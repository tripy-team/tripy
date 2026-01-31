"""
Optimization module for travel itinerary planning.

This module contains the ILP-based optimization system for finding
the best combination of flights, payment methods, and point transfers.

IMPORTANT: Heavy imports (solver, PuLP) are LAZY to avoid:
- Slow cold starts
- Import errors if optional deps missing
- Circular imports

Submodules:
- models: Data classes for flights, solutions, and configuration
- constants: All configuration values, thresholds, and transfer graphs
- utils: Helper functions for datetime parsing, cost calculations
- constraints: ILP constraint builders
- exceptions: Custom exception types

V3 Submodules (new architecture):
- trip_spec: Trip specification models (TripPlanSpec, Traveler, etc.)
- normalize: Program/bank identifier normalization
- models_v3: V3 data models (FlightItineraryEdge, HotelOption, etc.)
- validators: Single-ticket enforcement, date feasibility
- metrics: Explainability counters
- pruning: Multi-criteria candidate pruning
- precompute: Soft value precomputation
- solver_v3: V3 ILP solver with two-pass optimization (LAZY IMPORT)
"""

# =============================================================================
# LIGHTWEIGHT IMPORTS (always available)
# =============================================================================

from .models import (
    FlightEdge,
    EdgeKey,
    OptimizationConfig,
    OptimizationMode,
    ILPSolution,
    ILPInputs,
    TransferInstruction,
    PaymentMethod,
    SegmentPayment,
    TravelerPath,
)

from .constants import (
    DEFAULT_TRANSFER_GRAPH,
    CPP_THRESHOLDS,
    HIGH_SURCHARGE_PROGRAMS,
    OOP_CONFIG,
    CPP_CONFIG,
    TRANSFER_CONFIG,
    SOLVER_CONFIG,
    BANK_NAME_MAPPINGS,
    CREDIT_CARD_SUGGESTIONS,
    AIRLINE_NAMES,
    get_cpp_threshold,
    is_high_surcharge_program,
    get_airline_name,
    get_credit_card_suggestion,
    normalize_bank_key,
    is_bank_key,
)

from .utils import (
    parse_datetime_to_minutes,
    parse_edge_times,
    calculate_cpp,
    should_reject_award,
    calculate_surcharge_penalty,
    split_balances,
    normalize_airline_code,
    build_edge_graph_stats,
    validate_graph_connectivity,
    format_currency,
    format_points,
    format_cpp,
    build_transfer_summary_text,
)

from .exceptions import (
    OptimizationError,
    InfeasibleSolutionError,
    NoFlightsError,
    InsufficientPointsError,
    BudgetExceededError,
    InvalidRouteError,
    MissingDataError,
    TransferGraphError,
    SolverTimeoutError,
    ConfigurationError,
    # New structured errors (PR1)
    OptimizationUserInputError,
    OptimizationUpstreamError,
    OptimizationInfeasible,
)

# V3 lightweight imports (dataclasses only, no solver)
from .trip_spec import (
    TripPlanSpec,
    Traveler,
    OrderedLeg,
    StaySegment,
    GroupTravelMode,
)

from .normalize import (
    normalize_program,
    normalize_bank,
    normalize_airline,
    is_bank_program,
    is_hotel_program,
    is_airline_program,
    get_program_display_name,
    get_bank_display_name,
)

from .models_v3 import (
    FundingSource,
    AwardOption,
    FlightSegment,
    FlightItineraryEdge,
    RoomType,
    HotelOption,
    TransferPath,
    SlackConfig,
    BalancedModeConfig,
    SolverConfig,
    PruningConfig,
    OptimizationStatus,
    PaymentChoice,
    Solution,
    OptimizationResult,
)

from .validators import (
    filter_single_ticket_only,
    validate_connection_eligibility,
    validate_date_feasibility,
    pre_check_feasibility,
    validate_connection_warnings,
    validate_award_availability,
)

from .enums import (
    TicketingType,
    ConnectionProtection,
    SelfTransferRequired,
    TransferType,
    TransferConfidence,
    WarningSeverity,
    WarningCategory,
)

from .provider_contracts import (
    ProviderContract,
    get_provider_contract,
    PROVIDER_CONTRACTS,
)

from .validation_policy import (
    ValidationPolicy,
    STRICT_MVP_POLICY,
    PERMISSIVE_POLICY,
    ALLOW_ALL_POLICY,
)

