"""
Namespaced reason codes for rejections and warnings.

All codes prefixed by domain: FLIGHT_*, HOTEL_*, GLOBAL_*
This prevents collisions and makes dashboards/filtering cleaner.

Usage:
    from optimization.reason_codes import FLIGHT_AIRPORT_NOT_ALLOWED
    
    rejection = Rejection(
        reason_code=FLIGHT_AIRPORT_NOT_ALLOWED,
        candidate_id="...",
        scope_id="leg_0",
        details={"airport": "LAX", "allowed": ["JFK", "LGA", "EWR"]},
    )
"""

# =============================================================================
# FLIGHT-SPECIFIC CODES
# =============================================================================

# Airport constraints
FLIGHT_AIRPORT_NOT_ALLOWED = "FLIGHT_AIRPORT_NOT_ALLOWED"
FLIGHT_AIRPORT_CHANGE_CONNECTION = "FLIGHT_AIRPORT_CHANGE_CONNECTION"

# Ticketing constraints
FLIGHT_TICKETING_NOT_SINGLE = "FLIGHT_TICKETING_NOT_SINGLE"
FLIGHT_TICKETING_UNKNOWN_CONNECTING = "FLIGHT_TICKETING_UNKNOWN_CONNECTING"

# Itinerary constraints
FLIGHT_SURCHARGE_CAP_EXCEEDED = "FLIGHT_SURCHARGE_CAP_EXCEEDED"
FLIGHT_MAX_STOPS_EXCEEDED = "FLIGHT_MAX_STOPS_EXCEEDED"
FLIGHT_MAX_DURATION_EXCEEDED = "FLIGHT_MAX_DURATION_EXCEEDED"

# Contract validation (schema errors)
FLIGHT_MISSING_REQUIRED_FIELD = "FLIGHT_MISSING_REQUIRED_FIELD"
FLIGHT_INVALID_FIELD_TYPE = "FLIGHT_INVALID_FIELD_TYPE"

# Datetime-specific codes (SPLIT for better debugging)
FLIGHT_DATETIME_PARSE_ERROR = "FLIGHT_DATETIME_PARSE_ERROR"  # Cannot parse string at all
FLIGHT_DATETIME_NAIVE = "FLIGHT_DATETIME_NAIVE"  # Parsed but missing timezone

# Fingerprinting/dedup
FLIGHT_FINGERPRINT_COLLISION = "FLIGHT_FINGERPRINT_COLLISION"

# Aggregate failure codes
FLIGHT_ALL_FILTERED_BY_POLICY = "FLIGHT_ALL_FILTERED_BY_POLICY"
FLIGHT_INSUFFICIENT_AFTER_FILTER = "FLIGHT_INSUFFICIENT_AFTER_FILTER"


# =============================================================================
# HOTEL-SPECIFIC CODES
# =============================================================================

# Contract validation
HOTEL_INCOMPLETE_PRICING = "HOTEL_INCOMPLETE_PRICING"
HOTEL_MISSING_ROOM_QUOTE_ID = "HOTEL_MISSING_ROOM_QUOTE_ID"
HOTEL_MISSING_REQUIRED_FIELD = "HOTEL_MISSING_REQUIRED_FIELD"

# Datetime errors
HOTEL_DATETIME_PARSE_ERROR = "HOTEL_DATETIME_PARSE_ERROR"
HOTEL_DATETIME_NAIVE = "HOTEL_DATETIME_NAIVE"

# Stay constraints
HOTEL_NIGHTS_NOT_CONSECUTIVE = "HOTEL_NIGHTS_NOT_CONSECUTIVE"
HOTEL_OCCUPANCY_EXCEEDED = "HOTEL_OCCUPANCY_EXCEEDED"

# Fee/pricing warnings
HOTEL_RESORT_FEE_UNKNOWN = "HOTEL_RESORT_FEE_UNKNOWN"
HOTEL_TAXES_NOT_INCLUDED = "HOTEL_TAXES_NOT_INCLUDED"

# Fingerprinting/dedup
HOTEL_FINGERPRINT_COLLISION = "HOTEL_FINGERPRINT_COLLISION"

# Aggregate failure codes
HOTEL_ALL_FILTERED_BY_POLICY = "HOTEL_ALL_FILTERED_BY_POLICY"
HOTEL_INSUFFICIENT_AFTER_FILTER = "HOTEL_INSUFFICIENT_AFTER_FILTER"


# =============================================================================
# GLOBAL CODES (cross-cutting concerns)
# =============================================================================

