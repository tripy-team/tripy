from typing import Dict, Any, List
from boto3.dynamodb.conditions import Key
from src.config import POINTS_TABLE
from .ddb import table, sanitize_for_dynamodb

t = table(POINTS_TABLE)


def upsert_points(trip_id: str, user_program: str, item: Dict[str, Any]) -> None:
    t.put_item(Item=sanitize_for_dynamodb(item))


def list_points_for_trip(trip_id: str) -> List[Dict[str, Any]]:
    resp = t.query(KeyConditionExpression=Key("tripId").eq(trip_id))
    return resp.get("Items", [])
