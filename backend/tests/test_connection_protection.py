"""
Tests for V4 connection protection system.

Tests cover:
- Protection derivation from provider contracts
- Transfer type detection (airside vs landside)
- Policy-driven validation
- Regression tests for critical bugs
"""

import pytest
from datetime import datetime

from backend.src.optimization.models_v3 import FlightItineraryEdge, FlightSegment
from backend.src.optimization.enums import (
    TicketingType, ConnectionProtection, SelfTransferRequired,
    TransferType, TransferConfidence,
)
from backend.src.optimization.derivation import finalize_itinerary
from backend.src.optimization.validators import validate_connection_eligibility
from backend.src.optimization.validation_policy import (
    STRICT_MVP_POLICY, PERMISSIVE_POLICY, ALLOW_ALL_POLICY,
)
from backend.src.optimization.airport_data import (
    get_airport_country, is_us_airport, has_us_preclearance,
    is_valid_iata, is_same_airport_code, clear_cache,
)


# =============================================================================
# TEST FIXTURES
# =============================================================================

def make_segment(origin: str, dest: str, hour: int = 8) -> FlightSegment:
    """Create a test flight segment."""
    return FlightSegment(
        segment_id=f"seg_{origin}_{dest}",
        flight_number="UA100",
        operating_carrier="UA",
        marketing_carrier="UA",
        origin=origin,
        destination=dest,
        departure=datetime(2024, 6, 15, hour, 0),
        arrival=datetime(2024, 6, 15, hour + 3, 0),
        cabin="economy",
    )


def make_edge(
    segments: list,
    pricing_source: str = "unknown",
    offer_id: str = None,
    finalize: bool = True,
    **kwargs,
) -> FlightItineraryEdge:
    """
    Helper to create test edges.
    
    Args:
        segments: List of (origin, destination) tuples
        pricing_source: Provider source
        offer_id: Optional offer ID
        finalize: If True (default), call finalize_itinerary(). 
                  Set to False if you need to modify the edge before finalizing.
        **kwargs: Additional edge fields
    """
    segs = [make_segment(s[0], s[1], i * 3) for i, s in enumerate(segments)]
    
    edge = FlightItineraryEdge(
        edge_id=f"test_{segments[0][0]}_{segments[-1][1]}",
        leg_id=0,
        origin=segments[0][0],
        destination=segments[-1][1],
        segments=segs,
        pricing_source=pricing_source,
        offer_id=offer_id,
        **kwargs,
    )
    if finalize:
        return finalize_itinerary(edge)
    return edge


def make_edge_raw(
    segments: list,
    pricing_source: str = "unknown",
    offer_id: str = None,
    **kwargs,
) -> FlightItineraryEdge:
    """
    Helper to create NON-finalized test edges.
    
    Use when you need to modify edge attributes before validation,
    then call finalize_itinerary() manually.
    
    This respects the immutability-after-finalize rule.
    """
    return make_edge(segments, pricing_source, offer_id, finalize=False, **kwargs)


# =============================================================================
# PROTECTION DERIVATION TESTS
# =============================================================================

