from typing import Dict, Any, List
from src.repos import trip_member_repo
from .trip_service import get_trip_by_invite


def join_trip(user_id: str, invite_code: str) -> Dict[str, Any]:
    trip = get_trip_by_invite(invite_code)
    if not trip:
        return {"error": "Invalid invite code"}

    trip_member_repo.add_member(
        {
            "tripId": trip["tripId"],
            "userId": user_id,
            "role": "member",
            "status": "active",
        }
    )
    return {"tripId": trip["tripId"]}


def list_members(trip_id: str) -> List[Dict[str, Any]]:
    return trip_member_repo.list_members(trip_id)
