import json
from ..utils.errors import response, ApiError
from ..utils.auth import get_user_id_from_event
from ..services import user_service


def handler(event, context):
    try:
        path = event.get("rawPath", "")
        method = event.get("requestContext", {}).get("http", {}).get("method", "")

        user_id = get_user_id_from_event(event)

        if path.endswith("/users/me") and method == "GET":
            u = user_service.ensure_user_exists(user_id)
            # Calculate and add cash_saved
            cash_saved = user_service.calculate_cash_saved(user_id)
            u["cash_saved"] = cash_saved
            return response(200, u)

        if path.endswith("/users/profile") and method == "PUT":
            body = json.loads(event.get("body") or "{}")
            user_service.update_profile(user_id, body)
            return response(200, {"ok": True})

        return response(404, {"error": "Not found"})
    except ApiError as e:
        return response(e.status_code, {"error": e.message})
