# Personal Implementation Plan (Execution Checklist)

This is my concrete implementation plan to deliver `docs/OPTIMIZATION_ILP_ALIGNMENT_IMPLEMENTATION_PLAN.md` as working code, in a sequence that lands safely and avoids drift.

---

## Guiding rules (to avoid regressions)

- **Ship in small PRs**: each PR should be reviewable and independently valuable.
- **Contracts are executable**: Candidate Contract + SolutionAccounting + reason codes are enforced by validators and tested.
- **No silent fallbacks**: remove `date.today()` parsing fallbacks (hard errors).
- **Keep MILP stable**: encode complexity via precomputed coefficients/warnings; avoid new MILP dimensions unless required.
- **Determinism**: metro resolution ordering, caching keys, and fingerprints must be stable.
- **Central config**: all thresholds/caps/TTLs live in one module and are logged per solve.
- **Reason code namespacing**: all codes prefixed by domain (`FLIGHT_*`, `HOTEL_*`, `GLOBAL_*`).
- **Separation of concerns**: Contract validation and policy filtering are SEPARATE functions.
- **Shared types in one module**: `Rejection`, outcomes, etc. live in `types.py` to prevent circular imports.

---

## Pre-implementation Checklist (final fixes before coding)

Apply these fixes to ensure implementation behaves exactly as intended:

| Fix | Issue | Solution |
|-----|-------|----------|
| 1 | `Rejection` referenced in multiple modules | Move to `optimization/types.py`, import everywhere |
| 2 | Contract validation continues after missing candidate-level fields | Early return if `segments` is None/not-list/empty |
| 3 | `FLIGHT_NAIVE_DATETIME` used for all parse errors | Split into `FLIGHT_DATETIME_PARSE_ERROR` + `FLIGHT_DATETIME_NAIVE` |
| 4 | Fingerprint suffix by provider can collide | Use `provider + candidate_id` for unique suffix |
| 5 | Collision logged for first candidate (bug) | Only emit collision if `merged_groups` already has groups |

---

## Critical Implementation Fixes (must-fix for correctness)

These are the specific code issues that would cause the optimizer to misbehave if not addressed. **All snippets in this document incorporate these fixes.**

### Fix 1: Shared types module (prevents circular imports)

**Problem**: `Rejection` type is defined in `contract_validation.py` but needed in `policy_filtering.py`, causing circular imports or NameError.

**Solution**: Create a shared types module:

```python
# backend/src/optimization/types.py
"""
Shared types for optimization pipeline.
Import from here to prevent circular dependencies.
"""

from dataclasses import dataclass, field
from typing import Any, Literal
from decimal import Decimal

@dataclass
class Rejection:
    """
    A rejection of a candidate with reason code and details.
    Used by both contract validation and policy filtering.
    """
    reason_code: str
    candidate_id: str
    scope_id: str
    details: dict[str, Any] = field(default_factory=dict)

@dataclass
class ContractValidationOutcome:
    """
    Outcome of contract validation (schema/structural only).
    If is_valid=False, candidate is MALFORMED and should not proceed to policy checks.
    """
    is_valid: bool
    rejections: list[Rejection]
    candidate_id: str

@dataclass
class PolicyFilterOutcome:
    """
    Outcome of policy filtering.
    If is_allowed=False, candidate failed business rules but is NOT malformed.
    """
    is_allowed: bool
    rejections: list[Rejection]
    candidate_id: str

@dataclass
class MergeGateOutcome:
    """Result of merge gate check between two candidates."""
    can_merge: bool
    reason: str | None = None

@dataclass
class LegValidationResult:
    """
    Validation result for a single leg.
    Counts are PER-CANDIDATE, not per-rejection.
    """
    contract_valid: list[dict]
    contract_rejections: list[Rejection]
    malformed_candidate_count: int
    warnings: list[str] = field(default_factory=list)
```

**Import pattern:**

```python
# In contract_validation.py
from optimization.types import Rejection, ContractValidationOutcome

# In policy_filtering.py
from optimization.types import Rejection, PolicyFilterOutcome

# In merge_gate.py
from optimization.types import Rejection, MergeGateOutcome
```

---

### Fix 2: Centralized datetime parsing for "Z" suffix

**Problem**: `datetime.fromisoformat("2024-06-01T10:00:00Z")` fails on Python < 3.11 because "Z" isn't recognized.

**Impact**: Contract validation and fingerprinting throw exceptions, killing solves or misclassifying candidates.

**Solution**: Centralize all datetime parsing:

