"""
Contract validation ONLY. No policy logic here.

Determines if a candidate is structurally valid (schema, required fields, parseable data).
This is the FIRST step in the pipeline - malformed candidates cannot proceed to policy checks.

Contract validation checks:
- Required fields present
- Correct data types  
- Parseable datetimes

Policy filtering (airports, ticketing, etc.) is in a SEPARATE module.
"""

from .types import Rejection, ContractValidationOutcome, LegValidationResult
from .datetime_utils import parse_dt, DatetimeParseError, DatetimeNaiveError
from .reason_codes import (
    FLIGHT_MISSING_REQUIRED_FIELD,
    FLIGHT_DATETIME_PARSE_ERROR,
    FLIGHT_DATETIME_NAIVE,
    FLIGHT_INVALID_FIELD_TYPE,
    HOTEL_MISSING_REQUIRED_FIELD,
    HOTEL_DATETIME_PARSE_ERROR,
    HOTEL_DATETIME_NAIVE,
)


# =============================================================================
# FLIGHT CONTRACT SCHEMA
# =============================================================================

# Required fields at the candidate level
FLIGHT_CANDIDATE_REQUIRED_FIELDS = ["id", "segments"]

# Required fields at the segment level
FLIGHT_SEGMENT_REQUIRED_FIELDS = ["origin", "destination", "dep_utc", "arr_utc"]


def validate_flight_candidate_contract(
    candidate: dict,
    scope_id: str,
) -> ContractValidationOutcome:
    """
    Validate candidate CONTRACT ONLY (schema, required fields, parseable datetimes).
    
    This function does NOT check any policy rules (ticketing, airports, etc.).
    Policy filtering happens AFTER contract validation, fingerprinting, and dedup.
    
    IMPORTANT: Early returns when fundamental fields are malformed.
    This prevents crashes and ensures we don't generate misleading rejections.
    
    Args:
        candidate: Raw candidate dict from provider
        scope_id: Context for logging (e.g., "leg_0")
    
    Returns:
        ContractValidationOutcome with is_valid=False if malformed
    """
    rejections: list[Rejection] = []
    candidate_id = candidate.get("id", "unknown")
    
    # =========================================================================
    # PHASE 1: Candidate-level required fields
    # =========================================================================
    
    for field_name in FLIGHT_CANDIDATE_REQUIRED_FIELDS:
        if field_name not in candidate or candidate[field_name] is None:
            rejections.append(Rejection(
                reason_code=FLIGHT_MISSING_REQUIRED_FIELD,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={"missing_field": field_name, "level": "candidate"},
            ))
    
    # =========================================================================
    # PHASE 2: Validate segments structure (EARLY RETURN if malformed)
    # =========================================================================
    
    segments = candidate.get("segments")
    
    # Check segments is a list
    if not isinstance(segments, list):
        rejections.append(Rejection(
            reason_code=FLIGHT_MISSING_REQUIRED_FIELD,
            candidate_id=candidate_id,
            scope_id=scope_id,
            details={
                "missing_field": "segments",
                "error": "not a list",
                "actual_type": type(segments).__name__ if segments is not None else "None",
            },
        ))
        # EARLY RETURN: Cannot proceed without valid segments
        return ContractValidationOutcome(
            is_valid=False,
            rejections=rejections,
            candidate_id=candidate_id,
        )
    
    # Check segments is not empty
    if len(segments) == 0:
        rejections.append(Rejection(
            reason_code=FLIGHT_MISSING_REQUIRED_FIELD,
            candidate_id=candidate_id,
            scope_id=scope_id,
            details={"missing_field": "segments", "error": "empty list"},
        ))
        # EARLY RETURN: Cannot proceed without segments
        return ContractValidationOutcome(
            is_valid=False,
            rejections=rejections,
            candidate_id=candidate_id,
        )
    
    # =========================================================================
    # PHASE 3: Segment-level required fields
    # =========================================================================
    
    for i, seg in enumerate(segments):
        # Check segment is a dict
        if not isinstance(seg, dict):
            rejections.append(Rejection(
                reason_code=FLIGHT_INVALID_FIELD_TYPE,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={
                    "error": "segment not a dict",
                    "segment_index": i,
                    "actual_type": type(seg).__name__,
                },
            ))
            continue  # Can't validate fields of non-dict
        
        # Check required fields
        for field_name in FLIGHT_SEGMENT_REQUIRED_FIELDS:
            if field_name not in seg or seg[field_name] is None:
                rejections.append(Rejection(
                    reason_code=FLIGHT_MISSING_REQUIRED_FIELD,
                    candidate_id=candidate_id,
                    scope_id=scope_id,
                    details={
                        "missing_field": field_name,
                        "level": "segment",
                        "segment_index": i,
                    },
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
                            "error_type": "parse_error",
                        },
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
                            "error_type": "naive_datetime",
                        },
                    ))
    
    return ContractValidationOutcome(
        is_valid=len(rejections) == 0,
        rejections=rejections,
        candidate_id=candidate_id,
    )


