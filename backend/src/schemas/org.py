from pydantic import BaseModel
from typing import Optional, List, Literal


# =============================================================================
# Feature 16: Extended branding for white-label client experience
# =============================================================================

class BrandingSettings(BaseModel):
    brand_name: Optional[str] = None
    brand_color: Optional[str] = "#1a56db"
    accent_color: Optional[str] = None
    logo_url: Optional[str] = None
    font_family: Optional[str] = None
    email_from_name: Optional[str] = None
    hide_tripy: bool = False


# =============================================================================
# Feature 15: Agency-level memory (operational preferences)
# =============================================================================

class AgencyPreferences(BaseModel):
    default_cabin_preference: Optional[str] = None  # economy | business | first | flexible
    acceptable_connection_mins: int = 90
    max_stops: int = 2
    self_transfer_policy: str = "warn"  # never | warn | allow
    separate_ticket_policy: str = "warn"  # never | warn | allow

    preferred_airlines: List[str] = []
    blocked_airlines: List[str] = []
    preferred_alliances: List[str] = []

    max_cpp_threshold: Optional[float] = None
    min_savings_to_recommend_points: float = 50.0

    default_proposal_greeting: str = ""
    default_booking_disclaimer: str = ""


class CreateOrgRequest(BaseModel):
    name: str


class OrgResponse(BaseModel):
    org_id: str
    name: str
    owner_id: str
    plan: str
    trial_ends_at: Optional[str] = None
    branding: Optional[BrandingSettings] = None
    agency_preferences: Optional[AgencyPreferences] = None
    created_at: str


class UpdateBrandingRequest(BaseModel):
    brand_name: Optional[str] = None
    brand_color: Optional[str] = None
    accent_color: Optional[str] = None
    logo_url: Optional[str] = None
    font_family: Optional[str] = None
    email_from_name: Optional[str] = None
    hide_tripy: Optional[bool] = None


class UpdateAgencyPreferencesRequest(BaseModel):
    default_cabin_preference: Optional[str] = None
    acceptable_connection_mins: Optional[int] = None
    max_stops: Optional[int] = None
    self_transfer_policy: Optional[str] = None
    separate_ticket_policy: Optional[str] = None
    preferred_airlines: Optional[List[str]] = None
    blocked_airlines: Optional[List[str]] = None
    preferred_alliances: Optional[List[str]] = None
    max_cpp_threshold: Optional[float] = None
    min_savings_to_recommend_points: Optional[float] = None
    default_proposal_greeting: Optional[str] = None
    default_booking_disclaimer: Optional[str] = None


class OrgMemberResponse(BaseModel):
    org_id: str
    user_id: str
    role: Literal["owner", "admin", "member"]
    display_name: Optional[str] = None
    email: Optional[str] = None
    active_client_count: int = 0
    active_trip_count: int = 0
    created_at: str


class AddMemberRequest(BaseModel):
    email: str
    role: Literal["owner", "admin", "member"] = "member"


# =============================================================================
# Feature 12: Trip assignment for team workspace
# =============================================================================

class TripAssignmentRequest(BaseModel):
    assigned_to: str
    note: Optional[str] = None


class ActivityEntry(BaseModel):
    timestamp: str
    user_id: str
    action: str  # created | optimized | shared | reassigned | annotated
    detail: Optional[str] = None