```python
# backend/src/optimization/datetime_utils.py
"""Centralized datetime parsing. USE THIS EVERYWHERE."""

from datetime import datetime, timezone

class DatetimeParseError(ValueError):
    """Raised when datetime string cannot be parsed."""
    pass

class DatetimeNaiveError(ValueError):
    """Raised when datetime is missing timezone info."""
    pass

def parse_dt(dt_str: str) -> datetime:
    """
    Parse ISO8601 datetime string, handling 'Z' suffix for all Python versions.
    
    CRITICAL: Use this function for ALL datetime parsing in:
    - adapter_v3.py
    - contract_validation.py
    - fingerprinting
    - merge gates
    
    Raises:
        DatetimeParseError: if string cannot be parsed
        DatetimeNaiveError: if datetime has no timezone
    """
    try:
        if dt_str.endswith("Z"):
            dt_str = dt_str[:-1] + "+00:00"
        dt = datetime.fromisoformat(dt_str)
    except ValueError as e:
        raise DatetimeParseError(f"Cannot parse datetime: {dt_str}") from e
    
    if dt.tzinfo is None:
        raise DatetimeNaiveError(f"Datetime must be timezone-aware: {dt_str}")
    
    return dt

def parse_dt_or_none(dt_str: str | None) -> datetime | None:
    """Parse datetime, returning None if input is None."""
    if dt_str is None:
        return None
    return parse_dt(dt_str)
```

---

### Fix 3: Contract validation with proper early return and datetime error codes

**Problem**: 
1. Validation continues after missing candidate-level fields (can hit `segments=None`)
2. Using `FLIGHT_NAIVE_DATETIME` for all parse errors (should distinguish parse error vs naive)

**Solution**: Proper early return and split error codes:

```python
# backend/src/optimization/contract_validation.py
"""
Contract validation ONLY. No policy logic here.
Determines if candidate is structurally valid (schema, required fields, parseable data).
"""

from optimization.types import Rejection, ContractValidationOutcome
from optimization.datetime_utils import parse_dt, DatetimeParseError, DatetimeNaiveError
from optimization.reason_codes import (
    FLIGHT_MISSING_REQUIRED_FIELD,
    FLIGHT_DATETIME_PARSE_ERROR,
    FLIGHT_DATETIME_NAIVE,
)

# Contract schema definition
CANDIDATE_REQUIRED_FIELDS = ["id", "segments"]
SEGMENT_REQUIRED_FIELDS = ["origin", "destination", "dep_utc", "arr_utc"]

def validate_flight_candidate_contract(candidate: dict, scope_id: str) -> ContractValidationOutcome:
    """
    Validate candidate CONTRACT ONLY (schema, required fields, parseable datetimes).
    
    This function does NOT check any policy rules (ticketing, airports, etc.).
    Policy filtering happens AFTER contract validation, fingerprinting, and dedup.
    
    IMPORTANT: Early returns when fundamental fields are malformed.
    """
    rejections = []
    candidate_id = candidate.get("id", "unknown")
    
    # === PHASE 1: Candidate-level required fields ===
    for field_name in CANDIDATE_REQUIRED_FIELDS:
        if field_name not in candidate or candidate[field_name] is None:
            rejections.append(Rejection(
                reason_code=FLIGHT_MISSING_REQUIRED_FIELD,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={"missing_field": field_name, "level": "candidate"}
            ))
    
    # === PHASE 2: Validate segments structure (EARLY RETURN if malformed) ===
    segments = candidate.get("segments")
    
    # Check segments is a non-empty list
    if not isinstance(segments, list):
        rejections.append(Rejection(
            reason_code=FLIGHT_MISSING_REQUIRED_FIELD,
            candidate_id=candidate_id,
            scope_id=scope_id,
            details={"missing_field": "segments", "error": "not a list", "actual_type": type(segments).__name__}
        ))
        # EARLY RETURN: Cannot proceed without valid segments
        return ContractValidationOutcome(is_valid=False, rejections=rejections, candidate_id=candidate_id)
    
    if len(segments) == 0:
        rejections.append(Rejection(
            reason_code=FLIGHT_MISSING_REQUIRED_FIELD,
            candidate_id=candidate_id,
            scope_id=scope_id,
            details={"missing_field": "segments", "error": "empty list"}
        ))
        # EARLY RETURN: Cannot proceed without segments
        return ContractValidationOutcome(is_valid=False, rejections=rejections, candidate_id=candidate_id)
    
    # === PHASE 3: Segment-level required fields ===
    for i, seg in enumerate(segments):
        if not isinstance(seg, dict):
            rejections.append(Rejection(
                reason_code=FLIGHT_MISSING_REQUIRED_FIELD,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={"error": "segment not a dict", "segment_index": i, "actual_type": type(seg).__name__}
            ))
            continue
        
        for field_name in SEGMENT_REQUIRED_FIELDS:
            if field_name not in seg or seg[field_name] is None:
                rejections.append(Rejection(
                    reason_code=FLIGHT_MISSING_REQUIRED_FIELD,
                    candidate_id=candidate_id,
                    scope_id=scope_id,
                    details={"missing_field": field_name, "level": "segment", "segment_index": i}
                ))
        
        # Validate segment datetime parsing with SPLIT ERROR CODES
        for dt_field in ["dep_utc", "arr_utc"]:
            dt_str = seg.get(dt_field)
            if dt_str:
                try:
                    parse_dt(dt_str)  # Use centralized parser
                except DatetimeParseError as e:
                    # Cannot parse at all (invalid format)
                    rejections.append(Rejection(
                        reason_code=FLIGHT_DATETIME_PARSE_ERROR,
                        candidate_id=candidate_id,
                        scope_id=scope_id,
                        details={
                            "field": dt_field,
                            "segment_index": i,
                            "value": dt_str,
                            "error": str(e),
                            "error_type": "parse_error"
                        }
                    ))
                except DatetimeNaiveError as e:
                    # Parsed but missing timezone
                    rejections.append(Rejection(
                        reason_code=FLIGHT_DATETIME_NAIVE,
                        candidate_id=candidate_id,
                        scope_id=scope_id,
                        details={
                            "field": dt_field,
                            "segment_index": i,
                            "value": dt_str,
                            "error": str(e),
                            "error_type": "naive_datetime"
                        }
                    ))
    
    return ContractValidationOutcome(
        is_valid=len(rejections) == 0,
        rejections=rejections,
        candidate_id=candidate_id,
    )
```