from .derivation import finalize_itinerary

from .airport_data import (
    get_airport_country,
    is_us_airport,
    has_us_preclearance,
    is_valid_iata,
    is_same_airport_code,
)

from .metrics import OptimizationMetrics, create_metrics

from .pruning import prune_flights, prune_hotels, prune_award_options

from .precompute import precompute_soft_values, compute_flight_K, compute_hotel_K

# =============================================================================
# NEW PIPELINE MODULES (PR1, PR2a, PR2b)
# =============================================================================

from .types import (
    Rejection,
    ContractValidationOutcome,
    PolicyFilterOutcome,
    MergeGateOutcome,
    LegValidationResult,
    PipelineResult,
    LedgerLineItem,
    TravelerLedger,
    SolutionAccounting,
    OptimizationExplanation,
)

from .datetime_utils import (
    DatetimeParseError,
    DatetimeNaiveError,
    parse_dt,
    parse_dt_or_none,
    parse_date,
    parse_date_or_none,
    datetime_to_utc,
    floor_to_minutes,
)

from .reason_codes import (
    # Flight codes
    FLIGHT_AIRPORT_NOT_ALLOWED,
    FLIGHT_TICKETING_NOT_SINGLE,
    FLIGHT_TICKETING_UNKNOWN_CONNECTING,
    FLIGHT_AIRPORT_CHANGE_CONNECTION,
    FLIGHT_SURCHARGE_CAP_EXCEEDED,
    FLIGHT_MAX_STOPS_EXCEEDED,
    FLIGHT_MAX_DURATION_EXCEEDED,
    FLIGHT_MISSING_REQUIRED_FIELD,
    FLIGHT_FINGERPRINT_COLLISION,
    FLIGHT_ALL_FILTERED_BY_POLICY,
    FLIGHT_DATETIME_PARSE_ERROR,
    FLIGHT_DATETIME_NAIVE,
    # Hotel codes
    HOTEL_INCOMPLETE_PRICING,
    HOTEL_NIGHTS_NOT_CONSECUTIVE,
    HOTEL_MISSING_ROOM_QUOTE_ID,
    HOTEL_FINGERPRINT_COLLISION,
    HOTEL_RESORT_FEE_UNKNOWN,
    HOTEL_ALL_FILTERED_BY_POLICY,
    # Global codes
    GLOBAL_DATE_PARSE_ERROR,
    GLOBAL_AMBIGUOUS_LOCATION,
    GLOBAL_INVALID_AIRPORT_CODE,
    GLOBAL_MISSING_REQUIRED_FIELD,
    GLOBAL_UPSTREAM_TIMEOUT,
    GLOBAL_ALL_CANDIDATES_MALFORMED,
    GLOBAL_INSUFFICIENT_CANDIDATES,
    GLOBAL_NO_FEASIBLE_SOLUTION,
    # Code categories
    CONTRACT_VIOLATION_CODES,
    POLICY_VIOLATION_CODES,
    UPSTREAM_ERROR_CODES,
    INFEASIBILITY_CODES,
    is_contract_violation,
    is_policy_violation,
    is_upstream_error,
    is_infeasibility,
)

from .config_mvp import (
    OptimizationConfigMVP,
    get_config,
    set_config,
    reset_config,
)

from .contract_validation import (
    validate_flight_candidate_contract,
    validate_contracts_for_leg,
    validate_hotel_candidate_contract,
    validate_hotel_contracts_for_segment,
)

from .policy_filtering import (
    apply_policy_filters_to_candidate,
    apply_policy_filters,
    apply_policy_filters_with_airports,
)

from .fingerprinting import (
    compute_itinerary_fingerprint,
    compute_property_fingerprint,
    compute_room_quote_fingerprint,
    fingerprints_match,
    add_fingerprint_suffix,
)

from .merge_gate import (
    check_merge_gate,
    merge_candidates_with_gate,
    group_by_fingerprint,
)

from .pipeline import (
    process_candidates_pipeline,
    raise_if_infeasible,
    build_success_response,
    should_raise_upstream_error,
    check_min_candidates_after_dedup,
    determine_failed_scope,
)


# =============================================================================
# LAZY IMPORTS FOR HEAVY MODULES (solver, PuLP)
# =============================================================================

def _get_solver_v3():
    """Lazy import for SolverV3."""
    from .solver_v3 import SolverV3
    return SolverV3

