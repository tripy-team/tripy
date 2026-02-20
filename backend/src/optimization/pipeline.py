"""
Candidate processing pipeline.

Orchestrates the full pipeline from raw candidates to solver-ready candidates:
1. CONTRACT VALIDATION → reject malformed (may raise 502)
2. FINGERPRINTING → compute fingerprint for each contract-valid candidate
3. GROUPING → group candidates by fingerprint
4. MERGE GATE → safely merge or emit FINGERPRINT_COLLISION
5. DEDUP → one candidate per fingerprint
6. POLICY FILTERING → apply business rules (airports, ticketing, etc.)
7. MIN CANDIDATES CHECK → after dedup, not before
8. RETURN → processed candidates ready for solver

Contract validation and policy filtering are COMPLETELY SEPARATE.
"""

from typing import TYPE_CHECKING
import logging

from .types import Rejection, PipelineResult, LegValidationResult
from .config_mvp import get_config
from .contract_validation import validate_contracts_for_leg
from .fingerprinting import compute_itinerary_fingerprint
from .merge_gate import merge_candidates_with_gate, group_by_fingerprint
from .policy_filtering import apply_policy_filters_with_airports
from .exceptions import OptimizationUpstreamError, OptimizationInfeasible
from .reason_codes import (
    GLOBAL_ALL_CANDIDATES_MALFORMED,
    GLOBAL_INSUFFICIENT_CANDIDATES,
)

if TYPE_CHECKING:
    from .trip_spec import OrderedLeg

logger = logging.getLogger(__name__)


def should_raise_upstream_error(
    malformed_count: int,
    total_count: int,
) -> bool:
    """
    Determine if malformed rate indicates upstream regression.
    
    Returns True if we should raise OptimizationUpstreamError (502).
    
    Rule: 502 only if 100% of candidates are malformed.
    This is a TRUE upstream regression, not user error or policy filtering.
    """
    if total_count == 0:
        return False  # No candidates is infeasible, not upstream error
    
    config = get_config()
    malformed_rate = malformed_count / total_count
    
    return malformed_rate >= config.MALFORMED_THRESHOLD_FOR_UPSTREAM_ERROR


def check_min_candidates_after_dedup(
    candidates: list[dict],
    has_award_candidates: bool,
    leg_id: str,
) -> tuple[bool, str | None]:
    """
    Check if we have enough candidates after dedup+filtering.
    
    Args:
        candidates: Candidates that survived all filtering
        has_award_candidates: Whether any candidate has award quotes
        leg_id: For logging
    
    Returns:
        (is_sufficient, failure_code or None)
    """
    config = get_config()
    
    # Different thresholds based on whether we have award candidates
    min_required = (
        config.MIN_FLIGHT_CANDIDATES_WITH_AWARDS
        if has_award_candidates
        else config.MIN_FLIGHT_CANDIDATES_PER_LEG
    )
    
    if len(candidates) < min_required:
        return False, GLOBAL_INSUFFICIENT_CANDIDATES
    
    return True, None


def determine_failed_scope(
    processed_by_leg: dict[str, list[dict]],
    legs_below_minimum: list[str],
) -> str | None:
    """
    Determine which scope failed for infeasible response.
    
    Rule: First leg with insufficient candidates, or "trip" if multiple.
    """
    if not legs_below_minimum:
        return None
    
    if len(legs_below_minimum) == 1:
        return f"leg_{legs_below_minimum[0]}"
    
    return "trip"


