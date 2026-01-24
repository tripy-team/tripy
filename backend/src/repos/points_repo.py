from typing import Dict, Any, List
from boto3.dynamodb.conditions import Key
from src.config import POINTS_TABLE
from .ddb import table

t = table(POINTS_TABLE)


def upsert_points(trip_id: str, user_program: str, item: Dict[str, Any]) -> None:
    t.put_item(Item=item)


def list_points_for_trip(trip_id: str) -> List[Dict[str, Any]]:
    resp = t.query(KeyConditionExpression=Key("tripId").eq(trip_id))
    return resp.get("Items", [])
