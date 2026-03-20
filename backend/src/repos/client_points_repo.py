from typing import Dict, Any, List
from boto3.dynamodb.conditions import Key
from src.config import CLIENT_POINTS_TABLE
from .ddb import table, put_item, delete_item, sanitize_for_dynamodb
import logging

logger = logging.getLogger(__name__)

t = table(CLIENT_POINTS_TABLE)


def _pk(org_id: str, client_id: str) -> str:
    return f"{org_id}#{client_id}"


def upsert_point(org_id: str, client_id: str, item: Dict[str, Any]) -> None:
    item["orgClientId"] = _pk(org_id, client_id)
    put_item(t, sanitize_for_dynamodb(item))


def list_points(org_id: str, client_id: str) -> List[Dict[str, Any]]:
    resp = t.query(
        KeyConditionExpression=Key("orgClientId").eq(_pk(org_id, client_id))
    )
    return resp.get("Items", [])


def delete_point(org_id: str, client_id: str, program: str) -> None:
    delete_item(t, {"orgClientId": _pk(org_id, client_id), "program": program})


def replace_all_points(
    org_id: str, client_id: str, points: List[Dict[str, Any]]
) -> None:
    """Full replacement: delete all existing, write new set."""
    existing = list_points(org_id, client_id)
    pk = _pk(org_id, client_id)
    for old in existing:
        delete_item(t, {"orgClientId": pk, "program": old["program"]})
    for item in points:
        item["orgClientId"] = pk
        put_item(t, sanitize_for_dynamodb(item))
