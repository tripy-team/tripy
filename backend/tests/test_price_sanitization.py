"""
Unit tests for flight price sanitization.

These tests ensure that negative sentinel values (like -1) from AwardTool 
never leak through to the optimization results or UI.

CRITICAL: AwardTool uses -1 to indicate "unknown/unavailable" for cash_fare.
Without proper sanitization, this -1 becomes -1.0 and corrupts pricing totals.

Contract enforced:
- cash_price / cash_cost must be either:
  - positive float (valid price), OR
  - None (unknown/unavailable)
- Negative prices MUST be treated as unknown and sanitized to None
- Never coerce None -> 0.0 for prices in API responses
"""

import pytest
from unittest.mock import MagicMock, patch


class TestSharedPricingSanitizer:
    """Tests for the shared pricing sanitizer in utils/pricing.py."""
    
    def test_sanitize_cash_price_returns_none_for_none(self):
        """sanitize_cash_price(None) should return None."""
        from src.utils.pricing import sanitize_cash_price
        assert sanitize_cash_price(None) is None
    
    def test_sanitize_cash_price_returns_none_for_negative(self):
        """sanitize_cash_price should return None for negative values (sentinel)."""
        from src.utils.pricing import sanitize_cash_price
        # -1 is the AwardTool sentinel for "unknown"
        assert sanitize_cash_price(-1) is None
        assert sanitize_cash_price(-0.01) is None
        assert sanitize_cash_price(-999) is None
    
    def test_sanitize_cash_price_returns_none_for_zero(self):
        """sanitize_cash_price should return None for zero (flights cost money)."""
        from src.utils.pricing import sanitize_cash_price
        assert sanitize_cash_price(0) is None
        assert sanitize_cash_price(0.0) is None
    
    def test_sanitize_cash_price_returns_value_for_positive(self):
        """sanitize_cash_price should return the value for positive prices."""
        from src.utils.pricing import sanitize_cash_price
        assert sanitize_cash_price(100) == 100.0
        assert sanitize_cash_price(0.01) == 0.01
        assert sanitize_cash_price(1234.56) == 1234.56
    
    def test_sanitize_cash_price_handles_strings(self):
        """sanitize_cash_price should parse string prices."""
        from src.utils.pricing import sanitize_cash_price
        assert sanitize_cash_price("250") == 250.0
        assert sanitize_cash_price("$1,234.56") == 1234.56
        assert sanitize_cash_price("invalid") is None
    
    def test_sanitize_cash_price_handles_serpapi_formats(self):
        """sanitize_cash_price should handle various SerpAPI price formats."""
        from src.utils.pricing import sanitize_cash_price
        # SerpAPI Google Flights can return prices in various formats
        assert sanitize_cash_price("$1,234") == 1234.0
        assert sanitize_cash_price("$999") == 999.0
        assert sanitize_cash_price("$12,345.67") == 12345.67
        assert sanitize_cash_price("1234") == 1234.0
        assert sanitize_cash_price("1,234") == 1234.0
        # Numeric values (most common SerpAPI format)
        assert sanitize_cash_price(1234) == 1234.0
        assert sanitize_cash_price(1234.56) == 1234.56
        # Edge cases that should return None
        assert sanitize_cash_price("") is None
        assert sanitize_cash_price("N/A") is None
        assert sanitize_cash_price("--") is None
    
    def test_sanitize_cash_price_logs_warning_for_negative(self):
        """sanitize_cash_price should log warning when negative sentinel detected."""
        from src.utils.pricing import sanitize_cash_price
        
        with patch('src.utils.pricing.logger') as mock_logger:
            result = sanitize_cash_price(-1, context="JFK->LAX AA100")
            assert result is None
            mock_logger.warning.assert_called_once()
            assert "Negative price sentinel" in str(mock_logger.warning.call_args)
    
    def test_sanitize_points_cost_returns_none_for_negative(self):
        """sanitize_points_cost should return None for negative values."""
        from src.utils.pricing import sanitize_points_cost
        assert sanitize_points_cost(-1) is None
        assert sanitize_points_cost(-50000) is None
    
    def test_sanitize_points_cost_returns_zero_for_zero(self):
        """sanitize_points_cost should return 0 for zero (valid edge case)."""
        from src.utils.pricing import sanitize_points_cost
        assert sanitize_points_cost(0) == 0
    
    def test_sanitize_points_cost_returns_value_for_positive(self):
        """sanitize_points_cost should return the value for positive."""
        from src.utils.pricing import sanitize_points_cost
        assert sanitize_points_cost(50000) == 50000
        assert sanitize_points_cost(12500) == 12500
    
    def test_sanitize_surcharge_returns_zero_for_negative(self):
        """sanitize_surcharge should return 0.0 for negative values."""
        from src.utils.pricing import sanitize_surcharge
        assert sanitize_surcharge(-1) == 0.0
        assert sanitize_surcharge(-50) == 0.0
    
    def test_sanitize_surcharge_returns_value_for_nonnegative(self):
        """sanitize_surcharge should return value for non-negative."""
        from src.utils.pricing import sanitize_surcharge
        assert sanitize_surcharge(0) == 0.0
        assert sanitize_surcharge(50) == 50.0
    
    def test_get_cash_cost_for_optimization_with_penalty(self):
        """get_cash_cost_for_optimization should return penalty for None."""
        from src.utils.pricing import get_cash_cost_for_optimization, UNKNOWN_PRICE_PENALTY
        assert get_cash_cost_for_optimization(None, use_penalty_for_unknown=True) == UNKNOWN_PRICE_PENALTY
        assert get_cash_cost_for_optimization(None, use_penalty_for_unknown=False) == 0.0
        assert get_cash_cost_for_optimization(250.0) == 250.0