---

### Fix 4: Policy filtering (separate module, with precondition assertion)

**Problem**: Policy functions could be called on malformed candidates.

**Solution**: Add precondition assertion:

```python
# backend/src/optimization/policy_filtering.py
"""
Policy filtering ONLY. No contract/schema validation here.
Determines if a contract-valid candidate meets business rules.

IMPORTANT: Only call these functions on candidates that PASSED contract validation.
"""

from optimization.types import Rejection, PolicyFilterOutcome
from optimization.config_mvp import get_config
from optimization.reason_codes import (
    FLIGHT_AIRPORT_NOT_ALLOWED,
    FLIGHT_AIRPORT_CHANGE_CONNECTION,
    FLIGHT_TICKETING_NOT_SINGLE,
    FLIGHT_TICKETING_UNKNOWN_CONNECTING,
)

def apply_policy_filters_to_candidate(
    candidate: dict,
    scope_id: str,
    allowed_origin_airports: list[str] | None,
    allowed_destination_airports: list[str] | None,
) -> PolicyFilterOutcome:
    """
    Apply all policy filters to a single candidate.
    
    PRECONDITION: candidate has passed contract validation.
    This is enforced with assertions.
    """
    # === PRECONDITION CHECK ===
    # These assertions catch bugs where policy is called on malformed candidates
    assert "segments" in candidate, "Policy filtering requires contract-valid candidate (missing segments)"
    assert isinstance(candidate["segments"], list), "Policy filtering requires contract-valid candidate (segments not list)"
    assert len(candidate["segments"]) > 0, "Policy filtering requires contract-valid candidate (empty segments)"
    
    rejections = []
    candidate_id = candidate.get("id", "unknown")
    segments = candidate["segments"]
    config = get_config()
    
    # Policy 1: Airport allowlist
    first_segment = segments[0]
    last_segment = segments[-1]
    
    if allowed_origin_airports and first_segment["origin"] not in allowed_origin_airports:
        rejections.append(Rejection(
            reason_code=FLIGHT_AIRPORT_NOT_ALLOWED,
            candidate_id=candidate_id,
            scope_id=scope_id,
            details={
                "airport": first_segment["origin"],
                "allowed": allowed_origin_airports,
                "position": "origin",
            }
        ))
    
    if allowed_destination_airports and last_segment["destination"] not in allowed_destination_airports:
        rejections.append(Rejection(
            reason_code=FLIGHT_AIRPORT_NOT_ALLOWED,
            candidate_id=candidate_id,
            scope_id=scope_id,
            details={
                "airport": last_segment["destination"],
                "allowed": allowed_destination_airports,
                "position": "destination",
            }
        ))
    
    # Policy 2: Airport-change connections
    for i in range(len(segments) - 1):
        if segments[i]["destination"] != segments[i + 1]["origin"]:
            rejections.append(Rejection(
                reason_code=FLIGHT_AIRPORT_CHANGE_CONNECTION,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={
                    "segment_index": i,
                    "arriving_at": segments[i]["destination"],
                    "departing_from": segments[i + 1]["origin"],
                }
            ))
    
    # Policy 3: Ticketing (single-ticket for connections)
    num_stops = len(segments) - 1
    ticketing = candidate.get("ticketing", {})
    ticketing_type = ticketing.get("type", "UNKNOWN")
    
    if num_stops == 0:
        if ticketing_type == "UNKNOWN" and not config.ALLOW_UNKNOWN_TICKETING_NONSTOP:
            rejections.append(Rejection(
                reason_code=FLIGHT_TICKETING_UNKNOWN_CONNECTING,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={"num_stops": num_stops, "ticketing_type": ticketing_type}
            ))
    else:
        if ticketing_type != "SINGLE_TICKET":
            code = FLIGHT_TICKETING_UNKNOWN_CONNECTING if ticketing_type == "UNKNOWN" else FLIGHT_TICKETING_NOT_SINGLE
            rejections.append(Rejection(
                reason_code=code,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={"num_stops": num_stops, "ticketing_type": ticketing_type}
            ))
    
    return PolicyFilterOutcome(
        is_allowed=len(rejections) == 0,
        rejections=rejections,
        candidate_id=candidate_id,
    )

def apply_policy_filters(
    candidates: list[dict],
    leg: "OrderedLeg",
) -> tuple[list[dict], list[Rejection]]:
    """
    Apply policy filters to all candidates for a leg.
    Returns (allowed_candidates, policy_rejections).
    """
    scope_id = f"leg_{leg.leg_id}"
    allowed = []
    all_rejections = []
    
    for candidate in candidates:
        outcome = apply_policy_filters_to_candidate(
            candidate,
            scope_id,
            leg.allowed_origin_airports,
            leg.allowed_destination_airports,
        )
        
        if outcome.is_allowed:
            allowed.append(candidate)
        else:
            all_rejections.extend(outcome.rejections)
    
    return allowed, all_rejections
```

