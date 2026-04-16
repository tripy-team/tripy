"""
Integration tests for the full Group Trip optimization flow.

Tests the end-to-end pipeline:
  Create trip → Add travelers → Add balances → Optimize → Settlement → Checklist

These tests mock the flight search and DynamoDB layers to test the
optimization, persistence, and settlement logic in isolation.
"""

import sys
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional
from unittest.mock import patch, MagicMock, AsyncMock
from dataclasses import dataclass

import pytest

# Ensure backend/ is on the path
_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))


# =============================================================================
# IN-MEMORY REPO MOCK
# =============================================================================

class InMemoryGroupPlanningRepo:
    """In-memory mock of group_planning_repo for testing."""

    def __init__(self):
        self._store: Dict[str, Dict[str, Any]] = {}  # (pk, sk) -> item

    def _key(self, pk: str, sk: str) -> str:
        return f"{pk}|{sk}"

    def put_item(self, item: Dict[str, Any]) -> None:
        pk = item.get("groupTripId", "")
        sk = item.get("sk", "META")
        self._store[self._key(pk, sk)] = item

    def get_item(self, pk: str, sk: str) -> Optional[Dict[str, Any]]:
        return self._store.get(self._key(pk, sk))

    def query_prefix(self, pk: str, sk_prefix: str) -> List[Dict[str, Any]]:
        results = []
        for key, item in self._store.items():
            if key.startswith(f"{pk}|{sk_prefix}"):
                results.append(item)
        return results

    def delete_item(self, pk: str, sk: str) -> None:
        self._store.pop(self._key(pk, sk), None)

    # --- Repo API methods ---
    def put_group_trip(self, trip: Dict[str, Any]) -> None:
        trip["sk"] = "META"
        self.put_item(trip)

    def get_group_trip(self, group_trip_id: str) -> Optional[Dict[str, Any]]:
        return self.get_item(group_trip_id, "META")

    def get_group_trips_by_owner(self, owner_user_id: str) -> List[Dict[str, Any]]:
        return [
            v for v in self._store.values()
            if v.get("sk") == "META" and v.get("ownerUserId") == owner_user_id
        ]

    def put_traveler_profile(self, group_trip_id: str, profile: Dict[str, Any]) -> None:
        tid = profile["travelerId"]
        profile["groupTripId"] = group_trip_id
        profile["sk"] = f"TRAVELER#{tid}"
        self.put_item(profile)

    def get_traveler_profile(self, group_trip_id: str, traveler_id: str) -> Optional[Dict[str, Any]]:
        return self.get_item(group_trip_id, f"TRAVELER#{traveler_id}")

    def get_travelers_for_trip(self, group_trip_id: str) -> List[Dict[str, Any]]:
        return self.query_prefix(group_trip_id, "TRAVELER#")

    def delete_traveler_profile(self, group_trip_id: str, traveler_id: str) -> None:
        self.delete_item(group_trip_id, f"TRAVELER#{traveler_id}")

    def put_loyalty_balance(self, group_trip_id: str, balance: Dict[str, Any]) -> None:
        tid = balance["travelerProfileId"]
        bid = balance["balanceId"]
        balance["groupTripId"] = group_trip_id
        balance["sk"] = f"BALANCE#{tid}#{bid}"
        self.put_item(balance)

    def get_loyalty_balance(self, gid: str, tid: str, bid: str) -> Optional[Dict[str, Any]]:
        return self.get_item(gid, f"BALANCE#{tid}#{bid}")

    def get_balances_for_traveler(self, gid: str, tid: str) -> List[Dict[str, Any]]:
        return self.query_prefix(gid, f"BALANCE#{tid}#")

    def get_all_balances_for_trip(self, gid: str) -> List[Dict[str, Any]]:
        return self.query_prefix(gid, "BALANCE#")

    def delete_loyalty_balance(self, gid: str, tid: str, bid: str) -> None:
        self.delete_item(gid, f"BALANCE#{tid}#{bid}")

    def put_contribution_preference(self, gid: str, pref: Dict[str, Any]) -> None:
        tid = pref["travelerProfileId"]
        pref["groupTripId"] = gid
        pref["sk"] = f"PREF#{tid}"
        self.put_item(pref)

    def get_contribution_preference(self, gid: str, tid: str) -> Optional[Dict[str, Any]]:
        return self.get_item(gid, f"PREF#{tid}")

    def get_all_preferences_for_trip(self, gid: str) -> List[Dict[str, Any]]:
        return self.query_prefix(gid, "PREF#")

    def put_itinerary_assignment(self, gid: str, assignment: Dict[str, Any]) -> None:
        aid = assignment["assignmentId"]
        assignment["groupTripId"] = gid
        assignment["sk"] = f"ASSIGNMENT#{aid}"
        self.put_item(assignment)

    def get_assignments_for_trip(self, gid: str) -> List[Dict[str, Any]]:
        return self.query_prefix(gid, "ASSIGNMENT#")

    def put_ledger_entry(self, gid: str, entry: Dict[str, Any]) -> None:
        eid = entry["entryId"]
        entry["groupTripId"] = gid
        entry["sk"] = f"LEDGER#{eid}"
        self.put_item(entry)

    def get_ledger_for_trip(self, gid: str) -> List[Dict[str, Any]]:
        return self.query_prefix(gid, "LEDGER#")

    def put_settlement_summary(self, gid: str, summary: Dict[str, Any]) -> None:
        tid = summary["travelerProfileId"]
        ver = summary.get("calculationVersion", 1)
        summary["groupTripId"] = gid
        summary["sk"] = f"SETTLEMENT#{tid}#{ver}"
        self.put_item(summary)

    def get_settlements_for_trip(self, gid: str) -> List[Dict[str, Any]]:
        return self.query_prefix(gid, "SETTLEMENT#")

    def delete_all_for_trip(self, gid: str) -> int:
        keys = [k for k in self._store if k.startswith(f"{gid}|")]
        for k in keys:
            del self._store[k]
        return len(keys)


