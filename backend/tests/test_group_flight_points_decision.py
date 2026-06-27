"""
Regression tests for group-trip flight pricing: points must actually reach the
payment decision, and taxes/surcharge must be charged when points are redeemed.

Covers two bugs found while debugging "results page shows no flights / only cash":

1. Field-name mapping. ``_search_one_route`` adapts ``ConnectingFlightOption``
   objects into the optimizer's option dicts. It previously read non-existent
   attributes (``cash_price``, ``award_options``, ``marketing_airline``), so every
   flight came back with ``cash_cost=0`` and ``points_options=[]`` and was dropped
   by the ``cash_cost > 0 or points_options`` filter — the traveler ended up with
   0 flights. The model actually exposes ``cash_price_usd`` / ``points_cost`` /
   ``points_program`` / ``surcharge_usd`` / ``marketing_carriers``.

2. Points + taxes in the decision. When the ILP redeems points it must still
   charge the surcharge (taxes/fees) as cash. A points allocation should carry
   ``cash_paid == surcharge`` and beat the all-cash baseline.
"""

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch, AsyncMock
from datetime import date

import pytest

# Dummy AWS creds so import-time boto3 clients (src.services.image_service) don't
# try the login credential provider. Must be set before importing the service.
os.environ.setdefault("AWS_ACCESS_KEY_ID", "test")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "test")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

# backend/ on path for internal `from src...`; repo root for `from backend.src...`
_backend = Path(__file__).resolve().parent.parent
for p in (str(_backend), str(_backend.parent)):
    if p not in sys.path:
        sys.path.insert(0, p)

from backend.src.handlers.solo_trip.models import ConnectingFlightOption, CabinClass
from backend.src.services.group_optimization_service import (
    _search_one_route,
    _build_booking_items,
    _normalize_local_time,
)
from backend.src.handlers.group_oop_optimizer import (
    GroupMember,
    GroupPointsPool,
    MemberBookingItem,
    GroupPointsOption,
    PaymentType,
    minimize_group_out_of_pocket_two_phase,
)
from backend.src.handlers.group_points_pooling import (
    aggregate_group_points,
    resolve_program_key,
)
from backend.src.handlers.transfer_strategy import EXTENDED_TRANSFER_GRAPH


def _make_option(**overrides):
    """A minimal award-priced ConnectingFlightOption (legs empty to stay hermetic)."""
    base = dict(
        option_id="opt1",
        option_type="award",
        origin="SFO",
        destination="HND",
        is_direct=True,
        num_stops=0,
        legs=[],
        layovers=[],
        total_duration_minutes=752,
        flight_time_minutes=752,
        cash_price_usd=3557.0,
        points_cost=42500,
        points_program="NH",
        surcharge_usd=85.0,
        marketing_carriers=["NH"],
        airlines=["NH"],
    )
    base.update(overrides)
    return ConnectingFlightOption(**base)


def test_search_one_route_maps_pricing_and_points_fields():
    """The adapter must read the real model fields, so an award flight survives
    the keep-filter with both its cash price and a points option."""
    option = _make_option()
    fake_result = SimpleNamespace(options=[option])

    traveler = {"traveler_id": "t1", "points": {}, "cabin_preference": "business"}
    with patch(
        "src.handlers.solo_trip.flight_searcher.ComprehensiveFlightSearcher.search_all_options",
        new=AsyncMock(return_value=fake_result),
    ):
        opts = asyncio.run(
            _search_one_route(traveler, "SFO", "HND", date(2026, 9, 15), CabinClass.BUSINESS)
        )

    assert len(opts) == 1, "award flight was dropped — pricing fields not mapped"
    opt = opts[0]
    assert opt["cash_cost"] == 3557.0
    assert opt["airline"] == "NH"
    assert opt["points_options"] == [
        {"program_code": "NH", "points_required": 42500, "surcharge": 85.0}
    ]


def test_award_flight_with_zero_cash_still_kept_via_points():
    """A pure-award flight (no cash price) must still be kept because it has a
    points option — the old bug dropped these entirely."""
    option = _make_option(cash_price_usd=0.0)
    fake_result = SimpleNamespace(options=[option])
    traveler = {"traveler_id": "t1", "points": {}, "cabin_preference": "business"}
    with patch(
        "src.handlers.solo_trip.flight_searcher.ComprehensiveFlightSearcher.search_all_options",
        new=AsyncMock(return_value=fake_result),
    ):
        opts = asyncio.run(
            _search_one_route(traveler, "SFO", "HND", date(2026, 9, 15), CabinClass.BUSINESS)
        )
    assert len(opts) == 1
    assert opts[0]["points_options"][0]["points_required"] == 42500


