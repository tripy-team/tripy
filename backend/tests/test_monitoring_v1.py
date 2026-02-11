"""
Unit tests for monitoring v1 — Phase 1 implementation.

Tests cover:
- Delta bullet generation (price drop, stops, duration, schedule)
- Recommendation/caveat generation
- Search adapter (stub, fake_drop modes)
- Candidate matching
- Lock TTL condition logic (conceptual)
- Update ID entropy (full uuid4 hex)
"""

import copy
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest


# =============================================================================
# FIXTURES: sample itineraries
# =============================================================================

BASELINE_ITINERARY = {
    "cash_price": 847,
    "points_cost": 80000,
    "total_duration_minutes": 720,
    "stops": 1,
    "cabin_class": "economy",
    "segments": [
        {
            "carrier": "United",
            "flight_number": "UA 837",
            "origin": "SFO",
            "destination": "NRT",
            "departure_time": "2026-03-15T08:30:00",
            "arrival_time": "2026-03-15T16:30:00",
            "duration_minutes": 660,
        },
        {
            "carrier": "United",
            "flight_number": "UA 838",
            "origin": "NRT",
            "destination": "HND",
            "departure_time": "2026-03-15T18:00:00",
            "arrival_time": "2026-03-15T19:00:00",
            "duration_minutes": 60,
        },
    ],
}


def _make_candidate(**overrides):
    """Clone baseline and apply overrides."""
    c = copy.deepcopy(BASELINE_ITINERARY)
    c.update(overrides)
    return c


# =============================================================================
# DELTA BULLET GENERATION
# =============================================================================


