"""
Pydantic models for the monitoring feature.

API request/response schemas and internal domain models.
"""
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field


# =============================================================================
# ENUMS
# =============================================================================

class MonitoringTier(str, Enum):
    FREE_EMAIL = "free_email"
    PAID = "paid"


class MonitoringState(str, Enum):
    PENDING_VERIFICATION = "pending_verification"
    ACTIVE = "active"
    PAUSED = "paused"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class AlertSeverity(str, Enum):
    MEDIUM = "medium"
    HIGH = "high"


# =============================================================================
# BASELINE PAYLOAD (sent from frontend)
# =============================================================================

class BaselinePayload(BaseModel):
    """Baseline data sent from the frontend with the monitoring start request."""
    schema_version: int = 1
    selected_itinerary: Dict[str, Any]
    alternatives: Optional[List[Dict[str, Any]]] = None
    query_inputs: Optional[Dict[str, Any]] = None


# =============================================================================
# API REQUEST MODELS
# =============================================================================

class StartMonitoringRequest(BaseModel):
    tier: MonitoringTier = MonitoringTier.FREE_EMAIL
    email: Optional[EmailStr] = None
    baseline_payload: Optional[BaselinePayload] = None


class StopMonitoringRequest(BaseModel):
    """Optional: can be empty, auth identifies the user."""
    pass


class ReplayRequest(BaseModel):
    update_id: str


# =============================================================================
# API RESPONSE MODELS
# =============================================================================

class StartMonitoringResponse(BaseModel):
    subscription_id: str
    state: MonitoringState
    tier: MonitoringTier
    expires_at: Optional[str] = None
    message: Optional[str] = None


class MonitoringStatusResponse(BaseModel):
    subscription_id: str
    state: MonitoringState
    tier: MonitoringTier
    email_masked: str
    expires_at: Optional[str] = None
    next_check_at: Optional[str] = None
    last_checked_at: Optional[str] = None
    alerts_sent: int = 0


class MonitoringStatusNotFound(BaseModel):
    state: str = "none"


class DeltaBullet(BaseModel):
    type: str                          # "price_drop", "schedule_change", etc.
    label: str                         # "Cash price dropped 28%"
    detail: str                        # "$847 → $612"
    direction: str = "neutral"         # "improvement", "neutral", "regression"
    subtype: Optional[str] = None      # "departure_later", "duration_decreased", etc.


class UpdateDeltas(BaseModel):
    bullets: List[DeltaBullet]
    recommendation: str
    caveat: str


class UpdateRecordResponse(BaseModel):
    """Public JSON response for the update click-through page."""
    update_id: str
    detected_at: str
    severity: AlertSeverity
    baseline_summary: Dict[str, Any]
    new_candidate_summary: Dict[str, Any]
    deltas: UpdateDeltas
    trip_id: str
    subscription_tier: MonitoringTier
    # Safety: NO email, NO user_id, NO subscription_id


class UpdateExpiredResponse(BaseModel):
    error: str = "expired"
    message: str = "This update has expired."


class UpdateDegradedResponse(BaseModel):
    update_id: str
    degraded: bool = True
    message: str = "This update was created with an older format. Some details may be missing."
    detected_at: Optional[str] = None
    trip_id: Optional[str] = None


# =============================================================================
# CRON RESPONSE
# =============================================================================

class MonitoringCheckResponse(BaseModel):
    ok: bool = True
    checked: int = 0
    updates_created: int = 0
    alerts_sent: int = 0
    alerts_skipped: int = 0
    alerts_skipped_reason: Optional[str] = None
    cooldown_overrides: int = 0
    expired: int = 0
    skipped_cooldown: int = 0
    skipped_version: int = 0
    errors: List[str] = Field(default_factory=list)


class ReplayResponse(BaseModel):
    ok: bool = True
    update_id: str
    previous_email_status: Optional[str] = None
    new_email_status: Optional[str] = None
    message: Optional[str] = None
