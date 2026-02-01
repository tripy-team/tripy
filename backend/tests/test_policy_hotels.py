"""
Unit tests for hotel policy rules.

Tests verify:
- Nonrefundable rate warnings
- OTA loyalty loss warnings
- Resort fee disclosure
- Cancellation deadline warnings
"""

import pytest
from datetime import datetime, timedelta

# Import policy modules
import sys
sys.path.insert(0, "/Users/ericzhong/tripy_codebase/tripy/backend/src")

from policy.hotel_policy import evaluate_hotel_option
from policy.modes import BookingRiskMode
from policy.reason_codes import (
    HOTEL_NONREFUNDABLE_RISK,
    HOTEL_OTA_LOYALTY_LOSS,
    HOTEL_RESORT_FEES_PRESENT,
    HOTEL_PREPAY_REQUIRED,
    HOTEL_CANCELLATION_DEADLINE_SOON,
)


# =============================================================================
# TEST FIXTURES
# =============================================================================

def make_hotel(
    refundable: bool = True,
    total_price: float = 200.0,
    refundable_alternative_price: float = None,
    rate_source: str = "direct",
    mandatory_fees: float = 0,
    nights: int = 2,
    prepay_required: bool = False,
    cancel_deadline: str = None,
    chain: str = "Marriott",
):
    """Helper to create test hotel option."""
    return {
        "refundable": refundable,
        "total_price": total_price,
        "base_rate": total_price - mandatory_fees * nights,
        "refundable_alternative_price": refundable_alternative_price,
        "rate_source": rate_source,
        "mandatory_fees": mandatory_fees,
        "resort_fee": mandatory_fees,
        "nights": nights,
        "prepay_required": prepay_required,
        "cancel_deadline": cancel_deadline,
        "chain": chain,
        "hotel_name": "Test Hotel",
    }


# =============================================================================
# NONREFUNDABLE RATE TESTS
# =============================================================================

class TestNonrefundable:
    """Tests for HOTEL_NONREFUNDABLE_RISK rule."""
    
    def test_refundable_no_warning(self):
        """Refundable rates should not trigger warning."""
        hotel = make_hotel(refundable=True)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        codes = [m.code for m in result.blocks + result.warnings]
        assert HOTEL_NONREFUNDABLE_RISK not in codes
    
    def test_nonrefundable_triggers_warning(self):
        """Nonrefundable rates should trigger warning."""
        hotel = make_hotel(refundable=False)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        codes = [m.code for m in result.blocks + result.warnings + result.info]
        assert HOTEL_NONREFUNDABLE_RISK in codes
    
    def test_nonrefundable_within_threshold_warns_strongly(self):
        """Nonrefundable close to refundable price should warn more strongly."""
        hotel = make_hotel(
            refundable=False,
            total_price=200.0,
            refundable_alternative_price=210.0,  # Only 5% more
        )
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        # Should be a warning (stronger than info)
        warning_codes = [m.code for m in result.warnings]
        assert HOTEL_NONREFUNDABLE_RISK in warning_codes
        
        # Should require acknowledgment
        assert HOTEL_NONREFUNDABLE_RISK in result.requires_ack
    
    def test_nonrefundable_context_includes_prices(self):
        """Nonrefundable warning should include price comparison."""
        hotel = make_hotel(
            refundable=False,
            total_price=200.0,
            refundable_alternative_price=250.0,
        )
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        msg = next(m for m in result.blocks + result.warnings + result.info 
                   if m.code == HOTEL_NONREFUNDABLE_RISK)
        assert msg.context["total_price"] == 200.0
        assert msg.context["refundable_alternative_price"] == 250.0


# =============================================================================
# OTA LOYALTY LOSS TESTS
# =============================================================================

class TestOTALoyaltyLoss:
    """Tests for HOTEL_OTA_LOYALTY_LOSS rule."""
    
    def test_direct_booking_no_warning(self):
        """Direct bookings should not trigger OTA warning."""
        hotel = make_hotel(rate_source="direct")
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        codes = [m.code for m in result.blocks + result.warnings]
        assert HOTEL_OTA_LOYALTY_LOSS not in codes
    
    def test_ota_triggers_warning(self):
        """OTA bookings should trigger loyalty warning."""
        hotel = make_hotel(rate_source="ota", chain="marriott")
        
        result = evaluate_hotel_option(
            hotel,
            BookingRiskMode.BALANCED,
            context={"hotel_loyalty_programs": ["marriott"]}
        )
        
        codes = [m.code for m in result.blocks + result.warnings + result.info]
        assert HOTEL_OTA_LOYALTY_LOSS in codes
    
    def test_ota_elite_status_warns_more(self):
        """OTA with elite status should warn about lost benefits."""
        hotel = make_hotel(rate_source="ota", chain="hilton")
        
        result = evaluate_hotel_option(
            hotel,
            BookingRiskMode.BALANCED,
            context={"has_hotel_elite_status": True}
        )
        
        msg = next(m for m in result.blocks + result.warnings + result.info
                   if m.code == HOTEL_OTA_LOYALTY_LOSS)
        assert "elite" in msg.detail.lower()
    
    def test_ota_no_loyalty_lower_priority(self):
        """OTA without relevant loyalty should be lower priority."""
        hotel = make_hotel(rate_source="ota", chain="marriott")
        
        # User has Hilton loyalty but booking Marriott OTA
        result = evaluate_hotel_option(
            hotel,
            BookingRiskMode.BALANCED,
            context={"hotel_loyalty_programs": ["hilton"]}  # Different chain
        )
        
        # Should be info, not warning
        info_codes = [m.code for m in result.info]
        assert HOTEL_OTA_LOYALTY_LOSS in info_codes


