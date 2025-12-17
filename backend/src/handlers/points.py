import json
from ..utils.errors import response, ApiError
from ..utils.auth import get_user_id_from_event
from ..services import points_service


def handler(event, context):
    try:
        path = event.get("rawPath", "")
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        user_id = get_user_id_from_event(event)
        body = json.loads(event.get("body") or "{}")

        if path.endswith("/points/upsert") and method == "POST":
            item = points_service.upsert_points(
                body["trip_id"], user_id, body["program"], int(body["balance"])
            )
            return response(200, item)

        if path.endswith("/points/summary") and method == "POST":
            out = points_service.trip_points_summary(body["trip_id"])
            return response(200, out)

        return response(404, {"error": "Not found"})
    except ApiError as e:
        return response(e.status_code, {"error": e.message})
