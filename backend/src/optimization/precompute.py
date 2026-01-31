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
    HotelOption,
    AwardOption,
    RoomType,
    BalancedModeConfig,
)
from .constants import CPP_THRESHOLDS, DEFAULT_CPP_THRESHOLD


def precompute_soft_values(
    flights: List[FlightItineraryEdge],
    hotels: List[HotelOption],
    config: BalancedModeConfig,
) -> None:
    """
    Precompute all soft values for award options.
    
    This modifies the award options in-place, setting:
    - soft_value_oop
    - soft_value_cpp
    - soft_value_balanced
    
    These become FIXED COEFFICIENTS in the MILP objective.
    """
    
    # Get CPP thresholds
    thresholds = _get_cpp_thresholds()
    
    # ═══════════════════════════════════════════════════════════════════════
    # FLIGHTS
    # ═══════════════════════════════════════════════════════════════════════
    
    for f in flights:
        for opt in f.award_options:
            _precompute_flight_award_values(opt, f, thresholds, config)
    
    # ═══════════════════════════════════════════════════════════════════════
    # HOTELS
    # ═══════════════════════════════════════════════════════════════════════
    
    for h in hotels:
        for rt in h.room_types:
            if rt.has_award_pricing:
                _precompute_hotel_room_values(rt, h, thresholds, config)


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


def _precompute_hotel_room_values(
    rt: RoomType,
    hotel: HotelOption,
    thresholds: Dict[str, float],
    config: BalancedModeConfig,
) -> None:
    """
    Precompute soft values for a hotel room type award.
    
    Note: Hotel room types don't have individual soft_value fields,
    but we can compute them here for use in the objective.
    The values are stored on the RoomType or computed on-the-fly.
    """
    
    if not rt.has_award_pricing:
        return
    
    # Compute raw value
    raw_value = rt.cash_per_night - rt.award_surcharge_per_night
    
    if raw_value <= 0:
        return
    
    # Compute CPP
    cpp = (raw_value * 100) / rt.points_per_night if rt.points_per_night > 0 else 0
    
    # Get threshold for hotel program
    threshold = thresholds.get(rt.award_program, thresholds["default"])
    
    # For hotels, we typically use simpler valuation
    # Star rating bonus
    star_bonus = config.star_rating_bonus.get(hotel.star_rating, 1.0)
    
    # The computed values would be used when building the objective
    # For now, we don't store them on RoomType directly


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


def compute_hotel_K(
    hotels: List[HotelOption],
    config: BalancedModeConfig,
) -> float:
    """
    Compute normalization constant K for hotels (robust median).
    
    K = median of positive award value per night across all hotel room types.
    """
    
    values = []
    for h in hotels:
        for rt in h.room_types:
            if rt.has_award_pricing:
                value = rt.cash_per_night - rt.award_surcharge_per_night
                if value > 0:
                    # Apply star bonus
                    star_bonus = config.star_rating_bonus.get(h.star_rating, 1.0)
                    values.append(value * star_bonus)
    
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


def get_hotel_award_value(
    rt: RoomType,
    hotel: HotelOption,
    nights: int,
    config: BalancedModeConfig,
) -> float:
    """
    Compute award value for a hotel room type booking.
    
    Returns total value for all nights.
    """
    
    if not rt.has_award_pricing:
        return 0.0
    
    # Raw value per night
    value_per_night = rt.cash_per_night - rt.award_surcharge_per_night
    
    if value_per_night <= 0:
        return 0.0
    
    # Apply star bonus
    star_bonus = config.star_rating_bonus.get(hotel.star_rating, 1.0)
    
    return value_per_night * star_bonus * nights


def get_hotel_soft_value_cpp(
    rt: RoomType,
    hotel: HotelOption,
    nights: int,
    thresholds: Dict[str, float],
) -> float:
    """
    Compute CPP-mode soft value for a hotel room type booking.
    
    Returns total soft value for all nights.
    """
    
    if not rt.has_award_pricing:
        return 0.0
    
    value_per_night = rt.cash_per_night - rt.award_surcharge_per_night
    
    if value_per_night <= 0:
        return 0.0
    
    # Compute CPP
    cpp = (value_per_night * 100) / rt.points_per_night if rt.points_per_night > 0 else 0
    
    # Get threshold
    threshold = thresholds.get(rt.award_program, thresholds.get("default", 1.2))
    
    # Apply penalty
    if cpp >= threshold:
        soft_value_per_night = value_per_night
    elif cpp > 0:
        penalty_factor = 0.2 + 0.8 * (cpp / threshold)
        soft_value_per_night = value_per_night * penalty_factor
    else:
        soft_value_per_night = 0.0
    
    return soft_value_per_night * nights
