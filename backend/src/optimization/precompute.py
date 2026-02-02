"""
Precomputation of soft values for V3 optimization.

CRITICAL: All soft values must be computed BEFORE building the MILP.
They become FIXED COEFFICIENTS in the objective, not decision variables.

This ensures:
- Sigmoid/piecewise functions don't need to be linearized
- Values are consistent and deterministic
- MILP construction is simpler
"""

from typing import List, Dict, Optional
import math

from .models_v3 import (
    FlightItineraryEdge,
    AwardOption,
    BalancedModeConfig,
)
from .constants import CPP_THRESHOLDS, DEFAULT_CPP_THRESHOLD


def precompute_soft_values(
    flights: List[FlightItineraryEdge],
    hotels: list,  # Ignored - no hotels
    config: BalancedModeConfig,
) -> None:
    """
    Precompute all soft values for flight award options.
    
    This modifies the award options in-place, setting:
    - soft_value_oop
    - soft_value_cpp
    - soft_value_balanced
    
    These become FIXED COEFFICIENTS in the MILP objective.
    """
    
    # Get CPP thresholds
    thresholds = _get_cpp_thresholds()
    
    # Flights only
    for f in flights:
        for opt in f.award_options:
            _precompute_flight_award_values(opt, f, thresholds, config)


def _get_cpp_thresholds() -> Dict[str, float]:
    """Get CPP thresholds by program."""
    return {**CPP_THRESHOLDS, "default": DEFAULT_CPP_THRESHOLD}


def _precompute_flight_award_values(
    opt: AwardOption,
    flight: FlightItineraryEdge,
    thresholds: Dict[str, float],
    config: BalancedModeConfig,
) -> None:
    """
    Precompute soft values for a flight award option.
    
    Sets:
    - soft_value_oop: Value if any savings (cpp > 0)
    - soft_value_cpp: Value with penalty below threshold
    - soft_value_balanced: Value adjusted for time/connections
    """
    
    raw_value = opt.raw_value
    cpp = opt.cpp
    
    # ═══════════════════════════════════════════════════════════════════════
    # OOP MODE: Use if any positive value
    # ═══════════════════════════════════════════════════════════════════════
    
    if raw_value > 0:
        opt.soft_value_oop = raw_value
    else:
        opt.soft_value_oop = 0.0
    
    # ═══════════════════════════════════════════════════════════════════════
    # CPP MODE: Soft penalty below threshold (piecewise linear)
    # ═══════════════════════════════════════════════════════════════════════
    
    threshold = thresholds.get(opt.program, thresholds["default"])
    
    if cpp >= threshold:
        # Above threshold: full value
        opt.soft_value_cpp = raw_value
    elif cpp > 0:
        # Below threshold: penalized value
        # Linear from 20% at cpp=0 to 100% at cpp=threshold
        penalty_factor = 0.2 + 0.8 * (cpp / threshold)
        opt.soft_value_cpp = raw_value * penalty_factor
    else:
        # Negative cpp: zero value
        opt.soft_value_cpp = 0.0
    
    # ═══════════════════════════════════════════════════════════════════════
    # BALANCED MODE: Adjust for time, connections, quality
    # ═══════════════════════════════════════════════════════════════════════
    
    if raw_value <= 0:
        opt.soft_value_balanced = 0.0
        return
    
    # Start with CPP soft value
    value = opt.soft_value_cpp
    
    # Time penalty
    hours = flight.total_time_minutes / 60
    excess_hours = max(0, hours - config.baseline_hours)
    time_factor = 1.0 / (1.0 + excess_hours * config.time_penalty_per_hour)
    
    # Connection penalty
    stops = flight.num_stops
    connection_factor = 1.0 / (1.0 + stops * config.connection_penalty)
    
    # Carrier change penalty
    carrier_factor = 1.0
    if flight.has_carrier_change:
        carrier_factor = 1.0 - config.carrier_change_penalty
    
    # Redeye penalty
    redeye_factor = 1.0
    if flight.is_redeye:
        redeye_factor = 1.0 - config.redeye_penalty
    
    # Availability penalty
    availability_factor = 1.0
    if opt.availability_score < 0.5:
        # Penalize low availability
        availability_factor = 1.0 - config.low_availability_penalty * (0.5 - opt.availability_score) / 0.5
    
    opt.soft_value_balanced = (
        value * 
        time_factor * 
        connection_factor * 
        carrier_factor * 
        redeye_factor * 
        availability_factor
    )


def compute_flight_K(
    flights: List[FlightItineraryEdge],
    config: BalancedModeConfig,
) -> float:
    """
    Compute normalization constant K for flights (robust median).
    
    K = median of positive soft_value_balanced across all flight awards.
    """
    
    values = []
    for f in flights:
        for opt in f.award_options:
            if opt.soft_value_balanced > 0:
                values.append(opt.soft_value_balanced)
    
    return _robust_median(values, config)


def _robust_median(values: List[float], config: BalancedModeConfig) -> float:
    """
    Compute robust median with trimming.
    
    If not enough samples, return default_K.
    """
    
    if len(values) < config.min_samples_for_median:
        return config.default_K
    
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    
    # Trim outliers (top/bottom 10%)
    low_idx = int(n * 0.1)
    high_idx = int(n * 0.9)
    
    if low_idx >= high_idx:
        # Not enough range to trim
        return sorted_vals[n // 2]
    
    trimmed = sorted_vals[low_idx:high_idx]
    
    if not trimmed:
        return sorted_vals[n // 2]
    
    return trimmed[len(trimmed) // 2]
