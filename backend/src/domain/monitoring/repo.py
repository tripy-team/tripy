"""
DynamoDB repository layer for the monitoring feature.

Handles all database operations: subscriptions, baselines, updates, rate limits.
Uses the same boto3 resource pattern as src/repos/ddb.py.
"""
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from botocore.exceptions import ClientError

from src.repos.ddb import ddb, sanitize_for_dynamodb, table
from src.config.monitoring import (
    DUE_INDEX_SHARD_COUNT,
    MONITORING_TABLE_BASELINES,
    MONITORING_TABLE_SUBSCRIPTIONS,
    MONITORING_TABLE_UPDATES,
    RATE_LIMIT_TABLE,
)

logger = logging.getLogger(__name__)

# We also need the boto3 client (not resource) for TransactWriteItems
import boto3
_ddb_client = boto3.client("dynamodb")


# =============================================================================
# TABLE ACCESSORS
# =============================================================================

def _subs_table():
    return table(MONITORING_TABLE_SUBSCRIPTIONS)


def _baselines_table():
    return table(MONITORING_TABLE_BASELINES)


def _updates_table():
    return table(MONITORING_TABLE_UPDATES)


def _rate_limit_table():
    return table(RATE_LIMIT_TABLE)


# =============================================================================
# SUBSCRIPTIONS
# =============================================================================

def get_subscription(subscription_id: str) -> Optional[Dict[str, Any]]:
    """Get a subscription by PK. Returns None if not found or if it's a lock item."""
    try:
        resp = _subs_table().get_item(Key={"subscription_id": subscription_id})
        item = resp.get("Item")
        if item and item.get("entity_type") == "lock":
            return None  # Never return lock items as subscriptions
        return item
    except ClientError as e:
        logger.error(f"get_subscription error: {e}")
        return None


def get_lock_item(lock_pk: str) -> Optional[Dict[str, Any]]:
    """Get a lock item by PK. Used for conflict resolution on race conditions."""
    try:
        resp = _subs_table().get_item(Key={"subscription_id": lock_pk})
        return resp.get("Item")
    except ClientError as e:
        logger.error(f"get_lock_item error: {e}")
        return None


def query_by_trip_email_key(trip_email_key: str) -> List[Dict[str, Any]]:
    """Query subscriptions by trip_email_key (GSI). Filters out lock items."""
    try:
        from boto3.dynamodb.conditions import Key
        resp = _subs_table().query(
            IndexName="trip-email-index",
            KeyConditionExpression=Key("trip_email_key").eq(trip_email_key),
        )
        items = resp.get("Items", [])
        return [i for i in items if i.get("entity_type") != "lock"]
    except ClientError as e:
        logger.error(f"query_by_trip_email_key error: {e}")
        return []


def query_by_user_id(user_id: str) -> List[Dict[str, Any]]:
    """Query all subscriptions for a user. Filters out lock items."""
    try:
        from boto3.dynamodb.conditions import Key
        resp = _subs_table().query(
            IndexName="user-index",
            KeyConditionExpression=Key("user_id").eq(user_id),
        )
        items = resp.get("Items", [])
        return [i for i in items if i.get("entity_type") != "lock"]
    except ClientError as e:
        logger.error(f"query_by_user_id error: {e}")
        return []


def query_by_trip_id(trip_id: str) -> List[Dict[str, Any]]:
    """Query all subscriptions for a trip. Filters out lock items."""
    try:
        from boto3.dynamodb.conditions import Key
        resp = _subs_table().query(
            IndexName="trip-index",
            KeyConditionExpression=Key("trip_id").eq(trip_id),
        )
        items = resp.get("Items", [])
        return [i for i in items if i.get("entity_type") != "lock"]
    except ClientError as e:
        logger.error(f"query_by_trip_id error: {e}")
        return []


def query_due_subscriptions(now_iso: str) -> List[Dict[str, Any]]:
    """
    Query all active subscriptions due for checking across all shard buckets.
    Returns subscriptions where state_bucket starts with 'active#' and next_check_at <= now.
    """
    from boto3.dynamodb.conditions import Key
    results = []
    for shard in range(DUE_INDEX_SHARD_COUNT):
        bucket = f"active#{shard}"
        try:
            resp = _subs_table().query(
                IndexName="due-index",
                KeyConditionExpression=(
                    Key("state_bucket").eq(bucket)
                    & Key("next_check_at").lte(now_iso)
                ),
            )
            items = resp.get("Items", [])
            results.extend([i for i in items if i.get("entity_type") != "lock"])
        except ClientError as e:
            logger.error(f"query_due_subscriptions error for bucket {bucket}: {e}")
    return results