---

### Fix 5: Merge gate with FIXED collision logging

**Problem**: The original code logged a collision for the FIRST candidate, which is incorrect (no collision exists yet).

**Solution**: Only emit collision when there's already at least one group:

```python
# backend/src/optimization/merge_gate.py
"""
Merge gate for fingerprint collision detection.
"""

from optimization.types import Rejection, MergeGateOutcome
from optimization.datetime_utils import parse_dt
from optimization.reason_codes import FLIGHT_FINGERPRINT_COLLISION

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
    """
    segments_a = candidate_a["segments"]
    segments_b = candidate_b["segments"]
    
    # Check 1: Same segment count
    if len(segments_a) != len(segments_b):
        return MergeGateOutcome(False, f"segment_count: {len(segments_a)} vs {len(segments_b)}")
    
    for i, (seg_a, seg_b) in enumerate(zip(segments_a, segments_b)):
        # Check 2a: origin
        if seg_a["origin"] != seg_b["origin"]:
            return MergeGateOutcome(False, f"segment_{i}_origin: {seg_a['origin']} vs {seg_b['origin']}")
        
        # Check 2b: destination
        if seg_a["destination"] != seg_b["destination"]:
            return MergeGateOutcome(False, f"segment_{i}_destination")
        
        # Check 2c: operating_carrier (when present in both)
        carrier_a = seg_a.get("operating_carrier")
        carrier_b = seg_b.get("operating_carrier")
        if carrier_a and carrier_b and carrier_a != carrier_b:
            return MergeGateOutcome(False, f"segment_{i}_carrier: {carrier_a} vs {carrier_b}")
        
        # Check 2d: flight_number (when present in both)
        fn_a = seg_a.get("flight_number")
        fn_b = seg_b.get("flight_number")
        if fn_a and fn_b and fn_a != fn_b:
            return MergeGateOutcome(False, f"segment_{i}_flight_number: {fn_a} vs {fn_b}")
        
        # Check 2e: dep_utc within tolerance (use UNFLOORED values)
        dep_a = parse_dt(seg_a["dep_utc"])
        dep_b = parse_dt(seg_b["dep_utc"])
        if abs((dep_a - dep_b).total_seconds()) > 120:  # 2 minutes
            return MergeGateOutcome(False, f"segment_{i}_dep_utc: delta > 2min")
        
        # Check 2f: arr_utc within tolerance
        arr_a = parse_dt(seg_a["arr_utc"])
        arr_b = parse_dt(seg_b["arr_utc"])
        if abs((arr_a - arr_b).total_seconds()) > 120:
            return MergeGateOutcome(False, f"segment_{i}_arr_utc: delta > 2min")
    
    return MergeGateOutcome(True)

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
    """
    if len(candidates_same_fingerprint) == 1:
        return candidates_same_fingerprint, [], []
    
    warnings = []
    collisions = []
    merged_groups: list[list[dict]] = []
    
    for candidate in candidates_same_fingerprint:
        placed = False
        
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
                    }
                ))
                warnings.append(
                    f"FLIGHT_FINGERPRINT_COLLISION: Candidate {candidate.get('id')} failed merge gate with existing groups in {scope_id}"
                )
            
            merged_groups.append([candidate])
    
    # Merge each group (combine award_quotes, pick best pricing)
    merged_candidates = []
    for group in merged_groups:
        if len(group) == 1:
            merged_candidates.append(group[0])
        else:
            merged = merge_candidate_data(group)
            merged_candidates.append(merged)
    
    # If we have multiple groups (collision), modify fingerprints to differentiate
    # BUG FIX: Use provider + candidate_id for unique suffix (not just provider)
    if len(merged_candidates) > 1:
        for candidate in merged_candidates:
            provider = candidate.get("provider", "unknown")
            cid = candidate.get("id", "unknown")
            # Use both provider AND candidate_id to ensure uniqueness
            candidate["_fingerprint"] = f"{candidate['_fingerprint']}_{provider}_{cid}"
    
    return merged_candidates, warnings, collisions

def merge_candidate_data(candidates: list[dict]) -> dict:
    """
    Merge data from multiple candidates representing same itinerary.
    
    - Combine award_quotes from all sources
    - Keep best cash price
    - Prefer data from higher-confidence providers
    """
    base = candidates[0].copy()
    
    # Combine award_quotes (dedupe by program)
    all_quotes = []
    seen_programs = set()
    for candidate in candidates:
        for quote in candidate.get("award_quotes", []):
            program = quote.get("program")
            if program and program not in seen_programs:
                all_quotes.append(quote)
                seen_programs.add(program)
    
    base["award_quotes"] = all_quotes
    
    # Keep best cash price
    best_cash = min(
        (c.get("cash_total", float("inf")) for c in candidates),
        default=None
    )
    if best_cash and best_cash != float("inf"):
        base["cash_total"] = best_cash
    
    return base
```

