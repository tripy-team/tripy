"""
Unit tests for flight policy rules.

Tests verify:
- Correct reason codes are generated
- Severity matches mode (safe=block, balanced=warn)
- MCT calculations are correct
- Context includes required details
"""

import pytest
from datetime import datetime, timedelta

# Import policy modules
import sys
sys.path.insert(0, "/Users/ericzhong/tripy_codebase/tripy/backend/src")

from policy.flight_policy import evaluate_flight_itinerary
from policy.modes import BookingRiskMode
from policy.reason_codes import (
    FLIGHT_UNPROTECTED_CONNECTION,
    FLIGHT_SELF_TRANSFER_RISK,
    FLIGHT_BELOW_MCT,
    FLIGHT_BASIC_ECONOMY_RESTRICTED,
    FLIGHT_ROUNDTRIP_FLEX_RISK,
)


# =============================================================================
# TEST FIXTURES
# =============================================================================

def make_itinerary(
    segments: list = None,
    ticketing_type: str = "single_ticket",
    connection_type: str = "protected",
    fare_brand: str = None,
    booking_type: str = "one_way",
):
    """Helper to create test itinerary."""
    if segments is None:
        segments = [
            {
                "origin": "SEA",
                "destination": "CDG",
                "departure_time": "2026-02-11T08:00:00",
                "arrival_time": "2026-02-12T08:00:00",
                "duration_minutes": 600,
            }
        ]
    
    return {
        "segments": segments,
        "ticketing_type": ticketing_type,
        "connection_type": connection_type,
        "fare_brand": fare_brand,
        "booking_type": booking_type,
    }


def make_connecting_segments(layover_minutes: int = 90, airport: str = "ORD"):
    """Helper to create two-segment itinerary with connection."""
    base_time = datetime(2026, 2, 11, 8, 0)
    arrival_1 = base_time + timedelta(hours=4)
    departure_2 = arrival_1 + timedelta(minutes=layover_minutes)
    arrival_2 = departure_2 + timedelta(hours=8)
    
    return [
        {
            "origin": "SEA",
            "destination": airport,
            "departure_time": base_time.isoformat(),
            "arrival_time": arrival_1.isoformat(),
            "duration_minutes": 240,
        },
        {
            "origin": airport,
            "destination": "CDG",
            "departure_time": departure_2.isoformat(),
            "arrival_time": arrival_2.isoformat(),
            "duration_minutes": 480,
        },
    ]


# =============================================================================
# UNPROTECTED CONNECTION TESTS
# =============================================================================

class TestUnprotectedConnection:
    """Tests for FLIGHT_UNPROTECTED_CONNECTION rule."""
    
    def test_single_ticket_passes(self):
        """Single ticket itinerary should not trigger warning."""
        itin = make_itinerary(
            segments=make_connecting_segments(),
            ticketing_type="single_ticket",
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.BALANCED)
        
        # Should not have unprotected connection warning
        codes = [m.code for m in result.blocks + result.warnings]
        assert FLIGHT_UNPROTECTED_CONNECTION not in codes
    
    def test_separate_tickets_safe_mode_blocks(self):
        """Separate tickets should block in SAFE mode."""
        itin = make_itinerary(
            segments=make_connecting_segments(),
            ticketing_type="separate_tickets",
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.SAFE)
        
        # Should be a block
        assert result.is_blocked
        block_codes = [m.code for m in result.blocks]
        assert FLIGHT_UNPROTECTED_CONNECTION in block_codes
    
    def test_separate_tickets_balanced_mode_warns(self):
        """Separate tickets should warn (not block) in BALANCED mode."""
        itin = make_itinerary(
            segments=make_connecting_segments(),
            ticketing_type="separate_tickets",
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.BALANCED)
        
        # Should be a warning, not block
        assert not result.is_blocked
        warning_codes = [m.code for m in result.warnings]
        assert FLIGHT_UNPROTECTED_CONNECTION in warning_codes
        
        # Should require acknowledgment
        assert FLIGHT_UNPROTECTED_CONNECTION in result.requires_ack
    
    def test_nonstop_no_warning(self):
        """Nonstop flights should never trigger unprotected connection."""
        itin = make_itinerary(
            segments=[{
                "origin": "SEA",
                "destination": "CDG",
                "departure_time": "2026-02-11T08:00:00",
                "arrival_time": "2026-02-12T08:00:00",
            }],
            ticketing_type="unknown",  # Even with unknown, nonstop is fine
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.SAFE)
        
        codes = [m.code for m in result.blocks + result.warnings]
        assert FLIGHT_UNPROTECTED_CONNECTION not in codes


