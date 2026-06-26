"""
Tests for the categorized hotel suggestion engine.

Covers:
- Scoring primitives (star/rating/amenity/cost/points)
- Best Value / Best Points / Best Stay selection + distinctness
- Best Points omitted when nothing is points-payable
- Budget enforcement: over-budget candidate surfaced with a risk note
- suggest_hotels_for_solo_trip end-to-end against the mock provider
"""

import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

for mod_name in ("openai", "httpx"):
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

import pytest
from src.agents.models import HotelRecommendation
from src.services.hotel_recommendation_service import (
    evaluate_payment_and_budget,
    set_hotel_provider,
    MockHotelProvider,
    suggest_hotels_for_solo_trip,
)
from src.services.hotel_suggestion_engine import (
    generate_hotel_suggestions,
    CAT_BEST_VALUE,
    CAT_BEST_POINTS,
    CAT_BEST_STAY,
    _quality_score,
    _cost_score,
)


def _rec(hotel_id, name, *, price, points, star, rating, loyalty="World of Hyatt",
         amenities=None):
    return HotelRecommendation(
        hotel_id=hotel_id,
        hotel_name=name,
        destination="PAR",
        check_in="2026-08-01",
        check_out="2026-08-04",
        price_total=price,
        nightly_rate=round(price / 3, 2),
        star_level=star,
        rating=rating,
        amenities=amenities or [],
        loyalty_program=loyalty,
        points_per_night=int(points / 3) if points else None,
        points_total=points,
    )


def _evaluated(rec, chain, cash_budget, user_points):
    return evaluate_payment_and_budget(rec, chain, cash_budget, user_points)


@pytest.fixture(autouse=True)
def _reset_provider():
    # Keep the global provider deterministic across tests.
    set_hotel_provider(MockHotelProvider())
    yield
    set_hotel_provider(MockHotelProvider())


def test_quality_score_rewards_stars_rating_amenities():
    high = _rec("a", "A", price=1000, points=0, star=5, rating=4.8, amenities=["Spa", "Pool"])
    low = _rec("b", "B", price=1000, points=0, star=3, rating=3.5, amenities=[])
    assert _quality_score(high, ["Spa", "Pool"]) > _quality_score(low, ["Spa", "Pool"])


def test_cost_score_points_payment_is_cheapest():
    rec = _rec("a", "A", price=1500, points=80000, star=5, rating=4.5)
    _evaluated(rec, "Hyatt", cash_budget=2000, user_points={"hyatt": 200000})
    assert rec.recommended_payment == "points"
    assert _cost_score(rec) == 1.0  # covered by points -> zero cash outlay


def test_three_distinct_categories_selected():
    # Two points-payable hotels (differing cpp) + one cash luxury leader. This is
    # the realistic shape that yields all three distinct categories: a points
    # hotel covers value, the higher-cpp points hotel is the points play, and the
    # 5-star cash property wins on quality.
    cands = [
        _rec("p_low", "Hyatt Place", price=1500, points=120000, star=4, rating=4.3),
        _rec("p_high", "Hyatt Centric", price=2000, points=50000, star=4, rating=4.2),
        _rec("lux", "Park Hyatt", price=2800, points=None, star=5, rating=4.9,
             amenities=["Spa", "Pool"]),
    ]
    for c in cands:
        _evaluated(c, "Hyatt", cash_budget=3000, user_points={"hyatt": 500000})

    suggestions = generate_hotel_suggestions(cands, budget_style="moderate",
                                             preferred_amenities=["Spa"])
    cats = {s.category for s in suggestions}
    assert cats == {CAT_BEST_VALUE, CAT_BEST_POINTS, CAT_BEST_STAY}
    # All picks are distinct hotels.
    ids = [s.recommendation.hotel_id for s in suggestions]
    assert len(ids) == len(set(ids))
    # Best Stay should be the 5-star property.
    best_stay = next(s for s in suggestions if s.category == CAT_BEST_STAY)
    assert best_stay.recommendation.star_level == 5
    # Best Points should be the higher-cpp points hotel (Hyatt Centric, cpp 4.0).
    best_points = next(s for s in suggestions if s.category == CAT_BEST_POINTS)
    assert best_points.recommendation.hotel_id == "p_high"


def test_best_points_omitted_when_no_points_payable():
    # No loyalty balance -> nothing is points-payable.
    cands = [
        _rec("a", "Cash Only A", price=800, points=None, star=4, rating=4.2),
        _rec("b", "Cash Only B", price=1200, points=None, star=5, rating=4.6),
    ]
    for c in cands:
        _evaluated(c, "Hyatt", cash_budget=2000, user_points=None)
    suggestions = generate_hotel_suggestions(cands, budget_style="moderate")
    assert all(s.category != CAT_BEST_POINTS for s in suggestions)
    assert {s.category for s in suggestions} == {CAT_BEST_VALUE, CAT_BEST_STAY}


def test_over_budget_surfaced_with_risk_note():
    rec = _rec("a", "Pricey", price=5000, points=None, star=5, rating=4.9)
    _evaluated(rec, "Hyatt", cash_budget=1000, user_points=None)
    assert rec.fits_budget is False
    suggestions = generate_hotel_suggestions([rec], budget_style="moderate")
    assert len(suggestions) >= 1
    risks = suggestions[0].risks
    assert any("budget" in r.lower() for r in risks)


def test_empty_candidates_returns_empty():
    assert generate_hotel_suggestions([], budget_style="moderate") == []


def test_suggest_hotels_for_solo_trip_end_to_end():
    groups = suggest_hotels_for_solo_trip(
        destinations=["NYC"],
        start_date="2026-07-01",
        end_date="2026-07-05",
        traveler_count=2,
        client_preferences={"preferred_hotel_amenities": ["Pool"]},
        cash_budget_remaining=2000.0,
        user_points={"marriott": 300000, "hyatt": 300000},
        budget_style="premium",
    )
    assert len(groups) == 1
    group = groups[0]
    assert group.destination == "NYC"
    assert group.nights == 4
    assert group.cash_budget_allocated == 2000.0
    assert 1 <= len(group.suggestions) <= 3
    # Every suggestion carries a label and a "why".
    for s in group.suggestions:
        assert s.label
        assert s.why_this_option
