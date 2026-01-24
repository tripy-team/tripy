import json
from ..utils.errors import response, ApiError
from ..utils.auth import get_user_id_from_event
from ..services import trip_service


def handler(event, context):
    try:
        path = event.get("rawPath", "")
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        user_id = get_user_id_from_event(event)
        body = json.loads(event.get("body") or "{}")

        if path.endswith("/trips") and method == "POST":
            trip = trip_service.create_trip(
                user_id,
                body["title"],
                body["start_date"],
                body["end_date"],
                include_hotels=body.get("include_hotels", True),
                max_budget=body.get("max_budget"),
                duration_days=body.get("duration_days"),
            )
            return response(200, trip)

        if path.endswith("/trips/get") and method == "POST":
            trip = trip_service.get_trip(body["trip_id"])
            return response(200, trip or {"error": "Not found"})

        if path.endswith("/trips/invite") and method == "POST":
            trip = trip_service.get_trip(body["trip_id"])
            if not trip:
                return response(404, {"error": "Trip not found"})
            return response(200, {"inviteCode": trip["inviteCode"]})

        return response(404, {"error": "Not found"})
    except ApiError as e:
        return response(e.status_code, {"error": e.message})
