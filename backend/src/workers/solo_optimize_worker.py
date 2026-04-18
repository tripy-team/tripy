"""Background worker for async /solo/optimize refresh (App Runner).

Runs inside the same App Runner process as the API, scheduled via FastAPI
BackgroundTasks. Persists progress + results to ITINERARY_TABLE so the
frontend can poll status via GET /solo/optimize/jobs/{trip_id}/{job_id}.
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def run_solo_optimize_job(
    trip_id: str,
    user_id: str,
    job_id: str,
    cache_key: str,
    request_payload: dict,
) -> None:
    # Deferred imports avoid circular deps on module load.
    from src.schemas.optimize import OptimizeSoloRequest
    from src.services import solo_optimize_jobs, solo_trip_service
    from src.routes.solo import _run_orchestration_and_cache

    logger.info(
        "[solo_optimize_worker] Processing job %s for trip %s", job_id, trip_id
    )
    solo_optimize_jobs.update_job_status(
        trip_id, job_id, "processing", message="Running optimization..."
    )

    heartbeat_task = asyncio.create_task(_heartbeat_loop(trip_id, job_id))

    try:
        trip = solo_trip_service.get_solo_trip(trip_id)
        if not trip:
            solo_optimize_jobs.update_job_status(
                trip_id,
                job_id,
                "error",
                error={"code": "TRIP_NOT_FOUND", "userMessage": "Trip not found"},
            )
            return

        request = OptimizeSoloRequest(**request_payload)
        mode = request.optimization_mode_override or trip.get(
            "optimizationMode", "balanced"
        )

        await _run_orchestration_and_cache(trip, user_id, request, mode, cache_key)

        solo_optimize_jobs.update_job_status(
            trip_id, job_id, "complete", message="Optimization complete"
        )
        logger.info(
            "[solo_optimize_worker] Job %s complete for trip %s", job_id, trip_id
        )
    except Exception as e:
        logger.exception("[solo_optimize_worker] Job %s failed", job_id)
        solo_optimize_jobs.update_job_status(
            trip_id,
            job_id,
            "error",
            error={"code": "INTERNAL_ERROR", "userMessage": str(e)},
        )
    finally:
        heartbeat_task.cancel()


async def _heartbeat_loop(trip_id: str, job_id: str) -> None:
    from src.services import solo_optimize_jobs

    while True:
        await asyncio.sleep(30)
        try:
            solo_optimize_jobs.heartbeat(trip_id, job_id)
        except Exception:
            logger.warning(
                "[solo_optimize_worker] Heartbeat failed for job %s",
                job_id,
                exc_info=True,
            )