# =============================================================================
# MOCK FLIGHT SEARCH RESULT
# =============================================================================

@dataclass
class MockAwardOption:
    program: str
    program_code: str
    points_required: int
    miles: int
    surcharge: float
    taxes_fees: float


@dataclass
class MockFlightOption:
    option_id: str
    summary: str
    marketing_airline: str
    cash_price: float
    award_options: List[MockAwardOption]


@dataclass
class MockFlightSearchResult:
    options: List[MockFlightOption]


def make_mock_flights(origin: str, destination: str) -> MockFlightSearchResult:
    """Create mock flight results for a given route."""
    return MockFlightSearchResult(options=[
        MockFlightOption(
            option_id=f"flight_{origin}_{destination}_1",
            summary=f"{origin}→{destination} Direct",
            marketing_airline="UA",
            cash_price=450.0,
            award_options=[
                MockAwardOption(
                    program="UA", program_code="UA",
                    points_required=25000, miles=25000,
                    surcharge=50.0, taxes_fees=50.0,
                ),
                MockAwardOption(
                    program="chase", program_code="chase",
                    points_required=30000, miles=30000,
                    surcharge=50.0, taxes_fees=50.0,
                ),
            ],
        ),
        MockFlightOption(
            option_id=f"flight_{origin}_{destination}_2",
            summary=f"{origin}→{destination} via connection",
            marketing_airline="AA",
            cash_price=380.0,
            award_options=[
                MockAwardOption(
                    program="AA", program_code="AA",
                    points_required=20000, miles=20000,
                    surcharge=40.0, taxes_fees=40.0,
                ),
            ],
        ),
    ])


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def mock_repo():
    return InMemoryGroupPlanningRepo()


@pytest.fixture
def trip_id():
    return str(uuid.uuid4())


@pytest.fixture
def user_id():
    return "test-user-001"