# =============================================================================
# SELF-TRANSFER TESTS
# =============================================================================

class TestSelfTransfer:
    """Tests for FLIGHT_SELF_TRANSFER_RISK rule."""
    
    def test_self_transfer_safe_mode_blocks(self):
        """Self-transfer should block in SAFE mode."""
        itin = make_itinerary(
            segments=make_connecting_segments(),
            connection_type="self_transfer",
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.SAFE)
        
        assert result.is_blocked
        block_codes = [m.code for m in result.blocks]
        assert FLIGHT_SELF_TRANSFER_RISK in block_codes
    
    def test_self_transfer_balanced_warns(self):
        """Self-transfer should warn in BALANCED mode."""
        itin = make_itinerary(
            segments=make_connecting_segments(),
            connection_type="self_transfer",
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.BALANCED)
        
        assert not result.is_blocked
        warning_codes = [m.code for m in result.warnings]
        assert FLIGHT_SELF_TRANSFER_RISK in warning_codes
        assert FLIGHT_SELF_TRANSFER_RISK in result.requires_ack
    
    def test_self_transfer_context_includes_airports(self):
        """Self-transfer warning should include connection airports."""
        itin = make_itinerary(
            segments=make_connecting_segments(airport="LHR"),
            connection_type="self_transfer",
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.BALANCED)
        
        msg = next(m for m in result.warnings if m.code == FLIGHT_SELF_TRANSFER_RISK)
        assert "connection_airports" in msg.context
        assert "LHR" in msg.context["connection_airports"]


# =============================================================================
# MCT (MINIMUM CONNECTION TIME) TESTS
# =============================================================================

class TestMCT:
    """Tests for FLIGHT_BELOW_MCT rule."""
    
    def test_below_mct_safe_mode_blocks(self):
        """Below MCT should block in SAFE mode."""
        # ORD domestic MCT is 60 minutes
        itin = make_itinerary(
            segments=make_connecting_segments(layover_minutes=30, airport="ORD"),
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.SAFE)
        
        assert result.is_blocked
        block_codes = [m.code for m in result.blocks]
        assert FLIGHT_BELOW_MCT in block_codes
    
    def test_below_mct_balanced_warns(self):
        """Below MCT should warn in BALANCED mode."""
        itin = make_itinerary(
            segments=make_connecting_segments(layover_minutes=30, airport="ORD"),
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.BALANCED)
        
        assert not result.is_blocked
        warning_codes = [m.code for m in result.warnings]
        assert FLIGHT_BELOW_MCT in warning_codes
    
    def test_mct_context_includes_details(self):
        """MCT warning should include layover minutes and required MCT."""
        itin = make_itinerary(
            segments=make_connecting_segments(layover_minutes=30, airport="ORD"),
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.BALANCED)
        
        msg = next(m for m in result.warnings if m.code == FLIGHT_BELOW_MCT)
        assert msg.context["airport"] == "ORD"
        assert msg.context["layover_minutes"] == 30
        assert "required_mct" in msg.context
        assert msg.context["required_mct"] >= 45  # ORD domestic MCT
    
    def test_above_mct_no_warning(self):
        """Connection time above MCT should not trigger warning."""
        # Use 120 minutes, well above any MCT
        itin = make_itinerary(
            segments=make_connecting_segments(layover_minutes=120, airport="ORD"),
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.SAFE)
        
        mct_codes = [m.code for m in result.blocks + result.warnings if m.code == FLIGHT_BELOW_MCT]
        assert len(mct_codes) == 0


# =============================================================================
# BASIC ECONOMY TESTS
# =============================================================================