# =============================================================================
# RESORT FEES TESTS
# =============================================================================

class TestResortFees:
    """Tests for HOTEL_RESORT_FEES_PRESENT rule."""
    
    def test_no_fees_no_warning(self):
        """Hotels without resort fees should not trigger warning."""
        hotel = make_hotel(mandatory_fees=0)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        codes = [m.code for m in result.blocks + result.warnings + result.info]
        assert HOTEL_RESORT_FEES_PRESENT not in codes
    
    def test_resort_fee_triggers_warning(self):
        """Resort fees should trigger warning."""
        hotel = make_hotel(mandatory_fees=35, nights=3)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        codes = [m.code for m in result.blocks + result.warnings + result.info]
        assert HOTEL_RESORT_FEES_PRESENT in codes
    
    def test_resort_fee_context_includes_totals(self):
        """Resort fee warning should include per-night and total."""
        hotel = make_hotel(mandatory_fees=35, nights=3)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        msg = next(m for m in result.blocks + result.warnings + result.info
                   if m.code == HOTEL_RESORT_FEES_PRESENT)
        assert msg.context["mandatory_fees_per_night"] == 35
        assert msg.context["total_fees"] == 105  # 35 * 3
        assert msg.context["nights"] == 3
    
    def test_high_resort_fee_warns(self):
        """High resort fees (>10% of rate) should warn more strongly."""
        hotel = make_hotel(
            mandatory_fees=50,  # $50/night
            total_price=300,  # ~$100/night base
            nights=3,
        )
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        # Should be a warning, not just info
        warning_codes = [m.code for m in result.warnings]
        assert HOTEL_RESORT_FEES_PRESENT in warning_codes


# =============================================================================
# PREPAYMENT TESTS
# =============================================================================

class TestPrepayment:
    """Tests for HOTEL_PREPAY_REQUIRED rule."""
    
    def test_no_prepay_no_message(self):
        """Hotels without prepayment should not trigger message."""
        hotel = make_hotel(prepay_required=False)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        codes = [m.code for m in result.blocks + result.warnings + result.info]
        assert HOTEL_PREPAY_REQUIRED not in codes
    
    def test_prepay_triggers_info(self):
        """Prepayment required should trigger info message."""
        hotel = make_hotel(prepay_required=True)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        info_codes = [m.code for m in result.info]
        assert HOTEL_PREPAY_REQUIRED in info_codes


# =============================================================================
# CANCELLATION DEADLINE TESTS
# =============================================================================

class TestCancellationDeadline:
    """Tests for HOTEL_CANCELLATION_DEADLINE_SOON rule."""
    
    def test_no_deadline_no_message(self):
        """Hotels without deadline should not trigger message."""
        hotel = make_hotel(cancel_deadline=None)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        codes = [m.code for m in result.blocks + result.warnings + result.info]
        assert HOTEL_CANCELLATION_DEADLINE_SOON not in codes
    
    def test_deadline_far_no_message(self):
        """Far-future deadline should not trigger message."""
        far_future = (datetime.now() + timedelta(days=30)).isoformat()
        hotel = make_hotel(cancel_deadline=far_future)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        codes = [m.code for m in result.blocks + result.warnings + result.info]
        assert HOTEL_CANCELLATION_DEADLINE_SOON not in codes
    
    def test_deadline_soon_warns(self):
        """Approaching deadline should trigger warning."""
        soon = (datetime.now() + timedelta(days=2)).isoformat()
        hotel = make_hotel(cancel_deadline=soon)
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        codes = [m.code for m in result.blocks + result.warnings + result.info]
        assert HOTEL_CANCELLATION_DEADLINE_SOON in codes


# =============================================================================
# TRUE TOTAL COST TESTS
# =============================================================================

class TestTrueTotalCost:
    """Tests for true total cost calculation including fees."""
    
    def test_explanation_includes_true_total(self):
        """Explanation should include true total with fees."""
        hotel = make_hotel(
            total_price=300,
            mandatory_fees=35,
            nights=3,
        )
        
        result = evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
        
        # Should have explanation about true total
        true_total = 300 + (35 * 3)  # 405
        has_true_total = any(
            str(true_total) in exp or "405" in exp
            for exp in result.explanations
        )
        assert has_true_total


# =============================================================================
# DETERMINISM TESTS
# =============================================================================

class TestDeterminism:
    """Tests for deterministic behavior."""
    
    def test_same_input_same_output(self):
        """Same input should always produce same output."""
        hotel = make_hotel(
            refundable=False,
            rate_source="ota",
            mandatory_fees=35,
        )
        
        results = [
            evaluate_hotel_option(hotel, BookingRiskMode.BALANCED)
            for _ in range(5)
        ]
        
        # All should have same codes
        codes_sets = [
            set(m.code for m in r.blocks + r.warnings + r.info)
            for r in results
        ]
        
        assert all(cs == codes_sets[0] for cs in codes_sets)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
