from typing import Optional, Dict, Any, List
from boto3.dynamodb.conditions import Key
from src.config import CLIENTS_TABLE
from .ddb import table, get_item, put_item, delete_item, sanitize_for_dynamodb
import logging

logger = logging.getLogger(__name__)

t = table(CLIENTS_TABLE)


def get_client(org_id: str, client_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"orgId": org_id, "clientId": client_id})


def create_client(client: Dict[str, Any]) -> None:
    put_item(t, sanitize_for_dynamodb(client))


def update_client(org_id: str, client_id: str, updates: Dict[str, Any]) -> None:
    expr_parts = []
    attr_values = {}
    attr_names = {}

    for i, (key, value) in enumerate(updates.items()):
        placeholder = f":v{i}"
        name_placeholder = f"#k{i}"
        expr_parts.append(f"{name_placeholder} = {placeholder}")
        attr_values[placeholder] = value
        attr_names[name_placeholder] = key

    if not expr_parts:
        return

    t.update_item(
        Key={"orgId": org_id, "clientId": client_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeValues=sanitize_for_dynamodb(attr_values),
        ExpressionAttributeNames=attr_names,
    )


def list_clients(org_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    resp = t.query(
        KeyConditionExpression=Key("orgId").eq(org_id),
        Limit=limit,
    )
    return resp.get("Items", [])


def delete_client(org_id: str, client_id: str) -> None:
    delete_item(t, {"orgId": org_id, "clientId": client_id})