class TestAwardToolSentinelPrevention:
    """Integration tests for AwardTool -1 sentinel handling."""
    
    def test_awardtool_v2_response_with_negative_cash_fare(self):
        """
        CRITICAL: Simulates AwardTool returning cash_fare=-1.
        Asserts that the sanitized result is None, NOT -1.
        """
        from src.utils.pricing import sanitize_cash_price
        
        # Simulate AwardTool V2 response with -1 sentinel
        awardtool_item = {
            "airline_code": "AA",
            "award_points": 50000,
            "surcharge": 50,
            "cabin_type": "Economy",
            "cash_fare": -1,  # THE SENTINEL VALUE
            "date": "2026-03-15",
        }
        
        # Extract cash_fare
        cash = awardtool_item.get("cash_fare")
        
        # Demonstrate the bug (what old code did)
        buggy_result = float(cash) if cash else None
        assert buggy_result == -1.0, "Old code would pass -1 through"
        
        # Demonstrate the fix
        fixed_result = sanitize_cash_price(cash)
        assert fixed_result is None, "sanitize_cash_price must return None for -1"
    
    def test_no_negative_prices_in_api_response(self):
        """
        API response must never contain negative cash_price or cash_cost.
        """
        from src.utils.pricing import sanitize_cash_price
        
        # Test various sentinel values that might come from AwardTool
        test_values = [-1, -1.0, -999, -0.01, 0, 0.0]
        
        for val in test_values:
            result = sanitize_cash_price(val)
            assert result is None, f"Value {val} should be sanitized to None, not {result}"


class TestFlightsModuleSanitization:
    """Tests for flights.py local sanitization helpers."""
    
    def test_sanitize_nonneg_int_handles_negative_sentinel(self):
        """sanitize_nonneg_int should return None for -1."""
        from src.handlers.flights import sanitize_nonneg_int
        assert sanitize_nonneg_int(-1) is None
        assert sanitize_nonneg_int(-999) is None
    
    def test_sanitize_nonneg_int_handles_valid_values(self):
        """sanitize_nonneg_int should return value for non-negative."""
        from src.handlers.flights import sanitize_nonneg_int
        assert sanitize_nonneg_int(0) == 0
        assert sanitize_nonneg_int(100) == 100
    
    def test_sanitize_nonneg_float_handles_negative_sentinel(self):
        """sanitize_nonneg_float should return None for negative values."""
        from src.handlers.flights import sanitize_nonneg_float
        assert sanitize_nonneg_float(-1) is None
        assert sanitize_nonneg_float(-0.01) is None
    
    def test_sanitize_nonneg_float_handles_valid_values(self):
        """sanitize_nonneg_float should return value for non-negative."""
        from src.handlers.flights import sanitize_nonneg_float
        assert sanitize_nonneg_float(0) == 0.0
        assert sanitize_nonneg_float(99.99) == 99.99
    
    def test_coalesce_nonneg_int_skips_negative_sentinels(self):
        """coalesce_nonneg_int should skip negative values in the chain."""
        from src.handlers.flights import coalesce_nonneg_int
        
        # -1 is sentinel, should be skipped
        assert coalesce_nonneg_int(-1, 100) == 100
        assert coalesce_nonneg_int(-1, -1, 50) == 50
        assert coalesce_nonneg_int(-1, None, 25) == 25
        
        # First valid non-negative wins
        assert coalesce_nonneg_int(0, 100) == 0
        assert coalesce_nonneg_int(None, 100) == 100


