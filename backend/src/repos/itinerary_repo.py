from typing import Dict, Any, List
from boto3.dynamodb.conditions import Key
from src.config import ITINERARY_TABLE
from .ddb import table

t = table(ITINERARY_TABLE)


def put_item(item: Dict[str, Any]) -> None:
    t.put_item(Item=item)


def list_items(trip_id: str) -> List[Dict[str, Any]]:
    resp = t.query(KeyConditionExpression=Key("tripId").eq(trip_id))
    return resp.get("Items", [])