def _get_mode():
    """Lazy import for Mode enum."""
    from .solver_v3 import Mode
    return Mode

def _get_optimize_trip():
    """Lazy import for optimize_trip function."""
    from .solver_v3 import optimize_trip
    return optimize_trip

def _get_run_v3_optimization():
    """Lazy import for run_v3_optimization adapter."""
    from .adapter_v3 import run_v3_optimization
    return run_v3_optimization

def _get_check_cbc_available():
    """Lazy import for CBC availability check."""
    from .solver_v3 import check_cbc_available
    return check_cbc_available

def _get_require_cbc():
    """Lazy import for CBC requirement check."""
    from .solver_v3 import require_cbc
    return require_cbc


# Module-level lazy accessors
class _LazyModule:
    """Lazy module accessor to defer heavy imports."""
    
    @property
    def SolverV3(self):
        return _get_solver_v3()
    
    @property
    def Mode(self):
        return _get_mode()
    
    @property
    def optimize_trip(self):
        return _get_optimize_trip()
    
    @property
    def run_v3_optimization(self):
        return _get_run_v3_optimization()
    
    @property
    def check_cbc_available(self):
        return _get_check_cbc_available()
    
    @property
    def require_cbc(self):
        return _get_require_cbc()


_lazy = _LazyModule()


