"""
Arrival coordination for multi-origin group trips.

When several travelers depart from different origins (e.g. Seattle and New York)
to a shared destination (e.g. Singapore) and want to *arrive together*, the
naive "cheapest flight per person" selection ignores schedule. This module picks,
per traveler, the flight whose ARRIVAL falls inside a common time window so the
group lands together.

Key idea: coordination is purely a comparison of ABSOLUTE arrival instants in
UTC. Each candidate flight already carries a fixed (departure, arrival) pair, so
constraining arrivals to coincide makes the longer-flight origin depart earlier
on its own — no explicit timezone arithmetic is required beyond normalizing every
timestamp to UTC. The traveler from NYC (longer flight to SIN) is automatically
assigned an earlier departure than the traveler from Seattle.

This stage decides *which* flight each traveler takes (the schedule). A later
stage (group_oop_optimizer) decides *how to pay* (cash vs. points). The two are
intentionally separate.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .airport_timezones import get_timezone
from .datetime_utils import datetime_to_utc

logger = logging.getLogger(__name__)

DEFAULT_WINDOW_MINUTES = 180  # how close together arrivals must be, by default


@dataclass
class FlightChoice:
    """A single candidate flight for one traveler, with absolute timestamps."""

    flight_id: str
    traveler_id: str
    departure: datetime  # timezone-aware
    arrival: datetime    # timezone-aware
    cost: float          # ranking cost (cash baseline; ties broken by this)
    payload: Dict[str, Any] = field(default_factory=dict)  # opaque pass-through

    @property
    def departure_utc(self) -> datetime:
        return datetime_to_utc(self.departure)

    @property
    def arrival_utc(self) -> datetime:
        return datetime_to_utc(self.arrival)


def _derive_departure(date_str: str, hhmm: str, origin_iata: str) -> Optional[datetime]:
    """
    Build a timezone-aware departure datetime from a YYYY-MM-DD date, an HH:MM
    local time, and the origin airport's timezone. Returns None if either the
    date or time is missing/malformed.
    """
    if not date_str or not hhmm:
        return None
    try:
        parts = hhmm.strip().split(":")
        hour, minute = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
        d = datetime.fromisoformat(date_str.strip()[:10]).date()
    except (ValueError, IndexError):
        return None
    tz = get_timezone(origin_iata)
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=tz)


def build_flight_choices(
    options_by_traveler: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, List[FlightChoice]]:
    """
    Turn raw per-traveler flight-option dicts into FlightChoice objects with
    absolute timestamps, for coordination.

    Each option dict is expected to provide:
      - flight_id (str)
      - origin (IATA), date (YYYY-MM-DD), departure_time (HH:MM)
      - duration_minutes (int)  [arrival = departure + duration]
      - cash_cost (float)       [ranking baseline]
      - the dict itself is carried through as `payload`

    Options lacking a usable departure time or duration are dropped (they can't
    be coordinated). Travelers left with zero usable options are omitted; the
    caller falls back to non-coordinated selection for them.
    """
    result: Dict[str, List[FlightChoice]] = {}
    for tid, opts in options_by_traveler.items():
        choices: List[FlightChoice] = []
        for o in opts:
            departure = _derive_departure(
                o.get("date", ""), o.get("departure_time", ""), o.get("origin", "")
            )
            duration_min = o.get("duration_minutes") or o.get("total_duration_minutes")
            if departure is None or not duration_min:
                continue
            arrival = departure + timedelta(minutes=int(duration_min))
            choices.append(
                FlightChoice(
                    flight_id=str(o.get("flight_id", "")),
                    traveler_id=tid,
                    departure=departure,
                    arrival=arrival,
                    cost=float(o.get("cash_cost") or 0.0),
                    payload=o,
                )
            )
        if choices:
            result[tid] = choices
    return result


@dataclass
class CoordinationResult:
    """Outcome of coordinating one shared destination."""

    # True when every traveler's chosen arrival fits inside `window_minutes`.
    within_target: bool
    # Chosen flight per traveler_id (always populated when feasible at all).
    selections: Dict[str, FlightChoice]
    window_start_utc: Optional[datetime]
    window_end_utc: Optional[datetime]
    spread_minutes: float  # actual gap between earliest and latest arrival
    reason: str

    def selected_ids(self) -> Dict[str, str]:
        return {tid: c.flight_id for tid, c in self.selections.items()}


def _min_cost_per_traveler_in_window(
    options_by_traveler: Dict[str, List[FlightChoice]],
    start: datetime,
    end: datetime,
) -> Optional[Dict[str, FlightChoice]]:
    """
    For a fixed [start, end] arrival window, pick the cheapest flight per traveler
    whose arrival lands inside it. Returns None if any traveler has no flight in
    the window (window infeasible).
    """
    chosen: Dict[str, FlightChoice] = {}
    for tid, opts in options_by_traveler.items():
        in_window = [o for o in opts if start <= o.arrival_utc <= end]
        if not in_window:
            return None
        chosen[tid] = min(in_window, key=lambda o: (o.cost, o.arrival_utc))
    return chosen


def _min_spread_selection(
    options_by_traveler: Dict[str, List[FlightChoice]],
) -> Dict[str, FlightChoice]:
    """
    Best-effort fallback when no window meets the target: choose one flight per
    traveler to minimize the spread (latest arrival - earliest arrival), via a
    sliding window over all arrivals sorted in time. Among equal-spread windows,
    prefer lower total cost.
    """
    events = sorted(
        (o.arrival_utc, tid, o)
        for tid, opts in options_by_traveler.items()
        for o in opts
    )
    n_travelers = len(options_by_traveler)
    best: Optional[Dict[str, FlightChoice]] = None
    best_spread = timedelta.max
    best_cost = float("inf")

    left = 0
    # cheapest seen option per traveler inside the current [left, right] window
    cheapest: Dict[str, FlightChoice] = {}
    # count of options per traveler currently in window (to know when to advance left)
    counts: Dict[str, int] = {}

    def recompute_cheapest(lo: int, hi: int) -> Dict[str, FlightChoice]:
        acc: Dict[str, FlightChoice] = {}
        for idx in range(lo, hi + 1):
            _, tid, o = events[idx]
            cur = acc.get(tid)
            if cur is None or (o.cost, o.arrival_utc) < (cur.cost, cur.arrival_utc):
                acc[tid] = o
        return acc

    for right in range(len(events)):
        _, tid_r, _ = events[right]
        counts[tid_r] = counts.get(tid_r, 0) + 1
        # shrink from the left while all travelers still covered
        while True:
            _, tid_l, _ = events[left]
            if counts.get(tid_l, 0) > 1:
                counts[tid_l] -= 1
                left += 1
            else:
                break
        if len(counts) == n_travelers and all(v >= 1 for v in counts.values()):
            spread = events[right][0] - events[left][0]
            sel = recompute_cheapest(left, right)
            cost = sum(c.cost for c in sel.values())
            if (spread, cost) < (best_spread, best_cost):
                best_spread, best_cost, best = spread, cost, sel

    # Fallback should always find something when every traveler has >=1 option.
    if best is None:
        best = {tid: min(opts, key=lambda o: o.cost) for tid, opts in options_by_traveler.items()}
    return best


def coordinate_arrivals(
    options_by_traveler: Dict[str, List[FlightChoice]],
    window_minutes: int = DEFAULT_WINDOW_MINUTES,
) -> CoordinationResult:
    """
    Choose one flight per traveler so the group arrives together.

    Strategy:
      1. Try to find the minimum-cost selection where every arrival fits inside
         some window of `window_minutes` (anchored at each candidate arrival).
      2. If no such window exists, fall back to the minimum-spread selection and
         report `within_target=False` with the actual spread.

    Returns a CoordinationResult. Travelers with no candidate flights are omitted
    from `options_by_traveler` by the caller; if fewer than 2 travelers remain,
    coordination is a no-op (each takes their cheapest).
    """
    # Drop travelers with no options; they can't be coordinated.
    options_by_traveler = {tid: opts for tid, opts in options_by_traveler.items() if opts}

    if len(options_by_traveler) <= 1:
        selections = {
            tid: min(opts, key=lambda o: (o.cost, o.arrival_utc))
            for tid, opts in options_by_traveler.items()
        }
        return CoordinationResult(
            within_target=True,
            selections=selections,
            window_start_utc=None,
            window_end_utc=None,
            spread_minutes=0.0,
            reason="single_traveler_no_coordination_needed",
        )

    window = timedelta(minutes=window_minutes)

    # Anchor a window at each distinct arrival time and keep the cheapest feasible.
    anchors = sorted({o.arrival_utc for opts in options_by_traveler.values() for o in opts})
    best: Optional[Dict[str, FlightChoice]] = None
    best_cost = float("inf")
    for start in anchors:
        chosen = _min_cost_per_traveler_in_window(options_by_traveler, start, start + window)
        if chosen is None:
            continue
        cost = sum(c.cost for c in chosen.values())
        if cost < best_cost:
            best_cost, best = cost, chosen

    if best is not None:
        arrivals = [c.arrival_utc for c in best.values()]
        spread = (max(arrivals) - min(arrivals)).total_seconds() / 60.0
        return CoordinationResult(
            within_target=True,
            selections=best,
            window_start_utc=min(arrivals),
            window_end_utc=max(arrivals),
            spread_minutes=spread,
            reason=f"coordinated_within_{window_minutes}min",
        )

    # No window meets the target — minimize spread instead.
    sel = _min_spread_selection(options_by_traveler)
    arrivals = [c.arrival_utc for c in sel.values()]
    spread = (max(arrivals) - min(arrivals)).total_seconds() / 60.0
    return CoordinationResult(
        within_target=False,
        selections=sel,
        window_start_utc=min(arrivals),
        window_end_utc=max(arrivals),
        spread_minutes=spread,
        reason=(
            f"could_not_meet_{window_minutes}min_target; "
            f"best_achievable_spread={spread:.0f}min"
        ),
    )
