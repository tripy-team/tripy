from typing import Optional, Dict, Any, List
from boto3.dynamodb.conditions import Key
from src.config import ORG_MEMBERS_TABLE
from .ddb import table, get_item, put_item, delete_item, query_gsi, sanitize_for_dynamodb
import logging

logger = logging.getLogger(__name__)

t = table(ORG_MEMBERS_TABLE)


def get_member(org_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"orgId": org_id, "userId": user_id})


def add_member(member: Dict[str, Any]) -> None:
    put_item(t, sanitize_for_dynamodb(member))


def remove_member(org_id: str, user_id: str) -> None:
    delete_item(t, {"orgId": org_id, "userId": user_id})


def list_members(org_id: str) -> List[Dict[str, Any]]:
    resp = t.query(KeyConditionExpression=Key("orgId").eq(org_id))
    return resp.get("Items", [])


def get_orgs_for_user(user_id: str) -> List[Dict[str, Any]]:
    """Find all org memberships for a given userId via GSI."""
    return query_gsi(t, "userId-index", "userId", user_id)
