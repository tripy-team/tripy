from dataclasses import dataclass
from typing import Any, Dict


@dataclass
class ApiError(Exception):
    status_code: int
    message: str


def response(status_code: int, body: Any) -> Dict[str, Any]:
    import json

    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
