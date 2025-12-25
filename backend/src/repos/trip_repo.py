from typing import Optional, Dict, Any, List
from ..config import TRIPS_TABLE
from .ddb import table, get_item, put_item, query_gsi

t = table(TRIPS_TABLE)


def get_trip(trip_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"tripId": trip_id})


def put_trip(trip: Dict[str, Any]) -> None:
    put_item(t, trip)


def get_trip_by_invite_code(invite_code: str) -> Optional[Dict[str, Any]]:
    items = query_gsi(t, "inviteCode-index", "inviteCode", invite_code)
    return items[0] if items else None
