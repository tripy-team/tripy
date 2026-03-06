"""SQS worker Lambda handler for async itinerary generation.

Picks up jobs from the tripy-itinerary-generation queue and runs
the streaming generation pipeline with allow_queue=False to prevent
recursive SQS enqueue.
"""
import json
import asyncio
import logging
from datetime import datetime, timezone

from src.repos import itinerary_repo
from src.models.sse_events import StatusValue

logger = logging.getLogger(__name__)


def handler(event, context):
    for record in event["Records"]:
        body = json.loads(record["body"])
        trip_id = body["trip_id"]
        optimization_mode = body.get("optimization_mode", "money_saving")
        request_id = body.get("request_id", "")
        attempt = int(
            record.get("attributes", {}).get("ApproximateReceiveCount", "1")
        )
        asyncio.run(_process(trip_id, optimization_mode, request_id, attempt))


async def _process(
    trip_id: str,
    optimization_mode: str,
    request_id: str,
    attempt: int,
):
    from src.services import itinerary_service  # deferred to avoid circular imports

    lock = itinerary_repo.get_generation_lock(trip_id)
    if not lock:
        logger.error("No generation lock found for trip %s", trip_id)
        return

    job_id = lock["jobId"]
    _update_status(trip_id, job_id, "processing", "Starting generation...", attempt=attempt)

    heartbeat_task = asyncio.create_task(_heartbeat_loop(trip_id, job_id))

    try:
        async for evt in itinerary_service.generate_optimized_itinerary_stream(
            trip_id,
            optimization_mode,
            request_id,
            allow_queue=False,
        ):
            if evt.type in ("phase", "progress"):
                _update_status(
                    trip_id,
                    job_id,
                    "processing",
                    evt.message,
                    phase=evt.phase.value if evt.phase else None,
                    progress=evt.progress,
                    attempt=attempt,
                )
            elif evt.type == "status" and evt.status == StatusValue.COMPLETE:
                _update_status(
                    trip_id,
                    job_id,
                    "complete",
                    "Done",
                    itinerary_version=evt.itinerary_version,
                    attempt=attempt,
                )
                _update_lock_status(trip_id, "complete")
            elif evt.type == "status" and evt.status == StatusValue.ERROR:
                msg = (evt.error or {}).get("userMessage", "Unknown error")
                _update_status(trip_id, job_id, "error", msg, attempt=attempt)
                _update_lock_status(trip_id, "error")
    except Exception as e:
        logger.exception("Worker failed for trip %s", trip_id)
        _update_status(trip_id, job_id, "error", str(e), attempt=attempt)
        _update_lock_status(trip_id, "error")
        raise
    finally:
        heartbeat_task.cancel()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _heartbeat_loop(trip_id: str, job_id: str):
    """Update lock heartbeat every 30 s so stale detection works."""
    while True:
        await asyncio.sleep(30)
        _update_lock_heartbeat(trip_id, job_id)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update_status(
    trip_id: str,
    job_id: str,
    status: str,
    message: str,
    **kwargs,
):
    now = _now()
    item = {
        "tripId": trip_id,
        "itemId": f"__job__{job_id}",
        "jobId": job_id,
        "status": status,
        "message": message,
        "updatedAt": now,
        "lastHeartbeatAt": now,
        "workerAttempt": kwargs.get("attempt", 1),
    }
    if kwargs.get("phase"):
        item["phase"] = kwargs["phase"]
    if kwargs.get("progress"):
        item["progress"] = kwargs["progress"]
    if kwargs.get("itinerary_version") is not None:
        item["itineraryVersion"] = kwargs["itinerary_version"]
        item["completedAt"] = now
    if status == "error":
        item["error"] = {"code": "INTERNAL_ERROR", "userMessage": message}
    itinerary_repo.put_item(item)


def _update_lock_heartbeat(trip_id: str, job_id: str):
    now = _now()
    lock = itinerary_repo.get_generation_lock(trip_id)
    if lock:
        lock["lastHeartbeatAt"] = now
        itinerary_repo.put_item(lock)


def _update_lock_status(trip_id: str, status: str):
    now = _now()
    lock = itinerary_repo.get_generation_lock(trip_id)
    if lock:
        lock["status"] = status
        lock["updatedAt"] = now
        itinerary_repo.put_item(lock)
