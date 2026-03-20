from typing import Optional, Dict, Any, List
from src.config import ORGANIZATIONS_TABLE
from .ddb import table, get_item, put_item, sanitize_for_dynamodb
import logging

logger = logging.getLogger(__name__)

t = table(ORGANIZATIONS_TABLE)


def get_org(org_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"orgId": org_id})


def create_org(org: Dict[str, Any]) -> None:
    put_item(t, sanitize_for_dynamodb(org))


def update_org(org_id: str, updates: Dict[str, Any]) -> None:
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
        Key={"orgId": org_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeValues=sanitize_for_dynamodb(attr_values),
        ExpressionAttributeNames=attr_names,
    )