@pytest.fixture
def setup_group_trip(mock_repo, trip_id, user_id):
    """Set up a complete group trip with 2 travelers from different origins."""
    # Create trip
    mock_repo.put_group_trip({
        "groupTripId": trip_id,
        "ownerUserId": user_id,
        "name": "Group Vacation",
        "destination": "CDG",
        "startDate": "2026-06-15",
        "endDate": "2026-06-22",
        "currency": "USD",
        "status": "draft",
        "splitMethod": "points_value_weighted",
        "includeHotels": False,
        "poolingScope": "full_group",
        "createdAt": "2026-04-16T00:00:00Z",
        "updatedAt": "2026-04-16T00:00:00Z",
    })

    # Add traveler A (from JFK, has Chase UR)
    alice_id = "alice-001"
    mock_repo.put_traveler_profile(trip_id, {
        "travelerId": alice_id,
        "displayName": "Alice",
        "originAirport": "JFK",
        "originCity": "New York",
        "cabinPreference": "economy",
        "cashBudget": 600,
        "createdAt": "2026-04-16T00:00:00Z",
        "updatedAt": "2026-04-16T00:00:00Z",
    })
    mock_repo.put_loyalty_balance(trip_id, {
        "balanceId": str(uuid.uuid4()),
        "travelerProfileId": alice_id,
        "program": "chase",
        "currencyType": "bank_points",
        "balance": 150000,
        "isEnabledForPooling": True,
        "createdAt": "2026-04-16T00:00:00Z",
        "updatedAt": "2026-04-16T00:00:00Z",
    })

    # Add traveler B (from LAX, has United miles)
    bob_id = "bob-002"
    mock_repo.put_traveler_profile(trip_id, {
        "travelerId": bob_id,
        "displayName": "Bob",
        "originAirport": "LAX",
        "originCity": "Los Angeles",
        "cabinPreference": "economy",
        "cashBudget": 500,
        "createdAt": "2026-04-16T00:00:00Z",
        "updatedAt": "2026-04-16T00:00:00Z",
    })
    mock_repo.put_loyalty_balance(trip_id, {
        "balanceId": str(uuid.uuid4()),
        "travelerProfileId": bob_id,
        "program": "UA",
        "currencyType": "airline_miles",
        "balance": 50000,
        "isEnabledForPooling": True,
        "createdAt": "2026-04-16T00:00:00Z",
        "updatedAt": "2026-04-16T00:00:00Z",
    })

    return {"alice_id": alice_id, "bob_id": bob_id}


# =============================================================================
# TESTS: GROSS SHARE COMPUTATION
# =============================================================================

class TestGrossShareComputation:
    def test_flight_shares_assigned_directly(self):
        from src.services.group_split_calculator import compute_gross_shares

        assignments = [
            {"travelerProfileId": "a", "itemType": "flight", "cashCost": 400, "imputedPointsValueUsd": 0},
            {"travelerProfileId": "b", "itemType": "flight", "cashCost": 350, "imputedPointsValueUsd": 0},
        ]
        travelers = [{"travelerId": "a"}, {"travelerId": "b"}]
        shares = compute_gross_shares(assignments, travelers)
        assert shares["a"] == 400.0
        assert shares["b"] == 350.0

    def test_shared_hotel_split_evenly(self):
        from src.services.group_split_calculator import compute_gross_shares

        # Each assignment's total_value (cashCost + imputedPointsValueUsd) is split
        # among the unique members sharing the same sharedGroupKey.
        # Two assignments with cashCost=200 sharing room1:
        # Assignment 1: 200 / 2 members = 100 each
        # Assignment 2: 200 / 2 members = 100 each
        # Total: each gets 200
        assignments = [
            {"travelerProfileId": "a", "itemType": "hotel", "cashCost": 200, "imputedPointsValueUsd": 0, "sharedGroupKey": "room1"},
            {"travelerProfileId": "b", "itemType": "hotel", "cashCost": 200, "imputedPointsValueUsd": 0, "sharedGroupKey": "room1"},
        ]
        travelers = [{"travelerId": "a"}, {"travelerId": "b"}]
        shares = compute_gross_shares(assignments, travelers)
        assert shares["a"] == 200.0
        assert shares["b"] == 200.0

    def test_points_counted_in_gross_share(self):
        from src.services.group_split_calculator import compute_gross_shares

        assignments = [
            {"travelerProfileId": "a", "itemType": "flight", "cashCost": 50, "imputedPointsValueUsd": 350},
        ]
        travelers = [{"travelerId": "a"}]
        shares = compute_gross_shares(assignments, travelers)
        assert shares["a"] == 400.0


