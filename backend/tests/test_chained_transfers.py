"""
Tests for hotel-as-source, chained (bank -> hotel -> airline) transfers, the
threshold top-up path, and the single-hop regression guard.

Covers:
  - config graph: hotels are transfer sources; chained paths compose correctly
  - strategy layer: chained top-up clears an award a single hop cannot
  - strategy layer: a plain bank->airline transfer is unchanged (regression)
  - scraper: a hotel-source bonus row parses; staleness circuit-breaker
  - ILP adapter: chained edges appear under the flag with no key collisions
"""

import os

import pytest

from src.config.programs import (
    EXTENDED_TRANSFER_GRAPH,
    CHAINED_TRANSFER_PATHS,
    get_chained_paths,
    HOTEL_PROGRAMS_SET,
)
from src.handlers.transfer_strategy import compute_points_strategy


# ---------------------------------------------------------------------------
# Minimal segment / payment stubs (duck-typed like the real models)
# ---------------------------------------------------------------------------

class _Payment:
    def __init__(self, program, points, surcharge=0.0):
        self.method = "points"
        self.program = program
        self.points_used = points
        self.surcharge = surcharge


class _Seg:
    def __init__(self, program, points, origin="SFO", dest="NRT", airline="UA"):
        self.payment = _Payment(program, points)
        self.origin = origin
        self.destination = dest
        self.airline = airline


# ---------------------------------------------------------------------------
# Phase 1: config graph
# ---------------------------------------------------------------------------

def test_hotels_are_transfer_sources():
    # Marriott can source an airline transfer; Hyatt intentionally cannot.
    assert "MAR" in EXTENDED_TRANSFER_GRAPH
    assert EXTENDED_TRANSFER_GRAPH["MAR"]["UA"]["ratio"] == pytest.approx(0.333)
    assert "HYATT" not in EXTENDED_TRANSFER_GRAPH  # no airline partners


def test_chained_paths_compose_ratios():
    paths = get_chained_paths("amex", "UA")
    assert paths, "expected amex -> hotel -> UA chains"
    mar = next(p for p in paths if p["via"] == "MAR")
    # amex->Marriott is 1:1, Marriott->UA is 3:1 -> compound 0.333
    assert mar["base_compound_ratio"] == pytest.approx(0.333)
    assert mar["leg_ratios"] == [1.0, pytest.approx(0.333)]


def test_chained_paths_global_nonempty():
    assert len(CHAINED_TRANSFER_PATHS) > 0
    assert all({"source", "via", "destination"} <= set(p) for p in CHAINED_TRANSFER_PATHS)


# ---------------------------------------------------------------------------
# Phase 2: strategy layer — threshold top-up
# ---------------------------------------------------------------------------

def test_chained_top_up_clears_threshold():
    # Amex does NOT transfer to United directly, and the traveler holds only
    # Amex. A chain Amex -> Marriott -> United should be surfaced to clear 60k UA.
    res = compute_points_strategy(
        segments=[_Seg("UA", 60000)],
        transfers=[],
        available_points={"amex": 200000},
        days_until_travel=30,
    )
    prog = res["programs"][0]
    assert prog["airline_program"] == "UA"
    chained = [s for s in prog["sources"] if s["is_chained"]]
    assert len(chained) == 1
    src = chained[0]
    assert src["via_program"] == "MAR"
    assert src["resulting_points"] >= 60000  # never under-delivers the threshold
    assert src["top_up_reason"]


def test_no_top_up_when_single_hop_suffices():
    # Citi -> AA is a direct 1:1 transfer; no chain should be needed.
    res = compute_points_strategy(
        segments=[_Seg("AA", 50000)],
        transfers=[],
        available_points={"citi": 80000},
        days_until_travel=30,
    )
    prog = res["programs"][0]
    assert not any(s["is_chained"] for s in prog["sources"])


# ---------------------------------------------------------------------------
# Phase 2: regression — single-hop transfers pass through unchanged
# ---------------------------------------------------------------------------

def test_single_hop_transfer_passthrough_regression():
    # An itinerary-attached bank->airline transfer must render as a plain,
    # non-chained, bank-typed source (shape unchanged from before this feature).
    transfer = {
        "from_program": "chase",
        "to_program": "UA",
        "points_to_transfer": 60000,
        "ratio": 1.0,
        "transfer_time": "Instant",
        "portal_url": "https://chase.com",
        "is_direct": False,
    }
    res = compute_points_strategy(
        segments=[_Seg("UA", 60000)],
        transfers=[transfer],
        available_points={"chase": 60000},
        days_until_travel=30,
    )
    prog = res["programs"][0]
    transfer_sources = [s for s in prog["sources"] if s["is_transfer"]]
    assert len(transfer_sources) == 1
    s = transfer_sources[0]
    assert s["is_chained"] is False
    assert s["source_type"] == "bank"
    assert s["via_program"] is None
    assert prog["total_points_available"] == 60000


# ---------------------------------------------------------------------------
# Phase 0: scraper — hotel-source parsing + staleness breaker
# ---------------------------------------------------------------------------

def test_scraper_parses_hotel_source_row():
    from src.services.transfer_bonus_scraper import _scrape_and_parse

    html = """
    <table>
      <tr><th>Transfer from</th><th>Transfer to</th><th>Bonus</th><th>End date</th></tr>
      <tr><td>Marriott Bonvoy</td><td>United MileagePlus</td><td>30%</td><td>Dec. 31, 2026</td></tr>
    </table>
    """
    records = _scrape_and_parse(html)
    assert len(records) == 1
    rec = records[0]
    assert rec.bank_code == "MAR"          # hotel is now a valid source
    assert rec.source_category == "hotel"
    assert rec.program_code == "UA"
    assert rec.bonus_pct == 30.0


def test_staleness_circuit_breaker():
    from datetime import datetime, timedelta
    from src.services import transfer_bonus_scraper as s

    with s._cache.lock:
        s._cache.last_refreshed = datetime.utcnow()
    assert s.bonuses_are_fresh(max_age_hours=48) is True

    with s._cache.lock:
        s._cache.last_refreshed = datetime.utcnow() - timedelta(hours=72)
    assert s.bonuses_are_fresh(max_age_hours=48) is False


# ---------------------------------------------------------------------------
# Phase 3: ILP adapter — chained edges under the flag, no collisions
# ---------------------------------------------------------------------------

def test_adapter_chained_edges_flagged(monkeypatch):
    from src.optimization import adapter_v3

    # Flag OFF -> no chain edges.
    monkeypatch.setenv("ENABLE_CHAINED_TRANSFERS", "false")
    paths_off = adapter_v3.build_transfer_paths({"amex": 200000})
    assert all(p.via is None for p in paths_off)

    # Flag ON -> chain edges appear, with no (from_bank, to_program) collisions
    # against direct edges and no duplicate chain keys.
    monkeypatch.setenv("ENABLE_CHAINED_TRANSFERS", "true")
    paths_on = adapter_v3.build_transfer_paths({"amex": 200000})
    chains = [p for p in paths_on if p.via]
    assert chains, "expected chain edges with the flag on"

    direct_keys = {(p.from_bank, p.to_program) for p in paths_on if p.via is None}
    chain_keys = [(p.from_bank, p.to_program) for p in chains]
    assert not (set(chain_keys) & direct_keys), "chain edge collides with a direct edge"
    assert len(chain_keys) == len(set(chain_keys)), "duplicate chain edge keys"
