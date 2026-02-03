"""
Tripy Backend Models

This module contains data models and schemas for the Tripy backend.
"""

from .group_trip import (
    PoolingScope,
    MemberLifecycleState,
    DelegationScope,
    DelegatedBookingAuthority,
    TripMemberRole,
    PointsUsagePreference,
    PassengerType,
    # Settlement (Task 17)
    SettlementPolicy,
    PointsValuationMode,
    PointsValuationConfig,
    TripSettlementConfig,
    SETTLEMENT_POLICY_DESCRIPTIONS,
    POINTS_VALUATION_DESCRIPTIONS,
    # Request/Response models
    UpdatePoolingScopeRequest,
    UpdatePoolingScopeResponse,
    UpdateMemberLifecycleRequest,
    UpdateMemberLifecycleResponse,
    SetHouseholdRequest,
    SetDelegationRequest,
    UpdateSettlementPolicyRequest,
    UpdateSettlementConfigRequest,
    SettlementConfigResponse,
    Passenger,
    CreatePassengerRequest,
    PassengerResponse,
    TripPassengersSummary,
    is_valid_lifecycle_transition,
    get_default_pooling_scope,
    VALID_LIFECYCLE_TRANSITIONS,
)

from .booking import (
    PaymentType,
    BookingStatus,
    SeatAllocation,
    Ticket,
    FlightSegmentRef,
    PassengerRef,
    PNR,
    PlanDraftAllocation,
    LedgerEntryType,
    LedgerEntry,
    LedgerSummary,
)

__all__ = [
    # Enums
    "PoolingScope",
    "MemberLifecycleState",
    "DelegationScope",
    "TripMemberRole",
    "PointsUsagePreference",
    "PassengerType",
    "PaymentType",
    "BookingStatus",
    "LedgerEntryType",
    # Settlement enums (Task 17)
    "SettlementPolicy",
    "PointsValuationMode",
    # Models
    "DelegatedBookingAuthority",
    "Passenger",
    "SeatAllocation",
    "Ticket",
    "FlightSegmentRef",
    "PassengerRef",
    "PNR",
    "PlanDraftAllocation",
    "LedgerEntry",
    "LedgerSummary",
    # Settlement models (Task 17)
    "PointsValuationConfig",
    "TripSettlementConfig",
    # Request/Response models
    "UpdatePoolingScopeRequest",
    "UpdatePoolingScopeResponse",
    "UpdateMemberLifecycleRequest",
    "UpdateMemberLifecycleResponse",
    "SetHouseholdRequest",
    "SetDelegationRequest",
    "UpdateSettlementPolicyRequest",
    "UpdateSettlementConfigRequest",
    "SettlementConfigResponse",
    "CreatePassengerRequest",
    "PassengerResponse",
    "TripPassengersSummary",
    # Helper functions
    "is_valid_lifecycle_transition",
    "get_default_pooling_scope",
    "VALID_LIFECYCLE_TRANSITIONS",
    # Settlement descriptions
    "SETTLEMENT_POLICY_DESCRIPTIONS",
    "POINTS_VALUATION_DESCRIPTIONS",
]
