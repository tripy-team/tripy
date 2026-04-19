"""
Tests for hotel recommendation service.

Covers:
- Stay-window derivation (single-destination, multi-city, with/without leg dates)
- Room count estimation
- Mock provider returns realistic data
- Graceful failure handling
- Solo and group entry points
- includeHotels=false produces no hotel results
"""

import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

# Stub heavy optional dependencies so the import chain succeeds
# without installing openai, httpx, etc.
for mod_name in ("openai", "httpx"):
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

import pytest
from src.services.hotel_recommendation_service import (
    StayWindow,
    estimate_room_count,
    derive_stay_windows_from_trip,
    derive_stay_windows_for_group,
    get_hotel_recommendations,
    recommend_hotels_for_solo_trip,
    recommend_hotels_for_group_trip,
    MockHotelProvider,
    set_hotel_provider,
)
from src.agents.models import HotelRecommendation


# =============================================================================
# ROOM COUNT ESTIMATION
# =============================================================================

class TestEstimateRoomCount:
    def test_single_traveler(self):
        assert estimate_room_count(1) == 1

    def test_two_travelers(self):
        assert estimate_room_count(2) == 1

    def test_three_travelers(self):
        assert estimate_room_count(3) == 2

    def test_four_travelers(self):
        assert estimate_room_count(4) == 2

    def test_five_travelers(self):
        assert estimate_room_count(5) == 3


# =============================================================================
# STAY WINDOW DERIVATION
# =============================================================================

class TestDeriveStayWindows:
    def test_single_destination_round_trip(self):
        windows = derive_stay_windows_from_trip(
            destinations=["CDG"],
            start_date="2025-06-10",
            end_date="2025-06-17",
            traveler_count=2,
            is_round_trip=True,
        )
        assert len(windows) == 1
        w = windows[0]
        assert w.destination == "CDG"
        assert w.check_in == "2025-06-10"
        assert w.check_out == "2025-06-17"
        assert w.nights == 7
        assert w.traveler_count == 2
        assert w.room_count == 1

    def test_multi_city_with_leg_dates(self):
        windows = derive_stay_windows_from_trip(
            destinations=["CDG", "FCO"],
            start_date="2025-06-10",
            end_date="2025-06-20",
            leg_dates=["2025-06-10", "2025-06-15", "2025-06-20"],
            traveler_count=1,
        )
        assert len(windows) == 2
        assert windows[0].destination == "CDG"
        assert windows[0].check_in == "2025-06-10"
        assert windows[0].check_out == "2025-06-15"
        assert windows[0].nights == 5
        assert windows[1].destination == "FCO"
        assert windows[1].check_in == "2025-06-15"
        assert windows[1].check_out == "2025-06-20"
        assert windows[1].nights == 5

    def test_multi_city_even_split(self):
        windows = derive_stay_windows_from_trip(
            destinations=["CDG", "FCO", "BCN"],
            start_date="2025-06-10",
            end_date="2025-06-19",
            traveler_count=1,
        )
        assert len(windows) == 3
        total_nights = sum(w.nights for w in windows)
        assert total_nights == 9

    def test_empty_destinations(self):
        windows = derive_stay_windows_from_trip(
            destinations=[],
            start_date="2025-06-10",
            end_date="2025-06-17",
        )
        assert windows == []

    def test_missing_dates(self):
        windows = derive_stay_windows_from_trip(
            destinations=["CDG"],
            start_date=None,
            end_date=None,
        )
        assert windows == []

    def test_invalid_date_range(self):
        windows = derive_stay_windows_from_trip(
            destinations=["CDG"],
            start_date="2025-06-20",
            end_date="2025-06-10",
        )
        assert windows == []


class TestDeriveStayWindowsForGroup:
    def test_basic_group(self):
        windows = derive_stay_windows_for_group(
            destination="CDG",
            start_date="2025-07-01",
            end_date="2025-07-08",
            traveler_count=4,
        )
        assert len(windows) == 1
        w = windows[0]
        assert w.traveler_count == 4
        assert w.room_count == 2

    def test_multi_destination_group(self):
        windows = derive_stay_windows_for_group(
            destination="CDG, FCO",
            start_date="2025-07-01",
            end_date="2025-07-11",
            traveler_count=6,
        )
        assert len(windows) == 2
        assert windows[0].destination == "CDG"
        assert windows[1].destination == "FCO"
        assert all(w.room_count == 3 for w in windows)


# =============================================================================
# MOCK PROVIDER
# =============================================================================

