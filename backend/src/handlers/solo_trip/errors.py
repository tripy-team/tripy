"""
Solo Trip Error Types

Explicit error types for the solo trip algorithm.
NO FALLBACKS - errors are returned with actionable guidance.
"""

from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field


@dataclass
class UserAction:
    """An actionable step the user can take."""
    action_type: str
    title: str
    description: str
    button_text: str = ""
    parameters: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "action_type": self.action_type,
            "title": self.title,
            "description": self.description,
            "button_text": self.button_text,
            "parameters": self.parameters,
        }


class SoloTripError(Exception):
    """Base class for all solo trip errors."""
    
    def __init__(
        self,
        message: str,
        code: str,
        user_actions: Optional[List[UserAction]] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        self.code = code
        self.user_actions = user_actions or []
        self.details = details or {}
        super().__init__(message)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "error_code": self.code,
            "message": self.message,
            "user_actions": [a.to_dict() for a in self.user_actions],
            "details": self.details,
        }


class ValidationError(SoloTripError):
    """Input validation failed."""
    
    def __init__(
        self,
        message: str,
        field: str,
        code: str = "VALIDATION_ERROR",
        severity: str = "blocking",
        suggestions: Optional[List[str]] = None
    ):
        self.field = field
        self.severity = severity
        self.suggestions = suggestions or []
        
        super().__init__(
            message=message,
            code=code,
            user_actions=[
                UserAction(
                    action_type="fix_input",
                    title="Fix Input",
                    description=f"Please correct: {field}",
                    button_text="Edit Trip Details"
                )
            ],
            details={
                "field": field,
                "severity": severity,
                "suggestions": self.suggestions
            }
        )


class NoFlightsFoundError(SoloTripError):
    """No flights available for route/date."""
    
    def __init__(
        self,
        message: str,
        origin: str,
        destination: str,
        date: str,
        strategies_tried: Optional[List[str]] = None,
        nearby_airports: Optional[List[str]] = None
    ):
        self.origin = origin
        self.destination = destination
        self.date = date
        self.strategies_tried = strategies_tried or []
        self.nearby_airports = nearby_airports or []
        
        actions = [
            UserAction(
                action_type="change_dates",
                title="Try Different Dates",
                description="Flight availability varies significantly by date. Try searching for dates 1-2 days before or after.",
                button_text="Change Dates"
            )
        ]
        
        if nearby_airports:
            actions.append(UserAction(
                action_type="change_airports",
                title="Try Nearby Airports",
                description=f"Consider flying to/from: {', '.join(nearby_airports[:5])}",
                button_text="Change Airports",
                parameters={"suggested_airports": nearby_airports}
            ))
        
        super().__init__(
            message=message,
            code="NO_FLIGHTS_FOUND",
            user_actions=actions,
            details={
                "origin": origin,
                "destination": destination,
                "date": date,
                "strategies_tried": self.strategies_tried,
                "nearby_airports": self.nearby_airports
            }
        )


class InvalidConnectionError(SoloTripError):
    """Connection time is insufficient."""
    
    def __init__(
        self,
        message: str,
        connection_airport: str,
        actual_minutes: int,
        required_minutes: int,
        arriving_flight: Optional[str] = None,
        departing_flight: Optional[str] = None
    ):
        self.connection_airport = connection_airport
        self.actual_minutes = actual_minutes
        self.required_minutes = required_minutes
        
        super().__init__(
            message=message,
            code="INVALID_CONNECTION",
            user_actions=[
                UserAction(
                    action_type="different_flights",
                    title="Choose Different Flights",
                    description=f"Need at least {required_minutes} minutes for this connection at {connection_airport}",
                    button_text="Search Again"
                )
            ],
            details={
                "connection_airport": connection_airport,
                "actual_minutes": actual_minutes,
                "required_minutes": required_minutes,
                "arriving_flight": arriving_flight,
                "departing_flight": departing_flight
            }
        )


