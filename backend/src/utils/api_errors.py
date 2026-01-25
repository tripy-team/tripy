"""
Consistent API error handling for frontend-friendly error responses.
All errors follow a standard shape that the frontend can easily parse.
"""
from typing import Dict, Any, List, Optional
from fastapi import HTTPException


class APIError(HTTPException):
    """
    Base API error that provides consistent error response shape.
    
    Response shape:
    {
        "error": true,
        "code": "ERROR_CODE",
        "message": "User-friendly message",
        "details": "Technical details (optional)",
        "fieldErrors": [{"field": "x", "message": "y"}],
        "suggestions": ["Try this..."],
        "retryable": false,
        "retryAfterMs": 5000
    }
    """
    
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Optional[str] = None,
        field_errors: Optional[List[Dict[str, str]]] = None,
        suggestions: Optional[List[str]] = None,
        retryable: bool = False,
        retry_after_ms: Optional[int] = None,
    ):
        detail = {
            "error": True,
            "code": code,
            "message": message,
        }
        
        if details:
            detail["details"] = details
        if field_errors:
            detail["fieldErrors"] = field_errors
        if suggestions:
            detail["suggestions"] = suggestions
        
        detail["retryable"] = retryable
        if retry_after_ms:
            detail["retryAfterMs"] = retry_after_ms
        
        super().__init__(status_code=status_code, detail=detail)


# =============================================================================
# Authentication Errors
# =============================================================================

class UnauthorizedError(APIError):
    """User is not authenticated."""
    def __init__(self, message: str = "Authentication required. Please log in."):
        super().__init__(
            status_code=401,
            code="UNAUTHORIZED",
            message=message,
            suggestions=["Log in to continue"],
            retryable=False,
        )


class SessionExpiredError(APIError):
    """User session has expired."""
    def __init__(self, message: str = "Your session has expired. Please log in again."):
        super().__init__(
            status_code=401,
            code="SESSION_EXPIRED",
            message=message,
            suggestions=["Log in again to continue"],
            retryable=False,
        )


class ForbiddenError(APIError):
    """User doesn't have access to this resource."""
    def __init__(self, message: str = "You don't have permission to access this resource."):
        super().__init__(
            status_code=403,
            code="FORBIDDEN",
            message=message,
            retryable=False,
        )


# =============================================================================
# Validation Errors
# =============================================================================

class ValidationError(APIError):
    """Request validation failed."""
    def __init__(
        self,
        message: str,
        field_errors: Optional[List[Dict[str, str]]] = None,
        suggestions: Optional[List[str]] = None,
    ):
        super().__init__(
            status_code=400,
            code="VALIDATION_ERROR",
            message=message,
            field_errors=field_errors,
            suggestions=suggestions,
            retryable=False,
        )


class InvalidDatesError(APIError):
    """Date validation failed."""
    def __init__(self, message: str = "Invalid dates provided."):
        super().__init__(
            status_code=400,
            code="INVALID_DATES",
            message=message,
            suggestions=["Check that end date is after start date", "Use format YYYY-MM-DD"],
            retryable=False,
        )


class InvalidBudgetError(APIError):
    """Budget validation failed."""
    def __init__(self, message: str = "Invalid budget provided."):
        super().__init__(
            status_code=400,
            code="INVALID_BUDGET",
            message=message,
            suggestions=["Budget must be a positive number"],
            retryable=False,
        )


# =============================================================================
# Resource Errors
# =============================================================================

class NotFoundError(APIError):
    """Requested resource not found."""
    def __init__(
        self,
        resource_type: str = "Resource",
        resource_id: Optional[str] = None,
    ):
        message = f"{resource_type} not found"
        if resource_id:
            message = f"{resource_type} '{resource_id}' not found"
        
        super().__init__(
            status_code=404,
            code="NOT_FOUND",
            message=message,
            retryable=False,
        )


class TripNotFoundError(NotFoundError):
    """Trip not found."""
    def __init__(self, trip_id: Optional[str] = None):
        super().__init__(resource_type="Trip", resource_id=trip_id)


class DestinationNotFoundError(NotFoundError):
    """Destination not found."""
    def __init__(self, destination_id: Optional[str] = None):
        super().__init__(resource_type="Destination", resource_id=destination_id)


# =============================================================================
# Itinerary Errors
# =============================================================================

class ItineraryInfeasibleError(APIError):
    """No feasible itinerary can be generated."""
    def __init__(
        self,
        message: str = "We couldn't find a route that fits your budget and points.",
        details: Optional[str] = None,
        suggestions: Optional[List[str]] = None,
    ):
        default_suggestions = [
            "Increase your budget",
            "Add more points to your account",
            "Remove a destination",
            "Try different dates",
        ]
        super().__init__(
            status_code=400,
            code="ITINERARY_INFEASIBLE",
            message=message,
            details=details,
            suggestions=suggestions or default_suggestions,
            retryable=False,
        )