---

### Fix 6: Updated reason codes with datetime split

```python
# backend/src/optimization/reason_codes.py
"""
Namespaced reason codes for rejections and warnings.
All codes prefixed by domain: FLIGHT_*, HOTEL_*, GLOBAL_*
"""

# Flight-specific codes
FLIGHT_AIRPORT_NOT_ALLOWED = "FLIGHT_AIRPORT_NOT_ALLOWED"
FLIGHT_TICKETING_NOT_SINGLE = "FLIGHT_TICKETING_NOT_SINGLE"
FLIGHT_TICKETING_UNKNOWN_CONNECTING = "FLIGHT_TICKETING_UNKNOWN_CONNECTING"
FLIGHT_AIRPORT_CHANGE_CONNECTION = "FLIGHT_AIRPORT_CHANGE_CONNECTION"
FLIGHT_SURCHARGE_CAP_EXCEEDED = "FLIGHT_SURCHARGE_CAP_EXCEEDED"
FLIGHT_MAX_STOPS_EXCEEDED = "FLIGHT_MAX_STOPS_EXCEEDED"
FLIGHT_MAX_DURATION_EXCEEDED = "FLIGHT_MAX_DURATION_EXCEEDED"
FLIGHT_MISSING_REQUIRED_FIELD = "FLIGHT_MISSING_REQUIRED_FIELD"
FLIGHT_FINGERPRINT_COLLISION = "FLIGHT_FINGERPRINT_COLLISION"
FLIGHT_ALL_FILTERED_BY_POLICY = "FLIGHT_ALL_FILTERED_BY_POLICY"

# Datetime-specific codes (SPLIT for better debugging)
FLIGHT_DATETIME_PARSE_ERROR = "FLIGHT_DATETIME_PARSE_ERROR"  # Cannot parse string at all
FLIGHT_DATETIME_NAIVE = "FLIGHT_DATETIME_NAIVE"              # Parsed but missing timezone

# Hotel-specific codes
HOTEL_INCOMPLETE_PRICING = "HOTEL_INCOMPLETE_PRICING"
HOTEL_NIGHTS_NOT_CONSECUTIVE = "HOTEL_NIGHTS_NOT_CONSECUTIVE"
HOTEL_MISSING_ROOM_QUOTE_ID = "HOTEL_MISSING_ROOM_QUOTE_ID"
HOTEL_FINGERPRINT_COLLISION = "HOTEL_FINGERPRINT_COLLISION"
HOTEL_RESORT_FEE_UNKNOWN = "HOTEL_RESORT_FEE_UNKNOWN"
HOTEL_ALL_FILTERED_BY_POLICY = "HOTEL_ALL_FILTERED_BY_POLICY"
HOTEL_DATETIME_PARSE_ERROR = "HOTEL_DATETIME_PARSE_ERROR"
HOTEL_DATETIME_NAIVE = "HOTEL_DATETIME_NAIVE"

# Global codes
GLOBAL_DATE_PARSE_ERROR = "GLOBAL_DATE_PARSE_ERROR"
GLOBAL_AMBIGUOUS_LOCATION = "GLOBAL_AMBIGUOUS_LOCATION"
GLOBAL_INVALID_AIRPORT_CODE = "GLOBAL_INVALID_AIRPORT_CODE"
GLOBAL_MISSING_REQUIRED_FIELD = "GLOBAL_MISSING_REQUIRED_FIELD"
GLOBAL_UPSTREAM_TIMEOUT = "GLOBAL_UPSTREAM_TIMEOUT"
GLOBAL_ALL_CANDIDATES_MALFORMED = "GLOBAL_ALL_CANDIDATES_MALFORMED"
GLOBAL_INSUFFICIENT_CANDIDATES = "GLOBAL_INSUFFICIENT_CANDIDATES"
GLOBAL_NO_FEASIBLE_SOLUTION = "GLOBAL_NO_FEASIBLE_SOLUTION"
```

