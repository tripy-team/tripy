"""
Merge gate for fingerprint collision detection.

When two candidates have the same fingerprint, we need to verify
they are truly "the same itinerary" before merging.

Merge gate checks:
- Same segment count
- For each segment: same origin, destination, carrier, flight number
- Departure/arrival times within tolerance

If merge gate fails, we have a FINGERPRINT_COLLISION and must keep
both candidates with different fingerprints.
"""

from .types import Rejection, MergeGateOutcome
from .datetime_utils import parse_dt, DatetimeParseError
from .config_mvp import get_config
from .reason_codes import FLIGHT_FINGERPRINT_COLLISION
from .fingerprinting import add_fingerprint_suffix


def check_merge_gate(candidate_a: dict, candidate_b: dict) -> MergeGateOutcome:
    """
    Check if two candidates with same fingerprint can be safely merged.
    
    REQUIRED for safe merge (must match EXACTLY):
    1. Same segment count
    2. For each segment:
       - origin (exact match)
       - destination (exact match)
       - operating_carrier (exact match when present in both)
       - flight_number (exact match when present in both)
       - dep_utc: within ±2 minutes (use unfloored values for comparison)
       - arr_utc: within ±2 minutes (use unfloored values for comparison)
    
    If ANY check fails → collision, do NOT merge.
    
    Args:
        candidate_a: First candidate (contract-valid)
        candidate_b: Second candidate (contract-valid)
    
    Returns:
        MergeGateOutcome with can_merge=True if safe to merge
    """
    config = get_config()
    segments_a = candidate_a["segments"]
    segments_b = candidate_b["segments"]
    
    # Check 1: Same segment count
    if len(segments_a) != len(segments_b):
        return MergeGateOutcome(
            can_merge=False,
            reason=f"segment_count: {len(segments_a)} vs {len(segments_b)}",
        )
    
    for i, (seg_a, seg_b) in enumerate(zip(segments_a, segments_b)):
        # Check 2a: origin
        origin_a = seg_a.get("origin")
        origin_b = seg_b.get("origin")
        if origin_a != origin_b:
            return MergeGateOutcome(
                can_merge=False,
                reason=f"segment_{i}_origin: {origin_a} vs {origin_b}",
            )
        
        # Check 2b: destination
        dest_a = seg_a.get("destination")
        dest_b = seg_b.get("destination")
        if dest_a != dest_b:
            return MergeGateOutcome(
                can_merge=False,
                reason=f"segment_{i}_destination: {dest_a} vs {dest_b}",
            )
        
        # Check 2c: operating_carrier (when present in both)
        carrier_a = seg_a.get("operating_carrier")
        carrier_b = seg_b.get("operating_carrier")
        if carrier_a and carrier_b and carrier_a != carrier_b:
            return MergeGateOutcome(
                can_merge=False,
                reason=f"segment_{i}_carrier: {carrier_a} vs {carrier_b}",
            )
        
        # Check 2d: flight_number (when present in both)
        fn_a = seg_a.get("flight_number")
        fn_b = seg_b.get("flight_number")
        if fn_a and fn_b and fn_a != fn_b:
            return MergeGateOutcome(
                can_merge=False,
                reason=f"segment_{i}_flight_number: {fn_a} vs {fn_b}",
            )
        
        # Check 2e: dep_utc within tolerance (use UNFLOORED values)
        try:
            dep_a = parse_dt(seg_a["dep_utc"])
            dep_b = parse_dt(seg_b["dep_utc"])
            dep_delta = abs((dep_a - dep_b).total_seconds())
            if dep_delta > config.MERGE_GATE_TIME_TOLERANCE_SECONDS:
                return MergeGateOutcome(
                    can_merge=False,
                    reason=f"segment_{i}_dep_utc: delta {dep_delta}s > tolerance {config.MERGE_GATE_TIME_TOLERANCE_SECONDS}s",
                )
        except (DatetimeParseError, KeyError):
            # If we can't parse, we can't verify - don't merge
            return MergeGateOutcome(
                can_merge=False,
                reason=f"segment_{i}_dep_utc: parse error",
            )
        
        # Check 2f: arr_utc within tolerance
        try:
            arr_a = parse_dt(seg_a["arr_utc"])
            arr_b = parse_dt(seg_b["arr_utc"])
            arr_delta = abs((arr_a - arr_b).total_seconds())
            if arr_delta > config.MERGE_GATE_TIME_TOLERANCE_SECONDS:
                return MergeGateOutcome(
                    can_merge=False,
                    reason=f"segment_{i}_arr_utc: delta {arr_delta}s > tolerance {config.MERGE_GATE_TIME_TOLERANCE_SECONDS}s",
                )
        except (DatetimeParseError, KeyError):
            return MergeGateOutcome(
                can_merge=False,
                reason=f"segment_{i}_arr_utc: parse error",
            )
    
    return MergeGateOutcome(can_merge=True)


