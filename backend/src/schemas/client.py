from pydantic import BaseModel
from typing import Optional, List, Dict, Any


# =============================================================================
# Feature 2: Extended client preferences for profile memory
# =============================================================================

class ClientPreferences(BaseModel):
    flight_class: Optional[str] = None
    preferred_airlines: List[str] = []
    preferred_airports: List[str] = []
    cabin_default: Optional[str] = None  # economy | business | first | flexible
    budget_style: Optional[str] = None  # budget | moderate | premium | ultra-premium
    avoid_constraints: List[str] = []  # "tight layovers", "red-eyes", "self-transfers"
    positive_constraints: List[str] = []  # "direct flights preferred", "lounge access"


class FamilyMember(BaseModel):
    name: str
    relationship: str  # spouse, child, parent, friend, etc.
    age: Optional[int] = None
    loyalty_programs: List[str] = []
    notes: Optional[str] = None


# =============================================================================
# Feature 11: Advisor annotations (internal notes + client-safe output)
# =============================================================================

class AdvisorAnnotation(BaseModel):
    recommendation_id: Optional[str] = None
    internal_notes: str = ""
    pricing_notes: str = ""
    client_visible_note: str = ""
    hidden_from_client: List[str] = []


class ClientStats(BaseModel):
    total_trips: int = 0
    total_savings: float = 0
    total_points_optimized: int = 0


class CreateClientRequest(BaseModel):
    name: str
    email: Optional[str] = None
    home_airport: Optional[str] = None
    notes: Optional[str] = None
    preferences: Optional[ClientPreferences] = None
    family_members: Optional[List[FamilyMember]] = None
    initial_points: Optional[List[Dict[str, Any]]] = None


class UpdateClientRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    home_airport: Optional[str] = None
    notes: Optional[str] = None
    preferences: Optional[ClientPreferences] = None
    family_members: Optional[List[FamilyMember]] = None


class ClientResponse(BaseModel):
    org_id: str
    client_id: str
    name: str
    email: Optional[str] = None
    home_airport: Optional[str] = None
    notes: Optional[str] = None
    preferences: Optional[ClientPreferences] = None
    family_members: List[FamilyMember] = []
    stats: Optional[ClientStats] = None
    is_self_client: bool = False
    created_by: Optional[str] = None
    created_at: str
    travel_history_summary: Optional[str] = None


class ClientPointBalance(BaseModel):
    program: str
    balance: int
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None


class UpsertClientPointsRequest(BaseModel):
    points: List[ClientPointBalance]


class ClientPointsResponse(BaseModel):
    org_id: str
    client_id: str
    points: List[ClientPointBalance]
    total_points: int = 0


# =============================================================================
# Feature 2: Client context for optimization (aggregates profile + points)
# =============================================================================

class ClientContext(BaseModel):
    client_id: str
    name: str
    home_airport: Optional[str] = None
    preferences: Optional[ClientPreferences] = None
    family_members: List[FamilyMember] = []
    points: List[ClientPointBalance] = []
    notes: Optional[str] = None
    travel_history_summary: Optional[str] = None