# =============================================================================
# TESTS: CONTRIBUTION TOTALS
# =============================================================================

class TestContributionTotals:
    def test_cash_and_points_contributions(self):
        from src.services.group_split_calculator import compute_contribution_totals

        ledger = [
            {"travelerProfileId": "a", "entryType": "cash_paid", "amountUsd": 100},
            {"travelerProfileId": "a", "entryType": "points_used", "amountUsd": 300},
            {"travelerProfileId": "b", "entryType": "cash_paid", "amountUsd": 350},
        ]
        totals = compute_contribution_totals(ledger)
        assert totals["a"] == 400.0
        assert totals["b"] == 350.0

    def test_adjustments_counted(self):
        from src.services.group_split_calculator import compute_contribution_totals

        ledger = [
            {"travelerProfileId": "a", "entryType": "cash_paid", "amountUsd": 200},
            {"travelerProfileId": "a", "entryType": "adjustment", "amountUsd": -50},
        ]
        totals = compute_contribution_totals(ledger)
        assert totals["a"] == 150.0


# =============================================================================
# TESTS: SETTLEMENT CALCULATION
# =============================================================================

class TestSettlementCalculation:
    def test_settlement_net_balance(self):
        from src.services.group_split_calculator import compute_gross_shares, compute_contribution_totals

        assignments = [
            {"travelerProfileId": "a", "itemType": "flight", "cashCost": 400, "imputedPointsValueUsd": 0},
            {"travelerProfileId": "b", "itemType": "flight", "cashCost": 400, "imputedPointsValueUsd": 0},
        ]
        ledger = [
            {"travelerProfileId": "a", "entryType": "cash_paid", "amountUsd": 500},
            {"travelerProfileId": "b", "entryType": "cash_paid", "amountUsd": 300},
        ]
        travelers = [{"travelerId": "a"}, {"travelerId": "b"}]

        shares = compute_gross_shares(assignments, travelers)
        contributions = compute_contribution_totals(ledger)

        # Alice: contributed 500, owes 400 → credit of 100
        net_a = contributions.get("a", 0) - shares.get("a", 0)
        assert net_a == 100.0

        # Bob: contributed 300, owes 400 → owes 100
        net_b = contributions.get("b", 0) - shares.get("b", 0)
        assert net_b == -100.0


# =============================================================================
# TESTS: BUILDING OPTIMIZATION INPUTS
# =============================================================================

class TestBuildOptimizationInputs:
    def test_build_group_members(self):
        from src.services.group_optimization_service import _build_group_members

        travelers = [
            {"traveler_id": "a", "display_name": "Alice", "origin_airport": "JFK",
             "cabin_preference": "economy", "points": {"chase": 150000}, "cash_budget": 600},
            {"traveler_id": "b", "display_name": "Bob", "origin_airport": "LAX",
             "cabin_preference": "economy", "points": {"UA": 50000}, "cash_budget": 500},
        ]

        members = _build_group_members(travelers, "full_group")
        assert len(members) == 2
        assert members[0].user_id == "a"
        assert members[0].willing_to_share_points is True
        assert members[0].points_balances == {"chase": 150000}

    def test_individual_only_disables_sharing(self):
        from src.services.group_optimization_service import _build_group_members

        travelers = [
            {"traveler_id": "a", "display_name": "Alice", "points": {"chase": 100000}},
        ]
        members = _build_group_members(travelers, "individual_only")
        assert members[0].willing_to_share_points is False

    def test_sponsors_only_requires_flag(self):
        from src.services.group_optimization_service import _build_group_members

        travelers = [
            {"traveler_id": "a", "display_name": "Alice", "points": {"chase": 100000}, "can_pay_for_others": True},
            {"traveler_id": "b", "display_name": "Bob", "points": {"UA": 50000}},
        ]
        members = _build_group_members(travelers, "sponsors_only")
        assert members[0].willing_to_share_points is True  # sponsor
        assert members[1].willing_to_share_points is False  # not a sponsor


# =============================================================================
# TESTS: BUILDING BOOKING ITEMS
# =============================================================================

