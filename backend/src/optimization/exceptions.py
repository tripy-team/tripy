"""
Custom exceptions for the optimization system.

This module defines specific exception types for better error handling
and clearer error messages.
"""


class OptimizationError(Exception):
    """Base exception for optimization errors."""
    pass


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
