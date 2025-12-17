import json
from ..utils.errors import response, ApiError
from ..utils.auth import get_user_id_from_event
from ..services import trip_member_service


def handler(event, context):
    try:
        path = event.get("rawPath", "")
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        user_id = get_user_id_from_event(event)
        body = json.loads(event.get("body") or "{}")

        if path.endswith("/trips/join") and method == "POST":
            out = trip_member_service.join_trip(user_id, body["invite_code"])
            return response(200, out)

        if path.endswith("/trips/members") and method == "POST":
            members = trip_member_service.list_members(body["trip_id"])
            return response(200, {"members": members})

        return response(404, {"error": "Not found"})
    except ApiError as e:
        return response(e.status_code, {"error": e.message})
