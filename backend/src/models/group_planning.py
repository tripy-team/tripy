"""
Group Planning Models

Data models for the organizer-managed group trip planning feature.
One authenticated owner creates lightweight traveler profiles (no account required),
enters each traveler's points/preferences, and the system optimizes a group
itinerary with Splitwise-style fair cost splitting.

DynamoDB Single Table Design:
  PK: groupTripId
  SK: META | TRAVELER#<id> | BALANCE#<travelerId>#<balanceId> |
      PREF#<travelerId> | LEDGER#<entryId> | SETTLEMENT#<travelerId>#<version>
  GSI: ownerUserId-index (PK=ownerUserId, SK=createdAt)
"""

from enum import Enum
from typing import Optional, List, Dict
from pydantic import BaseModel, Field


# =============================================================================
# ENUMS
# =============================================================================

class GroupTripStatus(str, Enum):
    DRAFT = "draft"
    OPTIMIZING = "optimizing"
    READY = "ready"
    BOOKED = "booked"


class SplitMethod(str, Enum):
    POINTS_VALUE_WEIGHTED = "points_value_weighted"
    EQUAL_CASH_AFTER_POINTS = "equal_cash_after_points"


class CabinPreference(str, Enum):
    ECONOMY = "economy"
    PREMIUM_ECONOMY = "premium_economy"
    BUSINESS = "business"
    FIRST = "first"


class HotelPreference(str, Enum):
    BUDGET = "budget"
    STANDARD = "standard"
    LUXURY = "luxury"


class LoyaltyCurrencyType(str, Enum):
    AIRLINE_MILES = "airline_miles"
    HOTEL_POINTS = "hotel_points"
    BANK_POINTS = "bank_points"


class UsePointsPriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class LedgerEntryType(str, Enum):
    CASH_PAID = "cash_paid"
    POINTS_USED = "points_used"
    TRANSFER_FEE_PAID = "transfer_fee_paid"
    TAX_PAID = "tax_paid"
    CREDIT = "credit"
    ADJUSTMENT = "adjustment"


class LedgerReferenceType(str, Enum):
    FLIGHT = "flight"
    HOTEL = "hotel"
    BOOKING_FEE = "booking_fee"
    MANUAL_ADJUSTMENT = "manual_adjustment"
    OPTIMIZER = "optimizer"


class AssignmentItemType(str, Enum):
    FLIGHT = "flight"
    HOTEL = "hotel"
    TRANSFER = "transfer"
    ACTIVITY = "activity"


# =============================================================================
# CORE MODELS
# =============================================================================

class GroupTripCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    destination: str = Field(..., min_length=1, max_length=1000)
    start_date: str = Field(..., min_length=10, max_length=10)
    end_date: str = Field(..., min_length=10, max_length=10)
    currency: str = Field(default="USD", max_length=3)
    split_method: SplitMethod = SplitMethod.POINTS_VALUE_WEIGHTED


class GroupTripUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    destination: Optional[str] = Field(None, min_length=1, max_length=1000)
    start_date: Optional[str] = Field(None, min_length=10, max_length=10)
    end_date: Optional[str] = Field(None, min_length=10, max_length=10)
    currency: Optional[str] = Field(None, max_length=3)
    status: Optional[GroupTripStatus] = None
    split_method: Optional[SplitMethod] = None


class GroupTripResponse(BaseModel):
    id: str
    owner_user_id: str
    name: str
    destination: str
    start_date: str
    end_date: str
    currency: str
    status: str
    split_method: str
    created_at: str
    updated_at: str
    traveler_count: int = 0


class TravelerProfileCreate(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=200)
    origin_city: Optional[str] = Field(None, max_length=100)
    origin_airport: Optional[str] = Field(None, max_length=10)
    cabin_preference: Optional[CabinPreference] = None
    hotel_preference: Optional[HotelPreference] = None
    room_share_group_id: Optional[str] = None
    cash_budget: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=500)


class TravelerProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=100)
    email: Optional[str] = Field(None, max_length=200)
    origin_city: Optional[str] = Field(None, max_length=100)
    origin_airport: Optional[str] = Field(None, max_length=10)
    cabin_preference: Optional[CabinPreference] = None
    hotel_preference: Optional[HotelPreference] = None
    room_share_group_id: Optional[str] = None
    cash_budget: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=500)


