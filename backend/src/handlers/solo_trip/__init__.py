# Solo Trip Algorithm Implementation
# Guaranteed Accurate Itineraries - No Placeholders, No Fallbacks

from .models import (
    FlightLeg,
    Layover,
    TransferPartner,
    ConnectingFlightOption,
    FlightSegment,
    Itinerary,
    TransferPlan,
    PointsTransfer,
    ConnectionValidation,
    ConnectionWarning,
    TripInput,
    Destination,
    CabinClass,
    RouteEdge,
    RouteGraph,
    FlightSearchResult,
    OptimizationResult,
)

from .errors import (
    SoloTripError,
    ValidationError,
    NoFlightsFoundError,
    InvalidConnectionError,
    NoValidRouteError,
    BudgetExceededError,
    OptimizationFailedError,
    MissingFlightDataError,
)

from .validator import StrictTripInputValidator
from .connection_validator import ConnectionValidator
from .flight_searcher import ComprehensiveFlightSearcher
from .route_graph_builder import RouteGraphBuilder
from .booking_instructions import BookingInstructionGenerator
from .orchestrator import (
    SoloTripOrchestrator,
    get_orchestrator,
    generate_optimized_itinerary,
    generate_optimized_itinerary_sync,
)

__all__ = [
    # Models
    "FlightLeg",
    "Layover",
    "TransferPartner",
    "ConnectingFlightOption",
    "FlightSegment",
    "Itinerary",
    "TransferPlan",
    "PointsTransfer",
    "ConnectionValidation",
    "ConnectionWarning",
    "TripInput",
    "Destination",
    "CabinClass",
    "RouteEdge",
    "RouteGraph",
    "FlightSearchResult",
    "OptimizationResult",
    # Errors
    "SoloTripError",
    "ValidationError",
    "NoFlightsFoundError",
    "InvalidConnectionError",
    "NoValidRouteError",
    "BudgetExceededError",
    "OptimizationFailedError",
    "MissingFlightDataError",
    # Components
    "StrictTripInputValidator",
    "ConnectionValidator",
    "ComprehensiveFlightSearcher",
    "RouteGraphBuilder",
    "BookingInstructionGenerator",
    # Orchestrator
    "SoloTripOrchestrator",
    "get_orchestrator",
    "generate_optimized_itinerary",
    "generate_optimized_itinerary_sync",
]