def validate_contracts_for_leg(
    candidates: list[dict],
    leg_id: str,
) -> LegValidationResult:
    """
    Validate all candidates for a leg.
    
    Returns:
        LegValidationResult with contract-valid candidates and rejection details
    """
    scope_id = f"leg_{leg_id}"
    contract_valid: list[dict] = []
    all_rejections: list[Rejection] = []
    malformed_count = 0
    
    for candidate in candidates:
        outcome = validate_flight_candidate_contract(candidate, scope_id)
        
        if outcome.is_valid:
            contract_valid.append(candidate)
        else:
            malformed_count += 1
            all_rejections.extend(outcome.rejections)
    
    return LegValidationResult(
        contract_valid=contract_valid,
        contract_rejections=all_rejections,
        malformed_candidate_count=malformed_count,
    )


# =============================================================================
# HOTEL CONTRACT SCHEMA
# =============================================================================

HOTEL_CANDIDATE_REQUIRED_FIELDS = [
    "id",
    "property_id",
    "check_in",
    "check_out",
]

HOTEL_ROOM_QUOTE_REQUIRED_FIELDS = [
    "room_type",
    "cash_total_all_in",
]


def validate_hotel_candidate_contract(
    candidate: dict,
    scope_id: str,
) -> ContractValidationOutcome:
    """
    Validate hotel candidate CONTRACT ONLY.
    
    Args:
        candidate: Raw hotel candidate dict
        scope_id: Context for logging (e.g., "segment_0")
    
    Returns:
        ContractValidationOutcome with is_valid=False if malformed
    """
    rejections: list[Rejection] = []
    candidate_id = candidate.get("id", "unknown")
    
    # Check required fields
    for field_name in HOTEL_CANDIDATE_REQUIRED_FIELDS:
        if field_name not in candidate or candidate[field_name] is None:
            rejections.append(Rejection(
                reason_code=HOTEL_MISSING_REQUIRED_FIELD,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={"missing_field": field_name, "level": "candidate"},
            ))
    
    # Validate date parsing
    for date_field in ["check_in", "check_out"]:
        date_str = candidate.get(date_field)
        if date_str:
            try:
                # Hotel dates are just dates, not datetimes
                from .datetime_utils import parse_date
                parse_date(date_str)
            except Exception as e:
                rejections.append(Rejection(
                    reason_code=HOTEL_DATETIME_PARSE_ERROR,
                    candidate_id=candidate_id,
                    scope_id=scope_id,
                    details={
                        "field": date_field,
                        "value": date_str,
                        "error": str(e),
                    },
                ))
    
    # Validate room quotes if present
    room_quotes = candidate.get("room_quotes", [])
    if room_quotes:
        if not isinstance(room_quotes, list):
            rejections.append(Rejection(
                reason_code=HOTEL_MISSING_REQUIRED_FIELD,
                candidate_id=candidate_id,
                scope_id=scope_id,
                details={
                    "missing_field": "room_quotes",
                    "error": "not a list",
                    "actual_type": type(room_quotes).__name__,
                },
            ))
        else:
            for i, quote in enumerate(room_quotes):
                if not isinstance(quote, dict):
                    continue
                for field_name in HOTEL_ROOM_QUOTE_REQUIRED_FIELDS:
                    if field_name not in quote or quote[field_name] is None:
                        rejections.append(Rejection(
                            reason_code=HOTEL_MISSING_REQUIRED_FIELD,
                            candidate_id=candidate_id,
                            scope_id=scope_id,
                            details={
                                "missing_field": field_name,
                                "level": "room_quote",
                                "quote_index": i,
                            },
                        ))
    
    return ContractValidationOutcome(
        is_valid=len(rejections) == 0,
        rejections=rejections,
        candidate_id=candidate_id,
    )


def validate_hotel_contracts_for_segment(
    candidates: list[dict],
    segment_id: str,
) -> LegValidationResult:
    """
    Validate all hotel candidates for a segment.
    
    Returns:
        LegValidationResult with contract-valid candidates and rejection details
    """
    scope_id = f"segment_{segment_id}"
    contract_valid: list[dict] = []
    all_rejections: list[Rejection] = []
    malformed_count = 0
    
    for candidate in candidates:
        outcome = validate_hotel_candidate_contract(candidate, scope_id)
        
        if outcome.is_valid:
            contract_valid.append(candidate)
        else:
            malformed_count += 1
            all_rejections.extend(outcome.rejections)
    
    return LegValidationResult(
        contract_valid=contract_valid,
        contract_rejections=all_rejections,
        malformed_candidate_count=malformed_count,
    )