class TravelerProfileResponse(BaseModel):
    id: str
    group_trip_id: str
    linked_user_id: Optional[str] = None
    is_guest_profile: bool
    display_name: str
    email: Optional[str] = None
    origin_city: Optional[str] = None
    origin_airport: Optional[str] = None
    cabin_preference: Optional[str] = None
    hotel_preference: Optional[str] = None
    room_share_group_id: Optional[str] = None
    cash_budget: Optional[float] = None
    notes: Optional[str] = None
    created_at: str
    updated_at: str


class LoyaltyBalanceCreate(BaseModel):
    program: str = Field(..., min_length=1, max_length=100)
    currency_type: LoyaltyCurrencyType
    balance: int = Field(..., ge=0)
    transferable_from: Optional[List[str]] = None
    cents_per_point_assumption: Optional[float] = Field(None, ge=0, le=10)
    is_enabled_for_pooling: bool = True


class LoyaltyBalanceUpdate(BaseModel):
    program: Optional[str] = Field(None, min_length=1, max_length=100)
    currency_type: Optional[LoyaltyCurrencyType] = None
    balance: Optional[int] = Field(None, ge=0)
    transferable_from: Optional[List[str]] = None
    cents_per_point_assumption: Optional[float] = Field(None, ge=0, le=10)
    is_enabled_for_pooling: Optional[bool] = None


class LoyaltyBalanceResponse(BaseModel):
    id: str
    traveler_profile_id: str
    program: str
    currency_type: str
    balance: int
    transferable_from: Optional[List[str]] = None
    cents_per_point_assumption: Optional[float] = None
    is_enabled_for_pooling: bool
    created_at: str
    updated_at: str


class ContributionPreferenceUpsert(BaseModel):
    max_cash_contribution: Optional[float] = Field(None, ge=0)
    max_point_value_contribution_usd: Optional[float] = Field(None, ge=0)
    use_points_priority: UsePointsPriority = UsePointsPriority.MEDIUM
    allow_transfer_partners: bool = True
    allow_hotel_points: bool = True
    allow_flight_points: bool = True


class ContributionPreferenceResponse(BaseModel):
    id: str
    traveler_profile_id: str
    max_cash_contribution: Optional[float] = None
    max_point_value_contribution_usd: Optional[float] = None
    use_points_priority: str
    allow_transfer_partners: bool
    allow_hotel_points: bool
    allow_flight_points: bool
    created_at: str
    updated_at: str


class ItineraryAssignmentResponse(BaseModel):
    id: str
    group_trip_id: str
    itinerary_item_id: str
    traveler_profile_id: str
    item_type: str
    shared_group_key: Optional[str] = None
    cash_cost: float
    points_cost: int
    points_program: Optional[str] = None
    imputed_points_value_usd: Optional[float] = None
    created_at: str


class ContributionLedgerEntryResponse(BaseModel):
    id: str
    group_trip_id: str
    traveler_profile_id: str
    entry_type: str
    reference_type: str
    reference_id: Optional[str] = None
    amount_usd: float
    points_amount: Optional[int] = None
    points_program: Optional[str] = None
    description: str
    created_at: str


class SettlementSummaryResponse(BaseModel):
    id: str
    group_trip_id: str
    traveler_profile_id: str
    traveler_name: str
    gross_share_usd: float
    contributed_value_usd: float
    net_owed_usd: float
    net_credit_usd: float
    explanation_lines: List[str] = []
    calculation_version: int
    created_at: str


class ManualAdjustmentCreate(BaseModel):
    traveler_profile_id: str
    amount_usd: float
    description: str = Field(..., min_length=1, max_length=500)


class GroupTripDetailResponse(BaseModel):
    """Denormalized read model for the frontend."""
    trip: GroupTripResponse
    travelers: List[TravelerProfileResponse]
    balances: Dict[str, List[LoyaltyBalanceResponse]] = {}
    preferences: Dict[str, ContributionPreferenceResponse] = {}
    settlements: List[SettlementSummaryResponse] = []
    ledger: List[ContributionLedgerEntryResponse] = []
