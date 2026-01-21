import json
from ..utils.errors import response, ApiError
from ..utils.auth import get_user_id_from_event
from ..services import destination_service, route_service, itinerary_service


def handler(event, context):
    try:
        path = event.get("rawPath", "")
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        _user_id = get_user_id_from_event(event)
        body = json.loads(event.get("body") or "{}")

        if path.endswith("/itinerary/generate") and method == "POST":
            trip_id = body["trip_id"]
            # Lightweight, dependency‑free generator. This avoids any external
            # flight vendors and simply builds reasonable routes from the
            # existing destinations so the frontend can always show options.
            items = itinerary_service.generate_simple_itineraries(trip_id)
            return response(200, {"items": items})

        if path.endswith("/itinerary/get") and method == "POST":
            items = itinerary_service.get_itinerary(body["trip_id"])
            return response(200, {"items": items})

        return response(404, {"error": "Not found"})
    except ApiError as e:
        return response(e.status_code, {"error": e.message})
