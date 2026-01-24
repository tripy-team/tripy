from typing import Dict, Any, List
from boto3.dynamodb.conditions import Key
from src.config import DESTINATION_VOTES_TABLE
from .ddb import table

t = table(DESTINATION_VOTES_TABLE)


def put_vote(item: Dict[str, Any]) -> None:
    t.put_item(Item=item)


def list_votes_for_trip(trip_id: str) -> List[Dict[str, Any]]:
    resp = t.query(KeyConditionExpression=Key("tripId").eq(trip_id))
    return resp.get("Items", [])
