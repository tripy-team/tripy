import uuid
from datetime import datetime
from typing import Dict, Any, List
from src.repos import destination_repo, destination_vote_repo


def add_destination(
    trip_id: str, user_id: str, name: str, must_include: bool, excluded: bool
) -> Dict[str, Any]:
    dest_id = str(uuid.uuid4())
    item = {
        "tripId": trip_id,
        "destinationId": dest_id,
        "name": name,
        "mustInclude": must_include,
        "excluded": excluded,
        "createdBy": user_id,
        "createdAt": datetime.utcnow().isoformat(),
    }
    destination_repo.add_destination(item)
    return item


def list_destinations(trip_id: str) -> List[Dict[str, Any]]:
    return destination_repo.list_destinations(trip_id)


def cast_vote(
    trip_id: str, destination_id: str, user_id: str, vote: int
) -> Dict[str, Any]:
    key = f"{destination_id}#{user_id}"
    item = {
        "tripId": trip_id,
        "destinationUser": key,
        "destinationId": destination_id,
        "userId": user_id,
        "vote": vote,
    }
    destination_vote_repo.put_vote(item)
    return item


def scores(trip_id: str) -> Dict[str, Any]:
    votes = destination_vote_repo.list_votes_for_trip(trip_id)
    totals: Dict[str, int] = {}
    for v in votes:
        d = v["destinationId"]
        totals[d] = totals.get(d, 0) + int(v.get("vote", 0))
    return {"tripId": trip_id, "scores": totals}
