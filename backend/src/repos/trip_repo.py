import logging
from typing import Optional, Dict, Any, List
from botocore.exceptions import ClientError
from src.config import TRIPS_TABLE
from .ddb import table, get_item, put_item, query_gsi, delete_item, sanitize_for_dynamodb

logger = logging.getLogger(__name__)
t = table(TRIPS_TABLE)


def get_trip(trip_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"tripId": trip_id})


def put_trip(trip: Dict[str, Any]) -> None:
    put_item(t, trip)


def get_trip_by_invite_code(invite_code: str) -> Optional[Dict[str, Any]]:
    items = query_gsi(t, "inviteCode-index", "inviteCode", invite_code)
    return items[0] if items else None


def delete_trip(trip_id: str) -> bool:
    """Delete a trip by ID"""
    try:
        delete_item(t, {"tripId": trip_id})
        return True
    except Exception as e:
        print(f"Error deleting trip {trip_id}: {e}")
        return False


def increment_itinerary_version(trip_id: str, current_version: int = 0) -> int:
    """Atomically increment itineraryVersion on the trip record.
    Returns the new version on success, raises on conflict."""
    try:
        resp = t.update_item(
            Key={"tripId": trip_id},
            UpdateExpression=(
                "SET itineraryVersion = if_not_exists(itineraryVersion, :zero) + :one, "
                "optimizationGenerated = :t"
            ),
            ConditionExpression=(
                "attribute_not_exists(itineraryVersion) OR itineraryVersion = :current"
            ),
            ExpressionAttributeValues=sanitize_for_dynamodb({
                ":zero": 0,
                ":one": 1,
                ":current": current_version,
                ":t": True,
            }),
            ReturnValues="ALL_NEW",
        )
        new_version = int(resp.get("Attributes", {}).get("itineraryVersion", current_version + 1))
        return new_version
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            logger.warning("itineraryVersion conflict for trip %s (expected %d)", trip_id, current_version)
            raise
        raise