# Input validation
GLOBAL_DATE_PARSE_ERROR = "GLOBAL_DATE_PARSE_ERROR"
GLOBAL_AMBIGUOUS_LOCATION = "GLOBAL_AMBIGUOUS_LOCATION"
GLOBAL_INVALID_AIRPORT_CODE = "GLOBAL_INVALID_AIRPORT_CODE"
GLOBAL_MISSING_REQUIRED_FIELD = "GLOBAL_MISSING_REQUIRED_FIELD"
GLOBAL_INVALID_TRAVELER_ID = "GLOBAL_INVALID_TRAVELER_ID"

# Upstream/provider errors
GLOBAL_UPSTREAM_TIMEOUT = "GLOBAL_UPSTREAM_TIMEOUT"
GLOBAL_UPSTREAM_ERROR = "GLOBAL_UPSTREAM_ERROR"
GLOBAL_ALL_CANDIDATES_MALFORMED = "GLOBAL_ALL_CANDIDATES_MALFORMED"

# Feasibility
GLOBAL_INSUFFICIENT_CANDIDATES = "GLOBAL_INSUFFICIENT_CANDIDATES"
GLOBAL_NO_FEASIBLE_SOLUTION = "GLOBAL_NO_FEASIBLE_SOLUTION"
GLOBAL_BUDGET_EXCEEDED = "GLOBAL_BUDGET_EXCEEDED"
GLOBAL_INSUFFICIENT_POINTS = "GLOBAL_INSUFFICIENT_POINTS"

# Solver errors
GLOBAL_SOLVER_TIMEOUT = "GLOBAL_SOLVER_TIMEOUT"
GLOBAL_SOLVER_ERROR = "GLOBAL_SOLVER_ERROR"


# =============================================================================
# CODE CATEGORIES (for filtering/grouping)
# =============================================================================

# Codes that indicate CONTRACT violations (malformed input)
CONTRACT_VIOLATION_CODES = {
    FLIGHT_MISSING_REQUIRED_FIELD,
    FLIGHT_INVALID_FIELD_TYPE,
    FLIGHT_DATETIME_PARSE_ERROR,
    FLIGHT_DATETIME_NAIVE,
    HOTEL_MISSING_REQUIRED_FIELD,
    HOTEL_DATETIME_PARSE_ERROR,
    HOTEL_DATETIME_NAIVE,
    GLOBAL_DATE_PARSE_ERROR,
    GLOBAL_MISSING_REQUIRED_FIELD,
}

# Codes that indicate POLICY violations (valid but rejected by business rules)
POLICY_VIOLATION_CODES = {
    FLIGHT_AIRPORT_NOT_ALLOWED,
    FLIGHT_AIRPORT_CHANGE_CONNECTION,
    FLIGHT_TICKETING_NOT_SINGLE,
    FLIGHT_TICKETING_UNKNOWN_CONNECTING,
    FLIGHT_SURCHARGE_CAP_EXCEEDED,
    FLIGHT_MAX_STOPS_EXCEEDED,
    FLIGHT_MAX_DURATION_EXCEEDED,
    HOTEL_NIGHTS_NOT_CONSECUTIVE,
    HOTEL_OCCUPANCY_EXCEEDED,
}

# Codes that indicate UPSTREAM issues (provider problems)
UPSTREAM_ERROR_CODES = {
    GLOBAL_UPSTREAM_TIMEOUT,
    GLOBAL_UPSTREAM_ERROR,
    GLOBAL_ALL_CANDIDATES_MALFORMED,
}

# Codes that indicate INFEASIBILITY (valid input but no solution)
INFEASIBILITY_CODES = {
    GLOBAL_INSUFFICIENT_CANDIDATES,
    GLOBAL_NO_FEASIBLE_SOLUTION,
    GLOBAL_BUDGET_EXCEEDED,
    GLOBAL_INSUFFICIENT_POINTS,
    FLIGHT_ALL_FILTERED_BY_POLICY,
    FLIGHT_INSUFFICIENT_AFTER_FILTER,
    HOTEL_ALL_FILTERED_BY_POLICY,
    HOTEL_INSUFFICIENT_AFTER_FILTER,
}


def is_contract_violation(code: str) -> bool:
    """Check if a reason code indicates a contract violation."""
    return code in CONTRACT_VIOLATION_CODES


def is_policy_violation(code: str) -> bool:
    """Check if a reason code indicates a policy violation."""
    return code in POLICY_VIOLATION_CODES


def is_upstream_error(code: str) -> bool:
    """Check if a reason code indicates an upstream error."""
    return code in UPSTREAM_ERROR_CODES


def is_infeasibility(code: str) -> bool:
    """Check if a reason code indicates infeasibility."""
    return code in INFEASIBILITY_CODES