class NoFlightsAvailableError(APIError):
    """No flights found for the given route/dates."""
    def __init__(
        self,
        origin: Optional[str] = None,
        destination: Optional[str] = None,
        date: Optional[str] = None,
    ):
        message = "No flights available"
        if origin and destination:
            message = f"No flights available from {origin} to {destination}"
            if date:
                message += f" on {date}"
        
        super().__init__(
            status_code=400,
            code="NO_FLIGHTS_AVAILABLE",
            message=message,
            suggestions=[
                "Try different dates",
                "Check nearby airports",
                "Consider alternative routes",
            ],
            retryable=True,
            retry_after_ms=60000,  # Wait 1 minute before retry
        )


class InsufficientPointsError(APIError):
    """User doesn't have enough points for the booking."""
    def __init__(
        self,
        required: Optional[int] = None,
        available: Optional[int] = None,
        program: Optional[str] = None,
    ):
        message = "You don't have enough points for this booking."
        if required and available:
            message = f"You need {required:,} points but only have {available:,}"
            if program:
                message += f" {program}"
        
        super().__init__(
            status_code=400,
            code="INSUFFICIENT_POINTS",
            message=message,
            suggestions=[
                "Add more points to your account",
                "Consider a cheaper route",
                "Use cash for some segments",
            ],
            retryable=False,
        )


class BudgetTooLowError(APIError):
    """User's budget is too low for the trip."""
    def __init__(
        self,
        user_budget: Optional[float] = None,
        recommended_budget: Optional[float] = None,
    ):
        message = "Your budget is too low for this trip."
        if user_budget and recommended_budget:
            message = f"Your budget of ${user_budget:,.0f} is too low. We recommend at least ${recommended_budget:,.0f}."
        
        super().__init__(
            status_code=400,
            code="BUDGET_TOO_LOW",
            message=message,
            details=f"User budget: ${user_budget:,.0f}, Recommended: ${recommended_budget:,.0f}" if user_budget else None,
            suggestions=[
                "Increase your budget",
                "Remove some destinations",
                "Shorten your trip duration",
            ],
            retryable=False,
        )


# =============================================================================
# External Service Errors
# =============================================================================

class ExternalServiceError(APIError):
    """Error from an external service (AwardTool, SerpAPI, etc.)."""
    def __init__(
        self,
        service_name: str,
        message: Optional[str] = None,
        retryable: bool = True,
    ):
        super().__init__(
            status_code=502,
            code="EXTERNAL_SERVICE_ERROR",
            message=message or f"Error communicating with {service_name}. Please try again.",
            details=f"Service: {service_name}",
            suggestions=["Wait a moment and try again", "If the problem persists, contact support"],
            retryable=retryable,
            retry_after_ms=5000 if retryable else None,
        )


class RateLimitError(APIError):
    """Rate limit exceeded."""
    def __init__(
        self,
        retry_after_ms: int = 60000,
        message: str = "Too many requests. Please slow down.",
    ):
        super().__init__(
            status_code=429,
            code="RATE_LIMIT_EXCEEDED",
            message=message,
            suggestions=["Wait a minute before trying again"],
            retryable=True,
            retry_after_ms=retry_after_ms,
        )


# =============================================================================
# Server Errors
# =============================================================================

class InternalError(APIError):
    """Internal server error."""
    def __init__(
        self,
        message: str = "Something went wrong on our end. Please try again.",
        details: Optional[str] = None,
    ):
        super().__init__(
            status_code=500,
            code="INTERNAL_ERROR",
            message=message,
            details=details,
            suggestions=["Try again in a few minutes", "If the problem persists, contact support"],
            retryable=True,
            retry_after_ms=5000,
        )


class TimeoutError(APIError):
    """Operation timed out."""
    def __init__(
        self,
        operation: str = "operation",
        timeout_seconds: Optional[int] = None,
    ):
        message = f"The {operation} took too long and was cancelled."
        if timeout_seconds:
            message = f"The {operation} exceeded the {timeout_seconds} second timeout."
        
        super().__init__(
            status_code=504,
            code="TIMEOUT",
            message=message,
            suggestions=[
                "Try again - this might be temporary",
                "Simplify your request (fewer destinations, shorter date range)",
            ],
            retryable=True,
            retry_after_ms=10000,
        )


# =============================================================================
# Helper Functions
# =============================================================================

def convert_exception_to_api_error(e: Exception) -> APIError:
    """Convert a generic exception to an appropriate APIError."""
    # Already an APIError
    if isinstance(e, APIError):
        return e
    
    # HTTPException from FastAPI
    if isinstance(e, HTTPException):
        if e.status_code == 401:
            return UnauthorizedError(str(e.detail))
        if e.status_code == 403:
            return ForbiddenError(str(e.detail))
        if e.status_code == 404:
            return NotFoundError()
        if e.status_code == 429:
            return RateLimitError()
        return InternalError(str(e.detail))
    
    # ValueError typically from validation
    if isinstance(e, ValueError):
        return ValidationError(str(e))
    
    # Default to internal error
    return InternalError(details=str(e))