class TestBuildBookingItems:
    def test_build_items_from_flight_options(self):
        from src.services.group_optimization_service import _build_booking_items
        from src.handlers.group_oop_optimizer import GroupPointsPool

        pool = GroupPointsPool(
            total_by_program={"chase": 150000, "UA": 50000},
            by_member={"alice": {"chase": 150000}, "bob": {"UA": 50000}},
            shareable_pool={"chase": 150000, "UA": 50000},
        )

        flight_options = [
            {
                "flight_id": "f1",
                "origin": "JFK",
                "destination": "CDG",
                "date": "2026-06-15",
                "airline": "UA",
                "description": "JFK→CDG Direct",
                "cash_cost": 450.0,
                "points_options": [
                    {"program_code": "UA", "points_required": 25000, "surcharge": 50.0},
                ],
            },
        ]

        items = _build_booking_items("alice", flight_options, pool)
        assert len(items) == 1
        assert items[0].member_id == "alice"
        assert items[0].cash_cost == 450.0
        assert len(items[0].points_options) >= 1

    def test_empty_flights_returns_empty(self):
        from src.services.group_optimization_service import _build_booking_items
        from src.handlers.group_oop_optimizer import GroupPointsPool

        pool = GroupPointsPool()
        items = _build_booking_items("alice", [], pool)
        assert items == []


# =============================================================================
# TESTS: POINTS POOLING
# =============================================================================

class TestPointsPooling:
    def test_aggregate_group_points(self):
        from src.handlers.group_points_pooling import aggregate_group_points
        from src.handlers.group_oop_optimizer import GroupMember

        members = [
            GroupMember(user_id="alice", name="Alice",
                        points_balances={"chase": 150000}),
            GroupMember(user_id="bob", name="Bob",
                        points_balances={"UA": 50000, "amex": 80000}),
        ]
        pool = aggregate_group_points(members)

        assert pool.total_by_program.get("chase", 0) == 150000
        assert pool.total_by_program.get("UA", 0) == 50000
        assert pool.total_by_program.get("amex", 0) == 80000
        assert len(pool.by_member) == 2

    def test_shareable_pool_respects_willingness(self):
        from src.handlers.group_points_pooling import aggregate_group_points
        from src.handlers.group_oop_optimizer import GroupMember

        members = [
            GroupMember(user_id="alice", name="Alice",
                        points_balances={"chase": 150000},
                        willing_to_share_points=True),
            GroupMember(user_id="bob", name="Bob",
                        points_balances={"UA": 50000},
                        willing_to_share_points=False),
        ]
        pool = aggregate_group_points(members)

        assert pool.shareable_pool.get("chase", 0) == 150000
        assert pool.shareable_pool.get("UA", 0) == 0  # Bob not sharing

    def test_find_points_sources(self):
        from src.handlers.group_points_pooling import find_points_sources, aggregate_group_points
        from src.handlers.group_oop_optimizer import GroupMember

        members = [
            GroupMember(user_id="alice", name="Alice",
                        points_balances={"UA": 30000}),
            GroupMember(user_id="bob", name="Bob",
                        points_balances={"UA": 50000}),
        ]
        pool = aggregate_group_points(members)

        sources = find_points_sources("UA", 25000, members, pool)
        assert len(sources) >= 1
        total_available = sum(s.resulting_points for s in sources)
        assert total_available >= 25000


# =============================================================================
# TESTS: SETTLEMENT ENGINE
# =============================================================================

