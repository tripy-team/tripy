"""
Optimization module for travel itinerary planning.

This module contains the ILP-based optimization system for finding
the best combination of flights, payment methods, and point transfers.

Submodules:
- models: Data classes for flights, solutions, and configuration
- constants: All configuration values, thresholds, and transfer graphs
- utils: Helper functions for datetime parsing, cost calculations
- constraints: ILP constraint builders
- exceptions: Custom exception types
"""

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
)

__all__ = [
    # Models
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
]
