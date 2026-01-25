from __future__ import annotations

from typing import Dict, Any, List, Tuple

from src.repos import points_repo
from src.utils.normalize import normalize_program_name

try:
    from src.handlers.tpg_valuations import (
        fetch_tpg_valuations,
        get_cents_per_point,
        get_valuations,
    )
except ImportError:
    try:
        from ..handlers.tpg_valuations import (
            fetch_tpg_valuations,
            get_cents_per_point,
            get_valuations,
        )
    except ImportError:
        fetch_tpg_valuations = None  # type: ignore
        get_cents_per_point = None  # type: ignore
        get_valuations = None  # type: ignore


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


def _enrich_with_valuations(
    items: List[Dict[str, Any]], tpg_vals: Dict[str, float]
) -> Tuple[List[Dict[str, Any]], float]:
    """Add value and centsPerPoint to each item. Returns (enriched_items, total_value)."""
    total_value = 0.0
    out: List[Dict[str, Any]] = []
    for x in items:
        row = dict(x)
        bal = int(x.get("balance") or 0)
        prog = (x.get("program") or "").strip() or None
        cpp = get_cents_per_point(prog, tpg_vals) if prog else None
        if cpp is not None:
            row["centsPerPoint"] = round(cpp, 2)
            v = bal * cpp / 100.0
            row["value"] = round(v, 2)
            total_value += v
        else:
            row["centsPerPoint"] = None
            row["value"] = None
        out.append(row)
    return out, round(total_value, 2)


def trip_points_summary(trip_id: str) -> Dict[str, Any]:
    items = points_repo.list_points_for_trip(trip_id)
    total = sum(int(x.get("balance", 0)) for x in items)

    try:
        if fetch_tpg_valuations and get_cents_per_point:
            tpg_vals = fetch_tpg_valuations()
            enriched, total_value = _enrich_with_valuations(items, tpg_vals)
        else:
            enriched = [{**x, "value": None, "centsPerPoint": None} for x in items]
            total_value = 0.0
    except Exception:
        enriched = [
            {**x, "value": None, "centsPerPoint": None}
            for x in items
        ]
        total_value = 0.0

    return {
        "tripId": trip_id,
        "totalPoints": total,
        "totalValue": total_value,
        "items": enriched,
    }