def test_optimizer_redeems_points_and_charges_surcharge():
    """Given a member with enough points and a beneficial award option, the ILP
    should redeem points and charge ONLY the surcharge in cash (not the fare)."""
    member = GroupMember(
        user_id="alice",
        name="Alice",
        points_balances={"NH": 100_000},
        party_size=1,
    )
    item = MemberBookingItem(
        item_id="flight_alice",
        member_id="alice",
        item_type="flight",
        description="SFO->HND",
        cash_cost=3557.0,
        points_options=[
            GroupPointsOption(
                program_code="NH",
                points_required=42500,
                surcharge=85.0,
                available_from=["alice"],
            )
        ],
        party_size=1,
    )
    pool = GroupPointsPool(
        total_by_program={"NH": 100_000},
        by_member={"alice": {"NH": 100_000}},
        shareable_pool={"NH": 100_000},
    )

    solution, _meta = minimize_group_out_of_pocket_two_phase([member], [item], pool)

    assert solution.allocations, "solver returned no allocations"
    alloc = solution.allocations[0]
    assert alloc.payment_type == PaymentType.POINTS, "points were not used for the flight"
    assert alloc.points_used == 42500
    assert alloc.program_used == "NH"
    # Taxes/fees must still be paid in cash — and ONLY the taxes, not the fare.
    assert alloc.cash_paid == pytest.approx(85.0)
    # Redeeming should beat paying the full fare.
    assert solution.total_group_oop < 3557.0


def test_resolve_program_key_handles_display_names_and_codes():
    """Balances are stored as human display names ("Amex Membership Rewards"),
    but pooling/transfer logic keys off canonical codes. Both forms — and bare
    codes — must resolve to the same canonical key."""
    # Banks -> lowercase short code.
    assert resolve_program_key("Amex Membership Rewards") == "amex"
    assert resolve_program_key("American Express Membership Rewards") == "amex"
    assert resolve_program_key("Chase Ultimate Rewards") == "chase"
    assert resolve_program_key("amex") == "amex"
    # Airlines/hotels -> uppercase code, by display name or bare code.
    assert resolve_program_key("ANA Mileage Club") == "NH"
    assert resolve_program_key("NH") == "NH"
    assert resolve_program_key("UA") == "UA"


def test_transferable_bank_points_fund_flight_award_via_transfer():
    """A member holding only transferable bank points (Amex), stored under its
    display name, must be able to fund a flight award through a bank->airline
    transfer. Before the normalization fix, ``pool.by_member`` keyed Amex as
    'AMEX MEMBERSHIP REWARDS', the bank lookup missed it, and the solver was
    forced to pay the full cash fare."""
    sam = GroupMember(
        user_id="sam",
        name="Sam Rivera",
        points_balances={"Amex Membership Rewards": 120_000},
    )
    pool = aggregate_group_points([sam])
    # Amex must be recognized as a transferable bank in the aggregated pool.
    assert pool.by_member["sam"].get("amex") == 120_000

    item = MemberBookingItem(
        item_id="flight_sam",
        member_id="sam",
        item_type="flight",
        description="JFK->NRT first",
        cash_cost=7491.0,
        points_options=[
            GroupPointsOption(
                program_code="NH",
                points_required=85_000,
                surcharge=120.0,
                available_from=["sam"],
            )
        ],
        party_size=1,
    )
    solution, _meta = minimize_group_out_of_pocket_two_phase(
        [sam], [item], pool, transfer_graph=EXTENDED_TRANSFER_GRAPH
    )

    alloc = solution.allocations[0]
    assert alloc.payment_type == PaymentType.POINTS, "transferable bank points were not used"
    assert alloc.program_used == "NH"
    assert alloc.cash_paid == pytest.approx(120.0)  # taxes only, not the fare
    # The solver should plan an Amex -> NH transfer to fund the redemption.
    assert any(
        t.from_program == "amex" and t.to_program == "NH" for t in solution.transfer_plan
    ), "expected an Amex->NH transfer in the plan"


def test_normalize_local_time_strips_iso_and_pads():
    """Departure time must reduce to HH:MM whether it arrives clean or as a full
    ISO datetime (synthetic/award data leaks the latter)."""
    assert _normalize_local_time("13:15") == "13:15"
    assert _normalize_local_time("2026-06-30T12:30:00") == "12:30"
    assert _normalize_local_time("2026-06-30T12:30:00Z") == "12:30"
    assert _normalize_local_time("08:05:00") == "08:05"
    assert _normalize_local_time(None) is None
    assert _normalize_local_time("") is None
    assert _normalize_local_time("garbage") is None