def process_candidates_pipeline(
    raw_candidates_by_leg: dict[str, list[dict]],
    legs: list["OrderedLeg"],
    normalization_notes: list[str],
    solve_id: str,
    allowed_airports_by_leg: dict[str, tuple[list[str] | None, list[str] | None]] | None = None,
) -> tuple[dict[str, list[dict]], PipelineResult]:
    """
    Full candidate processing pipeline with CORRECT ORDER and SEPARATION OF CONCERNS.
    
    Pipeline stages:
    1. CONTRACT VALIDATION → reject malformed (may raise 502)
    2. FINGERPRINTING → compute fingerprint for each contract-valid candidate
    3. GROUPING → group candidates by fingerprint
    4. MERGE GATE → safely merge or emit FINGERPRINT_COLLISION
    5. DEDUP → one candidate per fingerprint
    6. POLICY FILTERING → apply business rules (airports, ticketing, etc.)
    7. MIN CANDIDATES CHECK → after dedup, not before
    8. RETURN → processed candidates ready for solver
    
    Contract validation and policy filtering are COMPLETELY SEPARATE.
    
    Args:
        raw_candidates_by_leg: Raw candidates from providers, keyed by leg_id
        legs: List of OrderedLeg objects
        normalization_notes: Notes from airport/city normalization
        solve_id: Unique identifier for this solve (for tracing)
        allowed_airports_by_leg: Optional override for (origin_airports, dest_airports) per leg
    
    Returns:
        (processed_candidates_by_leg, pipeline_result)
    
    Raises:
        OptimizationUpstreamError: If 100% of candidates for a leg are malformed
    """
    config = get_config()
    
    # Log config snapshot
    config.log_snapshot(solve_id)
    
    result = PipelineResult(
        solve_id=solve_id,
        normalization_notes=normalization_notes,
    )
    
    processed_by_leg: dict[str, list[dict]] = {}
    
    # Build leg lookup
    legs_by_id = {str(leg.leg_id): leg for leg in legs}
    
    for leg_id, raw_candidates in raw_candidates_by_leg.items():
        leg = legs_by_id.get(leg_id)
        if not leg:
            result.warnings.append(f"Unknown leg_id: {leg_id}")
            continue
        
        scope_id = f"leg_{leg_id}"
        
        # Handle empty candidates
        if not raw_candidates:
            result.warnings.append(f"No candidates received for {scope_id}")
            processed_by_leg[leg_id] = []
            result.legs_below_minimum.append(leg_id)
            continue
        
        # =====================================================================
        # STAGE 1: CONTRACT VALIDATION (schema only)
        # =====================================================================
        
        contract_result = validate_contracts_for_leg(raw_candidates, leg_id)
        result.contract_rejections.extend(contract_result.contract_rejections)
        
        # Check for TRUE upstream regression (100% malformed)
        if should_raise_upstream_error(
            contract_result.malformed_candidate_count,
            len(raw_candidates),
        ):
            raise OptimizationUpstreamError(
                code=GLOBAL_ALL_CANDIDATES_MALFORMED,
                message=f"All flight candidates for {scope_id} failed contract validation",
                details={
                    "leg_id": leg_id,
                    "solve_id": solve_id,
                    "total_candidates": len(raw_candidates),
                    "malformed_count": contract_result.malformed_candidate_count,
                    "sample_errors": [
                        {
                            "reason_code": r.reason_code,
                            "candidate_id": r.candidate_id,
                            "details": r.details,
                        }
                        for r in contract_result.contract_rejections[:5]
                    ],
                },
            )
        
        contract_valid = contract_result.contract_valid
        
        if not contract_valid:
            result.warnings.append(
                f"No contract-valid candidates for {scope_id} "
                f"({contract_result.malformed_candidate_count} malformed)"
            )
            processed_by_leg[leg_id] = []
            result.legs_below_minimum.append(leg_id)
            continue
        
        # =====================================================================
        # STAGE 2: FINGERPRINTING
        # =====================================================================
        
        for candidate in contract_valid:
            candidate["_fingerprint"] = compute_itinerary_fingerprint(
                candidate["segments"]
            )
        
        # =====================================================================
        # STAGE 3: GROUPING by fingerprint
        # =====================================================================
        
        by_fingerprint = group_by_fingerprint(contract_valid)
        
        # =====================================================================
        # STAGE 4 & 5: MERGE GATE + DEDUP
        # =====================================================================
        
        deduped_candidates: list[dict] = []
        
        for fp, group in by_fingerprint.items():
            merged, merge_warnings, collisions = merge_candidates_with_gate(
                group, scope_id
            )
            deduped_candidates.extend(merged)
            result.warnings.extend(merge_warnings)
            result.fingerprint_collisions.extend(collisions)
        
        # =====================================================================
        # STAGE 6: POLICY FILTERING (ONLY HERE, NOT BEFORE)
        # =====================================================================
        
        # Get allowed airports for this leg
        if allowed_airports_by_leg and leg_id in allowed_airports_by_leg:
            allowed_origins, allowed_dests = allowed_airports_by_leg[leg_id]
        else:
            # Try to get from leg attributes (may be None)
            allowed_origins = getattr(leg, "allowed_origin_airports", None)
            allowed_dests = getattr(leg, "allowed_destination_airports", None)
        
        policy_allowed, policy_rejections = apply_policy_filters_with_airports(
            deduped_candidates,
            leg_id,
            allowed_origins,
            allowed_dests,
        )
        result.policy_rejections.extend(policy_rejections)
        
        # =====================================================================
        # STAGE 7: MIN CANDIDATES CHECK (AFTER DEDUP)
        # =====================================================================
        
        # Note: has_award_candidates is based on what SURVIVED filtering
        # This is intentional - minimum is about what we can actually use
        has_award_candidates = any(
            candidate.get("award_quotes")
            for candidate in policy_allowed
        )
        
        is_sufficient, failure_code = check_min_candidates_after_dedup(
            policy_allowed,
            has_award_candidates=has_award_candidates,
            leg_id=leg_id,
        )
        
        if not is_sufficient:
            result.legs_below_minimum.append(leg_id)
            result.warnings.append(
                f"{GLOBAL_INSUFFICIENT_CANDIDATES}: {scope_id} has "
                f"{len(policy_allowed)} candidates after dedup+filtering "
                f"(min required: {config.MIN_FLIGHT_CANDIDATES_PER_LEG})"
            )
        
        processed_by_leg[leg_id] = policy_allowed
        
        # Invariant log: intent vs reality after pruning
        actual_dests_post_prune = sorted(set(
            c.get("destination", "") for c in policy_allowed if c.get("destination")
        ))
        allowed_dest_list = list(allowed_dests) if allowed_dests else []
        logger.info(
            f"[INVARIANT] leg={leg_id} stage=post_prune "
            f"allowed_dest={allowed_dest_list} actual_dest={actual_dests_post_prune} "
            f"candidate_count={len(policy_allowed)}"
        )
        
        logger.info(
            f"Pipeline completed for {scope_id}: "
            f"{len(raw_candidates)} raw -> "
            f"{len(contract_valid)} valid -> "
            f"{len(deduped_candidates)} deduped -> "
            f"{len(policy_allowed)} allowed",
            extra={
                "solve_id": solve_id,
                "leg_id": leg_id,
                "raw_count": len(raw_candidates),
                "valid_count": len(contract_valid),
                "deduped_count": len(deduped_candidates),
                "allowed_count": len(policy_allowed),
                "malformed_count": contract_result.malformed_candidate_count,
                "policy_rejected_count": len(deduped_candidates) - len(policy_allowed),
            },
        )
    
    # Determine failed_scope for infeasible response
    result.failed_scope = determine_failed_scope(
        processed_by_leg,
        result.legs_below_minimum,
    )
    
    return processed_by_leg, result