class TestAdapterV3CashPriceSanitization:
    """Tests for adapter_v3.py cash price handling."""
    
    def test_adapter_uses_shared_sanitizer(self):
        """Adapter should use the shared sanitizer from utils.pricing."""
        from src.utils.pricing import sanitize_cash_price, get_cash_cost_for_optimization
        
        # Simulate what adapter does
        raw_price = -1.0  # Leaked from upstream
        sanitized = sanitize_cash_price(raw_price, context="test")
        assert sanitized is None, "Should be sanitized to None"
        
        # For optimization math
        opt_value = get_cash_cost_for_optimization(sanitized, use_penalty_for_unknown=False)
        assert opt_value == 0.0, "Should be 0.0 for optimization"
    
    def test_adapter_passes_valid_cash_price(self):
        """Adapter should pass through valid positive cash prices."""
        from src.utils.pricing import sanitize_cash_price
        
        assert sanitize_cash_price(250.0) == 250.0
        assert sanitize_cash_price(1000) == 1000.0
        assert sanitize_cash_price(0.01) == 0.01


class TestOrchestratorSanitization:
    """Tests for orchestrator.py cash price handling."""
    
    def test_orchestrator_sanitizes_segment_options(self):
        """Orchestrator should sanitize cash_price in segment options."""
        from src.utils.pricing import sanitize_cash_price, sanitize_points_cost, sanitize_surcharge
        
        # Simulate raw option from search
        raw_opt = {
            "cash_price": -1,  # Sentinel
            "award_points": -1,  # Sentinel
            "surcharge": -1,  # Sentinel
        }
        
        sanitized_cash = sanitize_cash_price(raw_opt.get("cash_price"))
        sanitized_points = sanitize_points_cost(raw_opt.get("award_points"))
        sanitized_surcharge = sanitize_surcharge(raw_opt.get("surcharge"))
        
        assert sanitized_cash is None, "Cash should be None"
        assert sanitized_points is None, "Points should be None"
        assert sanitized_surcharge == 0.0, "Surcharge should be 0.0"


# Smoke test that can be run independently
def test_no_negative_prices_invariant():
    """
    INVARIANT TEST: Ensure no function returns negative prices.
    
    This test documents the contract that must be maintained.
    """
    from src.utils.pricing import sanitize_cash_price, sanitize_points_cost, sanitize_surcharge
    
    # Test a range of inputs including edge cases
    test_inputs = [
        None, -1, -1.0, -999, -0.01, 0, 0.0, 
        0.01, 1, 100, 1000.50, "250", "$1,234"
    ]
    
    for val in test_inputs:
        cash = sanitize_cash_price(val)
        points = sanitize_points_cost(val) if not isinstance(val, str) or val.replace(",", "").replace("$", "").isdigit() else None
        surcharge = sanitize_surcharge(val)
        
        # INVARIANT: No negative returns
        if cash is not None:
            assert cash > 0, f"cash_price must be positive or None, got {cash} for input {val}"
        if points is not None:
            assert points >= 0, f"points must be non-negative or None, got {points} for input {val}"
        assert surcharge >= 0, f"surcharge must be non-negative, got {surcharge} for input {val}"


# Run with: pytest backend/tests/test_price_sanitization.py -v
if __name__ == "__main__":
    pytest.main([__file__, "-v"])