def _flight_opt():
    return {
        "flight_id": "f1", "origin": "JFK", "destination": "NRT", "date": "2026-09-15",
        "departure_time": "13:15", "duration_minutes": 800, "airline": "NH",
        "cash_cost": 7491.0,
        "points_options": [{"program_code": "NH", "points_required": 85000, "surcharge": 120.0}],
    }


def test_allow_flight_points_false_suppresses_points_options():
    """A traveler who disabled award flights must get cash-only booking items so
    the solver never spends their points on flights (they stay for others)."""
    sam = GroupMember(user_id="sam", name="Sam", points_balances={"Amex Membership Rewards": 120_000})
    pool = aggregate_group_points([sam])

    on = _build_booking_items("sam", [_flight_opt()], pool, leg_index=0, leg_label="Tokyo",
                              allow_flight_points=True)
    off = _build_booking_items("sam", [_flight_opt()], pool, leg_index=0, leg_label="Tokyo",
                               allow_flight_points=False)

    assert len(on[0].points_options) == 1, "points option should be present by default"
    assert off[0].points_options == [], "disabling flight points must drop points options"
    # The cash baseline is unaffected either way.
    assert off[0].cash_cost == 7491.0


def _two_member_pool(sam, eric):
    return aggregate_group_points([sam, eric])


def test_allow_flight_points_false_blocks_funding_others_flights():
    """A member with allow_flight_points=False must not fund ANY flight — not
    their own and not another member's — even when they hold usable points."""
    sam = GroupMember(user_id="sam", name="Sam", points_balances={"NH": 200_000},
                      allow_flight_points=False)
    eric = GroupMember(user_id="eric", name="Eric", points_balances={})
    pool = _two_member_pool(sam, eric)
    # Eric's flight has an NH award; only Sam holds NH points.
    item = MemberBookingItem(
        item_id="flight_eric", member_id="eric", item_type="flight", description="x",
        cash_cost=3000.0,
        points_options=[GroupPointsOption(program_code="NH", points_required=80_000,
                                          surcharge=80.0, available_from=["sam"])],
        party_size=1,
    )
    sol, _ = minimize_group_out_of_pocket_two_phase([sam, eric], [item], pool)
    alloc = sol.allocations[0]
    assert alloc.payment_type == PaymentType.CASH, "Sam's points should be barred from flights"


def test_allow_transfer_partners_false_blocks_bank_transfer():
    """allow_transfer_partners=False means only DIRECT balances are usable — a
    bank→airline transfer must not be planned for that member."""
    # Sam holds only Amex (transferable) and disabled transfers; the only award
    # is NH, reachable from Amex only via transfer → must fall back to cash.
    sam = GroupMember(user_id="sam", name="Sam",
                      points_balances={"Amex Membership Rewards": 200_000},
                      allow_transfer_partners=False)
    pool = aggregate_group_points([sam])
    item = MemberBookingItem(
        item_id="flight_sam", member_id="sam", item_type="flight", description="x",
        cash_cost=3000.0,
        points_options=[GroupPointsOption(program_code="NH", points_required=80_000,
                                          surcharge=80.0, available_from=["sam"])],
        party_size=1,
    )
    sol, _ = minimize_group_out_of_pocket_two_phase(
        [sam], [item], pool, transfer_graph=EXTENDED_TRANSFER_GRAPH)
    alloc = sol.allocations[0]
    assert alloc.payment_type == PaymentType.CASH, "no transfer allowed → must pay cash"
    assert not sol.transfer_plan, "no bank→airline transfer should be planned"


def test_allow_transfer_partners_true_still_transfers():
    """Control: with transfers allowed, the same Amex balance DOES fund the NH
    award via transfer (confirms the block above is the preference, not a dead path)."""
    sam = GroupMember(user_id="sam", name="Sam",
                      points_balances={"Amex Membership Rewards": 200_000},
                      allow_transfer_partners=True)
    pool = aggregate_group_points([sam])
    item = MemberBookingItem(
        item_id="flight_sam", member_id="sam", item_type="flight", description="x",
        cash_cost=3000.0,
        points_options=[GroupPointsOption(program_code="NH", points_required=80_000,
                                          surcharge=80.0, available_from=["sam"])],
        party_size=1,
    )
    sol, _ = minimize_group_out_of_pocket_two_phase(
        [sam], [item], pool, transfer_graph=EXTENDED_TRANSFER_GRAPH)
    assert sol.allocations[0].payment_type == PaymentType.POINTS
    assert any(t.from_program == "amex" and t.to_program == "NH" for t in sol.transfer_plan)


