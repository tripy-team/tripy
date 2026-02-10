# Solo Booking Schemas
# These schemas define the API contracts for the solo booking flow

from .programs import PointsProgram
from .trip import (
    TripType,
    DateMode,
    OptimizationMode,
    CreateTripRequest,
    TripResponse,
    UpdateTripStatusRequest,
    StatusUpdateResponse,
    SelectItineraryRequest,
    SelectionResponse,
)
from .points import (
    PointsBalance,
    UpsertPointsRequest,
    PointsSummaryResponse,
)
from .optimize import (
    OptimizeSoloRequest,
    OptimizeSoloResponse,
    BudgetStatus,
    TransferInsight,
    TransferInstruction,
    SegmentBreakdown,
    OOPMetrics,
    RankedItinerary,
    DecisionSummary,
    RejectedAlternative,
    RiskAssessment,
    BookingDetails,
    BookingChecklistStep,
    TransferStrategyRequest,
    TransferStrategyResponse,
    BookingStep,
)

__all__ = [
    # Programs
    "PointsProgram",
    # Trip
    "TripType",
    "DateMode",
    "OptimizationMode",
    "CreateTripRequest",
    "TripResponse",
    "UpdateTripStatusRequest",
    "StatusUpdateResponse",
    "SelectItineraryRequest",
    "SelectionResponse",
    # Points
    "PointsBalance",
    "UpsertPointsRequest",
    "PointsSummaryResponse",
    # Optimize
    "OptimizeSoloRequest",
    "OptimizeSoloResponse",
    "BudgetStatus",
    "TransferInsight",
    "TransferInstruction",
    "SegmentBreakdown",
    "OOPMetrics",
    "RankedItinerary",
    "DecisionSummary",
    "RejectedAlternative",
    "RiskAssessment",
    "BookingDetails",
    "BookingChecklistStep",
    "TransferStrategyRequest",
    "TransferStrategyResponse",
    "BookingStep",
]
