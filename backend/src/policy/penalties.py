"""
Risk penalty scoring for policy-aware ranking.

Applies penalties to risky options so safer options rank higher
without completely removing risky options.

Usage:
    from policy.penalties import apply_policy_penalties, get_penalty_for_code
    
    penalty = get_penalty_for_code("FLIGHT_SELF_TRANSFER_RISK")
    # Returns 800 (default penalty for self-transfer)
    
    scored_options = apply_policy_penalties(options, mode)
"""

import logging
from typing import Any

from .config import get_policy_config
from .modes import BookingRiskMode, get_mode_policy
from .types import PolicyEvaluation

logger = logging.getLogger(__name__)


# =============================================================================
# PENALTY LOOKUP
# =============================================================================

def get_penalty_for_code(code: str, config=None) -> int:
    """
    Get the risk penalty for a specific reason code.
    
    Args:
        code: Reason code (e.g., "FLIGHT_SELF_TRANSFER_RISK")
        config: Optional PolicyConfig
    
    Returns:
        Penalty score (higher = riskier)
    """
    if config is None:
        config = get_policy_config()
    
    return config.get_risk_penalty(code)


def compute_total_penalty(
    evaluation: PolicyEvaluation,
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
    config=None,
) -> int:
    """
    Compute total risk penalty from a policy evaluation.
    
    Args:
        evaluation: PolicyEvaluation with blocks/warnings
        mode: Risk mode for penalty multiplier
        config: Optional PolicyConfig
    
    Returns:
        Total penalty score
    """
    if config is None:
        config = get_policy_config()
    
    mode_policy = get_mode_policy(mode)
    total = 0
    
    # Blocks have higher penalties
    for msg in evaluation.blocks:
        total += config.get_risk_penalty(msg.code) * 2  # Double for blocks
    
    # Warnings have standard penalties
    for msg in evaluation.warnings:
        total += config.get_risk_penalty(msg.code)
    
    # Info messages have minimal penalty
    for msg in evaluation.info:
        total += config.get_risk_penalty(msg.code) // 10  # 10% for info
    
    # Apply mode multiplier
    total = int(total * mode_policy.risk_penalty_multiplier)
    
    return total


# =============================================================================
# BATCH OPERATIONS
# =============================================================================

def apply_policy_penalties(
    options: list[dict[str, Any]],
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
    evaluation_key: str = "policy_evaluation",
    penalty_key: str = "policy_penalty",
) -> list[dict[str, Any]]:
    """
    Apply policy penalties to a list of options.
    
    Args:
        options: List of option dicts with policy evaluations
        mode: Risk mode
        evaluation_key: Key in dict where PolicyEvaluation is stored
        penalty_key: Key to store computed penalty
    
    Returns:
        Options with penalty scores added
    """
    config = get_policy_config()
    
    for option in options:
        evaluation = option.get(evaluation_key)
        
        if evaluation is None:
            option[penalty_key] = 0
            continue
        
        if isinstance(evaluation, dict):
            # Convert dict to PolicyEvaluation if needed
            from .types import PolicyMessage
            blocks = [PolicyMessage(**m) for m in evaluation.get("blocks", [])]
            warnings = [PolicyMessage(**m) for m in evaluation.get("warnings", [])]
            info = [PolicyMessage(**m) for m in evaluation.get("info", [])]
            
            eval_obj = PolicyEvaluation(
                blocks=blocks,
                warnings=warnings,
                info=info,
            )
        else:
            eval_obj = evaluation
        
        penalty = compute_total_penalty(eval_obj, mode, config)
        option[penalty_key] = penalty
    
    return options


def sort_by_risk_adjusted_score(
    options: list[dict[str, Any]],
    base_score_key: str = "score",
    penalty_key: str = "policy_penalty",
    output_key: str = "risk_adjusted_score",
    lower_is_better: bool = True,
) -> list[dict[str, Any]]:
    """
    Sort options by risk-adjusted score.
    
    Combines base score with policy penalties for ranking.
    
    Args:
        options: List of option dicts
        base_score_key: Key for the base score (e.g., price, OOP)
        penalty_key: Key for policy penalty
        output_key: Key to store combined score
        lower_is_better: If True, lower scores are better
    
    Returns:
        Sorted options with risk-adjusted scores
    """
    for option in options:
        base = option.get(base_score_key, 0)
        penalty = option.get(penalty_key, 0)
        
        if lower_is_better:
            # Add penalty to increase score (worse)
            option[output_key] = base + penalty
        else:
            # Subtract penalty to decrease score (worse)
            option[output_key] = base - penalty
    
    # Sort
    return sorted(
        options,
        key=lambda x: x.get(output_key, float('inf') if lower_is_better else float('-inf')),
        reverse=not lower_is_better,
    )


# =============================================================================
# PENALTY BREAKDOWN (for explainability)
# =============================================================================

def explain_penalty(
    evaluation: PolicyEvaluation,
    mode: BookingRiskMode | str = BookingRiskMode.BALANCED,
    config=None,
) -> dict[str, Any]:
    """
    Explain how the penalty was calculated.
    
    Returns breakdown for debugging/transparency.
    """
    if config is None:
        config = get_policy_config()
    
    mode_policy = get_mode_policy(mode)
    
    breakdown = {
        "mode": str(mode),
        "multiplier": mode_policy.risk_penalty_multiplier,
        "blocks": [],
        "warnings": [],
        "info": [],
        "subtotal_before_multiplier": 0,
        "total": 0,
    }
    
    subtotal = 0
    
    for msg in evaluation.blocks:
        base_penalty = config.get_risk_penalty(msg.code)
        adjusted = base_penalty * 2
        breakdown["blocks"].append({
            "code": msg.code,
            "base_penalty": base_penalty,
            "multiplier": "2x (block)",
            "adjusted": adjusted,
        })
        subtotal += adjusted
    
    for msg in evaluation.warnings:
        penalty = config.get_risk_penalty(msg.code)
        breakdown["warnings"].append({
            "code": msg.code,
            "penalty": penalty,
        })
        subtotal += penalty
    
    for msg in evaluation.info:
        penalty = config.get_risk_penalty(msg.code) // 10
        breakdown["info"].append({
            "code": msg.code,
            "penalty": penalty,
            "note": "10% of base (info only)",
        })
        subtotal += penalty
    
    breakdown["subtotal_before_multiplier"] = subtotal
    breakdown["total"] = int(subtotal * mode_policy.risk_penalty_multiplier)
    
    return breakdown
