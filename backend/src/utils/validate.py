from .errors import ApiError


def require_fields(obj: dict, fields: list[str]) -> None:
    for f in fields:
        if f not in obj or obj[f] in (None, ""):
            raise ApiError(400, f"Missing required field: {f}")