class NoValidRouteError(SoloTripError):
    """No valid route exists for the given constraints."""
    
    def __init__(
        self,
        message: str,
        start: str,
        end: str,
        must_visit: Optional[List[str]] = None,
        reasons: Optional[List[str]] = None
    ):
        self.start = start
        self.end = end
        self.must_visit = must_visit or []
        self.reasons = reasons or []
        
        super().__init__(
            message=message,
            code="NO_VALID_ROUTE",
            user_actions=[
                UserAction(
                    action_type="modify_destinations",
                    title="Modify Destinations",
                    description="Some destinations may not be reachable with available flights",
                    button_text="Edit Destinations"
                ),
                UserAction(
                    action_type="change_dates",
                    title="Try Different Dates",
                    description="More flights may be available on other dates",
                    button_text="Change Dates"
                )
            ],
            details={
                "start": start,
                "end": end,
                "must_visit": self.must_visit,
                "reasons": self.reasons
            }
        )


class BudgetExceededError(SoloTripError):
    """Trip costs more than user's budget. NOT a failure - returns real itinerary."""
    
    def __init__(
        self,
        message: str,
        minimum_cost: float,
        user_budget: float,
        itinerary: Optional[Any] = None  # The actual Itinerary object
    ):
        self.minimum_cost = minimum_cost
        self.user_budget = user_budget
        self.itinerary = itinerary
        
        super().__init__(
            message=message,
            code="BUDGET_EXCEEDED",
            user_actions=[
                UserAction(
                    action_type="increase_budget",
                    title="Increase Budget",
                    description=f"Minimum cost is ${minimum_cost:,.2f}. Set budget to at least this amount.",
                    button_text="Update Budget",
                    parameters={"suggested_budget": minimum_cost}
                ),
                UserAction(
                    action_type="view_itinerary",
                    title="View Itinerary Anyway",
                    description="See the full itinerary and cost breakdown",
                    button_text="View Details"
                )
            ],
            details={
                "minimum_cost": minimum_cost,
                "user_budget": user_budget,
                "exceeded_by": minimum_cost - user_budget
            }
        )


class OptimizationFailedError(SoloTripError):
    """ILP optimization failed."""
    
    def __init__(
        self,
        message: str,
        status: str = "Unknown",
        details: Optional[Dict[str, Any]] = None
    ):
        self.status = status
        
        super().__init__(
            message=message,
            code="OPTIMIZATION_FAILED",
            user_actions=[
                UserAction(
                    action_type="retry",
                    title="Try Again",
                    description="The optimization may succeed with different parameters",
                    button_text="Retry"
                ),
                UserAction(
                    action_type="simplify_trip",
                    title="Simplify Trip",
                    description="Try fewer destinations or more flexible dates",
                    button_text="Edit Trip"
                )
            ],
            details=details or {"status": status}
        )


class MissingFlightDataError(SoloTripError):
    """Required flight data is missing for some route segments."""
    
    def __init__(
        self,
        message: str,
        missing_segments: List[tuple],
        trip_data: Optional[Any] = None
    ):
        self.missing_segments = missing_segments
        
        # Format missing segments for display
        segments_str = ", ".join([f"{s[0]} → {s[1]}" for s in missing_segments[:5]])
        if len(missing_segments) > 5:
            segments_str += f" and {len(missing_segments) - 5} more"
        
        super().__init__(
            message=message,
            code="MISSING_FLIGHT_DATA",
            user_actions=[
                UserAction(
                    action_type="change_dates",
                    title="Try Different Dates",
                    description=f"No flights found for: {segments_str}",
                    button_text="Change Dates"
                ),
                UserAction(
                    action_type="change_destinations",
                    title="Modify Destinations",
                    description="Some routes may not have available flights",
                    button_text="Edit Destinations"
                )
            ],
            details={
                "missing_segments": [
                    {"origin": s[0], "destination": s[1]} for s in missing_segments
                ]
            }
        )


class APIError(SoloTripError):
    """External API call failed."""
    
    def __init__(
        self,
        message: str,
        source: str,
        status_code: Optional[int] = None,
        recoverable: bool = True
    ):
        self.source = source
        self.status_code = status_code
        self.recoverable = recoverable
        
        actions = []
        if recoverable:
            actions.append(UserAction(
                action_type="retry",
                title="Try Again",
                description="The issue may be temporary",
                button_text="Retry"
            ))
        
        super().__init__(
            message=message,
            code="API_ERROR",
            user_actions=actions,
            details={
                "source": source,
                "status_code": status_code,
                "recoverable": recoverable
            }
        )
