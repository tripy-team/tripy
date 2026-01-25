import json
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

        if path.endswith("/itinerary/generate") and method == "POST":
            trip_id = body["trip_id"]
            # Use the main itinerary generation which provides real flight data
            # NO FALLBACKS - explicit errors with actionable guidance
            try:
                result = itinerary_service.generate_optimized_itinerary_sync(trip_id)
                return response(200, result)
            except ValueError as e:
                logger.warning(f"Itinerary generation failed: {e}")
                return response(400, {
                    "error": str(e),
                    "error_code": "GENERATION_FAILED",
                    "user_actions": [
                        {
                            "action_type": "change_dates",
                            "title": "Try Different Dates",
                            "description": "Flight availability varies by date"
                        },
                        {
                            "action_type": "increase_budget", 
                            "title": "Increase Budget",
                            "description": "Your budget may be too low"
                        }
                    ]
                })

        if path.endswith("/itinerary/get") and method == "POST":
            items = itinerary_service.get_itinerary(body["trip_id"])
            return response(200, {"items": items})

        return response(404, {"error": "Not found"})
    except ApiError as e:
        return response(e.status_code, {"error": e.message})
