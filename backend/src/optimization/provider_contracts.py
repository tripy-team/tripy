"""
Provider contracts for flight pricing sources.

This defines what guarantees each provider offers, allowing the derivation
pipeline to correctly determine protection levels.

IMPORTANT: "Discovery ID" ≠ "Bookable offer ID"
Discovery sources show availability but don't provide ticketing guarantees.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class ProviderContract:
    """
    Contract defining what a pricing source guarantees.
    
    Fields:
        provider_id: Unique identifier matching pricing_source field
        display_name: Human-readable name
        offers_airline_ticketing: Can this source issue airline tickets?
        offers_airline_protection: Do offers include airline misconnect protection?
        does_virtual_interlining: Does this source do virtual interlining?
        offers_ota_guarantee: Does OTA offer their own guarantee?
        trust_level: "high" (GDS/NDC), "medium" (some verification), "low" (aggregator)
    """
    
    provider_id: str
    display_name: str
    offers_airline_ticketing: bool
    offers_airline_protection: bool
    does_virtual_interlining: bool
    offers_ota_guarantee: bool
    trust_level: str  # "high", "medium", "low"


# =============================================================================
# PROVIDER CONTRACT REGISTRY
# =============================================================================

PROVIDER_CONTRACTS = {
    # ─────────────────────────────────────────────────────────────────────────
    # GDS / NDC (HIGH TRUST)
    # These connect directly to airline inventory and issue real tickets
    # ─────────────────────────────────────────────────────────────────────────
    
    "amadeus_gds": ProviderContract(
        provider_id="amadeus_gds",
        display_name="Amadeus GDS",
        offers_airline_ticketing=True,
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
    
    "amadeus": ProviderContract(
        provider_id="amadeus",
        display_name="Amadeus",
        offers_airline_ticketing=True,
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
    
    "sabre": ProviderContract(
        provider_id="sabre",
        display_name="Sabre GDS",
        offers_airline_ticketing=True,
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
    
    "duffel": ProviderContract(
        provider_id="duffel",
        display_name="Duffel",
        offers_airline_ticketing=True,  # GDS aggregator
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
    
    # ─────────────────────────────────────────────────────────────────────────
    # AWARD SEARCH / DISCOVERY (LOW-MEDIUM TRUST)
    # 
    # IMPORTANT: These are DISCOVERY layers, not ticketing/booking sources.
    # They show availability/pricing but the actual ticket is issued elsewhere.
    # "Discovery ID" ≠ "Bookable offer ID"
    # 
    # Only upgrade to high trust if you have a REAL booking artifact
    # from an airline booking flow that yields an actual PNR.
    # ─────────────────────────────────────────────────────────────────────────
    
    "awardtool": ProviderContract(
        provider_id="awardtool",
        display_name="AwardTool",
        offers_airline_ticketing=False,  # Discovery layer only
        offers_airline_protection=False,  # Can't guarantee until booked
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="medium",  # Shows real availability but not bookable artifact
    ),
    
    "seats_aero": ProviderContract(
        provider_id="seats_aero",
        display_name="Seats.aero",
        offers_airline_ticketing=False,  # Discovery/aggregation
        offers_airline_protection=False,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="low",  # Aggregates from multiple sources
    ),
    
    "point_me": ProviderContract(
        provider_id="point_me",
        display_name="Point.me",
        offers_airline_ticketing=False,  # Discovery
        offers_airline_protection=False,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="low",
    ),
    
    # ─────────────────────────────────────────────────────────────────────────
    # VIRTUAL INTERLINING (SELF-TRANSFER)
    # These explicitly book separate tickets and coordinate connections
    # ─────────────────────────────────────────────────────────────────────────
    
    "kiwi": ProviderContract(
        provider_id="kiwi",
        display_name="Kiwi.com",
        offers_airline_ticketing=False,  # Books separate tickets
        offers_airline_protection=False,
        does_virtual_interlining=True,
        offers_ota_guarantee=True,  # "Kiwi Guarantee"
        trust_level="medium",
    ),
    
    "skiplagged": ProviderContract(
        provider_id="skiplagged",
        display_name="Skiplagged",
        offers_airline_ticketing=False,
        offers_airline_protection=False,
        does_virtual_interlining=True,
        offers_ota_guarantee=False,
        trust_level="low",
    ),
    
    # ─────────────────────────────────────────────────────────────────────────
    # METASEARCH (LOW TRUST)
    # Show prices from multiple sources, no booking capability
    # ─────────────────────────────────────────────────────────────────────────
    
    "google_flights": ProviderContract(
        provider_id="google_flights",
        display_name="Google Flights",
        offers_airline_ticketing=False,
        offers_airline_protection=False,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="low",
    ),
    
    "skyscanner": ProviderContract(
        provider_id="skyscanner",
        display_name="Skyscanner",
        offers_airline_ticketing=False,
        offers_airline_protection=False,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="low",
    ),
    
    # ─────────────────────────────────────────────────────────────────────────
    # AIRLINE DIRECT (HIGH TRUST)
    # Direct from airline = definitely single ticket
    # ─────────────────────────────────────────────────────────────────────────
    
    "airline_direct": ProviderContract(
        provider_id="airline_direct",
        display_name="Airline Direct",
        offers_airline_ticketing=True,
        offers_airline_protection=True,
        does_virtual_interlining=False,
        offers_ota_guarantee=False,
        trust_level="high",
    ),
}


# Default contract for unknown providers
_DEFAULT_CONTRACT = ProviderContract(
    provider_id="unknown",
    display_name="Unknown",
    offers_airline_ticketing=False,
    offers_airline_protection=False,
    does_virtual_interlining=False,
    offers_ota_guarantee=False,
    trust_level="low",
)


def get_provider_contract(pricing_source: Optional[str]) -> ProviderContract:
    """
    Get the provider contract for a pricing source.
    
    Returns default (conservative) contract if source is unknown.
    """
    if not pricing_source:
        return _DEFAULT_CONTRACT
    
    # Normalize source name
    normalized = pricing_source.lower().strip().replace("-", "_").replace(" ", "_")
    
    return PROVIDER_CONTRACTS.get(normalized, _DEFAULT_CONTRACT)
