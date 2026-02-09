"""
Derivation pipeline for flight itinerary attributes.

Single entry point: finalize_itinerary(edge)

This derives all protection and transfer attributes in one place,
using provider contracts and airport data.
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional, TYPE_CHECKING

from .enums import (
    TicketingType, ConnectionProtection, SelfTransferRequired,
    TransferType, TransferConfidence, WarningSeverity, WarningCategory,
)
from .provider_contracts import get_provider_contract
from .airport_data import (
    is_us_airport, has_us_preclearance, get_airport_country,
    is_same_airport_code, is_valid_iata,
)

if TYPE_CHECKING:
    from .models_v3 import FlightItineraryEdge

logger = logging.getLogger(__name__)


# =============================================================================
# MAIN ENTRY POINT
# =============================================================================

def finalize_itinerary(edge: "FlightItineraryEdge") -> "FlightItineraryEdge":
    """
    Finalize a FlightItineraryEdge by deriving all attributes.
    
    This is the SINGLE place where protection/transfer attributes are computed.
    After this call, the edge should be treated as immutable.
    
    Pipeline:
    1. Compute completeness (segment chain integrity, num_stops)
    2. Derive protection (ticketing, connection protection, self-transfer)
    3. Derive transfer type (airside vs landside)
    4. Generate warnings
    
    Returns the same edge (mutated) for chaining.
    """
    
    if edge._finalized:
        return edge
    
    _compute_completeness(edge)
    _derive_protection(edge)
    _derive_transfer_type(edge)
    _generate_warnings(edge)
    
    edge._finalized = True
    return edge


# =============================================================================
# STEP 1: COMPUTE COMPLETENESS
# =============================================================================

def _compute_completeness(edge: "FlightItineraryEdge"):
    """
    Determine if segment data is complete and detect chain breaks.
    
    Chain breaks (segment[i].destination != segment[i+1].origin) are either:
    - Airport change (real - requires landside transfer)
    - Data corruption (bad parse)
    
    We record both for downstream handling.
    """
    
    # If no segments at all, definitely incomplete
    if not edge.segments:
        edge.segments_incomplete = True
        return
    
    # ═══════════════════════════════════════════════════════════════════════
    # Check segment chain integrity and record breaks
    # ═══════════════════════════════════════════════════════════════════════
    
    chain_breaks = []
    
    for i in range(len(edge.segments) - 1):
        s1, s2 = edge.segments[i], edge.segments[i + 1]
        
        if s1.destination and s2.origin and s1.destination != s2.origin:
            from_apt = s1.destination
            to_apt = s2.origin
            
            chain_breaks.append({
                "index": i,
                "from_airport": from_apt,
                "to_airport": to_apt,
            })
            
            # Determine if this is a real airport change vs parse corruption
            # If both are valid IATA codes, treat as transfer fact (no data quality warning)
            # If either is invalid/unknown, add data quality warning
            from_valid = is_valid_iata(from_apt)
            to_valid = is_valid_iata(to_apt)
            
            if not from_valid or not to_valid:
                # Unknown airport code - could be parse corruption
                _add_warning(
                    edge,
                    severity=WarningSeverity.WARNING,
                    category=WarningCategory.DATA_QUALITY,
                    message=f"Segment chain break with unknown airport: {from_apt} → {to_apt}",
                    conn_idx=i,
                )
            # If both valid, don't add DATA_QUALITY warning - _derive_transfer_type
            # will handle this as a transfer fact
    
    # Store chain breaks for transfer type derivation (HIGH confidence landside)
    edge._chain_breaks = chain_breaks
    
    # ═══════════════════════════════════════════════════════════════════════
    # Check if hint contradicts segments
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.num_stops_hint is not None:
        expected_segments = edge.num_stops_hint + 1
        if len(edge.segments) < expected_segments:
            edge.segments_incomplete = True
            logger.warning(
                f"{edge.edge_id}: Expected {expected_segments} segments "
                f"(from num_stops_hint={edge.num_stops_hint}), "
                f"got {len(edge.segments)}. Marking incomplete."
            )


# =============================================================================
# STEP 2: DERIVE PROTECTION
# =============================================================================

def _derive_protection(edge: "FlightItineraryEdge"):
    """
    Derive ticketing and protection attributes.
    
    Uses the provider contract to understand what guarantees exist.
    
    IMPORTANT: We only assert ticketing_type=SINGLE_TICKET when we have
    STRONG evidence. Medium/low trust sources leave it as UNKNOWN.
    "Discovery ID" ≠ "Bookable offer ID"
    
    NOTE: If fields are already set to non-default values, they are preserved.
    This allows tests and adapters to pre-set fields before finalization.
    """
    
    # Set pricing artifact flag first (separate from whether we trust it)
    edge.pricing_artifact_present = edge.has_priced_offer
    
    # ═══════════════════════════════════════════════════════════════════════
    # PRESERVE PRE-SET VALUES
    # If adapter or test has already set protection fields, don't overwrite
    # ═══════════════════════════════════════════════════════════════════════
    
    already_derived = (
        edge.connection_protection != ConnectionProtection.UNKNOWN or
        edge.self_transfer_required != SelfTransferRequired.UNKNOWN or
        edge.ticketing_type != TicketingType.UNKNOWN
    )
    if already_derived:
        # Fields were pre-set, preserve them
        return
    
    # Direct flights are trivially protected
    if edge.is_direct:
        edge.ticketing_type = TicketingType.SINGLE_TICKET
        edge.connection_protection = ConnectionProtection.AIRLINE_PROTECTED
        edge.self_transfer_required = SelfTransferRequired.NO
        edge.protection_provider = "airline"
        return
    
    # Get provider contract
    contract = get_provider_contract(edge.pricing_source)
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 0: Check for explicit self-transfer markers
    # Some providers explicitly mark virtual interline / self-transfer
    # ═══════════════════════════════════════════════════════════════════════
    
    # (This would come from raw provider data - adapter should extract it)
    # For now, check if provider is known to do virtual interlining
    if contract.does_virtual_interlining:
        edge.self_transfer_required = SelfTransferRequired.YES
        edge.ticketing_type = TicketingType.SEPARATE_TICKETS
        edge.connection_protection = ConnectionProtection.UNPROTECTED
        
        if contract.offers_ota_guarantee:
            # Provider offers their own guarantee (e.g., Kiwi Guarantee)
            edge.connection_protection = ConnectionProtection.OTA_GUARANTEE
            edge.protection_provider = f"{contract.display_name} Guarantee"
        
        return
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 0.5: Codeshare detection
    # Different operating carriers under the same marketing/validating
    # carrier are codeshare flights on a SINGLE reservation. This is NOT
    # the same as separate tickets / virtual interline.
    # E.g., DL selling AS 274 + BF 721 = single DL reservation.
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.segments and len(edge.segments) > 1:
        marketing_carriers = set()
        for seg in edge.segments:
            mkt = (seg.marketing_carrier or "").strip().upper()[:2]
            if mkt:
                marketing_carriers.add(mkt)
        
        validating = (edge.validating_carrier or "").strip().upper()[:2]
        
        # Check if segments are codeshare-unified under one carrier
        all_same_marketing = len(marketing_carriers) <= 1
        unified_by_validating = (
            validating and
            len(marketing_carriers) > 1 and
            validating not in marketing_carriers
        )
        
        if (all_same_marketing or unified_by_validating) and contract.trust_level == "high":
            # All segments are under one marketing carrier from a high-trust source
            # This is a codeshare itinerary on a single reservation
            edge.ticketing_type = TicketingType.SINGLE_TICKET
            edge.connection_protection = ConnectionProtection.AIRLINE_PROTECTED
            edge.self_transfer_required = SelfTransferRequired.NO
            edge.protection_provider = validating or (list(marketing_carriers)[0] if marketing_carriers else "airline")
            return
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 1: Check for priced offer from HIGH TRUST provider
    # Only high-trust providers can assert single-ticket + protected
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.has_priced_offer and contract.trust_level == "high":
        if contract.offers_airline_protection:
            edge.ticketing_type = TicketingType.SINGLE_TICKET
            edge.connection_protection = ConnectionProtection.AIRLINE_PROTECTED
            edge.self_transfer_required = SelfTransferRequired.NO
            edge.protection_provider = "airline"
            return
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 2: Has priced offer but provider not fully trusted
    # 
    # CRITICAL: Do NOT assert SINGLE_TICKET here!
    # "Discovery ID" from awardtool/seats.aero ≠ bookable single ticket
    # Keep everything UNKNOWN until user actually books via trusted channel
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.has_priced_offer and contract.trust_level in {"medium", "low"}:
        # We have a pricing artifact but can't trust it means single-ticket
        edge.ticketing_type = TicketingType.UNKNOWN  # NOT single_ticket!
        edge.connection_protection = ConnectionProtection.UNKNOWN
        edge.self_transfer_required = SelfTransferRequired.UNKNOWN
        # pricing_artifact_present=True (set above) lets downstream know
        # "there's something here but not verified"
        return
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 3: Has validating carrier (suggests ticketing POSSIBLE, not proven)
    # ═══════════════════════════════════════════════════════════════════════
    
    if edge.validating_carrier:
        # Validating carrier suggests someone COULD ticket it
        # But we don't have proof it WAS ticketed as single itinerary
        edge.ticketing_type = TicketingType.UNKNOWN  # NOT single_ticket!
        edge.connection_protection = ConnectionProtection.UNKNOWN
        edge.self_transfer_required = SelfTransferRequired.UNKNOWN
        return
    
    # ═══════════════════════════════════════════════════════════════════════
    # LEVEL 4: No evidence - all unknown
    # ═══════════════════════════════════════════════════════════════════════
    
    edge.ticketing_type = TicketingType.UNKNOWN
    edge.connection_protection = ConnectionProtection.UNKNOWN
    edge.self_transfer_required = SelfTransferRequired.UNKNOWN


# =============================================================================
# STEP 3: DERIVE TRANSFER TYPE
# =============================================================================

def _derive_transfer_type(edge: "FlightItineraryEdge"):
    """
    Derive physical transfer requirements at each connection.
    
    This is SEPARATE from protection - even a protected ticket
    can require landside transfer (e.g., US port of entry).
    """
    
    if edge.is_direct:
        # Direct flights have no transfer - not applicable
        edge.transfer_type = TransferType.NOT_APPLICABLE
        edge.transfer_confidence = TransferConfidence.HIGH
        return
    
    # Start optimistic for connections
    edge.transfer_type = TransferType.AIRSIDE
    edge.transfer_confidence = TransferConfidence.MEDIUM
    
    # ═══════════════════════════════════════════════════════════════════════
    # CHECK 0: Chain breaks from _compute_completeness (HIGH confidence)
    # These are definitively different airports
    # ═══════════════════════════════════════════════════════════════════════
    
    chain_breaks = getattr(edge, '_chain_breaks', [])
    for brk in chain_breaks:
        edge.transfer_type = TransferType.LANDSIDE_REQUIRED
        edge.transfer_confidence = TransferConfidence.HIGH
        reason = f"Airport change: {brk['from_airport']} → {brk['to_airport']}"
        if reason not in edge.landside_reasons:
            edge.landside_reasons.append(reason)
        
        # Different airports without explicit protection = self-transfer
        if edge.self_transfer_required == SelfTransferRequired.UNKNOWN:
            if edge.connection_protection != ConnectionProtection.AIRLINE_PROTECTED:
                edge.self_transfer_required = SelfTransferRequired.YES
    
    # ═══════════════════════════════════════════════════════════════════════
    # CHECK 1: Different airports (redundant with chain breaks but explicit)
    # ═══════════════════════════════════════════════════════════════════════
    
    for i in range(len(edge.segments) - 1):
        s1, s2 = edge.segments[i], edge.segments[i + 1]
        
        if not is_same_airport_code(s1.destination, s2.origin):
            # Skip if already recorded from chain breaks
            reason = f"Airport change: {s1.destination} → {s2.origin}"
            if reason not in edge.landside_reasons:
                edge.transfer_type = TransferType.LANDSIDE_REQUIRED
                edge.transfer_confidence = TransferConfidence.HIGH
                edge.landside_reasons.append(reason)
                
                # Different airports without protection = likely self-transfer
                if edge.self_transfer_required == SelfTransferRequired.UNKNOWN:
                    if edge.connection_protection != ConnectionProtection.AIRLINE_PROTECTED:
                        edge.self_transfer_required = SelfTransferRequired.YES
        
        # ═══════════════════════════════════════════════════════════════════
        # CHECK 2: US port of entry
        # ═══════════════════════════════════════════════════════════════════
        
        origin_country = get_airport_country(s1.origin)
        arrival_airport = s1.destination
        
        if _is_us_port_of_entry(origin_country, arrival_airport, s1.origin):
            edge.transfer_type = TransferType.LANDSIDE_REQUIRED
            edge.transfer_confidence = TransferConfidence.HIGH
            reason = f"US port of entry at {arrival_airport}: customs/immigration required"
            if reason not in edge.landside_reasons:
                edge.landside_reasons.append(reason)
        
        # ═══════════════════════════════════════════════════════════════════
        # CHECK 3: Other known landside requirements could go here
        # (Schengen/non-Schengen, etc. - not implemented for MVP)
        # ═══════════════════════════════════════════════════════════════════


def _is_us_port_of_entry(
    origin_country: Optional[str],
    arrival_airport: str,
    departure_airport: str,
) -> bool:
    """
    Check if arrival at a US airport constitutes a port of entry.
    
    Rules:
    - Arriving in US from non-US origin = port of entry
    - UNLESS departing from a US preclearance airport
    """
    
    if not is_us_airport(arrival_airport):
        return False
    
    # If origin is US, not a port of entry
    if origin_country == "US":
        return False
    
    # If departing from preclearance airport, not a port of entry
    if has_us_preclearance(departure_airport):
        return False
    
    # International arrival to US = port of entry
    return True


# =============================================================================
# STEP 4: GENERATE WARNINGS
# =============================================================================

def _generate_warnings(edge: "FlightItineraryEdge"):
    """
    Generate user-facing warnings about the itinerary.
    
    Warnings are informational - they don't affect eligibility.
    """
    
    # Direct flights don't need transfer warnings
    if edge.is_direct:
        return
    
    # Landside transfer warning
    if edge.transfer_type == TransferType.LANDSIDE_REQUIRED:
        reasons = "; ".join(edge.landside_reasons) if edge.landside_reasons else "physical transfer required"
        _add_warning(
            edge,
            severity=WarningSeverity.WARNING,
            category=WarningCategory.TRANSFER,
            message=f"Landside transfer required: {reasons}",
        )
    
    # Incomplete segments warning (if not already warned via chain breaks)
    if edge.segments_incomplete:
        existing_data_warnings = [
            w for w in edge.connection_warnings 
            if hasattr(w, 'category') and w.category == WarningCategory.DATA_QUALITY
        ]
        if not existing_data_warnings:
            _add_warning(
                edge,
                severity=WarningSeverity.INFO,
                category=WarningCategory.DATA_QUALITY,
                message="Segment data incomplete - some connection details may be missing",
            )


def _add_warning(
    edge: "FlightItineraryEdge",
    severity: WarningSeverity,
    category: WarningCategory,
    message: str,
    conn_idx: Optional[int] = None,
):
    """Add a warning to the edge."""
    
    warning = {
        "severity": severity.value,
        "category": category.value,
        "message": message,
    }
    if conn_idx is not None:
        warning["connection_index"] = conn_idx
    
    # For backwards compatibility, also add to connection_warnings as string
    edge.connection_warnings.append(message)