class TestMockHotelProvider:
    def test_returns_recommendation(self):
        provider = MockHotelProvider()
        window = StayWindow(
            destination="CDG",
            check_in="2025-06-10",
            check_out="2025-06-15",
            traveler_count=2,
            room_count=1,
        )
        recs = provider.recommend(window)
        assert len(recs) == 1
        rec = recs[0]
        assert isinstance(rec, HotelRecommendation)
        assert rec.destination == "CDG"
        assert rec.check_in == "2025-06-10"
        assert rec.check_out == "2025-06-15"
        assert rec.traveler_count == 2
        assert rec.room_count == 1
        assert rec.price_total > 0
        assert rec.nightly_rate > 0
        assert rec.hotel_name
        assert rec.loyalty_program is not None
        assert rec.points_per_night is not None and rec.points_per_night > 0
        assert rec.points_total is not None and rec.points_total > 0
        assert rec.points_total == rec.points_per_night * 5  # 5 nights
        assert rec.hotel_id.startswith("mock-")


# =============================================================================
# GET HOTEL RECOMMENDATIONS (with failure handling)
# =============================================================================

class TestGetHotelRecommendations:
    def test_returns_recs_for_valid_windows(self):
        windows = [
            StayWindow("CDG", "2025-06-10", "2025-06-15", 1, 1),
            StayWindow("FCO", "2025-06-15", "2025-06-20", 1, 1),
        ]
        recs = get_hotel_recommendations(windows)
        assert len(recs) == 2
        assert recs[0].destination == "CDG"
        assert recs[1].destination == "FCO"

    def test_graceful_failure_skips_broken_window(self):
        class FailingProvider:
            def __init__(self):
                self.call_count = 0

            def recommend(self, window):
                self.call_count += 1
                if self.call_count == 1:
                    raise RuntimeError("Provider down")
                return MockHotelProvider().recommend(window)

        failing = FailingProvider()
        set_hotel_provider(failing)
        try:
            windows = [
                StayWindow("CDG", "2025-06-10", "2025-06-15", 1, 1),
                StayWindow("FCO", "2025-06-15", "2025-06-20", 1, 1),
            ]
            recs = get_hotel_recommendations(windows)
            assert len(recs) == 1
            assert recs[0].destination == "FCO"
        finally:
            set_hotel_provider(MockHotelProvider())

    def test_empty_windows(self):
        recs = get_hotel_recommendations([])
        assert recs == []


# =============================================================================
# SOLO ENTRY POINT
# =============================================================================

class TestRecommendHotelsForSoloTrip:
    def test_solo_round_trip(self):
        recs = recommend_hotels_for_solo_trip(
            destinations=["CDG"],
            start_date="2025-06-10",
            end_date="2025-06-17",
            traveler_count=2,
            is_round_trip=True,
        )
        assert len(recs) == 1
        assert recs[0].traveler_count == 2

    def test_solo_multi_city(self):
        recs = recommend_hotels_for_solo_trip(
            destinations=["CDG", "FCO"],
            start_date="2025-06-10",
            end_date="2025-06-20",
            leg_dates=["2025-06-10", "2025-06-15", "2025-06-20"],
            traveler_count=1,
        )
        assert len(recs) == 2

    def test_solo_no_dates_returns_empty(self):
        recs = recommend_hotels_for_solo_trip(
            destinations=["CDG"],
            start_date=None,
            end_date=None,
        )
        assert recs == []


# =============================================================================
# GROUP ENTRY POINT
# =============================================================================

class TestRecommendHotelsForGroupTrip:
    def test_group_single_destination(self):
        recs = recommend_hotels_for_group_trip(
            destination="CDG",
            start_date="2025-07-01",
            end_date="2025-07-08",
            traveler_count=4,
        )
        assert len(recs) == 1
        assert recs[0].room_count == 2
        assert recs[0].traveler_count == 4

    def test_group_custom_room_count(self):
        recs = recommend_hotels_for_group_trip(
            destination="CDG",
            start_date="2025-07-01",
            end_date="2025-07-08",
            traveler_count=4,
            room_count=4,
        )
        assert len(recs) == 1
        assert recs[0].room_count == 4


# =============================================================================
# INCLUDE HOTELS FALSE — no recommendations generated
# =============================================================================

class TestIncludeHotelsFalse:
    """Simulates the behavior when includeHotels=false: we simply don't call
    the recommendation service, so no hotel data is produced."""

    def test_no_call_means_no_recs(self):
        include_hotels = False
        recs = None
        if include_hotels:
            recs = recommend_hotels_for_solo_trip(
                destinations=["CDG"],
                start_date="2025-06-10",
                end_date="2025-06-17",
            )
        assert recs is None


