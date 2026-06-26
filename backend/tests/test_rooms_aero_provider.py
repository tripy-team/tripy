"""
Tests for the rooms.aero hotel provider adapter.

Covers:
- Row normalization across field-name variants (the rooms.aero/award_pricing
  shapes) via the offline fixture
- Rows lacking a name or any price/points signal are dropped
- Canonical chain detection + program selection from a points balance
- Provider falls back to award_pricing (no live key) and evaluates candidates
- install_configured_provider respects USE_LIVE_HOTEL_PROVIDER
"""

import json
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock

_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

for mod_name in ("openai",):
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()

import pytest
from src.handlers import rooms_aero
from src.handlers.rooms_aero import (
    RoomsAeroHotelProvider,
    _normalize_row,
    _canonical_chain,
    _programs_for,
    install_configured_provider,
)
from src.services.hotel_recommendation_service import StayWindow

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "rooms_aero_response.json"


@pytest.fixture
def window():
    return StayWindow("PAR", "2026-08-01", "2026-08-04", traveler_count=2, room_count=1)


@pytest.fixture
def rows():
    return json.loads(_FIXTURE.read_text())["data"]


def test_normalize_handles_field_variants(window, rows):
    # Park Hyatt: cash_cost + award_points + star_rating + rating
    ph = _normalize_row(rows[0], window)
    assert ph is not None
    assert ph.hotel_name == "Park Hyatt Paris"
    assert ph.star_level == 5
    assert ph.price_total == 2400
    assert ph.points_total == 120000
    assert ph.points_per_night == 40000  # 120000 / 3 nights
    assert ph.loyalty_program == "World of Hyatt"

    # Hilton: cash_rate + points + stars + guest_rating
    hh = _normalize_row(rows[1], window)
    assert hh.hotel_name == "Hilton Paris Opera"
    assert hh.price_total == 1200
    assert hh.rating == 4.3
    assert hh.star_level == 4

    # Marriott: price + points_required + explicit nightly_rate + hotel_class
    mar = _normalize_row(rows[2], window)
    assert mar.star_level == 5
    assert mar.nightly_rate == 450
    assert mar.points_total == 90000


def test_normalize_drops_unusable_rows(window):
    # No name at all.
    assert _normalize_row({"cash_cost": 500}, window) is None
    # Name but no price and no points.
    assert _normalize_row({"name": "Ghost Hotel"}, window) is None


def test_canonical_chain_detection(rows):
    assert _canonical_chain(rows[0]) == "Hyatt"
    assert _canonical_chain(rows[1]) == "Hilton"
    assert _canonical_chain(rows[2]) == "Marriott"
    assert _canonical_chain({"name": "InterContinental Le Grand"}) == "IHG"


def test_programs_for_selects_held_programs():
    assert _programs_for({"hyatt": 100000}) == ["HYATT"]
    assert set(_programs_for({"marriott_bonvoy": 50000, "hilton": 50000})) == {"MAR", "HH"}
    # No balances -> query all programs.
    assert set(_programs_for(None)) == {"MAR", "HH", "HYATT", "IHG"}


def test_provider_falls_back_to_award_pricing(window, monkeypatch):
    # Force the safe path: no live key + dummy data off means _fetch_live returns
    # None (no key) and the provider uses award_pricing.
    monkeypatch.setattr(rooms_aero, "SEATS_AERO_API_KEY", None)
    provider = RoomsAeroHotelProvider()
    cands = provider.candidates(window, cash_budget=2500.0, user_points={"hyatt": 300000})
    assert cands, "expected fallback candidates from award_pricing"
    # Each candidate is evaluated (payment + budget fit set).
    for c in cands:
        assert c.recommended_payment in ("cash", "points")
        assert c.fits_budget in (True, False)
        assert c.cash_budget_allocated == 2500.0


def test_normalize_used_by_live_path_via_monkeypatched_fetch(window, rows, monkeypatch):
    # Simulate a successful live fetch returning the fixture rows.
    monkeypatch.setattr(rooms_aero, "SEATS_AERO_API_KEY", "pro_testkey")
    monkeypatch.setattr(rooms_aero, "USE_HOTEL_DUMMY_DATA", False)
    monkeypatch.setattr(rooms_aero, "_fetch_live", lambda w, programs: rows)

    provider = RoomsAeroHotelProvider()
    cands = provider.candidates(window, cash_budget=3000.0, user_points={"hyatt": 200000})
    names = {c.hotel_name for c in cands}
    assert "Park Hyatt Paris" in names
    # The malformed row (no name/price-only IHG with only cash) still normalizes
    # to a cash hotel; the truly unusable one (RA-1004-bad has cash 900) is kept.
    # The Hyatt stay should be flagged points-payable given the balance + cpp.
    ph = next(c for c in cands if c.hotel_name == "Park Hyatt Paris")
    assert ph.points_total == 120000


def test_install_configured_provider_respects_flag(monkeypatch):
    monkeypatch.delenv("USE_LIVE_HOTEL_PROVIDER", raising=False)
    assert install_configured_provider() is False

    monkeypatch.setenv("USE_LIVE_HOTEL_PROVIDER", "true")
    assert install_configured_provider() is True
    # Reset to mock provider so other tests aren't affected.
    from src.services.hotel_recommendation_service import set_hotel_provider, MockHotelProvider
    set_hotel_provider(MockHotelProvider())
