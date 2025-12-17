from typing import Dict, Any, List
from boto3.dynamodb.conditions import Key
from ..config import DESTINATIONS_TABLE
from .ddb import table

t = table(DESTINATIONS_TABLE)


def add_destination(item: Dict[str, Any]) -> None:
    t.put_item(Item=item)


def list_destinations(trip_id: str) -> List[Dict[str, Any]]:
    resp = t.query(KeyConditionExpression=Key("tripId").eq(trip_id))
    return resp.get("Items", [])