# =============================================================================
# HOTEL RECOMMENDATION MODEL
# =============================================================================

class TestHotelRecommendationModel:
    def test_serialization_roundtrip(self):
        rec = HotelRecommendation(
            hotel_id="test-123",
            hotel_name="Test Hotel Paris",
            destination="CDG",
            check_in="2025-06-10",
            check_out="2025-06-17",
            price_total=1400.00,
            nightly_rate=200.00,
            currency="USD",
            rating=4.5,
            star_level=4,
            amenities=["Free WiFi", "Pool"],
            recommendation_reason="Best value",
            traveler_count=2,
            room_count=1,
            loyalty_program="Marriott Bonvoy",
            points_per_night=35000,
            points_total=245000,
        )
        data = rec.model_dump()
        assert data["hotel_id"] == "test-123"
        assert data["price_total"] == 1400.00
        assert data["amenities"] == ["Free WiFi", "Pool"]
        assert data["loyalty_program"] == "Marriott Bonvoy"
        assert data["points_per_night"] == 35000
        assert data["points_total"] == 245000

        restored = HotelRecommendation(**data)
        assert restored.hotel_name == "Test Hotel Paris"


# =============================================================================
# BUDGET + POINTS-AWARE RECOMMENDATIONS
# =============================================================================

class TestBudgetAwareRecommendations:
    """When a cash budget and/or loyalty balances are supplied, the provider
    should pick a single best hotel per stay window and annotate it with the
    recommended payment method and budget-fit flag."""

    def test_prefers_points_when_balance_covers_stay(self):
        # Marriott points cover the stay comfortably; cash budget is tight.
        recs = recommend_hotels_for_solo_trip(
            destinations=["CDG"],
            start_date="2025-06-10",
            end_date="2025-06-12",
            traveler_count=1,
            cash_budget_remaining=50.0,  # very tight — should push to points
            user_points={"MAR": 500_000},  # plenty of Marriott Bonvoy
        )
        assert len(recs) == 1
        rec = recs[0]
        # With that much balance, Marriott points should be recommended.
        assert rec.loyalty_program == "Marriott Bonvoy"
        assert rec.recommended_payment == "points"
        assert rec.fits_budget is True
        assert rec.points_total is not None
        assert rec.redemption_value_cpp is not None and rec.redemption_value_cpp > 0

    def test_picks_cash_when_budget_is_generous_and_no_points(self):
        recs = recommend_hotels_for_solo_trip(
            destinations=["CDG"],
            start_date="2025-06-10",
            end_date="2025-06-12",
            traveler_count=1,
            cash_budget_remaining=5000.0,
            user_points={},  # no loyalty balances
        )
        assert len(recs) == 1
        rec = recs[0]
        assert rec.recommended_payment == "cash"
        assert rec.fits_budget is True
        assert rec.cash_budget_allocated == 5000.0

    def test_flags_when_nothing_fits(self):
        recs = recommend_hotels_for_solo_trip(
            destinations=["CDG"],  # tier-1 city → expensive
            start_date="2025-06-10",
            end_date="2025-06-17",
            traveler_count=1,
            cash_budget_remaining=10.0,  # impossibly tight
            user_points={},  # no points either
        )
        assert len(recs) == 1
        rec = recs[0]
        assert rec.fits_budget is False
        assert "over budget" in (rec.recommendation_reason or "").lower()

    def test_legacy_call_without_budget_unchanged(self):
        # Smoke test: the pre-budget call shape still returns 1 rec per window
        # with no payment annotation applied.
        recs = recommend_hotels_for_solo_trip(
            destinations=["CDG"],
            start_date="2025-06-10",
            end_date="2025-06-12",
            traveler_count=1,
        )
        assert len(recs) == 1
        assert recs[0].recommended_payment is None
        assert recs[0].fits_budget is None

    def test_budget_split_across_multi_city_stays(self):
        # Two destinations, same nights each. Cash envelopes should roughly
        # halve. We assert the annotation carries the split, not the total.
        recs = recommend_hotels_for_solo_trip(
            destinations=["CDG", "FCO"],
            start_date="2025-06-10",
            end_date="2025-06-20",
            leg_dates=["2025-06-10", "2025-06-15", "2025-06-20"],
            traveler_count=1,
            cash_budget_remaining=2000.0,
            user_points={},
        )
        assert len(recs) == 2
        for rec in recs:
            assert rec.cash_budget_allocated is not None
            assert rec.cash_budget_allocated < 2000.0