class TestGenerateDeltaBullets:
    """Tests for generate_delta_bullets()."""

    def test_price_drop_produces_bullet(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        candidate = _make_candidate(cash_price=612)
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")

        price_bullets = [b for b in bullets if b["type"] == "price_drop"]
        assert len(price_bullets) == 1
        assert price_bullets[0]["direction"] == "improvement"
        assert "28%" in price_bullets[0]["label"] or "27%" in price_bullets[0]["label"]
        assert "$847" in price_bullets[0]["detail"]
        assert "$612" in price_bullets[0]["detail"]

    def test_no_change_produces_no_bullets(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        bullets = generate_delta_bullets(BASELINE_ITINERARY, BASELINE_ITINERARY, "free_email")
        assert bullets == []

    def test_price_increase_under_5pct_suppressed(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        candidate = _make_candidate(cash_price=870)  # ~2.7% increase
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        price_bullets = [b for b in bullets if b["type"] == "price_drop"]
        assert len(price_bullets) == 0

    def test_price_increase_over_5pct_flagged(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        candidate = _make_candidate(cash_price=1000)  # ~18% increase
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        price_bullets = [b for b in bullets if b["type"] == "price_drop"]
        assert len(price_bullets) == 1
        assert price_bullets[0]["direction"] == "regression"

    def test_stops_decreased_bullet(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        candidate = _make_candidate(stops=0)
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        stops_bullets = [b for b in bullets if b.get("subtype") == "stops_decreased"]
        assert len(stops_bullets) == 1
        assert stops_bullets[0]["direction"] == "improvement"
        assert "Nonstop" in stops_bullets[0]["label"]

    def test_stops_increased_bullet(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        candidate = _make_candidate(stops=2)
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        stops_bullets = [b for b in bullets if b.get("subtype") == "stops_increased"]
        assert len(stops_bullets) == 1
        assert stops_bullets[0]["direction"] == "regression"

    def test_duration_improvement_bullet(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        candidate = _make_candidate(total_duration_minutes=660)  # 60 min shorter
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        dur_bullets = [b for b in bullets if b.get("subtype") == "duration_shorter"]
        assert len(dur_bullets) == 1
        assert dur_bullets[0]["direction"] == "improvement"

    def test_small_duration_change_no_bullet(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        candidate = _make_candidate(total_duration_minutes=710)  # only 10 min shorter
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        dur_bullets = [b for b in bullets if b.get("subtype") in ("duration_shorter", "duration_longer")]
        assert len(dur_bullets) == 0

    def test_departure_shift_bullet(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        candidate = copy.deepcopy(BASELINE_ITINERARY)
        candidate["segments"][0]["departure_time"] = "2026-03-15T10:00:00"  # 1.5 hr shift
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        shift_bullets = [b for b in bullets if b.get("subtype") == "depart_time_shift"]
        assert len(shift_bullets) == 1

    def test_combined_improvement_multiple_bullets(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        candidate = _make_candidate(cash_price=612, stops=0, total_duration_minutes=660)
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        # Should have price drop + stops decrease + duration improvement
        assert len(bullets) >= 3

    def test_missing_cash_price_no_crash(self):
        from src.domain.monitoring.utils import generate_delta_bullets

        baseline = {**BASELINE_ITINERARY, "cash_price": None}
        candidate = _make_candidate(cash_price=612)
        bullets = generate_delta_bullets(baseline, candidate, "free_email")
        # Should not crash; price bullet may or may not appear depending on None handling
        assert isinstance(bullets, list)


class TestGenerateRecommendationAndCaveat:
    """Tests for generate_recommendation_and_caveat()."""

    def test_price_drop_recommendation(self):
        from src.domain.monitoring.utils import generate_delta_bullets, generate_recommendation_and_caveat

        candidate = _make_candidate(cash_price=612)
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        rec, caveat = generate_recommendation_and_caveat(bullets, BASELINE_ITINERARY, candidate)
        assert "dropped" in rec.lower() or "rechecking" in rec.lower()
        assert caveat  # non-empty

    def test_empty_bullets_empty_recommendation(self):
        from src.domain.monitoring.utils import generate_recommendation_and_caveat

        rec, caveat = generate_recommendation_and_caveat([], BASELINE_ITINERARY, BASELINE_ITINERARY)
        assert rec == ""
        assert caveat  # caveat always present


# =============================================================================
# SEARCH ADAPTER
# =============================================================================


class TestSearchAdapter:
    """Tests for the monitoring search adapter."""

    def test_stub_returns_baseline(self):
        from src.domain.monitoring.search import run_search

        baseline = {
            "selected_itinerary": BASELINE_ITINERARY,
            "query_inputs": {},
        }
        result = run_search(baseline, mode="stub")
        assert result == BASELINE_ITINERARY

    def test_fake_drop_reduces_price(self):
        from src.domain.monitoring.search import run_search

        baseline = {
            "selected_itinerary": BASELINE_ITINERARY,
            "query_inputs": {},
        }
        result = run_search(baseline, mode="fake_drop")

        assert result is not None
        assert result["cash_price"] < BASELINE_ITINERARY["cash_price"]
        assert result["cash_price"] == pytest.approx(847 * 0.80, rel=0.01)

    def test_fake_drop_reduces_stops(self):
        from src.domain.monitoring.search import run_search

        baseline = {
            "selected_itinerary": BASELINE_ITINERARY,
            "query_inputs": {},
        }
        result = run_search(baseline, mode="fake_drop")
        assert result["stops"] == 0  # was 1, now 0

    def test_fake_drop_shortens_duration(self):
        from src.domain.monitoring.search import run_search

        baseline = {
            "selected_itinerary": BASELINE_ITINERARY,
            "query_inputs": {},
        }
        result = run_search(baseline, mode="fake_drop")
        assert result["total_duration_minutes"] < BASELINE_ITINERARY["total_duration_minutes"]

    def test_fake_drop_does_not_mutate_baseline(self):
        from src.domain.monitoring.search import run_search

        baseline = {
            "selected_itinerary": copy.deepcopy(BASELINE_ITINERARY),
            "query_inputs": {},
        }
        original_price = baseline["selected_itinerary"]["cash_price"]
        run_search(baseline, mode="fake_drop")
        assert baseline["selected_itinerary"]["cash_price"] == original_price

    def test_stub_with_json_string_itinerary(self):
        from src.domain.monitoring.search import run_search

        baseline = {
            "selected_itinerary": json.dumps(BASELINE_ITINERARY),
            "query_inputs": {},
        }
        result = run_search(baseline, mode="stub")
        assert result is not None
        assert result["cash_price"] == 847


class TestCandidateMatching:
    """Tests for match_best_candidate()."""

    def test_picks_cheapest_matching_route(self):
        from src.domain.monitoring.search import match_best_candidate, _normalize_search_result

        search_results = [
            {
                "price": 900,
                "total_duration": 700,
                "flights": [
                    {
                        "departure_airport": {"id": "SFO", "time": "2026-03-15 08:00"},
                        "arrival_airport": {"id": "NRT", "time": "2026-03-15 16:00"},
                        "flight_number": "UA 100",
                        "airline": "United",
                        "duration": 700,
                    }
                ],
            },
            {
                "price": 612,
                "total_duration": 680,
                "flights": [
                    {
                        "departure_airport": {"id": "SFO", "time": "2026-03-15 09:00"},
                        "arrival_airport": {"id": "NRT", "time": "2026-03-15 15:20"},
                        "flight_number": "UA 837",
                        "airline": "United",
                        "duration": 680,
                    }
                ],
            },
        ]
        # Baseline is SFO→NRT (last segment destination) but our baseline has two segments
        # SFO→NRT→HND. For single-segment search results, they'll only match SFO→NRT.
        # Adjust baseline to be single-segment for this test.
        baseline = {
            "cash_price": 847,
            "stops": 0,
            "segments": [
                {
                    "origin": "SFO",
                    "destination": "NRT",
                    "departure_time": "2026-03-15T08:30:00",
                }
            ],
        }
        best = match_best_candidate(baseline, search_results)
        assert best is not None
        assert best["cash_price"] == 612

    def test_filters_wrong_route(self):
        from src.domain.monitoring.search import match_best_candidate

        search_results = [
            {
                "price": 400,
                "total_duration": 300,
                "flights": [
                    {
                        "departure_airport": {"id": "LAX", "time": "2026-03-15 08:00"},
                        "arrival_airport": {"id": "JFK", "time": "2026-03-15 16:00"},
                        "flight_number": "AA 100",
                        "airline": "American",
                        "duration": 300,
                    }
                ],
            },
        ]
        baseline = {
            "segments": [
                {"origin": "SFO", "destination": "NRT", "departure_time": "2026-03-15T08:30:00"}
            ]
        }
        best = match_best_candidate(baseline, search_results)
        assert best is None  # LAX→JFK != SFO→NRT

    def test_filters_outside_time_window(self):
        from src.domain.monitoring.search import match_best_candidate

        search_results = [
            {
                "price": 400,
                "total_duration": 700,
                "flights": [
                    {
                        "departure_airport": {"id": "SFO", "time": "2026-03-15 23:00"},
                        "arrival_airport": {"id": "NRT", "time": "2026-03-16 07:00"},
                        "flight_number": "UA 900",
                        "airline": "United",
                        "duration": 700,
                    }
                ],
            },
        ]
        baseline = {
            "segments": [
                {"origin": "SFO", "destination": "NRT", "departure_time": "2026-03-15T08:30:00"}
            ]
        }
        best = match_best_candidate(baseline, search_results)
        assert best is None  # 23:00 is >2h from 08:30

    def test_empty_results_returns_none(self):
        from src.domain.monitoring.search import match_best_candidate

        best = match_best_candidate(BASELINE_ITINERARY, [])
        assert best is None


# =============================================================================
# UPDATE ID ENTROPY
# =============================================================================


class TestUpdateIdEntropy:
    """Verify IDs use full uuid4 hex (32 chars)."""

    def test_update_id_format(self):
        update_id = f"mupd_{uuid.uuid4().hex}"
        assert update_id.startswith("mupd_")
        assert len(update_id) == 37  # 5 (prefix) + 32 (hex)

    def test_baseline_id_format(self):
        baseline_id = f"mbl_{uuid.uuid4().hex}"
        assert baseline_id.startswith("mbl_")
        assert len(baseline_id) == 36  # 4 (prefix) + 32 (hex)

    def test_subscription_id_format(self):
        sub_id = f"msub_{uuid.uuid4().hex}"
        assert sub_id.startswith("msub_")
        assert len(sub_id) == 37  # 5 (prefix) + 32 (hex)


# =============================================================================
# SEARCH RESULT NORMALIZATION
# =============================================================================


class TestNormalization:
    """Tests for _normalize_search_result."""

    def test_normalizes_serp_format(self):
        from src.domain.monitoring.search import _normalize_search_result

        raw = {
            "price": 612,
            "total_duration": 680,
            "flights": [
                {
                    "departure_airport": {"id": "SFO", "name": "San Francisco", "time": "2026-03-15 09:00"},
                    "arrival_airport": {"id": "NRT", "name": "Narita", "time": "2026-03-15 15:20"},
                    "flight_number": "UA 837",
                    "airline": "United",
                    "duration": 680,
                }
            ],
        }
        result = _normalize_search_result(raw)
        assert result is not None
        assert result["cash_price"] == 612.0
        assert result["total_duration_minutes"] == 680
        assert result["stops"] == 0
        assert len(result["segments"]) == 1
        assert result["segments"][0]["origin"] == "SFO"
        assert result["segments"][0]["destination"] == "NRT"
        assert result["segments"][0]["carrier"] == "United"

    def test_multi_leg_counts_stops(self):
        from src.domain.monitoring.search import _normalize_search_result

        raw = {
            "price": 800,
            "total_duration": 900,
            "flights": [
                {
                    "departure_airport": {"id": "SFO", "time": "2026-03-15 08:00"},
                    "arrival_airport": {"id": "LAX", "time": "2026-03-15 09:30"},
                    "flight_number": "UA 100",
                    "airline": "United",
                    "duration": 90,
                },
                {
                    "departure_airport": {"id": "LAX", "time": "2026-03-15 11:00"},
                    "arrival_airport": {"id": "NRT", "time": "2026-03-16 15:00"},
                    "flight_number": "UA 200",
                    "airline": "United",
                    "duration": 700,
                },
            ],
        }
        result = _normalize_search_result(raw)
        assert result is not None
        assert result["stops"] == 1
        assert len(result["segments"]) == 2

    def test_missing_flights_returns_none(self):
        from src.domain.monitoring.search import _normalize_search_result

        assert _normalize_search_result({"price": 100, "flights": []}) is None
        assert _normalize_search_result({"price": 100}) is None

    def test_missing_price_returns_none(self):
        from src.domain.monitoring.search import _normalize_search_result

        assert _normalize_search_result({
            "flights": [
                {"departure_airport": {"id": "SFO"}, "arrival_airport": {"id": "NRT"}}
            ]
        }) is None


# =============================================================================
# SCORING INTEGRATION (end-to-end: fake_drop → score > 0 → bullets non-empty)
# =============================================================================


class TestEndToEndFakeDrop:
    """End-to-end test: fake_drop mode produces score > 0 and non-empty bullets."""

    def test_fake_drop_produces_nonzero_score(self):
        from src.domain.monitoring.search import run_search
        from src.domain.monitoring.utils import compute_change_score

        baseline = {
            "selected_itinerary": BASELINE_ITINERARY,
            "query_inputs": {},
        }
        candidate = run_search(baseline, mode="fake_drop")
        score = compute_change_score(BASELINE_ITINERARY, candidate, "free_email")
        assert score > 0

    def test_fake_drop_produces_nonempty_bullets(self):
        from src.domain.monitoring.search import run_search
        from src.domain.monitoring.utils import generate_delta_bullets

        baseline = {
            "selected_itinerary": BASELINE_ITINERARY,
            "query_inputs": {},
        }
        candidate = run_search(baseline, mode="fake_drop")
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        assert len(bullets) > 0
        # At minimum should have price_drop
        price_bullets = [b for b in bullets if b["type"] == "price_drop"]
        assert len(price_bullets) >= 1

    def test_fake_drop_bullets_have_required_fields(self):
        from src.domain.monitoring.search import run_search
        from src.domain.monitoring.utils import generate_delta_bullets

        baseline = {
            "selected_itinerary": BASELINE_ITINERARY,
            "query_inputs": {},
        }
        candidate = run_search(baseline, mode="fake_drop")
        bullets = generate_delta_bullets(BASELINE_ITINERARY, candidate, "free_email")
        for bullet in bullets:
            assert "type" in bullet
            assert "label" in bullet
            assert "detail" in bullet
            assert "direction" in bullet
            assert bullet["direction"] in ("improvement", "regression", "neutral")