# These will be lazily loaded when accessed
def __getattr__(name):
    """Module-level __getattr__ for lazy imports."""
    if name == "SolverV3":
        return _get_solver_v3()
    elif name == "Mode":
        return _get_mode()
    elif name == "optimize_trip":
        return _get_optimize_trip()
    elif name == "run_v3_optimization":
        return _get_run_v3_optimization()
    elif name == "check_cbc_available":
        return _get_check_cbc_available()
    elif name == "require_cbc":
        return _get_require_cbc()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    # Models (V1)
    "FlightEdge",
    "EdgeKey",
    "OptimizationConfig",
    "OptimizationMode",
    "ILPSolution",
    "ILPInputs",
    "TransferInstruction",
    "PaymentMethod",
    "SegmentPayment",
    "TravelerPath",
    # Constants
    "DEFAULT_TRANSFER_GRAPH",
    "CPP_THRESHOLDS",
    "HIGH_SURCHARGE_PROGRAMS",
    "OOP_CONFIG",
    "CPP_CONFIG",
    "TRANSFER_CONFIG",
    "SOLVER_CONFIG",
    "BANK_NAME_MAPPINGS",
    "CREDIT_CARD_SUGGESTIONS",
    "AIRLINE_NAMES",
    # Constant functions
    "get_cpp_threshold",
    "is_high_surcharge_program",
    "get_airline_name",
    "get_credit_card_suggestion",
    "normalize_bank_key",
    "is_bank_key",
    # Utilities
    "parse_datetime_to_minutes",
    "parse_edge_times",
    "calculate_cpp",
    "should_reject_award",
    "calculate_surcharge_penalty",
    "split_balances",
    "normalize_airline_code",
    "build_edge_graph_stats",
    "validate_graph_connectivity",
    "format_currency",
    "format_points",
    "format_cpp",
    "build_transfer_summary_text",
    # Exceptions
    "OptimizationError",
    "InfeasibleSolutionError",
    "NoFlightsError",
    "InsufficientPointsError",
    "BudgetExceededError",
    "InvalidRouteError",
    "MissingDataError",
    "TransferGraphError",
    "SolverTimeoutError",
    "ConfigurationError",
    # ═══════════════════════════════════════════════════════════════════════
    # V3 EXPORTS
    # ═══════════════════════════════════════════════════════════════════════
    # Trip Spec
    "TripPlanSpec",
    "Traveler",
    "OrderedLeg",
    "StaySegment",
    "GroupTravelMode",
    # Normalize
    "normalize_program",
    "normalize_bank",
    "normalize_airline",
    "is_bank_program",
    "is_hotel_program",
    "is_airline_program",
    "get_program_display_name",
    "get_bank_display_name",
    # V3 Models
    "FundingSource",
    "AwardOption",
    "FlightSegment",
    "FlightItineraryEdge",
    "RoomType",
    "HotelOption",
    "TransferPath",
    "SlackConfig",
    "BalancedModeConfig",
    "SolverConfig",
    "PruningConfig",
    "OptimizationStatus",
    "PaymentChoice",
    "Solution",
    "OptimizationResult",
    # Validators
    "filter_single_ticket_only",
    "validate_connection_eligibility",
    "validate_date_feasibility",
    "pre_check_feasibility",
    "validate_connection_warnings",
    "validate_award_availability",
    # V4 Enums
    "TicketingType",
    "ConnectionProtection",
    "SelfTransferRequired",
    "TransferType",
    "TransferConfidence",
    "WarningSeverity",
    "WarningCategory",
    # V4 Provider Contracts
    "ProviderContract",
    "get_provider_contract",
    "PROVIDER_CONTRACTS",
    # V4 Validation Policy
    "ValidationPolicy",
    "STRICT_MVP_POLICY",
    "PERMISSIVE_POLICY",
    "ALLOW_ALL_POLICY",
    # V4 Derivation
    "finalize_itinerary",
    # V4 Airport Data
    "get_airport_country",
    "is_us_airport",
    "has_us_preclearance",
    "is_valid_iata",
    "is_same_airport_code",
    # Metrics
    "OptimizationMetrics",
    "create_metrics",
    # Pruning
    "prune_flights",
    "prune_hotels",
    "prune_award_options",
    # Precompute
    "precompute_soft_values",
    "compute_flight_K",
    "compute_hotel_K",
    # Solver V3 (LAZY)
    "SolverV3",
    "Mode",
    "optimize_trip",
    # Adapter V3 (LAZY)
    "run_v3_optimization",
    # CBC check (LAZY)
    "check_cbc_available",
    "require_cbc",
    # ═══════════════════════════════════════════════════════════════════════
    # NEW PIPELINE EXPORTS (PR1, PR2a, PR2b)
    # ═══════════════════════════════════════════════════════════════════════
    # Types
    "Rejection",
    "ContractValidationOutcome",
    "PolicyFilterOutcome",
    "MergeGateOutcome",
    "LegValidationResult",
    "PipelineResult",
    "LedgerLineItem",
    "TravelerLedger",
    "SolutionAccounting",
    "OptimizationExplanation",
    # Datetime utils
    "DatetimeParseError",
    "DatetimeNaiveError",
    "parse_dt",
    "parse_dt_or_none",
    "parse_date",
    "parse_date_or_none",
    "datetime_to_utc",
    "floor_to_minutes",
    # Reason codes (commonly used)
    "FLIGHT_AIRPORT_NOT_ALLOWED",
    "FLIGHT_TICKETING_NOT_SINGLE",
    "FLIGHT_TICKETING_UNKNOWN_CONNECTING",
    "FLIGHT_AIRPORT_CHANGE_CONNECTION",
    "FLIGHT_MISSING_REQUIRED_FIELD",
    "FLIGHT_FINGERPRINT_COLLISION",
    "FLIGHT_DATETIME_PARSE_ERROR",
    "FLIGHT_DATETIME_NAIVE",
    "GLOBAL_ALL_CANDIDATES_MALFORMED",
    "GLOBAL_INSUFFICIENT_CANDIDATES",
    "GLOBAL_NO_FEASIBLE_SOLUTION",
    # Code category functions
    "is_contract_violation",
    "is_policy_violation",
    "is_upstream_error",
    "is_infeasibility",
    # Config
    "OptimizationConfigMVP",
    "get_config",
    "set_config",
    "reset_config",
    # Contract validation
    "validate_flight_candidate_contract",
    "validate_contracts_for_leg",
    "validate_hotel_candidate_contract",
    "validate_hotel_contracts_for_segment",
    # Policy filtering
    "apply_policy_filters_to_candidate",
    "apply_policy_filters",
    "apply_policy_filters_with_airports",
    # Fingerprinting
    "compute_itinerary_fingerprint",
    "compute_property_fingerprint",
    "compute_room_quote_fingerprint",
    "fingerprints_match",
    "add_fingerprint_suffix",
    # Merge gate
    "check_merge_gate",
    "merge_candidates_with_gate",
    "group_by_fingerprint",
    # Pipeline
    "process_candidates_pipeline",
    "raise_if_infeasible",
    "build_success_response",
    "should_raise_upstream_error",
    "check_min_candidates_after_dedup",
    "determine_failed_scope",
    # New structured errors
    "OptimizationUserInputError",
    "OptimizationUpstreamError",
    "OptimizationInfeasible",
]