def merge_candidates_with_gate(
    candidates_same_fingerprint: list[dict],
    scope_id: str,
) -> tuple[list[dict], list[str], list[Rejection]]:
    """
    Attempt to merge candidates with same fingerprint.
    
    Returns:
    - merged_candidates: list of deduplicated candidates (may be >1 if collisions)
    - warnings: merge-related warnings
    - collisions: FINGERPRINT_COLLISION rejections (for logging, not for 502)
    
    COLLISION HANDLING:
    - If merge gate fails, KEEP BOTH candidates but modify their fingerprints
    - Add candidate-specific suffix to fingerprint to prevent dedup from dropping one
    - Emit FINGERPRINT_COLLISION warning (not rejection that affects 502 logic)
    
    BUG FIX: Only emit collision when there's already at least one group.
    The first candidate starting a new group is NOT a collision.
    
    Args:
        candidates_same_fingerprint: Candidates that share the same fingerprint
        scope_id: Context for logging
    
    Returns:
        (merged_candidates, warnings, collisions)
    """
    if len(candidates_same_fingerprint) == 1:
        return candidates_same_fingerprint, [], []
    
    warnings: list[str] = []
    collisions: list[Rejection] = []
    merged_groups: list[list[dict]] = []
    
    for candidate in candidates_same_fingerprint:
        placed = False
        
        # Try to place in an existing group
        for group in merged_groups:
            # Try to merge with first candidate in group
            gate_result = check_merge_gate(group[0], candidate)
            
            if gate_result.can_merge:
                group.append(candidate)
                placed = True
                break
        
        if not placed:
            # Starting a new group
            
            # BUG FIX: Only log collision if there's already at least one group
            # The first candidate is NOT a collision - it's just starting the first group
            if merged_groups:
                # This IS a collision - we tried to merge but failed
                collisions.append(Rejection(
                    reason_code=FLIGHT_FINGERPRINT_COLLISION,
                    candidate_id=candidate.get("id", "unknown"),
                    scope_id=scope_id,
                    details={
                        "reason": "merge_gate_failed",
                        "fingerprint": candidate.get("_fingerprint"),
                        "existing_groups": len(merged_groups),
                    },
                ))
                warnings.append(
                    f"FLIGHT_FINGERPRINT_COLLISION: Candidate {candidate.get('id')} "
                    f"failed merge gate with existing groups in {scope_id}"
                )
            
            merged_groups.append([candidate])
    
    # Merge each group (combine award_quotes, pick best pricing)
    merged_candidates: list[dict] = []
    for group in merged_groups:
        if len(group) == 1:
            merged_candidates.append(group[0])
        else:
            merged = _merge_candidate_data(group)
            merged_candidates.append(merged)
    
    # If we have multiple groups (collision), modify fingerprints to differentiate
    # BUG FIX: Use provider + candidate_id for unique suffix (not just provider)
    if len(merged_candidates) > 1:
        for candidate in merged_candidates:
            provider = candidate.get("provider", "unknown")
            cid = candidate.get("id", "unknown")
            old_fp = candidate.get("_fingerprint", "")
            # Use both provider AND candidate_id to ensure uniqueness
            candidate["_fingerprint"] = add_fingerprint_suffix(old_fp, provider, cid)
    
    return merged_candidates, warnings, collisions


def _merge_candidate_data(candidates: list[dict]) -> dict:
    """
    Merge data from multiple candidates representing same itinerary.
    
    - Combine award_quotes from all sources (dedupe by program)
    - Keep best cash price
    - Prefer data from higher-confidence providers
    
    Args:
        candidates: List of candidates to merge
    
    Returns:
        Merged candidate dict
    """
    # Start with a copy of the first candidate
    base = candidates[0].copy()
    
    # Combine award_quotes (dedupe by program)
    all_quotes: list[dict] = []
    seen_programs: set[str] = set()
    
    for candidate in candidates:
        for quote in candidate.get("award_quotes", []):
            if isinstance(quote, dict):
                program = quote.get("program")
                if program and program not in seen_programs:
                    all_quotes.append(quote)
                    seen_programs.add(program)
    
    base["award_quotes"] = all_quotes
    
    # Keep best (lowest) cash price
    cash_values = []
    for c in candidates:
        cash = c.get("cash_total")
        if cash is not None:
            try:
                cash_values.append(float(cash))
            except (ValueError, TypeError):
                pass
    
    if cash_values:
        base["cash_total"] = min(cash_values)
    
    # Track which providers contributed
    providers = [c.get("provider", "unknown") for c in candidates]
    base["_merged_from_providers"] = providers
    
    return base


def group_by_fingerprint(candidates: list[dict]) -> dict[str, list[dict]]:
    """
    Group candidates by their fingerprint.
    
    Args:
        candidates: List of candidates with _fingerprint field
    
    Returns:
        Dict mapping fingerprint -> list of candidates
    """
    by_fingerprint: dict[str, list[dict]] = {}
    
    for candidate in candidates:
        fp = candidate.get("_fingerprint", "")
        if fp not in by_fingerprint:
            by_fingerprint[fp] = []
        by_fingerprint[fp].append(candidate)
    
    return by_fingerprint
