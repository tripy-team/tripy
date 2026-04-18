"""Async job helpers for /solo/optimize.

The live backend runs on AWS App Runner (not Lambda+SQS), so jobs are
dispatched via FastAPI's BackgroundTasks — the long-running optimization
runs in the same process after the HTTP response is returned. Job status
is persisted to ITINERARY_TABLE (itemIds `__solo_opt_lock__` per trip and
`__solo_opt_job__{jobId}` per job) so the frontend can poll it via
GET /solo/optimize/jobs/{trip_id}/{job_id}.

Why this works: App Runner's 120s request timeout is what surfaces as the
user-facing 504 today. By kicking the work into a BackgroundTask the
initial request returns in <1s — and the worker runs to completion (the
App Runner instance stays alive across requests).
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks

from ..config import SOLO_OPTIMIZE_LOCK_STALE_SECONDS
from ..repos import itinerary_repo

logger = logging.getLogger(__name__)

LOCK_ITEM_ID = "__solo_opt_lock__"
JOB_ITEM_PREFIX = "__solo_opt_job__"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _job_item_id(job_id: str) -> str:
    return f"{JOB_ITEM_PREFIX}{job_id}"


def get_lock(trip_id: str) -> Optional[Dict[str, Any]]:
    return itinerary_repo.get_item(trip_id, LOCK_ITEM_ID)


def get_job(trip_id: str, job_id: str) -> Optional[Dict[str, Any]]:
    return itinerary_repo.get_item(trip_id, _job_item_id(job_id))


def get_active_job_for_cache_key(
    trip_id: str, cache_key: str
) -> Optional[Dict[str, Any]]:
    """If a job is already running for this (trip, cache_key), return its record.

    Used to dedupe duplicate refresh clicks — a second click reuses the
    first job instead of kicking off a parallel background task.
    """
    lock = get_lock(trip_id)
    if not lock or lock.get("cacheKey") != cache_key:
        return None
    if lock.get("status") not in ("queued", "processing"):
        return None
    stale_threshold = datetime.now(timezone.utc) - timedelta(
        seconds=SOLO_OPTIMIZE_LOCK_STALE_SECONDS
    )
    heartbeat = lock.get("lastHeartbeatAt")
    if heartbeat:
        try:
            hb_dt = datetime.fromisoformat(heartbeat.replace("Z", "+00:00"))
            if hb_dt < stale_threshold:
                return None
        except (ValueError, TypeError):
            return None
    job_id = lock.get("jobId")
    if not job_id:
        return None
    return get_job(trip_id, job_id)


def enqueue_job(
    trip_id: str,
    user_id: str,
    cache_key: str,
    request_payload: Dict[str, Any],
    background_tasks: BackgroundTasks,
) -> str:
    """Acquire a lock, schedule the background task, and return the job_id."""
    job_id = str(uuid.uuid4())
    now = _now_iso()
    stale_threshold = (
        datetime.now(timezone.utc)
        - timedelta(seconds=SOLO_OPTIMIZE_LOCK_STALE_SECONDS)
    ).isoformat()

    lock_item = {
        "tripId": trip_id,
        "itemId": LOCK_ITEM_ID,
        "jobId": job_id,
        "cacheKey": cache_key,
        "status": "queued",
        "createdAt": now,
        "lastHeartbeatAt": now,
    }
    acquired = itinerary_repo.put_item_conditional(
        lock_item,
        "attribute_not_exists(itemId) OR #s IN (:complete, :error) OR lastHeartbeatAt < :stale",
        {"#s": "status"},
        {":complete": "complete", ":error": "error", ":stale": stale_threshold},
    )
    if not acquired:
        existing = get_lock(trip_id)
        if existing and existing.get("status") in ("queued", "processing"):
            logger.info(
                "[solo_optimize_jobs] Lock already held for trip %s by job %s",
                trip_id,
                existing.get("jobId"),
            )
            return existing.get("jobId") or job_id

    job_item = {
        "tripId": trip_id,
        "itemId": _job_item_id(job_id),
        "jobId": job_id,
        "cacheKey": cache_key,
        "status": "queued",
        "createdAt": now,
        "updatedAt": now,
    }
    itinerary_repo.put_item(job_item)

    # Deferred import to avoid circular: worker imports the routes module
    # which imports services (including this file) during FastAPI startup.
    from ..workers.solo_optimize_worker import run_solo_optimize_job

    background_tasks.add_task(
        run_solo_optimize_job,
        trip_id=trip_id,
        user_id=user_id,
        job_id=job_id,
        cache_key=cache_key,
        request_payload=request_payload,
    )
    logger.info(
        "[solo_optimize_jobs] Scheduled job %s for trip %s (in-process)",
        job_id,
        trip_id,
    )
    return job_id


def update_job_status(
    trip_id: str,
    job_id: str,
    status: str,
    message: Optional[str] = None,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[Dict[str, Any]] = None,
) -> None:
    """Update a job row. Status is one of queued|processing|complete|error."""
    now = _now_iso()
    job = get_job(trip_id, job_id) or {
        "tripId": trip_id,
        "itemId": _job_item_id(job_id),
        "jobId": job_id,
        "createdAt": now,
    }
    job["status"] = status
    job["updatedAt"] = now
    if message is not None:
        job["message"] = message
    if result is not None:
        job["result"] = result
    if error is not None:
        job["error"] = error
    if status == "complete":
        job["completedAt"] = now
    itinerary_repo.put_item(job)

    lock = get_lock(trip_id)
    if lock and lock.get("jobId") == job_id:
        lock["status"] = status
        lock["lastHeartbeatAt"] = now
        itinerary_repo.put_item(lock)


def heartbeat(trip_id: str, job_id: str) -> None:
    """Refresh the lock's lastHeartbeatAt so stale detection doesn't kick in."""
    now = _now_iso()
    lock = get_lock(trip_id)
    if lock and lock.get("jobId") == job_id:
        lock["lastHeartbeatAt"] = now
        itinerary_repo.put_item(lock)
