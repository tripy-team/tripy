import json
from ..utils.errors import response, ApiError
from ..utils.auth import get_user_id_from_event
from ..services import destination_service


def handler(event, context):
    try:
        path = event.get("rawPath", "")
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        user_id = get_user_id_from_event(event)
        body = json.loads(event.get("body") or "{}")

        if path.endswith("/destinations/add") and method == "POST":
            item = destination_service.add_destination(
                body["trip_id"],
                user_id,
                body["name"],
                bool(body.get("must_include", False)),
                bool(body.get("excluded", False)),
                is_start=bool(body.get("is_start", False)),
                is_end=bool(body.get("is_end", False)),
            )
            return response(200, item)

        if path.endswith("/destinations/list") and method == "POST":
            items = destination_service.list_destinations(body["trip_id"])
            return response(
                200,
                {
                    "destinations": items,
                    "scores": destination_service.scores(body["trip_id"])["scores"],
                },
            )

        if path.endswith("/destinations/vote") and method == "POST":
            v = destination_service.cast_vote(
                body["trip_id"], body["destination_id"], user_id, int(body["vote"])
            )
            return response(200, v)

        return response(404, {"error": "Not found"})
    except ApiError as e:
        return response(e.status_code, {"error": e.message})