class TestProtectionDerivation:
    """Test that protection is derived correctly from provider contracts."""
    
    def test_direct_flight_always_protected(self):
        """Direct flights are trivially protected."""
        edge = make_edge([("JFK", "LAX")], pricing_source="unknown")
        
        assert edge.is_direct
        assert edge.connection_protection == ConnectionProtection.AIRLINE_PROTECTED
        assert edge.self_transfer_required == SelfTransferRequired.NO
        assert edge.transfer_type == TransferType.NOT_APPLICABLE
    
    def test_gds_offer_is_protected(self):
        """GDS priced offer = airline protected."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="AMADEUS123",
        )
        
        assert edge.connection_protection == ConnectionProtection.AIRLINE_PROTECTED
        assert edge.self_transfer_required == SelfTransferRequired.NO
        assert edge.ticketing_type == TicketingType.SINGLE_TICKET
    
    def test_duffel_offer_is_protected(self):
        """Duffel (GDS aggregator) = airline protected."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="duffel",
            offer_id="DUFFEL_OFFER_123",
        )
        
        assert edge.connection_protection == ConnectionProtection.AIRLINE_PROTECTED
    
    def test_kiwi_is_self_transfer(self):
        """Kiwi virtual interline = self-transfer."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="kiwi",
            offer_id="KIWI123",
        )
        
        assert edge.self_transfer_required == SelfTransferRequired.YES
        assert edge.connection_protection == ConnectionProtection.OTA_GUARANTEE
    
    def test_unknown_source_is_unknown(self):
        """Unknown source = unknown protection."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="some_random_api",
        )
        
        assert edge.connection_protection == ConnectionProtection.UNKNOWN
        assert edge.self_transfer_required == SelfTransferRequired.UNKNOWN
        assert edge.ticketing_type == TicketingType.UNKNOWN
    
    def test_offer_without_trusted_source_is_unknown(self):
        """Offer ID from untrusted source doesn't guarantee protection."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="google_flights",
            offer_id="SOME_ID",
        )
        
        # Has artifact but source is low trust
        assert edge.pricing_artifact_present
        assert edge.connection_protection == ConnectionProtection.UNKNOWN
        assert edge.ticketing_type == TicketingType.UNKNOWN
    
    def test_discovery_source_not_protected(self):
        """Discovery sources (seats.aero, point.me) are NOT high trust."""
        for source in ["seats_aero", "point_me", "awardtool"]:
            edge = make_edge(
                [("JFK", "ORD"), ("ORD", "LAX")],
                pricing_source=source,
                offer_id="DISCOVERY_ID_123",
            )
            
            # Discovery ID ≠ Bookable offer ID
            assert edge.pricing_artifact_present
            assert edge.connection_protection == ConnectionProtection.UNKNOWN
            assert edge.ticketing_type == TicketingType.UNKNOWN
    
    def test_medium_trust_does_not_assert_single_ticket(self):
        """Medium trust sources should NOT assert SINGLE_TICKET."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="awardtool",
            offer_id="DISCOVERY_123",
        )
        
        # Critical: ticketing_type must remain UNKNOWN
        assert edge.ticketing_type == TicketingType.UNKNOWN
        assert edge.connection_protection == ConnectionProtection.UNKNOWN


# =============================================================================
# TRANSFER TYPE TESTS
# =============================================================================

