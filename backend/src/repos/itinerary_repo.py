import logging
from typing import Dict, Any, List, Optional
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key
from src.config import ITINERARY_TABLE
from .ddb import table, sanitize_for_dynamodb

logger = logging.getLogger(__name__)
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


def get_item(trip_id: str, item_id: str) -> Optional[Dict[str, Any]]:
    resp = t.get_item(Key={"tripId": trip_id, "itemId": item_id})
    return resp.get("Item")


# ---------------------------------------------------------------------------
# Generation lock & job helpers
# ---------------------------------------------------------------------------

def put_item_conditional(
    item: Dict[str, Any],
    condition_expression: str,
    expression_names: Optional[Dict[str, str]] = None,
    expression_values: Optional[Dict[str, Any]] = None,
) -> bool:
    """Write item only if condition is met. Returns False on ConditionalCheckFailedException."""
    try:
        kwargs: Dict[str, Any] = {
            "Item": sanitize_for_dynamodb(item),
            "ConditionExpression": condition_expression,
        }
        if expression_names:
            kwargs["ExpressionAttributeNames"] = expression_names
        if expression_values:
            kwargs["ExpressionAttributeValues"] = sanitize_for_dynamodb(expression_values)
        t.put_item(**kwargs)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return False
        raise


def get_generation_lock(trip_id: str) -> Optional[Dict[str, Any]]:
    return get_item(trip_id, "__generation_lock__")


def get_job_status(trip_id: str, job_id: str) -> Optional[Dict[str, Any]]:
    return get_item(trip_id, f"__job__{job_id}")


def get_latest_job(trip_id: str) -> Optional[Dict[str, Any]]:
    """Read the generation lock to find the current jobId, then fetch that job's status."""
    lock = get_generation_lock(trip_id)
    if not lock or "jobId" not in lock:
        return None
    return get_job_status(trip_id, lock["jobId"])
