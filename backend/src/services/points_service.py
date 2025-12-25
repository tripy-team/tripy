from typing import Dict, Any
from ..repos import points_repo
from ..utils.normalize import normalize_program_name


def upsert_points(
    trip_id: str, user_id: str, program: str, balance: int
) -> Dict[str, Any]:
    prog = normalize_program_name(program)
    user_program = f"{user_id}#{prog}"
    item = {
        "tripId": trip_id,
        "userProgram": user_program,
        "userId": user_id,
        "program": prog,
        "balance": balance,
        "source": "manual",
    }
    points_repo.upsert_points(trip_id, user_program, item)
    return item


def trip_points_summary(trip_id: str) -> Dict[str, Any]:
    items = points_repo.list_points_for_trip(trip_id)
    total = sum(int(x.get("balance", 0)) for x in items)
    return {"tripId": trip_id, "totalPoints": total, "items": items}
