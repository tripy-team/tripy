import json
import asyncio
import logging
from ..utils.errors import response, ApiError
from ..utils.auth import get_user_id_from_event
from ..services import destination_service, route_service, itinerary_service

logger = logging.getLogger(__name__)


def handler(event, context):
    try:
        path = event.get("rawPath", "")
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        _user_id = get_user_id_from_event(event)
        body = json.loads(event.get("body") or "{}")
        headers = event.get("headers", {})

        if path.endswith("/itinerary/generate") and method == "POST":
            trip_id = body["trip_id"]
            
            # Check for version override header (X-Itinerary-Version: v1 or v2)
            version = headers.get("x-itinerary-version") or headers.get("X-Itinerary-Version")
            
            # Try v2 itinerary generation (default) with real flight data from APIs
            # (SERP for cash prices, AwardTool for points pricing)
            # Falls back to v1 then simple generator if optimization fails
            try:
                result = asyncio.run(
                    itinerary_service.generate_itinerary_with_version(trip_id, version=version)
                )
                resp = {
                    "status": result.get("status", "Unknown"),
                    "solution": result.get("solution", {}),
                    "items": result.get("items", []),
                }
                if result.get("relaxed_constraints"):
                    resp["relaxed_constraints"] = True
                    resp["relaxed_message"] = result.get("relaxed_message")
                return response(200, resp)
            except ValueError as e:
                # Optimization failed (missing data, infeasible, etc.)
                # Fall back to simple itineraries with placeholder costs
                logger.warning(
                    f"Optimization failed for trip {trip_id}: {e}. "
                    "Falling back to simple itineraries."
                )
                try:
                    items = itinerary_service.generate_simple_itineraries(
                        trip_id, safe_mode=True
                    )
                    return response(200, {
                        "status": "simple_fallback",
                        "solution": {},
                        "items": items,
                        "fallback_reason": "optimization_error",
                        "warning": str(e),
                    })
                except Exception as fallback_err:
                    logger.error(f"Simple itinerary fallback failed: {fallback_err}")
                    fallback_items = itinerary_service._generate_minimal_fallback_itinerary(
                        trip_id, f"All generators failed: {str(fallback_err)}"
                    )
                    return response(200, {
                        "status": "minimal_fallback",
                        "solution": {},
                        "items": fallback_items,
                        "error": str(e),
                    })
            except Exception as e:
                # Unexpected error - fall back to simple itineraries
                logger.error(f"Error generating optimized itinerary: {e}")
                try:
                    items = itinerary_service.generate_simple_itineraries(
                        trip_id, safe_mode=True
                    )
                    return response(200, {
                        "status": "simple_fallback",
                        "solution": {},
                        "items": items,
                        "fallback_reason": "unexpected_error",
                        "warning": str(e),
                    })
                except Exception as fallback_err:
                    logger.error(f"Simple itinerary fallback failed: {fallback_err}")
                    fallback_items = itinerary_service._generate_minimal_fallback_itinerary(
                        trip_id, f"All generators failed: {str(fallback_err)}"
                    )
                    return response(200, {
                        "status": "minimal_fallback",
                        "solution": {},
                        "items": fallback_items,
                        "error": str(e),
                    })

        if path.endswith("/itinerary/get") and method == "POST":
            items = itinerary_service.get_itinerary(body["trip_id"])
            return response(200, {"items": items})

        return response(404, {"error": "Not found"})
    except ApiError as e:
        return response(e.status_code, {"error": e.message})
