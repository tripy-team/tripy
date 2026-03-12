import itertools
import math
from typing import List, Dict, Any, Optional


MAX_PERMUTATIONS = 120


def generate_routes(
    destinations: List[Dict[str, Any]],
    leg_dates: Optional[List[str]] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Generate route permutations for group trips.

    When ``leg_dates`` are provided, per-destination durations (in days) are
    computed so that each permutation preserves how many days the user
    allocated to each destination.  Only the visit *order* changes; the
    total trip window stays the same.

    Returns a list of route dicts, each containing:
      - ``ids``: ordered list of destination IDs
      - ``leg_dates``: recomputed leg dates for that permutation (if available)
      - ``dest_durations``: mapping of destination ID to allocated days
    """
    active = [d for d in destinations if not d.get("excluded", False)]
    ids = [d["destinationId"] for d in active]

    if len(ids) <= 1:
        return [{"ids": ids, "leg_dates": leg_dates, "dest_durations": {}}]

    # Separate start/end (fixed) from intermediate (permutable) destinations
    start_dest = next((d for d in active if d.get("isStart")), None)
    end_dest = next((d for d in active if d.get("isEnd")), None)

    fixed_start_id = start_dest["destinationId"] if start_dest else None
    fixed_end_id = end_dest["destinationId"] if end_dest else None

    intermediate = [
        d for d in active
        if d["destinationId"] not in (fixed_start_id, fixed_end_id)
    ]
    intermediate_ids = [d["destinationId"] for d in intermediate]

    # Compute per-destination durations from leg_dates
    dest_durations: Dict[str, int] = {}
    if leg_dates and len(leg_dates) > 0 and start_date and end_date:
        from datetime import datetime
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            for i, dest in enumerate(intermediate):
                arrive_str = leg_dates[i] if i < len(leg_dates) else None
                if i + 1 < len(leg_dates) and leg_dates[i + 1]:
                    depart_str = leg_dates[i + 1]
                elif i == len(intermediate) - 1:
                    depart_str = end_date
                else:
                    depart_str = None

                if arrive_str and depart_str:
                    arrive_dt = datetime.strptime(arrive_str, "%Y-%m-%d")
                    depart_dt = datetime.strptime(depart_str, "%Y-%m-%d")
                    dest_durations[dest["destinationId"]] = max(1, (depart_dt - arrive_dt).days)
        except (ValueError, IndexError):
            dest_durations = {}

    # Generate permutations of intermediate destinations
    if len(intermediate_ids) > 6:
        perms = list(itertools.islice(itertools.permutations(intermediate_ids), MAX_PERMUTATIONS))
    else:
        perms = list(itertools.permutations(intermediate_ids))

    routes = []
    for perm in perms:
        ordered_ids = (
            ([fixed_start_id] if fixed_start_id else [])
            + list(perm)
            + ([fixed_end_id] if fixed_end_id else [])
        )

        # Recompute leg dates for this permutation order
        perm_leg_dates = None
        if dest_durations and start_date:
            from datetime import datetime, timedelta
            try:
                current = datetime.strptime(start_date, "%Y-%m-%d")
                perm_leg_dates = [current.strftime("%Y-%m-%d")]
                total_days = (datetime.strptime(end_date, "%Y-%m-%d") - current).days if end_date else 7
                fallback = max(1, total_days // max(len(intermediate_ids), 1))
                for did in perm:
                    duration = dest_durations.get(did, fallback)
                    current = current + timedelta(days=duration)
                    perm_leg_dates.append(current.strftime("%Y-%m-%d"))
            except (ValueError, IndexError):
                perm_leg_dates = None

        routes.append({
            "ids": ordered_ids,
            "leg_dates": perm_leg_dates,
            "dest_durations": dest_durations,
        })

    return routes
