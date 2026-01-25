import uuid
from datetime import datetime
from typing import Dict, Any, List, Tuple
from src.repos import destination_repo, destination_vote_repo


def get_display_destinations_for_trip(destinations: List[Dict[str, Any]]) -> Tuple[List[str], str]:
    """
    For trip display (firstDestination, "Visiting X, Y, Z"): exclude origin/departure (mustInclude).
    Start and end are where the dates start/end—like booking an airline ticket (fly from A on
    startDate, arrive at B on endDate). They are not "destinations" for the total trip.
    - If there are middle cities (stays): use those only.
    - If simple A→B (no middle): the place you visit is the end.
    Returns (list of destination names for "Visiting", first destination name).
    """
    if not destinations:
        return ([], "")
    must_include = [d for d in destinations if d.get("mustInclude", False)]
    stay_dests = [d for d in destinations if not d.get("mustInclude", False)]
    end_dest = must_include[-1] if must_include else None
    display = stay_dests if stay_dests else ([end_dest] if end_dest else [])
    names = [
        (d.get("name") or d.get("destinationId") or "").strip()
        for d in display
        if (d.get("name") or d.get("destinationId"))
    ]
    names = [n for n in names if n]
    first = names[0] if names else ""
    return (names, first)


def add_destination(
    trip_id: str,
    user_id: str,
    name: str,
    must_include: bool,
    excluded: bool,
    *,
    is_start: bool = False,
    is_end: bool = False,
) -> Dict[str, Any]:
    dest_id = str(uuid.uuid4())
    item = {
        "tripId": trip_id,
        "destinationId": dest_id,
        "name": name,
        "mustInclude": must_include,
        "excluded": excluded,
        "isStart": is_start,
        "isEnd": is_end,
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
