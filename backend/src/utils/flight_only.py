"""
Flight-only mode enforcement utilities.

Tripy is a flight-only optimizer. This module provides utilities to gate
hotel/lodging endpoints and ensure they return HTTP 410 Gone when called.
"""

from functools import wraps
from fastapi import HTTPException
from typing import Callable, Any

from src.config import is_flights_only_mode


class FlightOnlyModeError(HTTPException):
    """Exception raised when hotel/lodging features are accessed in flight-only mode."""
    
    def __init__(self):
        super().__init__(
            status_code=410,
            detail={
                "error": "feature_disabled",
                "message": "Tripy is a flight-only optimizer. Hotel/lodging features are not available.",
                "code": "FLIGHTS_ONLY_MODE",
                "documentation": "https://docs.tripy.app/flight-only"
            }
        )


def require_hotel_feature():
    """
    FastAPI dependency that raises HTTP 410 Gone if hotel features are disabled.
    
    Usage:
        @app.get("/hotels/search")
        async def search_hotels(
            _: None = Depends(require_hotel_feature),
            ...
        ):
            ...
    """
    if is_flights_only_mode():
        raise FlightOnlyModeError()
    return None


def hotel_feature_gate(func: Callable) -> Callable:
    """
    Decorator that gates a function behind the hotel feature flag.
    
    When FEATURE_FLIGHTS_ONLY=true, the decorated function will raise
    FlightOnlyModeError instead of executing.
    
    Usage:
        @hotel_feature_gate
        async def search_hotels(...):
            ...
    """
    @wraps(func)
    async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
        if is_flights_only_mode():
            raise FlightOnlyModeError()
        return await func(*args, **kwargs)
    
    @wraps(func)
    def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
        if is_flights_only_mode():
            raise FlightOnlyModeError()
        return func(*args, **kwargs)
    
    # Return appropriate wrapper based on function type
    import asyncio
    if asyncio.iscoroutinefunction(func):
        return async_wrapper
    return sync_wrapper


def get_hotel_functions_if_enabled():
    """
    Returns hotel-related functions only if hotel features are enabled.
    Returns None if in flight-only mode.
    
    This prevents hotel code from being called in candidate generation pipelines.
    """
    if is_flights_only_mode():
        return None
    
    try:
        from src.services.serp_api_functions import (
            get_google_hotels,
            optimize_hotels_out_of_pocket,
        )
        return {
            "get_google_hotels": get_google_hotels,
            "optimize_hotels_out_of_pocket": optimize_hotels_out_of_pocket,
        }
    except ImportError:
        return None
