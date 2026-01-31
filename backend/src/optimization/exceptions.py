"""
Custom exceptions for the optimization system.

This module defines specific exception types for better error handling
and clearer error messages.

Error categories and HTTP status mappings:
- OptimizationUserInputError: User input is malformed -> 400
- OptimizationUpstreamError: Provider/upstream failure -> 502/503
- OptimizationInfeasible: Valid input but no solution -> 200 with status="infeasible"
"""

from typing import Any


class OptimizationError(Exception):
    """Base exception for optimization errors."""
    pass


# =============================================================================
# NEW STRUCTURED ERRORS (for pipeline)
# =============================================================================

class OptimizationUserInputError(OptimizationError):
    """
    Raised when user input is malformed.
    
    HTTP mapping: 400 Bad Request
    
    Examples:
    - Missing required date field
    - Invalid date format
    - Invalid airport code
    - Missing legs
    """
    
    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(message)
    
    def to_response(self) -> dict:
        """Convert to API response payload."""
        return {
            "status": "error",
            "http_status": 400,
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            },
        }


class OptimizationUpstreamError(OptimizationError):
    """
    Raised when upstream provider fails.
    
    HTTP mapping: 502 Bad Gateway (or 503 if transient)
    
    Examples:
    - All candidates from a provider are malformed
    - Provider timeout
    - Provider returned error response
    """
    
    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
        is_transient: bool = False,
    ):
        self.code = code
        self.message = message
        self.details = details or {}
        self.is_transient = is_transient
        super().__init__(message)
    
    @property
    def http_status(self) -> int:
        """Get HTTP status based on whether error is transient."""
        return 503 if self.is_transient else 502
    
    def to_response(self) -> dict:
        """Convert to API response payload."""
        return {
            "status": "error",
            "http_status": self.http_status,
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            },
        }


class OptimizationInfeasible(OptimizationError):
    """
    Raised when input is valid but no solution exists.
    
    HTTP mapping: 200 OK with status="infeasible"
    
    This is NOT an error - the optimization ran successfully,
    but the constraints cannot be satisfied.
    
    Examples:
    - No flights available on the requested dates
    - Budget too low for any option
    - Insufficient points for any award
    """
    
    def __init__(
        self,
        code: str,
        message: str,
        solve_id: str,
        failed_scope: str | None = None,
        rejections_summary: dict[str, int] | None = None,
        rejections_sample: list[dict] | None = None,
        normalization_notes: list[str] | None = None,
        warnings: list[str] | None = None,
    ):
        self.code = code
        self.message = message
        self.solve_id = solve_id
        self.failed_scope = failed_scope
        self.rejections_summary = rejections_summary or {}
        self.rejections_sample = rejections_sample or []
        self.normalization_notes = normalization_notes or []
        self.warnings = warnings or []
        super().__init__(message)
    
    def to_response(self) -> dict:
        """Convert to API response payload."""
        return {
            "status": "infeasible",
            "http_status": 200,
            "solve_id": self.solve_id,
            "reason_code": self.code,
            "message": self.message,
            "failed_scope": self.failed_scope,
            "rejections_summary": self.rejections_summary,
            "rejections_sample": self.rejections_sample,
            "normalization_notes": self.normalization_notes,
            "warnings": self.warnings,
        }


class InfeasibleSolutionError(OptimizationError):
    """Raised when the ILP solver finds the problem infeasible."""
    
    def __init__(self, message: str = "No feasible solution found", details: dict = None):
        self.details = details or {}
        super().__init__(message)
    
    def __str__(self):
        base = super().__str__()
        if self.details:
            return f"{base}. Details: {self.details}"
        return base


class NoFlightsError(OptimizationError):
    """Raised when no flights are available for a route."""
    
    def __init__(self, origin: str, destination: str, date: str = None):
        self.origin = origin
        self.destination = destination
        self.date = date
        message = f"No flights available from {origin} to {destination}"
        if date:
            message += f" on {date}"
        super().__init__(message)


class InsufficientPointsError(OptimizationError):
    """Raised when user doesn't have enough points for any award option."""
    
    def __init__(self, required: int, available: int, program: str = None):
        self.required = required
        self.available = available
        self.program = program
        message = f"Insufficient points: {available:,} available, {required:,} required"
        if program:
            message += f" for {program}"
        super().__init__(message)


class BudgetExceededError(OptimizationError):
    """Raised when no solution exists within the budget."""
    
    def __init__(self, budget: float, minimum_cost: float = None):
        self.budget = budget
        self.minimum_cost = minimum_cost
        message = f"No solution within budget of ${budget:,.2f}"
        if minimum_cost:
            message += f". Minimum cost is ${minimum_cost:,.2f}"
        super().__init__(message)


class InvalidRouteError(OptimizationError):
    """Raised when the requested route is invalid or impossible."""
    
    def __init__(self, message: str, missing_connections: list = None):
        self.missing_connections = missing_connections or []
        super().__init__(message)


class MissingDataError(OptimizationError):
    """Raised when required data is missing for optimization."""
    
    def __init__(self, data_type: str, details: str = None):
        self.data_type = data_type
        message = f"Missing required data: {data_type}"
        if details:
            message += f". {details}"
        super().__init__(message)


class TransferGraphError(OptimizationError):
    """Raised when there's an issue with the transfer graph configuration."""
    
    def __init__(self, bank: str = None, airline: str = None, message: str = None):
        self.bank = bank
        self.airline = airline
        if message:
            super().__init__(message)
        elif bank and airline:
            super().__init__(f"No transfer path from {bank} to {airline}")
        else:
            super().__init__("Transfer graph configuration error")


class SolverTimeoutError(OptimizationError):
    """Raised when the ILP solver times out."""
    
    def __init__(self, timeout_seconds: float, partial_solution: dict = None):
        self.timeout_seconds = timeout_seconds
        self.partial_solution = partial_solution
        super().__init__(f"Solver timed out after {timeout_seconds} seconds")


class ConfigurationError(OptimizationError):
    """Raised when optimization configuration is invalid."""
    
    def __init__(self, parameter: str, value, reason: str = None):
        self.parameter = parameter
        self.value = value
        message = f"Invalid configuration: {parameter}={value}"
        if reason:
            message += f". {reason}"
        super().__init__(message)