---

### Fix 7: Correct pipeline order (no duplicate policy filtering)

```python
def process_candidates_pipeline(
    raw_candidates_by_leg: dict[str, list[dict]],
    legs: list[OrderedLeg],
    normalization_notes: list[str],
    solve_id: str,
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
    """
    result = PipelineResult(
        solve_id=solve_id,
        normalization_notes=normalization_notes,
    )
    
    processed_by_leg: dict[str, list[dict]] = {}
    
    for leg_id, raw_candidates in raw_candidates_by_leg.items():
        leg = next((l for l in legs if str(l.leg_id) == leg_id), None)
        if not leg:
            continue
        
        scope_id = f"leg_{leg_id}"
        
        if not raw_candidates:
            result.warnings.append(f"No candidates received for {scope_id}")
            processed_by_leg[leg_id] = []
            continue
        
        # === STAGE 1: CONTRACT VALIDATION (schema only) ===
        contract_result = validate_contracts_for_leg(raw_candidates, leg_id)
        result.contract_rejections.extend(contract_result.contract_rejections)
        
        # Check for TRUE upstream regression (100% malformed)
        if should_raise_upstream_error(contract_result.malformed_candidate_count, len(raw_candidates)):
            raise OptimizationUpstreamError(
                code=GLOBAL_ALL_CANDIDATES_MALFORMED,
                message=f"All flight candidates for {scope_id} failed contract validation",
                details={
                    "leg_id": leg_id,
                    "solve_id": solve_id,
                    "total_candidates": len(raw_candidates),
                    "malformed_count": contract_result.malformed_candidate_count,
                    "sample_errors": [
                        {"reason_code": r.reason_code, "candidate_id": r.candidate_id}
                        for r in contract_result.contract_rejections[:5]
                    ],
                }
            )
        
        contract_valid = contract_result.contract_valid
        
        # === STAGE 2: FINGERPRINTING ===
        for candidate in contract_valid:
            candidate["_fingerprint"] = compute_itinerary_fingerprint(candidate["segments"])
        
        # === STAGE 3: GROUPING by fingerprint ===
        by_fingerprint: dict[str, list[dict]] = {}
        for candidate in contract_valid:
            fp = candidate["_fingerprint"]
            if fp not in by_fingerprint:
                by_fingerprint[fp] = []
            by_fingerprint[fp].append(candidate)
        
        # === STAGE 4 & 5: MERGE GATE + DEDUP ===
        deduped_candidates = []
        for fp, group in by_fingerprint.items():
            merged, merge_warnings, collisions = merge_candidates_with_gate(group, scope_id)
            deduped_candidates.extend(merged)
            result.warnings.extend(merge_warnings)
            result.fingerprint_collisions.extend(collisions)
        
        # === STAGE 6: POLICY FILTERING (ONLY HERE, NOT BEFORE) ===
        policy_allowed, policy_rejections = apply_policy_filters(deduped_candidates, leg)
        result.policy_rejections.extend(policy_rejections)
        
        # === STAGE 7: MIN CANDIDATES CHECK (AFTER DEDUP) ===
        # Note: has_award_candidates is based on what SURVIVED filtering
        # This is intentional - minimum is about what we can actually use
        has_award_candidates = any(c.get("award_quotes") for c in policy_allowed)
        
        is_sufficient, failure_code = check_min_candidates_after_dedup(
            policy_allowed,
            has_award_candidates=has_award_candidates,
            leg_id=leg_id,
        )
        
        if not is_sufficient:
            result.legs_below_minimum.append(leg_id)
            result.warnings.append(
                f"GLOBAL_INSUFFICIENT_CANDIDATES: {scope_id} has {len(policy_allowed)} candidates after dedup+filtering"
            )
        
        processed_by_leg[leg_id] = policy_allowed
    
    # Determine failed_scope for infeasible response
    result.failed_scope = determine_failed_scope(processed_by_leg, result.legs_below_minimum)
    
    return processed_by_leg, result
```

