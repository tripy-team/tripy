"""
Golden-file + behavior tests for the self-hosted AwardPricingEngine.

Chart programs must be deterministic and match the published chart (bookable-exact);
cash-derived must stay bounded; the public API must preserve the legacy AwardTool
dict shape so the optimizer's parsers (handlers/flights.py:_merge_award_edges,
handlers/hotels.py:_normalize_row) consume it unchanged.
"""

import pytest

from src.award_pricing import (
    engine,
    search_award_flights,
    search_award_hotels,
    search_award_calendar,
)
from src.award_pricing import charts
from src.award_pricing.models import SOURCE_CHART, SOURCE_CASH_DERIVED
from src.award_pricing.airports import great_circle_miles


# ---------------------------------------------------------------------------
# Airport coordinates / distance
# ---------------------------------------------------------------------------

def test_great_circle_known_distance():
    miles = great_circle_miles("JFK", "LHR")
    assert miles is not None
    assert 3400 <= miles <= 3500  # transatlantic ~3442mi

def test_great_circle_unknown_airport():
    assert great_circle_miles("JFK", "ZZZ") is None


# ---------------------------------------------------------------------------
# Avios distance chart — GOLDEN values (band lookup is exact & deterministic)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("origin,dest,cabin,expected_offpeak", [
    ("LHR", "CDG", "economy", 4000),     # band 1 (<650mi)
    ("LHR", "CDG", "business", 9000),
    ("JFK", "LHR", "economy", 13000),    # band 5 (3001-4000mi)
    ("JFK", "LHR", "business", 39000),
    ("JFK", "LHR", "first", 78000),
])
def test_avios_golden(origin, dest, cabin, expected_offpeak):
    q = engine.quote_flight("BA", origin, dest, cabin)
    assert q.source == SOURCE_CHART
    assert q.award_points == expected_offpeak
    assert q.confidence >= 0.9
    assert q.tier_unknown is True  # no peak/off-peak date supplied

def test_avios_peak_vs_offpeak():
    off = engine.quote_flight("BA", "JFK", "LHR", "business", peak=False)
    peak = engine.quote_flight("BA", "JFK", "LHR", "business", peak=True)
    assert off.award_points == 39000
    assert peak.award_points == 48750
    assert off.tier_unknown is False

def test_avios_family_shares_chart():
    # IB/EI/QR/AY use the same distance bands (multiplier 1.0 seed)
    for prog in ["BA", "IB", "EI", "QR", "AY"]:
        q = engine.quote_flight(prog, "JFK", "LHR", "business")
        assert q.award_points == 39000
        assert q.source == SOURCE_CHART


# ---------------------------------------------------------------------------
# Partner region charts
# ---------------------------------------------------------------------------

def test_partner_alaska_chart_exact():
    q = engine.quote_flight("AS", "SEA", "LHR", "business")
    assert q.source == SOURCE_CHART
    assert q.award_points == 60000  # EU-NA business

def test_partner_ana_roundtrip_halved():
    # ANA chart is round-trip; one-way quote must be half (AS_E-NA business 85k rt)
    q = engine.quote_flight("NH", "SFO", "NRT", "business")
    assert q.source == SOURCE_CHART
    assert q.award_points == 42500


# ---------------------------------------------------------------------------
# Hyatt category chart — GOLDEN values
# ---------------------------------------------------------------------------

def test_hyatt_category_resolution():
    assert charts.resolve_hyatt_category("Park Hyatt Tokyo") == 7
    assert charts.resolve_hyatt_category("Hyatt Place Austin") == 2
    assert charts.resolve_hyatt_category("Some Unknown Hyatt") == 4  # default

def test_hyatt_chart_golden_total_points():
    # Park Hyatt Tokyo = Cat 7, moderate tier = 35,000/night × 2 nights
    q = engine.quote_hotel("HYATT", "Park Hyatt Tokyo", "TYO", nights=2)
    assert q.source == SOURCE_CHART
    assert q.award_points == 70000
    assert q.surcharge == 0.0  # Hyatt has no award surcharges
    assert q.tier_unknown is True

def test_hyatt_explicit_category_and_tier():
    q = engine.quote_hotel("HYATT", "x", "x", nights=1, category=1, tier="lowest")
    assert q.award_points == 3000
    q2 = engine.quote_hotel("HYATT", "x", "x", nights=1, category=8, tier="top")
    assert q2.award_points == 70000


# ---------------------------------------------------------------------------
# Cash-derived (dynamic programs) — bounded estimate
# ---------------------------------------------------------------------------

def test_cash_derived_economy():
    q = engine.quote_flight("UA", "JFK", "LAX", "economy")
    assert q.source == SOURCE_CASH_DERIVED
    assert 10000 <= q.award_points <= 35000  # domestic economy range
    assert q.confidence < 0.7

def test_cash_derived_business_is_bounded():
    # Unclamped cash÷peg would be ~300k; must clamp into realistic transatlantic range
    q = engine.quote_flight("UA", "JFK", "LHR", "business")
    assert q.award_points <= 120000

def test_hotel_cash_derived_marriott():
    q = engine.quote_hotel("MAR", "Marriott Downtown", "NYC", nights=2)
    assert q.source == SOURCE_CASH_DERIVED
    assert q.award_points > 0


# ---------------------------------------------------------------------------
# Public API preserves the legacy AwardTool dict shape
# ---------------------------------------------------------------------------

def test_search_flights_shape_and_tagging():
    body = search_award_flights("JFK", "LHR", "2026-03-08", ["Economy", "Business"],
                                ["BA", "UA", "AS"], pax=1)
    assert "data" in body and isinstance(body["data"], list) and body["data"]
    for row in body["data"]:
        # fields _merge_award_edges reads
        assert "award_points" in row and isinstance(row["award_points"], int)
        assert "program_code" in row
        assert row["fare"]["products"], "must carry products for edge merge"
        assert row["source"] in (SOURCE_CHART, SOURCE_CASH_DERIVED, "dummy")
        assert 0 < row["confidence"] <= 1
    # BA rows must be exact chart values
    ba = [r for r in body["data"] if r["program_code"] == "BA" and r["cabin"] == "Business"]
    assert ba and ba[0]["award_points"] == 39000
    assert ba[0]["source"] == SOURCE_CHART

def test_search_hotels_shape_and_tagging():
    body = search_award_hotels("TYO", "2026-03-08", "2026-03-11", ["HYATT", "MAR"], guests=2)
    rows = body["data"]
    assert rows
    for r in rows:
        assert "points" in r and "program_code" in r and "name" in r
        assert r["source"] in (SOURCE_CHART, SOURCE_CASH_DERIVED, "dummy")
    hyatt = [r for r in rows if r["program_code"] == "HYATT"]
    assert hyatt and all(r["source"] == SOURCE_CHART for r in hyatt)

def test_search_calendar_runs():
    cal = search_award_calendar("JFK", "LHR")
    assert isinstance(cal, list)


# ---------------------------------------------------------------------------
# Determinism — chart layer must be stable across calls
# ---------------------------------------------------------------------------

def test_chart_pricing_is_deterministic():
    a = engine.quote_flight("BA", "JFK", "LHR", "business").award_points
    b = engine.quote_flight("BA", "JFK", "LHR", "business").award_points
    assert a == b == 39000