class TestSettlementEngine:
    def test_pay_your_own_policy(self):
        from src.services.settlement_engine import compute_settlement

        tickets = [
            {"passenger_id": "p_alice", "base_fare_cash": 400, "taxes_fees_cash": 50},
            {"passenger_id": "p_bob", "base_fare_cash": 380, "taxes_fees_cash": 40},
        ]
        allocations = [
            {"payer_user_id": "alice", "payment_type": "cash", "cash_amount": 450},
            {"payer_user_id": "bob", "payment_type": "cash", "cash_amount": 420},
        ]
        passengers = [
            {"passenger_id": "p_alice", "guardian_user_id": "alice"},
            {"passenger_id": "p_bob", "guardian_user_id": "bob"},
        ]
        members = [
            {"user_id": "alice", "name": "Alice"},
            {"user_id": "bob", "name": "Bob"},
        ]

        result = compute_settlement(
            tickets=tickets,
            allocations=allocations,
            passengers=passengers,
            members=members,
            policy="pay_your_own",
            valuation_config={"mode": "market_implied"},
        )

        assert result.total_trip_cost > 0
        assert len(result.net_balance_by_member) == 2

    def test_equal_per_passenger_policy(self):
        from src.services.settlement_engine import compute_settlement

        # Alice's ticket costs more, but split equally
        tickets = [
            {"passenger_id": "p_alice", "base_fare_cash": 500, "taxes_fees_cash": 0},
            {"passenger_id": "p_bob", "base_fare_cash": 300, "taxes_fees_cash": 0},
        ]
        allocations = [
            {"payer_user_id": "alice", "payment_type": "cash", "cash_amount": 500},
            {"payer_user_id": "bob", "payment_type": "cash", "cash_amount": 300},
        ]
        passengers = [
            {"passenger_id": "p_alice", "guardian_user_id": "alice"},
            {"passenger_id": "p_bob", "guardian_user_id": "bob"},
        ]
        members = [
            {"user_id": "alice", "name": "Alice"},
            {"user_id": "bob", "name": "Bob"},
        ]

        result = compute_settlement(
            tickets=tickets,
            allocations=allocations,
            passengers=passengers,
            members=members,
            policy="equal_per_passenger",
            valuation_config={"mode": "market_implied"},
        )

        # Each should owe 400 (800 total / 2 passengers)
        alice_bal = result.net_balance_by_member["alice"]
        bob_bal = result.net_balance_by_member["bob"]

        # Obligations are equal (400 each)
        assert alice_bal.obligation_usd == 400.0
        assert bob_bal.obligation_usd == 400.0

        # Contributions match what they paid
        assert alice_bal.contribution_usd == 500.0
        assert bob_bal.contribution_usd == 300.0

        # Bob owes Alice $100 via reimbursement transfers
        assert len(result.reimbursement_transfers) == 1
        transfer = result.reimbursement_transfers[0]
        assert transfer.from_user_id == "bob"
        assert transfer.to_user_id == "alice"
        assert transfer.amount_usd == 100.0

    def test_points_valued_in_settlement(self):
        from src.services.settlement_engine import value_points, ValuationMode

        # Chase UR at market rate (~1.8 cpp)
        value = value_points("chase", 100000, ValuationMode.MARKET_IMPLIED, {})
        assert value > 0
        assert 1000 <= value <= 2500  # 100k points at 1-2.5 cpp


# =============================================================================
# TESTS: POOLING CONSTRAINTS
# =============================================================================

class TestPoolingConstraints:
    def test_individual_only_blocks_cross_payment(self):
        from src.optimization.pooling_constraints import PoolingConstraintBuilder, PoolingScope

        members = [
            {"user_id": "alice", "household_id": "h1"},
            {"user_id": "bob", "household_id": "h2"},
        ]
        builder = PoolingConstraintBuilder(
            model=None,
            pooling_scope=PoolingScope.INDIVIDUAL_ONLY,
            members=members,
            passengers=[],
        )

        assert builder.can_user_pay_for("alice", "alice") is True
        assert builder.can_user_pay_for("alice", "bob") is False

    def test_household_only_allows_same_household(self):
        from src.optimization.pooling_constraints import PoolingConstraintBuilder, PoolingScope

        members = [
            {"user_id": "alice", "household_id": "h1"},
            {"user_id": "spouse", "household_id": "h1"},
            {"user_id": "bob", "household_id": "h2"},
        ]
        builder = PoolingConstraintBuilder(
            model=None,
            pooling_scope=PoolingScope.HOUSEHOLD_ONLY,
            members=members,
            passengers=[],
        )

        assert builder.can_user_pay_for("alice", "spouse") is True
        assert builder.can_user_pay_for("alice", "bob") is False

    def test_full_group_allows_all(self):
        from src.optimization.pooling_constraints import PoolingConstraintBuilder, PoolingScope

        members = [
            {"user_id": "alice"},
            {"user_id": "bob"},
        ]
        builder = PoolingConstraintBuilder(
            model=None,
            pooling_scope=PoolingScope.FULL_GROUP,
            members=members,
            passengers=[],
        )

        assert builder.can_user_pay_for("alice", "bob") is True
        assert builder.can_user_pay_for("bob", "alice") is True

    def test_sponsors_only_requires_sponsor_flag(self):
        from src.optimization.pooling_constraints import PoolingConstraintBuilder, PoolingScope

        members = [
            {"user_id": "sponsor", "can_pay_for_others": True},
            {"user_id": "member"},
        ]
        builder = PoolingConstraintBuilder(
            model=None,
            pooling_scope=PoolingScope.SPONSORS_ONLY,
            members=members,
            passengers=[],
        )

        assert builder.can_user_pay_for("sponsor", "member") is True
        assert builder.can_user_pay_for("member", "sponsor") is False