---

## Invariant tests (one per stage)

Add these tests to catch bugs early:

```python
# backend/tests/test_pipeline_invariants.py
"""Invariant tests for each pipeline stage."""

import pytest
from optimization.contract_validation import validate_flight_candidate_contract
from optimization.policy_filtering import apply_policy_filters_to_candidate
from optimization.merge_gate import merge_candidates_with_gate

class TestContractValidationInvariants:
    """Invariants for contract validation."""
    
    def test_missing_segments_returns_malformed(self):
        """Missing segments must return malformed, not crash."""
        candidate = {"id": "test_1"}  # No segments
        outcome = validate_flight_candidate_contract(candidate, "leg_0")
        
        assert not outcome.is_valid
        assert any(r.reason_code == "FLIGHT_MISSING_REQUIRED_FIELD" for r in outcome.rejections)
    
    def test_null_segments_returns_malformed(self):
        """None segments must return malformed, not crash."""
        candidate = {"id": "test_1", "segments": None}
        outcome = validate_flight_candidate_contract(candidate, "leg_0")
        
        assert not outcome.is_valid
    
    def test_empty_segments_returns_malformed(self):
        """Empty segments list must return malformed."""
        candidate = {"id": "test_1", "segments": []}
        outcome = validate_flight_candidate_contract(candidate, "leg_0")
        
        assert not outcome.is_valid
    
    def test_datetime_parse_error_vs_naive(self):
        """Parse error and naive datetime have different reason codes."""
        # Parse error
        candidate_parse = {
            "id": "test_1",
            "segments": [{"origin": "SEA", "destination": "JFK", "dep_utc": "not-a-date", "arr_utc": "2024-06-01T18:00:00Z"}]
        }
        outcome_parse = validate_flight_candidate_contract(candidate_parse, "leg_0")
        assert any(r.reason_code == "FLIGHT_DATETIME_PARSE_ERROR" for r in outcome_parse.rejections)
        
        # Naive datetime
        candidate_naive = {
            "id": "test_2",
            "segments": [{"origin": "SEA", "destination": "JFK", "dep_utc": "2024-06-01T10:00:00", "arr_utc": "2024-06-01T18:00:00Z"}]
        }
        outcome_naive = validate_flight_candidate_contract(candidate_naive, "leg_0")
        assert any(r.reason_code == "FLIGHT_DATETIME_NAIVE" for r in outcome_naive.rejections)

class TestPolicyFilteringInvariants:
    """Invariants for policy filtering."""
    
    def test_rejects_malformed_candidate(self):
        """Policy filtering should assert on malformed candidates."""
        malformed = {"id": "test_1"}  # No segments
        
        with pytest.raises(AssertionError):
            apply_policy_filters_to_candidate(malformed, "leg_0", None, None)
    
    def test_accepts_contract_valid_candidate(self):
        """Policy filtering should work on contract-valid candidates."""
        valid = {
            "id": "test_1",
            "segments": [{"origin": "SEA", "destination": "JFK", "dep_utc": "2024-06-01T10:00:00Z", "arr_utc": "2024-06-01T18:00:00Z"}]
        }
        
        # Should not raise
        outcome = apply_policy_filters_to_candidate(valid, "leg_0", None, None)
        assert isinstance(outcome.is_allowed, bool)

class TestMergeGateInvariants:
    """Invariants for merge gate."""
    
    def test_first_candidate_no_collision(self):
        """First candidate should not emit collision."""
        candidates = [
            {"id": "test_1", "segments": [{"origin": "SEA", "destination": "JFK", "dep_utc": "2024-06-01T10:00:00Z", "arr_utc": "2024-06-01T18:00:00Z"}], "_fingerprint": "fp_1"}
        ]
        
        merged, warnings, collisions = merge_candidates_with_gate(candidates, "leg_0")
        
        assert len(collisions) == 0
        assert len(warnings) == 0
    
    def test_identical_candidates_merge_no_collision(self):
        """Identical candidates should merge without collision."""
        candidates = [
            {"id": "test_1", "provider": "amadeus", "segments": [{"origin": "SEA", "destination": "JFK", "dep_utc": "2024-06-01T10:00:00Z", "arr_utc": "2024-06-01T18:00:00Z"}], "_fingerprint": "fp_1"},
            {"id": "test_2", "provider": "awardtool", "segments": [{"origin": "SEA", "destination": "JFK", "dep_utc": "2024-06-01T10:01:00Z", "arr_utc": "2024-06-01T18:01:00Z"}], "_fingerprint": "fp_1"},
        ]
        
        merged, warnings, collisions = merge_candidates_with_gate(candidates, "leg_0")
        
        assert len(merged) == 1  # Merged into one
        assert len(collisions) == 0
    
    def test_collision_emits_warning_for_second_group(self):
        """Collision should only be emitted when starting second+ group."""
        candidates = [
            {"id": "test_1", "provider": "amadeus", "segments": [{"origin": "SEA", "destination": "JFK", "dep_utc": "2024-06-01T10:00:00Z", "arr_utc": "2024-06-01T18:00:00Z"}], "_fingerprint": "fp_1"},
            {"id": "test_2", "provider": "awardtool", "segments": [{"origin": "SEA", "destination": "LAX", "dep_utc": "2024-06-01T10:00:00Z", "arr_utc": "2024-06-01T18:00:00Z"}], "_fingerprint": "fp_1"},  # Different destination!
        ]
        
        merged, warnings, collisions = merge_candidates_with_gate(candidates, "leg_0")
        
        assert len(merged) == 2  # Kept both
        assert len(collisions) == 1  # One collision (for second candidate)
    
    def test_fingerprint_suffix_includes_candidate_id(self):
        """Fingerprint suffix should include candidate_id for uniqueness."""
        candidates = [
            {"id": "test_1", "provider": "amadeus", "segments": [{"origin": "SEA", "destination": "JFK", "dep_utc": "2024-06-01T10:00:00Z", "arr_utc": "2024-06-01T18:00:00Z"}], "_fingerprint": "fp_1"},
            {"id": "test_2", "provider": "amadeus", "segments": [{"origin": "SEA", "destination": "LAX", "dep_utc": "2024-06-01T10:00:00Z", "arr_utc": "2024-06-01T18:00:00Z"}], "_fingerprint": "fp_1"},  # Same provider, different dest
        ]
        
        merged, warnings, collisions = merge_candidates_with_gate(candidates, "leg_0")
        
        # Both should have unique fingerprints
        fps = [c["_fingerprint"] for c in merged]
        assert len(fps) == len(set(fps)), "Fingerprints should be unique"
        assert "test_1" in fps[0] or "test_2" in fps[0], "Fingerprint should include candidate_id"
```

