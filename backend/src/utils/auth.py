from typing import Dict, Any
from .errors import ApiError


def get_bearer_token(event: Dict[str, Any]) -> str:
    headers = event.get("headers") or {}
    auth = headers.get("authorization") or headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        raise ApiError(401, "Missing or invalid Authorization header")
    return auth.split(" ", 1)[1].strip()


def get_user_id_from_event(event: Dict[str, Any]) -> str:
    # For MVP, assume API Gateway JWT authorizer populates requestContext.authorizer.jwt.claims.sub
    # If you switch authorizers, update this.
    ctx = event.get("requestContext") or {}
    auth = ctx.get("authorizer") or {}
    jwt = auth.get("jwt") or {}
    claims = jwt.get("claims") or {}
    user_id = claims.get("sub")
    if not user_id:
        raise ApiError(401, "Unauthorized: missing user identity")
    return user_id
