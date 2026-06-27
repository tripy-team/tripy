"""
Unit tests for multi-origin arrival coordination.

Covers:
  - the core selection algorithm (window-feasible + min-spread fallback)
  - deriving absolute UTC timestamps from local HH:MM + origin timezone + duration
  - the user's motivating scenario: Seattle + NYC -> Singapore, arrive together,
    where the longer-flight origin (NYC) must DEPART EARLIER.
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from src.optimization.arrival_coordination import (  # noqa: E402
    FlightChoice,
    build_flight_choices,
    coordinate_arrivals,
)
from src.optimization.airport_timezones import get_timezone, has_known_timezone  # noqa: E402

PDT = timezone(timedelta(hours=-7))
EDT = timezone(timedelta(hours=-4))
SGT = timezone(timedelta(hours=+8))


def _fc(fid, tid, dep, arr, cost):
    return FlightChoice(fid, tid, dep, arr, cost)


# --------------------------------------------------------------------------- #
# Timezone resolver
# --------------------------------------------------------------------------- #

def test_timezone_resolver_known_airports():
    assert has_known_timezone("SEA")
    assert has_known_timezone("JFK")
    assert has_known_timezone("SIN")
    # A July (summer) instant: Seattle is UTC-7, Singapore UTC+8.
    jul = datetime(2026, 7, 1, 12, 0)
    assert get_timezone("SEA").utcoffset(jul) == timedelta(hours=-7)
    assert get_timezone("SIN").utcoffset(jul) == timedelta(hours=8)


def test_timezone_resolver_unknown_defaults_safely():
    # Never raises; returns a usable tzinfo even for nonsense.
    tz = get_timezone("ZZZ")
    assert tz is not None
    assert get_timezone(None).utcoffset(datetime(2026, 7, 1)) == timedelta(0)


# --------------------------------------------------------------------------- #
# Timestamp derivation from raw option dicts
# --------------------------------------------------------------------------- #

def test_build_flight_choices_derives_utc_arrival():
    raw = {
        "t1": [{
            "flight_id": "F1", "origin": "SEA", "date": "2026-07-01",
            "departure_time": "09:00", "duration_minutes": 1020, "cash_cost": 800,
        }],
    }
    choices = build_flight_choices(raw)
    assert "t1" in choices and len(choices["t1"]) == 1
    c = choices["t1"][0]
    # 09:00 PDT = 16:00 UTC; +17h = 09:00 UTC next day.
    assert c.departure_utc == datetime(2026, 7, 1, 16, 0, tzinfo=timezone.utc)
    assert c.arrival_utc == datetime(2026, 7, 2, 9, 0, tzinfo=timezone.utc)


def test_build_flight_choices_drops_options_without_timing():
    raw = {
        "t1": [
            {"flight_id": "ok", "origin": "SEA", "date": "2026-07-01",
             "departure_time": "09:00", "duration_minutes": 600, "cash_cost": 800},
            {"flight_id": "no_time", "origin": "SEA", "date": "2026-07-01",
             "departure_time": None, "duration_minutes": 600, "cash_cost": 700},
            {"flight_id": "no_dur", "origin": "SEA", "date": "2026-07-01",
             "departure_time": "10:00", "duration_minutes": 0, "cash_cost": 700},
        ],
    }
    choices = build_flight_choices(raw)
    assert [c.flight_id for c in choices["t1"]] == ["ok"]


# --------------------------------------------------------------------------- #
# Core coordination algorithm
# --------------------------------------------------------------------------- #

def test_seattle_nyc_singapore_nyc_departs_earlier():
    """The motivating scenario: arrive together => NYC departs earlier."""
    def dt(d, h, mi, tz):
        return datetime(2026, 7, d, h, mi, tzinfo=tz)

    options = {
        "seattle": [
            _fc("SEA-A", "seattle", dt(1, 9, 0, PDT),  dt(2, 17, 0, SGT), 820),
            _fc("SEA-B", "seattle", dt(1, 23, 55, PDT), dt(3, 7, 55, SGT), 760),
        ],
        "nyc": [
            _fc("NYC-A", "nyc", dt(1, 8, 40, EDT), dt(2, 19, 20, SGT), 910),
            _fc("NYC-C", "nyc", dt(1, 21, 40, EDT), dt(3, 8, 20, SGT), 850),
        ],
    }
    res = coordinate_arrivals(options, window_minutes=180)
    assert res.within_target
    assert res.spread_minutes <= 180
    sea = res.selections["seattle"]
    nyc = res.selections["nyc"]
    # KEY ASSERTION: NYC departs earlier in absolute (UTC) time.
    assert nyc.departure_utc < sea.departure_utc


def test_single_traveler_is_noop():
    options = {
        "solo": [
            _fc("A", "solo", datetime(2026, 7, 1, 9, 0, tzinfo=PDT),
                datetime(2026, 7, 2, 2, 0, tzinfo=SGT), 500),
        ],
    }
    res = coordinate_arrivals(options, window_minutes=180)
    assert res.within_target
    assert res.spread_minutes == 0.0
    assert res.selections["solo"].flight_id == "A"


def test_prefers_cheapest_among_window_feasible():
    """Two windows both meet the target; the cheaper total should win."""
    base = datetime(2026, 7, 2, 0, 0, tzinfo=timezone.utc)
    dep = datetime(2026, 7, 1, 0, 0, tzinfo=timezone.utc)
    options = {
        "a": [
            _fc("a-early", "a", dep, base, 300),
            _fc("a-late", "a", dep, base + timedelta(hours=6), 100),
        ],
        "b": [
            _fc("b-early", "b", dep, base + timedelta(minutes=30), 300),
            _fc("b-late", "b", dep, base + timedelta(hours=6, minutes=30), 100),
        ],
    }
    res = coordinate_arrivals(options, window_minutes=60)
    # Late window total = 200 < early window total = 600.
    assert res.selections["a"].flight_id == "a-late"
    assert res.selections["b"].flight_id == "b-late"


def test_fallback_minimizes_spread_when_target_impossible():
    options = {
        "a": [
            _fc("A1", "a", datetime(2026, 7, 1, 8, 0, tzinfo=EDT),
                datetime(2026, 7, 2, 6, 0, tzinfo=SGT), 500),
            _fc("A2", "a", datetime(2026, 7, 1, 9, 0, tzinfo=EDT),
                datetime(2026, 7, 2, 7, 0, tzinfo=SGT), 400),
        ],
        "b": [
            _fc("B1", "b", datetime(2026, 7, 1, 8, 0, tzinfo=PDT),
                datetime(2026, 7, 2, 12, 0, tzinfo=SGT), 500),
            _fc("B2", "b", datetime(2026, 7, 1, 9, 0, tzinfo=PDT),
                datetime(2026, 7, 2, 15, 0, tzinfo=SGT), 400),
        ],
    }
    res = coordinate_arrivals(options, window_minutes=60)
    assert not res.within_target
    # Closest pair is A2 (07:00 SGT) and B1 (12:00 SGT) = 5h.
    assert res.selections["a"].flight_id == "A2"
    assert res.selections["b"].flight_id == "B1"
    assert res.spread_minutes == pytest.approx(300.0)


def test_traveler_without_options_is_omitted():
    options = {
        "a": [_fc("A1", "a", datetime(2026, 7, 1, tzinfo=timezone.utc),
                  datetime(2026, 7, 2, tzinfo=timezone.utc), 500)],
        "b": [],
    }
    res = coordinate_arrivals(options, window_minutes=180)
    assert "b" not in res.selections
