"""
Optimizer Configuration

Central configuration for group optimizer settings, including
relaxation parameters for the two-phase solve approach.
"""

import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)


# =============================================================================
# SOLVER SETTINGS
# =============================================================================

# Time limit for ILP solve (seconds)
GROUP_SOLVE_TIME_LIMIT_S = 60

# Solver to use (CBC is bundled with PuLP)
GROUP_SOLVER = "CBC"


# =============================================================================
# RELAXATION PENALTY WEIGHTS (Big-M style)
# =============================================================================
# These weights determine how the solver prioritizes different objectives
# when budget constraints are relaxed. Higher weight = stronger preference.
#
# The objective in relaxed mode is:
#   minimize:
#     RELAX_BIG_M_MAX_MEMBER * slack_max_member (if minimax enabled)
#   + RELAX_BIG_M_MEMBER * sum(slack_member)
#   + RELAX_BIG_M_GROUP * slack_group
#   + RELAX_EPS_OOP * total_cost
#   + RELAX_EPS_POINTS * total_points_used

# Weight for group budget overrun (USD penalty per dollar over)
RELAX_BIG_M_GROUP = 100_000

# Weight for per-member budget overruns (higher than group to prioritize fairness)
RELAX_BIG_M_MEMBER = 200_000

# Weight for minimax (minimize the maximum member overrun)
# This ensures no single member bears disproportionate overrun
RELAX_BIG_M_MAX_MEMBER = 300_000

# Secondary objective: minimize total OOP (lower weight to be secondary)
RELAX_EPS_OOP = 1.0

# Tertiary objective: minimize points spent (very small tiebreaker)
RELAX_EPS_POINTS = 0.0001

# Enable minimax constraint (minimize max member overrun)
RELAX_ENABLE_MINIMAX = True


# =============================================================================
# RANKING CONFIGURATION
# =============================================================================

# Maximum number of alternative solutions to generate
MAX_ALTERNATIVE_SOLUTIONS = 5

# Whether to generate alternatives for relaxed mode (can be slow)
GENERATE_ALTERNATIVES_IN_RELAXED = False


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_relaxation_config() -> Dict[str, Any]:
    """Get relaxation configuration as a dictionary for logging/debugging."""
    return {
        "group_weight": RELAX_BIG_M_GROUP,
        "member_weight": RELAX_BIG_M_MEMBER,
        "max_member_weight": RELAX_BIG_M_MAX_MEMBER,
        "oop_weight": RELAX_EPS_OOP,
        "points_weight": RELAX_EPS_POINTS,
        "enable_minimax": RELAX_ENABLE_MINIMAX,
        "time_limit_s": GROUP_SOLVE_TIME_LIMIT_S,
        "solver": GROUP_SOLVER,
    }


def log_relaxation_config():
    """Log current relaxation configuration."""
    config = get_relaxation_config()
    logger.info(f"[OptimizerConfig] Relaxation config: {config}")


def validate_penalty_weights():
    """Validate that penalty weights are properly ordered."""
    # Ensure weights follow the priority: max_member > member > group > OOP > points
    assert RELAX_BIG_M_MAX_MEMBER >= RELAX_BIG_M_MEMBER, \
        "Max member weight should be >= member weight"
    assert RELAX_BIG_M_MEMBER >= RELAX_BIG_M_GROUP, \
        "Member weight should be >= group weight"
    assert RELAX_BIG_M_GROUP >= RELAX_EPS_OOP, \
        "Group weight should be >= OOP weight"
    assert RELAX_EPS_OOP >= RELAX_EPS_POINTS, \
        "OOP weight should be >= points weight"
    
    logger.info("[OptimizerConfig] Penalty weights validated successfully")


# Validate on import
try:
    validate_penalty_weights()
except AssertionError as e:
    logger.error(f"[OptimizerConfig] Invalid penalty weights: {e}")
    raise