def raise_if_infeasible(
    pipeline_result: PipelineResult,
) -> None:
    """
    Raise OptimizationInfeasible if pipeline result indicates infeasibility.
    
    Call this after process_candidates_pipeline to convert pipeline result
    to an exception if needed.
    """
    if pipeline_result.legs_below_minimum:
        raise OptimizationInfeasible(
            code=GLOBAL_INSUFFICIENT_CANDIDATES,
            message=(
                f"Insufficient candidates after filtering for legs: "
                f"{', '.join(pipeline_result.legs_below_minimum)}"
            ),
            solve_id=pipeline_result.solve_id,
            failed_scope=pipeline_result.failed_scope,
            rejections_summary=pipeline_result.to_rejections_summary(),
            rejections_sample=pipeline_result.to_rejections_sample(),
            normalization_notes=pipeline_result.normalization_notes,
            warnings=pipeline_result.warnings,
        )


def build_success_response(
    solve_id: str,
    result: dict,
    explanation: dict,
    pipeline_result: PipelineResult,
) -> dict:
    """
    Build success response payload with all required fields.
    
    Args:
        solve_id: Unique solve identifier
        result: Optimization result (itineraries, etc.)
        explanation: OptimizationExplanation dict
        pipeline_result: Pipeline result with rejections/warnings
    
    Returns:
        Complete success response dict
    """
    return {
        "status": "ok",
        "http_status": 200,
        "solve_id": solve_id,
        "result": result,
        "explanation": explanation,
        "rejections_summary": pipeline_result.to_rejections_summary(),
        "warnings": pipeline_result.warnings,
        "normalization_notes": pipeline_result.normalization_notes,
    }
