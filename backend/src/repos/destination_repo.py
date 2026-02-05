from typing import Dict, Any, List, Optional
from boto3.dynamodb.conditions import Key
from src.config import DESTINATIONS_TABLE
from .ddb import table

t = table(DESTINATIONS_TABLE)


def add_destination(item: Dict[str, Any]) -> None:
    t.put_item(Item=item)


def list_destinations(trip_id: str) -> List[Dict[str, Any]]:
    resp = t.query(KeyConditionExpression=Key("tripId").eq(trip_id))
    items = resp.get("Items", [])
    # Sort by createdAt so Start (added first), End (second), then waypoints
    # follow insertion order. Items without createdAt sort first ("").
    items.sort(key=lambda x: x.get("createdAt", ""))
    return items


def get_destination(trip_id: str, destination_id: str) -> Optional[Dict[str, Any]]:
    """Get a specific destination by ID."""
    resp = t.get_item(Key={"tripId": trip_id, "destinationId": destination_id})
    return resp.get("Item")


def delete_destination(trip_id: str, destination_id: str) -> bool:
    """Delete a destination. Returns True if deleted."""
    try:
        t.delete_item(Key={"tripId": trip_id, "destinationId": destination_id})
        return True
    except Exception:
        return False


def update_destination(trip_id: str, destination_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update a destination with the given fields. Returns updated item."""
    if not updates:
        return get_destination(trip_id, destination_id)
    
    # Build update expression
    update_expr_parts = []
    expr_attr_values = {}
    expr_attr_names = {}
    
    for key, value in updates.items():
        safe_key = f"#{key}"
        value_key = f":{key}"
        update_expr_parts.append(f"{safe_key} = {value_key}")
        expr_attr_names[safe_key] = key
        expr_attr_values[value_key] = value
    
    update_expr = "SET " + ", ".join(update_expr_parts)
    
    try:
        resp = t.update_item(
            Key={"tripId": trip_id, "destinationId": destination_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values,
            ReturnValues="ALL_NEW"
        )
        return resp.get("Attributes")
    except Exception:
        return None