---

## File structure (modules)

```
backend/src/optimization/
├── types.py                    # Shared types: Rejection, outcomes
├── datetime_utils.py           # parse_dt, DatetimeParseError, DatetimeNaiveError
├── config_mvp.py               # Configuration
├── reason_codes.py             # All reason codes
├── errors.py                   # OptimizationUserInputError, etc.
├── contract_validation.py      # Contract validation ONLY
├── policy_filtering.py         # Policy filtering ONLY
├── merge_gate.py               # Merge gate + fingerprint handling
├── fingerprinting.py           # compute_itinerary_fingerprint
├── pipeline.py                 # process_candidates_pipeline
├── solver_v3.py                # MILP solver
└── adapter_v3.py               # Adapter layer
```

---

## Final landability checklist

| Item | PR | Status |
|------|-----|--------|
| `Rejection` in shared `types.py` module | 1 | ☐ |
| Contract validation early returns on malformed segments | 2a | ☐ |
| Split `FLIGHT_DATETIME_PARSE_ERROR` and `FLIGHT_DATETIME_NAIVE` | 1 | ☐ |
| Fingerprint suffix uses `provider + candidate_id` | 2b | ☐ |
| Collision logging only for 2nd+ group (bug fix) | 2b | ☐ |
| Policy filtering asserts contract-valid precondition | 2b | ☐ |
| Invariant tests for each stage | All | ☐ |
| No duplicate policy filtering in pipeline | 2b | ☐ |
| Min candidates checked AFTER dedup | 2b | ☐ |
| solve_id in ALL responses | All | ☐ |

---

## Revised PR stack summary

| PR | Name | Key Deliverables |
|----|------|------------------|
| **PR 1** | Types + Utils + Config | `types.py`, `datetime_utils.py`, `reason_codes.py`, `config_mvp.py` |
| **PR 2a** | Contract validation | `contract_validation.py` with early returns and split datetime codes |
| **PR 2b** | Policy + Merge + Pipeline | `policy_filtering.py`, `merge_gate.py` (fixed), `pipeline.py` |
| **PR 3** | Metro resolver + IATA | Airport resolution |
| **PR 4** | Search + Provider health | Concurrency, timeouts, stats |
| **PR 5** | Solver + Accounting | MILP, transfer accumulation, explainability |

---

This plan is now correct, internally consistent, and ready to implement. The key fixes ensure:

- ✅ No circular imports (shared types module)
- ✅ Contract validation fails fast on malformed segments
- ✅ Datetime errors are distinguishable (parse vs naive)
- ✅ Fingerprint collisions keep both candidates with unique suffixes
- ✅ Collision logging doesn't fire for the first candidate
- ✅ Policy filtering catches misuse via assertions
- ✅ Invariant tests catch regressions at each stage