# =============================================================================
# TESTS: ILP SOLVER (unit-level with small inputs)
# =============================================================================

class TestGroupILPSolver:
    """Test the ILP solver directly with small inputs."""

    @pytest.fixture(autouse=True)
    def check_pulp(self):
        try:
            import pulp
        except ImportError:
            pytest.skip("pulp not installed")

    def test_two_members_simple_optimization(self):
        from src.handlers.group_oop_optimizer import (
            GroupMember, GroupPointsPool, MemberBookingItem,
            GroupPointsOption, minimize_group_out_of_pocket,
        )
        from src.handlers.group_points_pooling import aggregate_group_points

        members = [
            GroupMember(user_id="alice", name="Alice",
                        points_balances={"UA": 30000},
                        max_cash_budget=500),
            GroupMember(user_id="bob", name="Bob",
                        points_balances={"UA": 50000},
                        max_cash_budget=500),
        ]
        pool = aggregate_group_points(members)

        items = [
            MemberBookingItem(
                item_id="flight_alice",
                member_id="alice",
                item_type="flight",
                description="JFK→CDG",
                cash_cost=400.0,
                points_options=[
                    GroupPointsOption(
                        program_code="UA",
                        points_required=25000,
                        surcharge=50.0,
                        available_from=["alice", "bob"],
                    ),
                ],
            ),
            MemberBookingItem(
                item_id="flight_bob",
                member_id="bob",
                item_type="flight",
                description="LAX→CDG",
                cash_cost=450.0,
                points_options=[
                    GroupPointsOption(
                        program_code="UA",
                        points_required=30000,
                        surcharge=60.0,
                        available_from=["bob"],
                    ),
                ],
            ),
        ]

        solution = minimize_group_out_of_pocket(
            members=members,
            booking_items=items,
            pool=pool,
            allow_cross_member_points=True,
        )

        assert solution.status in ("Optimal", "Feasible", "Fallback")
        assert solution.total_group_oop <= 850.0  # Must be <= all-cash
        assert len(solution.allocations) == 2  # One per item

    def test_individual_only_no_cross_member(self):
        from src.handlers.group_oop_optimizer import (
            GroupMember, MemberBookingItem, GroupPointsOption,
            minimize_group_out_of_pocket,
        )
        from src.handlers.group_points_pooling import aggregate_group_points

        members = [
            GroupMember(user_id="alice", name="Alice",
                        points_balances={"UA": 0},
                        willing_to_share_points=False),
            GroupMember(user_id="bob", name="Bob",
                        points_balances={"UA": 100000},
                        willing_to_share_points=False),
        ]
        pool = aggregate_group_points(members)

        items = [
            MemberBookingItem(
                item_id="flight_alice",
                member_id="alice",
                item_type="flight",
                description="JFK→CDG",
                cash_cost=400.0,
                points_options=[
                    GroupPointsOption(
                        program_code="UA",
                        points_required=25000,
                        surcharge=50.0,
                        available_from=["bob"],  # Only bob has UA
                    ),
                ],
            ),
        ]

        solution = minimize_group_out_of_pocket(
            members=members,
            booking_items=items,
            pool=pool,
            allow_cross_member_points=False,
        )

        # Alice has no points and cross-member is disabled → must pay cash
        alice_alloc = [a for a in solution.allocations if a.beneficiary_member == "alice"]
        assert len(alice_alloc) == 1
        assert alice_alloc[0].payment_type.value == "cash"