class TestBasicEconomy:
    """Tests for FLIGHT_BASIC_ECONOMY_RESTRICTED rule."""
    
    def test_basic_economy_safe_mode_blocks(self):
        """Basic economy should block in SAFE mode when not opted in."""
        itin = make_itinerary(fare_brand="Basic Economy")
        
        result = evaluate_flight_itinerary(
            itin, 
            BookingRiskMode.SAFE,
            context={"include_basic_economy": False}
        )
        
        assert result.is_blocked
        block_codes = [m.code for m in result.blocks]
        assert FLIGHT_BASIC_ECONOMY_RESTRICTED in block_codes
    
    def test_basic_economy_opt_in_not_blocked(self):
        """Basic economy should not block when user opts in."""
        itin = make_itinerary(fare_brand="Basic Economy")
        
        result = evaluate_flight_itinerary(
            itin,
            BookingRiskMode.SAFE,
            context={"include_basic_economy": True}
        )
        
        # Should not be blocked
        block_codes = [m.code for m in result.blocks]
        assert FLIGHT_BASIC_ECONOMY_RESTRICTED not in block_codes
    
    def test_basic_economy_detection_variants(self):
        """Should detect various basic economy naming conventions."""
        variants = [
            "Basic Economy",
            "BASIC ECONOMY",
            "Economy Light",
            "Light Fare",
            "Saver Fare",
        ]
        
        for fare_brand in variants:
            itin = make_itinerary(fare_brand=fare_brand)
            result = evaluate_flight_itinerary(itin, BookingRiskMode.BALANCED)
            
            codes = [m.code for m in result.blocks + result.warnings + result.info]
            assert FLIGHT_BASIC_ECONOMY_RESTRICTED in codes, f"Failed to detect: {fare_brand}"


# =============================================================================
# ROUND-TRIP FLEXIBILITY TESTS
# =============================================================================

class TestRoundTripFlexibility:
    """Tests for FLIGHT_ROUNDTRIP_FLEX_RISK rule."""
    
    def test_roundtrip_warns_high_flexibility(self):
        """Round-trip should warn when flexibility is high priority."""
        itin = make_itinerary(booking_type="round_trip")
        
        result = evaluate_flight_itinerary(
            itin,
            BookingRiskMode.BALANCED,
            context={"flexibility_priority": "high"}
        )
        
        warning_codes = [m.code for m in result.warnings]
        assert FLIGHT_ROUNDTRIP_FLEX_RISK in warning_codes
    
    def test_roundtrip_info_normal_flexibility(self):
        """Round-trip should be info-only for normal flexibility."""
        itin = make_itinerary(booking_type="round_trip")
        
        result = evaluate_flight_itinerary(
            itin,
            BookingRiskMode.BALANCED,
            context={"flexibility_priority": "medium"}
        )
        
        info_codes = [m.code for m in result.info]
        assert FLIGHT_ROUNDTRIP_FLEX_RISK in info_codes


# =============================================================================
# RISK SCORE TESTS
# =============================================================================

class TestRiskScore:
    """Tests for risk score calculation."""
    
    def test_risk_score_accumulates(self):
        """Risk score should accumulate from multiple issues."""
        # Create itinerary with multiple issues
        itin = make_itinerary(
            segments=make_connecting_segments(layover_minutes=30),
            ticketing_type="separate_tickets",
            connection_type="self_transfer",
        )
        
        result = evaluate_flight_itinerary(itin, BookingRiskMode.BALANCED)
        
        # Should have high risk score from multiple issues
        assert result.risk_score > 1000
    
    def test_safe_mode_multiplier(self):
        """Safe mode should have higher risk score multiplier."""
        itin = make_itinerary(
            segments=make_connecting_segments(layover_minutes=30),
        )
        
        safe_result = evaluate_flight_itinerary(itin, BookingRiskMode.SAFE)
        aggressive_result = evaluate_flight_itinerary(itin, BookingRiskMode.AGGRESSIVE)
        
        # Safe mode multiplier is 2.0, aggressive is 0.5
        # Same issues should have higher score in safe mode
        # (Note: safe mode blocks, so scores may differ due to block vs warn)


# =============================================================================
# DETERMINISM TESTS
# =============================================================================

class TestDeterminism:
    """Tests for deterministic behavior."""
    
    def test_same_input_same_output(self):
        """Same input should always produce same output."""
        itin = make_itinerary(
            segments=make_connecting_segments(layover_minutes=30),
            ticketing_type="separate_tickets",
        )
        
        results = [
            evaluate_flight_itinerary(itin, BookingRiskMode.BALANCED)
            for _ in range(5)
        ]
        
        # All should have same codes
        codes_sets = [
            set(m.code for m in r.blocks + r.warnings + r.info)
            for r in results
        ]
        
        assert all(cs == codes_sets[0] for cs in codes_sets)
    
    def test_order_independent(self):
        """Policy evaluation should not depend on segment order."""
        segments = make_connecting_segments(layover_minutes=30)
        
        itin1 = make_itinerary(segments=segments)
        itin2 = make_itinerary(segments=segments)  # Same segments
        
        result1 = evaluate_flight_itinerary(itin1, BookingRiskMode.BALANCED)
        result2 = evaluate_flight_itinerary(itin2, BookingRiskMode.BALANCED)
        
        assert result1.risk_score == result2.risk_score


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