def test_max_point_value_contribution_cap_limits_cross_member_subsidy():
    """A member's cross-member point contribution is capped at their max USD
    value. With a tiny cap, the subsidy must not happen (cash instead)."""
    sam = GroupMember(user_id="sam", name="Sam", points_balances={"NH": 200_000},
                      max_point_value_contribution_usd=100.0)  # ~6,600 pts at 1.5c
    eric = GroupMember(user_id="eric", name="Eric", points_balances={})
    pool = aggregate_group_points([sam, eric])
    item = MemberBookingItem(
        item_id="flight_eric", member_id="eric", item_type="flight", description="x",
        cash_cost=3000.0,
        points_options=[GroupPointsOption(program_code="NH", points_required=80_000,
                                          surcharge=80.0, available_from=["sam"])],
        party_size=1,
    )
    sol, _ = minimize_group_out_of_pocket_two_phase([sam, eric], [item], pool)
    # 80k pts * 1.5c = $1,200 >> $100 cap → Sam can't subsidize → cash.
    assert sol.allocations[0].payment_type == PaymentType.CASH


# --- Settlement fairness: consumption base + points-sacrifice reward ----------

from unittest.mock import patch as _patch
from backend.src.services.group_split_calculator import calculate_settlement


def _settle(travelers, assignments, ledger):
    with _patch(
        "backend.src.services.group_split_calculator.repo.get_settlements_for_trip",
        return_value=[],
    ):
        rows = calculate_settlement("trip", assignments, ledger, travelers)
    return {r["travelerProfileId"]: r for r in rows}


def test_more_points_contributor_gets_cash_back():
    """Same trip cost; one pays cash, the other points. The points payer must be
    reimbursed in cash, and the settlement is zero-sum."""
    travelers = [{"travelerId": "sam", "displayName": "Sam"},
                 {"travelerId": "eric", "displayName": "Eric"}]
    assignments = [
        {"travelerProfileId": "sam", "itemType": "flight", "cashCost": 5000, "imputedPointsValueUsd": 0},
        {"travelerProfileId": "eric", "itemType": "flight", "cashCost": 0, "imputedPointsValueUsd": 5000},
    ]
    ledger = [
        {"travelerProfileId": "sam", "entryType": "cash_paid", "amountUsd": 5000},
        {"travelerProfileId": "eric", "entryType": "points_used", "amountUsd": 5000},
    ]
    s = _settle(travelers, assignments, ledger)
    assert s["eric"]["netCreditUsd"] > 0, "points contributor should be owed cash"
    assert s["sam"]["netOwedUsd"] > 0, "cash payer should owe cash"
    # Zero-sum.
    net = (s["eric"]["netCreditUsd"] - s["eric"]["netOwedUsd"]) + (
        s["sam"]["netCreditUsd"] - s["sam"]["netOwedUsd"])
    assert abs(net) < 0.01


def test_pricier_cabin_still_bears_more_even_when_paid_with_points():
    """Cabin/consumption is the base: a business-class flyer paying with points
    must still bear MORE total than a main-cabin flyer paying cash — the points
    bonus rewards them but doesn't overturn the consumption ordering."""
    travelers = [{"travelerId": "sam", "displayName": "Sam"},
                 {"travelerId": "eric", "displayName": "Eric"}]
    assignments = [
        {"travelerProfileId": "sam", "itemType": "flight", "cashCost": 1000, "imputedPointsValueUsd": 0},
        {"travelerProfileId": "eric", "itemType": "flight", "cashCost": 0, "imputedPointsValueUsd": 5000},
    ]
    ledger = [
        {"travelerProfileId": "sam", "entryType": "cash_paid", "amountUsd": 1000},
        {"travelerProfileId": "eric", "entryType": "points_used", "amountUsd": 5000},
    ]
    s = _settle(travelers, assignments, ledger)
    # Business flyer's share is higher (cabin respected).
    assert s["eric"]["grossShareUsd"] > s["sam"]["grossShareUsd"]
    # Eric still gets a points bonus (reward).
    assert s["eric"]["pointsSacrificeBonusUsd"] > 0
    # Effective burden = consumption - cash received (or + cash paid). Eric > Sam.
    eric_burden = 5000 - s["eric"]["netCreditUsd"]      # paid points, got cash back
    sam_burden = 1000 + s["sam"]["netOwedUsd"]          # paid cash, owes more
    assert eric_burden > sam_burden, "business/points flyer must still bear more than main/cash flyer"
