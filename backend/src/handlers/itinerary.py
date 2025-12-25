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
            destinations = destination_service.list_destinations(trip_id)
            routes = route_service.generate_routes(destinations)
            saved = itinerary_service.save_itinerary(
                trip_id, routes[0] if routes else []
            )
            return response(200, {"routes": routes, "saved": saved})

        if path.endswith("/itinerary/get") and method == "POST":
            items = itinerary_service.get_itinerary(body["trip_id"])
            return response(200, {"items": items})

        return response(404, {"error": "Not found"})
    except ApiError as e:
        return response(e.status_code, {"error": e.message})
