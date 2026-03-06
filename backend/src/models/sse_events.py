import json
from enum import Enum
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from typing import Optional, List


SCHEMA_VERSION = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Phase(str, Enum):
    LOADING = "loading"
    AIRPORTS = "airports"
    FLIGHTS = "flights"
    OPTIMIZING = "optimizing"
    SAVING = "saving"
    TIPS = "tips"


class StatusValue(str, Enum):
    STARTED = "started"
    QUEUED = "queued"
    ALREADY_PROCESSING = "already_processing"
    COMPLETE = "complete"
    ERROR = "error"


class ErrorCode(str, Enum):
    ILP_INFEASIBLE = "ILP_INFEASIBLE"
    ILP_TIMEOUT = "ILP_TIMEOUT"
    FLIGHT_FETCH_FAILED = "FLIGHT_FETCH_FAILED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    TRIP_NOT_FOUND = "TRIP_NOT_FOUND"
    ACCESS_DENIED = "ACCESS_DENIED"


class SSEEvent(BaseModel):
    v: int = SCHEMA_VERSION
    seq: int
    trip_id: str = Field(alias="tripId")
    type: str
    phase: Optional[Phase] = None
    status: Optional[StatusValue] = None
    message: Optional[str] = None
    progress: Optional[dict] = None
    job_id: Optional[str] = Field(default=None, alias="jobId")
    itinerary_version: Optional[int] = Field(default=None, alias="itineraryVersion")
    degraded: Optional[bool] = None
    skipped_routes: Optional[List[str]] = Field(default=None, alias="skippedRoutes")
    error: Optional[dict] = None
    ts: str = Field(default_factory=_now_iso)

    model_config = {"populate_by_name": True}


def format_sse(event: SSEEvent) -> bytes:
    """Format as wire SSE and return bytes to force flush in ASGI."""
    payload = event.model_dump(by_alias=True, exclude_none=True)
    lines = f"id: {event.seq}\nevent: {event.type}\ndata: {json.dumps(payload)}\n\n"
    return lines.encode("utf-8")


def format_sse_comment(comment: str) -> bytes:
    return f": {comment}\n\n".encode("utf-8")


def format_sse_retry(ms: int) -> bytes:
    return f"retry: {ms}\n\n".encode("utf-8")


class SeqCounter:
    """Thread-safe monotonic sequence counter for SSE events."""

    def __init__(self, trip_id: str):
        self._seq = 0
        self._trip_id = trip_id

    def next_event(self, **kwargs) -> SSEEvent:
        self._seq += 1
        return SSEEvent(seq=self._seq, tripId=self._trip_id, **kwargs)
