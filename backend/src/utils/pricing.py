"""
Pricing sanitization utilities.

This module provides functions to sanitize price values from external APIs.
The primary goal is to prevent sentinel values (like -1) from leaking through
to the optimization logic or UI.

CONTRACT:
- cash_price / cash_cost must be either:
  - positive float (valid price), OR
  - None (unknown/unavailable)
- Negative prices are INVALID and must be sanitized to None
- Zero prices are treated as unknown (flights cost money)
- Never coerce None -> 0.0 for prices

WHY THIS MATTERS:
- AwardTool uses -1 as a sentinel for "unknown/unavailable"
- Python treats -1 as truthy, so `float(x) if x else None` preserves -1
- If -1 leaks into optimization, it corrupts totals and may cause
  the optimizer to incorrectly prefer "free" flights
"""

import logging
from typing import Optional, Union

logger = logging.getLogger(__name__)


def sanitize_cash_price(
    value: Union[int, float, str, None],
    context: str = "",
    log_sentinel: bool = True,
) -> Optional[float]:
    """
    Sanitize a cash price value to either a positive float or None.
    
    This is the SINGLE SOURCE OF TRUTH for price sanitization.
    Use this everywhere prices are parsed from external sources.
    
    Rules:
    - None → None (unknown)
    - Cannot parse → None (invalid)
    - value <= 0 → None (treat 0 and negative as unknown; flights cost money)
    - value > 0 → float(value) (valid price)
    
    Args:
        value: Raw price value from API (can be int, float, string, or None)
        context: Optional context for logging (e.g., "JFK->LAX AA100")
        log_sentinel: If True, log a warning when negative sentinel detected
    
    Returns:
        float if valid positive price, None otherwise
    
    Examples:
        >>> sanitize_cash_price(250.0)
        250.0
        >>> sanitize_cash_price(-1)  # AwardTool sentinel
        None
        >>> sanitize_cash_price(0)   # Zero = unknown
        None
        >>> sanitize_cash_price(None)
        None
        >>> sanitize_cash_price("$1,234.56")
        1234.56
    
    INVARIANT: Never returns negative or zero values.
    """
    if value is None:
        return None
    
    # Try to parse the value
    parsed: Optional[float] = None
    try:
        if isinstance(value, (int, float)):
            parsed = float(value)
        elif isinstance(value, str):
            # Handle string prices like "$123", "123.45", "1,234"
            import re
            cleaned = value.replace(",", "").replace("$", "").strip()
            if cleaned:
                parsed = float(cleaned)
    except (ValueError, TypeError):
        return None
    
    if parsed is None:
        return None
    
    # Check for negative sentinel
    if parsed < 0:
        if log_sentinel:
            logger.warning(
                f"[PRICE_SANITIZER] Negative price sentinel detected: {parsed}"
                f"{f' ({context})' if context else ''}. Treating as unknown."
            )
        return None
    
    # Zero is not a valid flight price - treat as unknown
    if parsed == 0:
        return None
    
    return parsed


def sanitize_points_cost(
    value: Union[int, float, str, None],
    context: str = "",
    log_sentinel: bool = True,
) -> Optional[int]:
    """
    Sanitize a points cost value to either a positive int or None.
    
    Similar to sanitize_cash_price but for points/miles.
    
    Rules:
    - None → None (unknown)
    - Cannot parse → None (invalid)
    - value < 0 → None (negative sentinel)
    - value == 0 → 0 (zero points is valid for some edge cases)
    - value > 0 → int(value) (valid points cost)
    
    Args:
        value: Raw points value from API
        context: Optional context for logging
        log_sentinel: If True, log a warning when negative sentinel detected
    
    Returns:
        int if valid non-negative, None if invalid/negative
    
    INVARIANT: Never returns negative values.
    """
    if value is None:
        return None
    
    try:
        if isinstance(value, str):
            value = value.replace(",", "").strip()
        parsed = int(float(value))
    except (ValueError, TypeError):
        return None
    
    if parsed < 0:
        if log_sentinel:
            logger.warning(
                f"[PRICE_SANITIZER] Negative points sentinel detected: {parsed}"
                f"{f' ({context})' if context else ''}. Treating as unknown."
            )
        return None
    
    return parsed


def sanitize_surcharge(
    value: Union[int, float, str, None],
    context: str = "",
) -> float:
    """
    Sanitize a surcharge value. Returns 0.0 for invalid/negative values.
    
    Unlike cash_price, surcharges CAN be zero (no surcharge).
    But negative surcharges are invalid.
    
    Rules:
    - None → 0.0 (no surcharge)
    - Cannot parse → 0.0
    - value < 0 → 0.0 (invalid, log warning)
    - value >= 0 → float(value)
    
    Returns:
        float >= 0.0
    
    INVARIANT: Never returns negative values.
    """
    if value is None:
        return 0.0
    
    try:
        if isinstance(value, str):
            value = value.replace(",", "").replace("$", "").strip()
        parsed = float(value)
    except (ValueError, TypeError):
        return 0.0
    
    if parsed < 0:
        logger.warning(
            f"[PRICE_SANITIZER] Negative surcharge detected: {parsed}"
            f"{f' ({context})' if context else ''}. Treating as 0."
        )
        return 0.0
    
    return parsed


# Large penalty value for optimization when price is unknown
# This ensures unknown prices don't appear "free" to the optimizer
UNKNOWN_PRICE_PENALTY = 999999.0


def get_cash_cost_for_optimization(
    cash_price: Optional[float],
    use_penalty_for_unknown: bool = True,
) -> float:
    """
    Get a cash cost value suitable for optimization calculations.
    
    When cash_price is unknown (None), we need a numeric value for
    optimization math. This function provides that value.
    
    Args:
        cash_price: Sanitized cash price (None or positive float)
        use_penalty_for_unknown: If True, return large penalty for None
                                 If False, return 0.0 (use carefully!)
    
    Returns:
        float value for optimization (never negative)
    
    WARNING: The returned value should ONLY be used for optimization math.
             For API responses, use the original None value.
    """
    if cash_price is None:
        return UNKNOWN_PRICE_PENALTY if use_penalty_for_unknown else 0.0
    return cash_price
