from typing import Dict, Any, List
from boto3.dynamodb.conditions import Key
from src.config import TRIP_MEMBERS_TABLE
from .ddb import table

t = table(TRIP_MEMBERS_TABLE)


def add_member(item: Dict[str, Any]) -> None:
    t.put_item(Item=item)


def list_members(trip_id: str) -> List[Dict[str, Any]]:
    # Use strongly consistent reads to ensure newly added members are visible immediately
    resp = t.query(
        KeyConditionExpression=Key("tripId").eq(trip_id),
        ConsistentRead=True
    )
    return resp.get("Items", [])


def list_trips_for_user(user_id: str) -> List[Dict[str, Any]]:
    resp = t.query(
        IndexName="userId-index",
        KeyConditionExpression=Key("userId").eq(user_id),
    )
    return resp.get("Items", [])


def update_member(trip_id: str, user_id: str, attrs: Dict[str, Any]) -> bool:
    """Update attributes for a member. Returns True if member existed and was updated."""
    items = list_members(trip_id)
    for item in items:
        if item.get("userId") == user_id or item.get("user_id") == user_id:
            merged = {**item, **attrs}
            t.put_item(Item=merged)
            return True
    return False
