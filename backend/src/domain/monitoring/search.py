"""
Monitoring search adapter.

Bridges the monitoring cron job to the existing flight search pipeline.
Supports three modes: stub, fake_drop, and real (live search).
"""
import copy
import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from src.config.monitoring import MONITORING_SEARCH_MODE

logger = logging.getLogger(__name__)


# =============================================================================
# PUBLIC INTERFACE
# =============================================================================


def run_search(
    baseline: Dict[str, Any],
    mode: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Run a monitoring search and return the best candidate itinerary.

    Args:
        baseline: The full baseline record (contains selected_itinerary, query_inputs).
        mode: Override search mode ("stub", "fake_drop", "real"). Defaults to config.

    Returns:
        Best candidate itinerary dict, or None if search found nothing.
    """
    mode = mode or MONITORING_SEARCH_MODE

    selected = _get_selected_itinerary(baseline)
    if not selected:
        logger.warning("monitoring.search no selected_itinerary in baseline")
        return None

    if mode == "stub":
        return selected  # No-op: candidate == baseline, score will be 0

    if mode == "fake_drop":
        return _fake_drop_candidate(selected)

    if mode == "real":
        query_inputs = baseline.get("query_inputs") or {}
        results = _run_real_search(selected, query_inputs)
        return match_best_candidate(selected, results)

    logger.warning(f"monitoring.search unknown mode={mode}, falling back to stub")
    return selected


# =============================================================================
# FAKE DROP (dev/test harness)
# =============================================================================


def _fake_drop_candidate(baseline_itin: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate a deterministic fake candidate with a ~20% cash price drop
    and optionally one fewer stop. Used for dev testing.
    """
    candidate = copy.deepcopy(baseline_itin)

    # Drop cash price by ~20%
    cash = candidate.get("cash_price")
    if cash is not None:
        try:
            cash = float(cash)
            candidate["cash_price"] = round(cash * 0.80, 2)
        except (ValueError, TypeError):
            pass

    # Reduce stops by 1 if > 0
    stops = candidate.get("stops")
    if stops is not None:
        try:
            stops = int(stops)
            if stops > 0:
                candidate["stops"] = stops - 1
        except (ValueError, TypeError):
            pass

    # Slightly shorten duration (remove ~15 min)
    dur = candidate.get("total_duration_minutes")
    if dur is not None:
        try:
            dur = float(dur)
            candidate["total_duration_minutes"] = max(0, dur - 15)
        except (ValueError, TypeError):
            pass

    return candidate


# =============================================================================
# REAL SEARCH
# =============================================================================


def _run_real_search(
    baseline_itin: Dict[str, Any],
    query_inputs: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Call the real flight search pipeline using query_inputs from the baseline.
    Returns raw list of flight option dicts from SerpAPI/Google Flights.
    """
    # Extract search parameters from query_inputs or baseline
    origin = (
        query_inputs.get("origin")
        or _extract_origin(baseline_itin)
    )
    destination = (
        query_inputs.get("destination")
        or _extract_destination(baseline_itin)
    )
    departure_date = (
        query_inputs.get("departure_date")
        or query_inputs.get("date")
        or _extract_departure_date(baseline_itin)
    )

    if not origin or not destination or not departure_date:
        logger.warning(
            f"monitoring.real_search missing params: "
            f"origin={origin} dest={destination} date={departure_date}"
        )
        return []

    # Map cabin class from baseline to SerpAPI travel_class
    cabin = (
        query_inputs.get("cabin_class")
        or baseline_itin.get("cabin_class")
        or baseline_itin.get("cabin")
    )
    travel_class = _cabin_to_travel_class(cabin)

    try:
        from src.handlers.serp_client import get_flights_between_airports
        results = get_flights_between_airports(
            origin=origin,
            destination=destination,
            date=departure_date,
            travel_class=travel_class,
            trip_type=2,  # one-way segment search
        )
        logger.info(
            f"monitoring.real_search origin={origin} dest={destination} "
            f"date={departure_date} results={len(results)}"
        )
        return results
    except Exception as e:
        logger.error(f"monitoring.real_search error: {e}", exc_info=True)
        return []


# =============================================================================
# CANDIDATE MATCHING
# =============================================================================


def match_best_candidate(
    baseline_itin: Dict[str, Any],
    search_results: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """
    From raw search results, find the best candidate that matches the baseline route.

    Matching criteria:
    - Same overall route (origin → destination)
    - Same departure date
    - Departure time within ±2 hours (if available)
    - Same cabin class (if available)

    Selection: lowest cash price, tie-break by shorter duration, fewer stops.

    Returns a normalized itinerary dict (same shape as baseline), or None.
    """
    if not search_results:
        return None

    baseline_origin = _extract_origin(baseline_itin)
    baseline_dest = _extract_destination(baseline_itin)
    baseline_dep_time = _extract_departure_time(baseline_itin)
    baseline_cabin = (
        baseline_itin.get("cabin_class")
        or baseline_itin.get("cabin")
    )

    scored: List[Tuple[float, Dict[str, Any]]] = []

    for result in search_results:
        normalized = _normalize_search_result(result)
        if normalized is None:
            continue

        # Route match
        cand_origin = _extract_origin(normalized)
        cand_dest = _extract_destination(normalized)
        if not _routes_match(baseline_origin, cand_origin, baseline_dest, cand_dest):
            continue

        # Time window match (±2 hours)
        if baseline_dep_time:
            cand_dep_time = _extract_departure_time(normalized)
            if cand_dep_time and not _within_time_window(baseline_dep_time, cand_dep_time, hours=2):
                continue

        # Score: lower is better (price primary, duration secondary, stops tertiary)
        price = float(normalized.get("cash_price") or 999999)
        duration = float(normalized.get("total_duration_minutes") or 9999)
        stops = int(normalized.get("stops") or 99)
        sort_key = (price, duration, stops)

        scored.append((sort_key, normalized))

    if not scored:
        return None

    scored.sort(key=lambda x: x[0])
    return scored[0][1]


# =============================================================================
# NORMALIZATION (SerpAPI → baseline-compatible shape)
# =============================================================================


def _normalize_search_result(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Normalize a SerpAPI Google Flights result into the same shape
    as the baseline selected_itinerary.

    SerpAPI shape:
    {
      "price": 612,
      "total_duration": 720,  # minutes
      "flights": [
        {
          "departure_airport": {"name": "...", "id": "SFO", "time": "2026-03-15 08:30"},
          "arrival_airport": {"name": "...", "id": "NRT", "time": "..."},
          "flight_number": "UA 837",
          "airline": "United",
          "duration": 660,
          ...
        }
      ],
      ...
    }

    Baseline shape:
    {
      "cash_price": 612,
      "total_duration_minutes": 720,
      "stops": 0,
      "segments": [
        {
          "carrier": "United",
          "flight_number": "UA 837",
          "origin": "SFO",
          "destination": "NRT",
          "departure_time": "2026-03-15T08:30:00",
          "arrival_time": "...",
          "duration_minutes": 660,
        }
      ],
      "cabin_class": "economy",
      ...
    }
    """
    flights = raw.get("flights") or []
    if not flights:
        return None

    price = raw.get("price")
    if price is None:
        return None

    total_duration = raw.get("total_duration") or sum(
        f.get("duration", 0) for f in flights
    )

    segments = []
    for leg in flights:
        dep_airport = leg.get("departure_airport") or {}
        arr_airport = leg.get("arrival_airport") or {}
        segments.append({
            "carrier": leg.get("airline", ""),
            "flight_number": leg.get("flight_number", ""),
            "origin": dep_airport.get("id", ""),
            "destination": arr_airport.get("id", ""),
            "departure_time": _serp_time_to_iso(dep_airport.get("time", "")),
            "arrival_time": _serp_time_to_iso(arr_airport.get("time", "")),
            "duration_minutes": leg.get("duration", 0),
        })

    stops = max(0, len(flights) - 1)

    return {
        "cash_price": float(price),
        "total_duration_minutes": total_duration,
        "stops": stops,
        "segments": segments,
    }


# =============================================================================
# HELPERS
# =============================================================================


def _get_selected_itinerary(baseline: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Extract selected_itinerary from baseline, handling JSON string encoding."""
    selected = baseline.get("selected_itinerary", {})
    if isinstance(selected, str):
        import json
        try:
            selected = json.loads(selected)
        except (json.JSONDecodeError, TypeError):
            return None
    return selected if selected else None


def _extract_origin(itin: Dict[str, Any]) -> Optional[str]:
    """Extract origin airport code from itinerary."""
    # Try direct field
    if itin.get("origin"):
        return str(itin["origin"]).upper()
    # Try first segment
    segments = itin.get("segments") or []
    if segments:
        return (segments[0].get("origin") or "").upper() or None
    return None


def _extract_destination(itin: Dict[str, Any]) -> Optional[str]:
    """Extract final destination airport code from itinerary."""
    if itin.get("destination"):
        return str(itin["destination"]).upper()
    segments = itin.get("segments") or []
    if segments:
        return (segments[-1].get("destination") or "").upper() or None
    return None


def _extract_departure_date(itin: Dict[str, Any]) -> Optional[str]:
    """Extract departure date (YYYY-MM-DD) from itinerary."""
    if itin.get("departure_date"):
        return str(itin["departure_date"])[:10]
    segments = itin.get("segments") or []
    if segments:
        dep_time = segments[0].get("departure_time", "")
        if dep_time and len(dep_time) >= 10:
            return dep_time[:10]
    return None


def _extract_departure_time(itin: Dict[str, Any]) -> Optional[datetime]:
    """Extract departure datetime from itinerary."""
    segments = itin.get("segments") or []
    if not segments:
        return None
    dep_str = segments[0].get("departure_time", "")
    if not dep_str:
        return None
    try:
        return datetime.fromisoformat(dep_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _routes_match(
    b_origin: Optional[str],
    c_origin: Optional[str],
    b_dest: Optional[str],
    c_dest: Optional[str],
) -> bool:
    """Check if two itineraries serve the same route."""
    if not all([b_origin, c_origin, b_dest, c_dest]):
        return False
    return b_origin == c_origin and b_dest == c_dest


def _within_time_window(
    baseline_dt: datetime,
    candidate_dt: datetime,
    hours: int = 2,
) -> bool:
    """Check if candidate departure is within ±hours of baseline."""
    try:
        # Make both offset-aware or offset-naive for comparison
        if baseline_dt.tzinfo is None and candidate_dt.tzinfo is not None:
            baseline_dt = baseline_dt.replace(tzinfo=timezone.utc)
        elif baseline_dt.tzinfo is not None and candidate_dt.tzinfo is None:
            candidate_dt = candidate_dt.replace(tzinfo=timezone.utc)

        diff = abs((candidate_dt - baseline_dt).total_seconds())
        return diff <= hours * 3600
    except (TypeError, ValueError):
        return True  # if we can't compare, don't exclude


def _cabin_to_travel_class(cabin: Optional[str]) -> Optional[int]:
    """Map cabin class string to SerpAPI travel_class int."""
    if not cabin:
        return None
    cabin_lower = cabin.lower()
    mapping = {
        "economy": 1,
        "premium_economy": 2,
        "premium economy": 2,
        "business": 3,
        "first": 4,
    }
    return mapping.get(cabin_lower)


def _serp_time_to_iso(serp_time: str) -> str:
    """
    Convert SerpAPI time format '2026-03-15 08:30' to ISO '2026-03-15T08:30:00'.
    """
    if not serp_time:
        return ""
    # SerpAPI uses 'YYYY-MM-DD HH:MM' format
    return serp_time.replace(" ", "T") + (":00" if serp_time.count(":") < 2 else "")