def put_subscription_transact_with_lock(
    sub_item: Dict[str, Any],
    lock_item: Dict[str, Any],
) -> None:
    """
    Atomically create a subscription + lock item using TransactWriteItems.
    The lock item's conditional expression enforces (trip_id, email) uniqueness.
    Treats expired locks (lock_expires_at < now) as absent to prevent stale orphans.
    Raises TransactionCanceledException if another request won the race.
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    # Ensure lock item has lock_expires_at (24 hours from now)
    from datetime import timedelta
    lock_item["lock_expires_at"] = (
        datetime.now(timezone.utc) + timedelta(hours=24)
    ).isoformat()

    _ddb_client.transact_write_items(
        TransactItems=[
            {
                "Put": {
                    "TableName": MONITORING_TABLE_SUBSCRIPTIONS,
                    "Item": _serialize_for_client(lock_item),
                    "ConditionExpression":
                        "attribute_not_exists(subscription_id) OR "
                        "#state IN (:cancelled, :expired) OR "
                        "lock_expires_at < :now",
                    "ExpressionAttributeNames": {"#state": "state"},
                    "ExpressionAttributeValues": {
                        ":cancelled": {"S": "cancelled"},
                        ":expired": {"S": "expired"},
                        ":now": {"S": now_iso},
                    },
                },
            },
            {
                "Put": {
                    "TableName": MONITORING_TABLE_SUBSCRIPTIONS,
                    "Item": _serialize_for_client(sub_item),
                },
            },
        ],
    )


def update_subscription_state_transact(
    subscription_id: str,
    lock_pk: str,
    new_state: str,
    new_bucket: str,
    next_check_at: str,
    **extra_fields,
) -> None:
    """
    Atomically update both the subscription and its lock item's state.
    On cancel/expire: sets lock_expires_at = now to free the lock immediately.
    """
    now = datetime.now(timezone.utc).isoformat()

    # Build update expression for extra fields
    update_parts = [
        "#state = :state",
        "state_bucket = :bucket",
        "next_check_at = :nca",
        "updated_at = :now",
    ]
    attr_names = {"#state": "state"}
    attr_values = {
        ":state": {"S": new_state},
        ":bucket": {"S": new_bucket},
        ":nca": {"S": next_check_at},
        ":now": {"S": now},
    }

    for key, val in extra_fields.items():
        placeholder = f":{key}"
        update_parts.append(f"{key} = {placeholder}")
        attr_values[placeholder] = _to_ddb_attr(val)

    # On cancel/expire: set lock_expires_at = now to free it immediately
    # On other transitions: refresh lock_expires_at to 24h from now
    if new_state in ("cancelled", "expired"):
        lock_expires_at = now
    else:
        from datetime import timedelta
        lock_expires_at = (
            datetime.now(timezone.utc) + timedelta(hours=24)
        ).isoformat()

    _ddb_client.transact_write_items(
        TransactItems=[
            {
                "Update": {
                    "TableName": MONITORING_TABLE_SUBSCRIPTIONS,
                    "Key": {"subscription_id": {"S": subscription_id}},
                    "UpdateExpression": "SET " + ", ".join(update_parts),
                    "ExpressionAttributeNames": attr_names,
                    "ExpressionAttributeValues": attr_values,
                },
            },
            {
                "Update": {
                    "TableName": MONITORING_TABLE_SUBSCRIPTIONS,
                    "Key": {"subscription_id": {"S": lock_pk}},
                    "UpdateExpression": "SET #state = :state, updated_at = :now, lock_expires_at = :lock_exp",
                    "ExpressionAttributeNames": {"#state": "state"},
                    "ExpressionAttributeValues": {
                        ":state": {"S": new_state},
                        ":now": {"S": now},
                        ":lock_exp": {"S": lock_expires_at},
                    },
                },
            },
        ],
    )


def refresh_lock_expiry(lock_pk: str) -> None:
    """
    Heartbeat: extend lock_expires_at by 24 hours.
    Called during cron processing to keep locks alive for active subscriptions.
    """
    from datetime import timedelta
    new_expiry = (
        datetime.now(timezone.utc) + timedelta(hours=24)
    ).isoformat()
    try:
        _subs_table().update_item(
            Key={"subscription_id": lock_pk},
            UpdateExpression="SET lock_expires_at = :exp",
            ExpressionAttributeValues=sanitize_for_dynamodb({":exp": new_expiry}),
        )
    except ClientError as e:
        logger.warning(f"refresh_lock_expiry failed for {lock_pk}: {e}")


def update_subscription_fields(subscription_id: str, **fields) -> None:
    """Update arbitrary fields on a subscription (non-transactional, for cron updates)."""
    if not fields:
        return
    update_parts = []
    attr_names = {}
    attr_values = {}
    for i, (key, val) in enumerate(fields.items()):
        placeholder = f":v{i}"
        name_placeholder = f"#k{i}"
        update_parts.append(f"{name_placeholder} = {placeholder}")
        attr_names[name_placeholder] = key
        attr_values[placeholder] = val

    _subs_table().update_item(
        Key={"subscription_id": subscription_id},
        UpdateExpression="SET " + ", ".join(update_parts),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=sanitize_for_dynamodb(attr_values),
    )


# =============================================================================
# BASELINES
# =============================================================================

def put_baseline(baseline_item: Dict[str, Any]) -> None:
    """Store a baseline snapshot."""
    _baselines_table().put_item(Item=sanitize_for_dynamodb(baseline_item))


def get_baseline(baseline_id: str) -> Optional[Dict[str, Any]]:
    """Get a baseline by ID."""
    try:
        resp = _baselines_table().get_item(Key={"baseline_id": baseline_id})
        return resp.get("Item")
    except ClientError as e:
        logger.error(f"get_baseline error: {e}")
        return None


# =============================================================================
# UPDATE RECORDS
# =============================================================================

def put_update(update_item: Dict[str, Any]) -> None:
    """Store a monitoring update record."""
    _updates_table().put_item(Item=sanitize_for_dynamodb(update_item))


def get_update(update_id: str) -> Optional[Dict[str, Any]]:
    """Get an update record by ID."""
    try:
        resp = _updates_table().get_item(Key={"update_id": update_id})
        return resp.get("Item")
    except ClientError as e:
        logger.error(f"get_update error: {e}")
        return None


def update_update_fields(update_id: str, **fields) -> None:
    """Update fields on an update record (e.g., email_status)."""
    if not fields:
        return
    update_parts = []
    attr_names = {}
    attr_values = {}
    for i, (key, val) in enumerate(fields.items()):
        placeholder = f":v{i}"
        name_placeholder = f"#k{i}"
        update_parts.append(f"{name_placeholder} = {placeholder}")
        attr_names[name_placeholder] = key
        attr_values[placeholder] = val

    _updates_table().update_item(
        Key={"update_id": update_id},
        UpdateExpression="SET " + ", ".join(update_parts),
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=sanitize_for_dynamodb(attr_values),
    )


def query_updates_by_subscription(subscription_id: str) -> List[Dict[str, Any]]:
    """Get all updates for a subscription (sorted by detected_at)."""
    try:
        from boto3.dynamodb.conditions import Key
        resp = _updates_table().query(
            IndexName="sub-index",
            KeyConditionExpression=Key("subscription_id").eq(subscription_id),
        )
        return resp.get("Items", [])
    except ClientError as e:
        logger.error(f"query_updates_by_subscription error: {e}")
        return []


# =============================================================================
# RATE LIMITING (DynamoDB TTL-based counters)
# =============================================================================

def check_rate_limit(scope_key: str, window_seconds: int, max_count: int) -> bool:
    """
    Increment a rate limit counter and check if the limit is exceeded.
    Returns True if the request is ALLOWED, False if rate limited.

    Uses DynamoDB TTL for auto-cleanup. Each counter item:
    - PK: scope_key (e.g., "start:ip:abc123" or "resend:email:user@example.com")
    - count: atomic counter
    - ttl: auto-expire after window_seconds
    """
    now = int(time.time())
    ttl_value = now + window_seconds

    try:
        resp = _rate_limit_table().update_item(
            Key={"pk": scope_key},
            UpdateExpression="SET #count = if_not_exists(#count, :zero) + :one, #ttl = if_not_exists(#ttl, :ttl)",
            ExpressionAttributeNames={"#count": "count", "#ttl": "ttl"},
            ExpressionAttributeValues=sanitize_for_dynamodb({
                ":zero": 0,
                ":one": 1,
                ":ttl": ttl_value,
            }),
            ReturnValues="ALL_NEW",
        )
        new_count = int(resp["Attributes"]["count"])
        return new_count <= max_count
    except ClientError as e:
        logger.error(f"check_rate_limit error for {scope_key}: {e}")
        return True  # fail open on error (don't block users due to rate limit failures)


# =============================================================================
# HELPERS
# =============================================================================

def _serialize_for_client(item: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    """Convert a plain dict to DynamoDB client (not resource) format: {"field": {"S": "value"}}."""
    result = {}
    for key, val in item.items():
        if val is None:
            continue  # skip None values
        if isinstance(val, str):
            result[key] = {"S": val}
        elif isinstance(val, (int, float, Decimal)):
            result[key] = {"N": str(val)}
        elif isinstance(val, bool):
            result[key] = {"BOOL": val}
        elif isinstance(val, dict):
            import json
            result[key] = {"S": json.dumps(val)}
        elif isinstance(val, list):
            import json
            result[key] = {"S": json.dumps(val)}
        else:
            result[key] = {"S": str(val)}
    return result


def _to_ddb_attr(val: Any) -> Dict[str, str]:
    """Convert a Python value to a single DynamoDB attribute value."""
    if val is None:
        return {"NULL": True}
    if isinstance(val, str):
        return {"S": val}
    if isinstance(val, (int, float, Decimal)):
        return {"N": str(val)}
    if isinstance(val, bool):
        return {"BOOL": val}
    return {"S": str(val)}
