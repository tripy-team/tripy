"""
Policy Engine for Tripy - Booking Reality Rules.

This module enforces real-world booking rules through:
- Deterministic reason codes for all rejections/warnings
- Risk modes (safe/balanced/aggressive) for user preference
- Acknowledgment gating for high-risk decisions
- Explanations for every policy decision

Usage:
    from policy import evaluate_itinerary, BookingRiskMode
    from policy.config import get_policy_config
    
    evaluation = evaluate_itinerary(itinerary, mode=BookingRiskMode.BALANCED)
    if evaluation.blocks:
        # Option should not be selectable without acknowledgment
        pass
"""

from .reason_codes import *
from .types import PolicyMessage, PolicyEvaluation, PolicySeverity
from .modes import BookingRiskMode, get_mode_policy
from .config import get_policy_config, PolicyConfig
from .engine import evaluate_itinerary, apply_policy_to_results
