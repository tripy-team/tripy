from typing import Dict, Any, List
from boto3.dynamodb.conditions import Key
from src.config import ITINERARY_TABLE
from .ddb import table, sanitize_for_dynamodb

t = table(ITINERARY_TABLE)


def put_item(item: Dict[str, Any]) -> None:
    t.put_item(Item=sanitize_for_dynamodb(item))


def batch_write_items(items: List[Dict[str, Any]]) -> None:
    """Write multiple items in batches (up to 25 per batch). Automatically retries failed items."""
    if not items:
        return
    with t.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=sanitize_for_dynamodb(item))


def list_items(trip_id: str) -> List[Dict[str, Any]]:
    resp = t.query(KeyConditionExpression=Key("tripId").eq(trip_id))
    return resp.get("Items", [])
