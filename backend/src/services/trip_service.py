import uuid
from typing import Dict, Any
from src.repos import trip_repo, trip_member_repo


def create_trip(
    user_id: str, title: str, start_date: str, end_date: str
) -> Dict[str, Any]:
    trip_id = str(uuid.uuid4())
    invite_code = str(uuid.uuid4())[:8]

    trip = {
        "tripId": trip_id,
        "createdBy": user_id,
        "title": title,
        "startDate": start_date,
        "endDate": end_date,
        "inviteCode": invite_code,
        "status": "active",
    }
    trip_repo.put_trip(trip)

    trip_member_repo.add_member(
        {
            "tripId": trip_id,
            "userId": user_id,
            "role": "owner",
            "status": "active",
        }
    )

    return trip


def get_trip(trip_id: str) -> Dict[str, Any] | None:
    return trip_repo.get_trip(trip_id)


def get_trip_by_invite(invite_code: str) -> Dict[str, Any] | None:
    return trip_repo.get_trip_by_invite_code(invite_code)
