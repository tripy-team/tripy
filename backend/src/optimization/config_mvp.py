"""
MVP configuration for optimization pipeline.

All thresholds, caps, and TTLs live here.
This config is logged as a snapshot on every solve for reproducibility.

Usage:
    from optimization.config_mvp import get_config, OptimizationConfigMVP
    
    config = get_config()
    if len(candidates) < config.MIN_FLIGHT_CANDIDATES_PER_LEG:
        raise InfeasibleError(...)
"""

from dataclasses import dataclass, field, asdict
from typing import Any
import logging

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OptimizationConfigMVP:
    """
    Centralized configuration for MVP optimization.
    
    All values are documented with rationale.
    Frozen to prevent accidental mutation during a solve.
    """
    
    # =========================================================================
    # AIRPORT RESOLUTION
    # =========================================================================
    
    # Maximum airports per side of a leg (top-K per side)
    MAX_ORIGIN_AIRPORTS: int = 3  # K1: e.g., NYC -> JFK, LGA, EWR
    MAX_DEST_AIRPORTS: int = 3    # K2: e.g., NYC -> JFK, LGA, EWR
    
    # Absolute ceiling for total airport pairs per leg
    # Prevents explosion for large metros like "London" or "Paris"
    MAX_TOTAL_PAIRS_PER_LEG: int = 16
    
    # Confidence threshold for ambiguous location resolution
    MIN_LOCATION_CONFIDENCE: float = 0.7
    
    # =========================================================================
    # SEARCH & CONCURRENCY
    # =========================================================================
    
    # Maximum concurrent searches per leg
    MAX_PAIR_SEARCH_CONCURRENCY: int = 6
    
    # Timeout for individual pair search (seconds)
    PER_PAIR_TIMEOUT_SECONDS: float = 15.0
    
    # Total timeout per leg (seconds)
    PER_LEG_TIMEOUT_SECONDS: float = 45.0
    
    # Cache TTL for search results (seconds)
    SEARCH_CACHE_TTL_SECONDS: int = 300  # 5 minutes
    AWARD_SEARCH_CACHE_TTL_SECONDS: int = 120  # 2 minutes (awards more volatile)
    
    # =========================================================================
    # CANDIDATE MINIMUMS
    # =========================================================================
    
    # Minimum flight candidates per leg after filtering
    MIN_FLIGHT_CANDIDATES_PER_LEG: int = 3
    
    # Minimum for legs that have award candidates (relax slightly)
    MIN_FLIGHT_CANDIDATES_WITH_AWARDS: int = 2
    
    # Minimum hotel candidates per segment after filtering
    MIN_HOTEL_CANDIDATES_PER_SEGMENT: int = 5
    
    # =========================================================================
    # CONTRACT VALIDATION
    # =========================================================================
    
    # If malformed rate exceeds this, treat as upstream error (502)
    MALFORMED_THRESHOLD_FOR_UPSTREAM_ERROR: float = 1.0  # 100% malformed
    
    # =========================================================================
    # POLICY FILTERING
    # =========================================================================
    
    # Ticketing policy
    # Allow UNKNOWN ticketing for nonstop flights (no connection risk)
    ALLOW_UNKNOWN_TICKETING_NONSTOP: bool = True
    
    # Require SINGLE_TICKET for connecting flights
    REQUIRE_SINGLE_TICKET_CONNECTING: bool = True
    
    # Maximum stops allowed
    MAX_STOPS: int = 2
    
    # Maximum total duration (hours)
    MAX_DURATION_HOURS: float = 36.0
    
    # Maximum surcharge for award bookings (USD)
    MAX_SURCHARGE_USD: float = 500.0
    
    # =========================================================================
    # FINGERPRINTING
    # =========================================================================
    
    # Floor times to this many minutes for fingerprinting
    FINGERPRINT_TIME_FLOOR_MINUTES: int = 5
    
    # Tolerance for merge gate (seconds)
    # If dep/arr times differ by more than this, don't merge
    MERGE_GATE_TIME_TOLERANCE_SECONDS: int = 120  # 2 minutes
    
    # =========================================================================
    # SOLVER
    # =========================================================================
    
    # Solver time limit (seconds)
    SOLVER_TIME_LIMIT_SECONDS: float = 30.0
    
    # MIP gap (optimality tolerance)
    SOLVER_MIP_GAP: float = 0.01  # 1%
    
    # =========================================================================
    # OBJECTIVE PENALTIES
    # =========================================================================
    
    # Time penalty per hour over baseline (USD)
    TIME_PENALTY_PER_HOUR_USD: float = 10.0
    BASELINE_HOURS: float = 8.0
    
    # Stop penalty (USD per stop)
    STOP_PENALTY_USD: float = 50.0
    
    # Redeye penalty (USD)
    REDEYE_PENALTY_USD: float = 75.0
    
    # Carrier change penalty (USD)
    CARRIER_CHANGE_PENALTY_USD: float = 25.0
    
    # Points shadow cost (cents per point) for OOP mode
    # Prevents burning 100k points to save $5
    OOP_POINTS_SHADOW_COST_CPP: float = 0.5  # 0.5 cpp minimum value
    
    # =========================================================================
    # HOTEL SPECIFIC
    # =========================================================================
    
    # Distance penalty per km from target (USD)
    HOTEL_DISTANCE_PENALTY_PER_KM_USD: float = 5.0
    
    # Maximum distance from target (km)
    HOTEL_MAX_DISTANCE_KM: float = 20.0
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dict for logging."""
        return asdict(self)
    
    def log_snapshot(self, solve_id: str):
        """Log this config as a snapshot for the solve."""
        logger.info(
            f"Optimization config snapshot for solve_id={solve_id}",
            extra={"solve_id": solve_id, "config": self.to_dict()},
        )


# Global singleton (frozen, so safe to share)
_CONFIG: OptimizationConfigMVP | None = None


def get_config() -> OptimizationConfigMVP:
    """
    Get the current configuration.
    
    Uses a singleton pattern for efficiency.
    """
    global _CONFIG
    if _CONFIG is None:
        _CONFIG = OptimizationConfigMVP()
    return _CONFIG


def set_config(config: OptimizationConfigMVP):
    """
    Override the configuration (for testing).
    
    Use sparingly - only in tests.
    """
    global _CONFIG
    _CONFIG = config


def reset_config():
    """Reset to default configuration."""
    global _CONFIG
    _CONFIG = None