class TestTransferType:
    """Test transfer type derivation."""
    
    def test_direct_flight_not_applicable(self):
        """Direct flights have no transfer."""
        edge = make_edge([("JFK", "LAX")], pricing_source="amadeus")
        
        assert edge.transfer_type == TransferType.NOT_APPLICABLE
    
    def test_same_airport_is_airside(self):
        """Same airport connection = airside."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        assert edge.transfer_type == TransferType.AIRSIDE
    
    def test_different_airports_is_landside(self):
        """Different airports = landside."""
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="CDG",
            segments=[
                make_segment("JFK", "LHR"),
                make_segment("LGW", "CDG"),  # LHR → LGW is different airports!
            ],
        )
        edge = finalize_itinerary(edge)
        
        assert edge.transfer_type == TransferType.LANDSIDE_REQUIRED
        assert edge.transfer_confidence == TransferConfidence.HIGH
    
    def test_us_port_of_entry_is_landside(self):
        """International arrival at US airport = landside (customs)."""
        edge = make_edge(
            [("LHR", "JFK"), ("JFK", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        # Even with protection, landside is required at JFK (US entry)
        assert edge.transfer_type == TransferType.LANDSIDE_REQUIRED
        assert "customs" in edge.landside_reasons[0].lower() or "port of entry" in edge.landside_reasons[0].lower()
    
    def test_preclearance_avoids_landside(self):
        """US preclearance airport avoids landside at arrival."""
        edge = make_edge(
            [("DUB", "JFK"), ("JFK", "LAX")],  # DUB has preclearance
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        # DUB has US preclearance, so no port of entry at JFK
        assert edge.transfer_type == TransferType.AIRSIDE


# =============================================================================
# VALIDATOR TESTS
# =============================================================================

class TestValidator:
    """Test the eligibility validator with policy-driven rules."""
    
    def test_direct_always_passes(self):
        """Direct flights always pass regardless of source."""
        edge = make_edge([("JFK", "LAX")], pricing_source="unknown")
        
        filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 1
    
    def test_protected_connection_passes(self):
        """Protected connection with no self-transfer passes."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 1
    
    def test_unknown_protection_dropped_strict(self):
        """Unknown protection dropped in strict mode."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="unknown",
        )
        
        filtered, reasons = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 0
        assert any("protection" in r for r in reasons)
    
    def test_ota_guarantee_dropped_in_strict_policy(self):
        """OTA guarantee is NOT enough for strict MVP policy."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="kiwi",
            offer_id="KIWI123",
        )
        
        # Kiwi has OTA_GUARANTEE but strict policy only allows AIRLINE_PROTECTED
        filtered, reasons = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 0
    
    def test_ota_guarantee_allowed_in_permissive_policy(self):
        """OTA guarantee passes with permissive policy (if no self-transfer)."""
        # Use make_edge_raw to modify BEFORE finalize (respects immutability rule)
        edge = make_edge_raw(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        # Set attributes before finalization
        edge.connection_protection = ConnectionProtection.OTA_GUARANTEE
        edge.self_transfer_required = SelfTransferRequired.NO
        # Now finalize
        edge = finalize_itinerary(edge)
        
        filtered, _ = validate_connection_eligibility([edge], policy=PERMISSIVE_POLICY)
        assert len(filtered) == 1
    
    def test_self_transfer_dropped_even_with_protection(self):
        """Self-transfer always dropped when require_explicit_no_self_transfer=True."""
        # Use make_edge_raw to modify before finalize (respects immutability)
        edge = make_edge_raw(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        # Force self-transfer before finalization
        edge.self_transfer_required = SelfTransferRequired.YES
        edge = finalize_itinerary(edge)
        
        filtered, reasons = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 0
        assert any("self_transfer" in r for r in reasons)
    
    def test_landside_warning_not_blocking(self):
        """Landside transfer is warned but not blocked."""
        edge = make_edge(
            [("LHR", "JFK"), ("JFK", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="PROTECTED",
        )
        
        filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        
        # Passes despite landside transfer
        assert len(filtered) == 1
        # But has warning
        assert edge.transfer_type == TransferType.LANDSIDE_REQUIRED
        assert len(edge.connection_warnings) > 0
    
    def test_discovery_source_dropped(self):
        """Discovery sources are dropped because they can't confirm protection."""
        for source in ["seats_aero", "point_me", "awardtool"]:
            edge = make_edge(
                [("JFK", "ORD"), ("ORD", "LAX")],
                pricing_source=source,
                offer_id="DISCOVERY_123",
            )
            
            filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
            assert len(filtered) == 0, f"Expected {source} to be dropped"


# =============================================================================
# NUM STOPS HINT TESTS
# =============================================================================

class TestNumStopsHint:
    """Test that num_stops_hint prevents false direct detection."""
    
    def test_hint_overrides_segment_count(self):
        """num_stops_hint should override segment count."""
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="LAX",
            segments=[make_segment("JFK", "LAX")],
            num_stops_hint=1,  # Provider says 1 stop!
        )
        edge = finalize_itinerary(edge)
        
        assert edge.num_stops == 1
        assert not edge.is_direct
    
    def test_missing_segments_marked_incomplete(self):
        """Edge with fewer segments than hint should be marked incomplete."""
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="LAX",
            segments=[make_segment("JFK", "LAX")],
            num_stops_hint=2,  # Provider says 2 stops but we only have 1 segment
        )
        edge = finalize_itinerary(edge)
        
        assert edge.segments_incomplete
        assert edge.num_stops == 2
        assert not edge.is_direct
    
    def test_incomplete_without_protection_dropped(self):
        """Incomplete segments without protection are dropped."""
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="LAX",
            segments=[make_segment("JFK", "LAX")],
            num_stops_hint=1,
            pricing_source="unknown",
        )
        edge = finalize_itinerary(edge)
        
        filtered, _ = validate_connection_eligibility([edge], policy=STRICT_MVP_POLICY)
        assert len(filtered) == 0


# =============================================================================
# AIRPORT DATA TESTS
# =============================================================================

class TestAirportData:
    """Test airport data module."""
    
    def setup_method(self):
        """Clear cache before each test."""
        clear_cache()
    
    def test_get_airport_country(self):
        """Test country lookup."""
        assert get_airport_country("JFK") == "US"
        assert get_airport_country("LHR") == "GB"
        assert get_airport_country("CDG") == "FR"
        assert get_airport_country("YYZ") == "CA"
    
    def test_is_us_airport(self):
        """Test US airport detection."""
        assert is_us_airport("JFK")
        assert is_us_airport("LAX")
        assert not is_us_airport("LHR")
        assert not is_us_airport("YYZ")
    
    def test_has_us_preclearance(self):
        """Test preclearance detection."""
        assert has_us_preclearance("YYZ")  # Toronto
        assert has_us_preclearance("DUB")  # Dublin
        assert has_us_preclearance("AUH")  # Abu Dhabi
        assert not has_us_preclearance("LHR")  # London
        assert not has_us_preclearance("CDG")  # Paris
    
    def test_is_valid_iata(self):
        """Test IATA code validation."""
        assert is_valid_iata("JFK")
        assert is_valid_iata("LHR")
        assert not is_valid_iata("XXX")  # Invalid
        assert not is_valid_iata("")
        assert not is_valid_iata(None)
    
    def test_is_same_airport_code(self):
        """Test same airport check."""
        assert is_same_airport_code("JFK", "JFK")
        assert is_same_airport_code("jfk", "JFK")  # Case insensitive
        assert not is_same_airport_code("JFK", "EWR")
        assert not is_same_airport_code("JFK", "LGA")


# =============================================================================
# REGRESSION TESTS
# =============================================================================

class TestRegressions:
    """Tests for specific bugs that were fixed."""
    
    def test_offer_id_doesnt_guarantee_protection_from_untrusted_source(self):
        """
        Regression: offer_id alone was being treated as proof of protection.
        Fix: must check provider contract trust level.
        """
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="random_ota",
            offer_id="THEIR_OFFER_123",
        )
        
        # Has artifact but source is not trusted
        assert edge.pricing_artifact_present
        assert edge.connection_protection == ConnectionProtection.UNKNOWN
        assert edge.ticketing_type == TicketingType.UNKNOWN
    
    def test_single_segment_with_stop_hint_is_connection(self):
        """
        Regression: missing segments made connection look direct.
        Fix: num_stops_hint overrides len(segments)-1.
        """
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="LAX",
            segments=[make_segment("JFK", "LAX")],
            num_stops_hint=1,
        )
        edge = finalize_itinerary(edge)
        
        assert edge.num_stops == 1
        assert not edge.is_direct
    
    def test_medium_trust_source_doesnt_assert_single_ticket(self):
        """
        Regression: medium trust sources were asserting SINGLE_TICKET.
        Fix: only high-trust sources can assert ticketing_type.
        """
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="awardtool",
            offer_id="DISCOVERY_123",
        )
        
        # Discovery ID ≠ Bookable offer - can't assert single ticket
        assert edge.ticketing_type == TicketingType.UNKNOWN
        assert edge.connection_protection == ConnectionProtection.UNKNOWN
    
    def test_chain_break_detected_as_landside(self):
        """
        Regression: segment chain breaks were silently ignored.
        Fix: chain breaks are now recorded and treated as HIGH confidence landside.
        """
        edge = FlightItineraryEdge(
            edge_id="test",
            leg_id=0,
            origin="JFK",
            destination="CDG",
            segments=[
                make_segment("JFK", "LHR"),
                make_segment("LGW", "CDG"),  # LHR→LGW break!
            ],
        )
        edge = finalize_itinerary(edge)
        
        # Chain break should be detected
        assert len(edge._chain_breaks) == 1
        assert edge.transfer_type == TransferType.LANDSIDE_REQUIRED
        assert edge.transfer_confidence == TransferConfidence.HIGH
        assert any("Airport change" in r for r in edge.landside_reasons)
    
    def test_ota_guarantee_not_treated_as_airline_protected(self):
        """
        Regression: OTA_GUARANTEE was being treated same as AIRLINE_PROTECTED.
        Fix: is_airline_protected only returns True for AIRLINE_PROTECTED.
        """
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="kiwi",
            offer_id="KIWI123",
        )
        
        assert edge.connection_protection == ConnectionProtection.OTA_GUARANTEE
        assert not edge.is_airline_protected
        assert edge.has_some_protection


# =============================================================================
# IMMUTABILITY TESTS
# =============================================================================

class TestImmutability:
    """Test that the immutability rule is respected."""
    
    def test_finalized_edge_preserves_pre_set_values(self):
        """Pre-set values should be preserved after finalization."""
        edge = make_edge_raw(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
        )
        
        # Pre-set protection (simulating adapter with special knowledge)
        edge.connection_protection = ConnectionProtection.OTA_GUARANTEE
        edge.self_transfer_required = SelfTransferRequired.NO
        
        edge = finalize_itinerary(edge)
        
        # Pre-set values should be preserved
        assert edge.connection_protection == ConnectionProtection.OTA_GUARANTEE
        assert edge.self_transfer_required == SelfTransferRequired.NO
    
    def test_double_finalize_is_idempotent(self):
        """Calling finalize twice should be safe."""
        edge = make_edge(
            [("JFK", "ORD"), ("ORD", "LAX")],
            pricing_source="amadeus_gds",
            offer_id="TEST",
        )
        
        # Already finalized, finalize again
        edge2 = finalize_itinerary(edge)
        
        # Should be same object, unchanged
        assert edge2 is edge
        assert edge2._finalized
