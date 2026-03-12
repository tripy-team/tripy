"""
Tests for Group Planning feature.

Covers:
- Settlement calculation with Splitwise-style fairness
- Points valuation
- Gross share computation
- Contribution totals
- Auth guard patterns (via model validation)

These tests are self-contained and don't depend on DynamoDB or
external service imports.
"""

import sys
from pathlib import Path

# Ensure backend/ is on the path so `from src.xxx` works
_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

import pytest
from src.models.group_planning import (
    GroupTripCreate, GroupTripUpdate,
    TravelerProfileCreate, TravelerProfileUpdate,
    LoyaltyBalanceCreate, LoyaltyBalanceUpdate,
    ContributionPreferenceUpsert,
    SplitMethod, CabinPreference, HotelPreference,
    LoyaltyCurrencyType, UsePointsPriority,
    ManualAdjustmentCreate,
    GroupTripStatus,
)


# =============================================================================
# TEST: MODEL VALIDATION
# =============================================================================

class TestModelValidation:
    def test_group_trip_create_valid(self):
        data = GroupTripCreate(
            name="Family Vacation",
            destination="Tokyo",
            start_date="2026-06-01",
            end_date="2026-06-10",
        )
        assert data.name == "Family Vacation"
        assert data.split_method == SplitMethod.POINTS_VALUE_WEIGHTED

    def test_group_trip_create_custom_split(self):
        data = GroupTripCreate(
            name="Friends Trip",
            destination="Paris",
            start_date="2026-07-01",
            end_date="2026-07-05",
            split_method=SplitMethod.EQUAL_CASH_AFTER_POINTS,
        )
        assert data.split_method == SplitMethod.EQUAL_CASH_AFTER_POINTS

    def test_group_trip_create_requires_name(self):
        with pytest.raises(Exception):
            GroupTripCreate(
                name="",
                destination="Tokyo",
                start_date="2026-06-01",
                end_date="2026-06-10",
            )

    def test_traveler_profile_create_valid(self):
        data = TravelerProfileCreate(
            display_name="Eric",
            origin_airport="JFK",
            cabin_preference=CabinPreference.BUSINESS,
            cash_budget=5000.0,
        )
        assert data.display_name == "Eric"
        assert data.cabin_preference == CabinPreference.BUSINESS

    def test_traveler_profile_negative_budget_rejected(self):
        with pytest.raises(Exception):
            TravelerProfileCreate(display_name="Bad", cash_budget=-100)

    def test_loyalty_balance_create_valid(self):
        data = LoyaltyBalanceCreate(
            program="Chase UR",
            currency_type=LoyaltyCurrencyType.BANK_POINTS,
            balance=120000,
            cents_per_point_assumption=1.8,
        )
        assert data.balance == 120000

    def test_loyalty_balance_negative_rejected(self):
        with pytest.raises(Exception):
            LoyaltyBalanceCreate(
                program="Chase", currency_type=LoyaltyCurrencyType.BANK_POINTS, balance=-500,
            )

    def test_contribution_preference_defaults(self):
        data = ContributionPreferenceUpsert()
        assert data.use_points_priority == UsePointsPriority.MEDIUM
        assert data.allow_transfer_partners is True
        assert data.allow_hotel_points is True

    def test_manual_adjustment_requires_description(self):
        with pytest.raises(Exception):
            ManualAdjustmentCreate(
                traveler_profile_id="t1", amount_usd=100, description="",
            )


# =============================================================================
# TEST: SETTLEMENT CALCULATION (pure functions)
# =============================================================================

# Import the pure calculation functions directly
from src.services.group_split_calculator import (
    compute_gross_shares,
    compute_contribution_totals,
    get_imputed_value_usd,
)


class TestGrossShares:
    def test_individual_flights_assigned_directly(self):
        travelers = [
            {"travelerId": "t1", "displayName": "Eric"},
            {"travelerId": "t2", "displayName": "Mom"},
        ]
        assignments = [
            {"travelerProfileId": "t1", "itemType": "flight", "cashCost": 600, "imputedPointsValueUsd": 0},
            {"travelerProfileId": "t2", "itemType": "flight", "cashCost": 800, "imputedPointsValueUsd": 0},
        ]
        shares = compute_gross_shares(assignments, travelers)
        assert shares["t1"] == 600
        assert shares["t2"] == 800

    def test_shared_hotel_split_among_occupants(self):
        travelers = [
            {"travelerId": "t1", "displayName": "Eric"},
            {"travelerId": "t2", "displayName": "Mom"},
            {"travelerId": "t3", "displayName": "Dad"},
        ]
        assignments = [
            {"travelerProfileId": "t1", "itemType": "hotel", "cashCost": 900, "imputedPointsValueUsd": 0,
             "sharedGroupKey": "room1"},
            {"travelerProfileId": "t2", "itemType": "hotel", "cashCost": 0, "imputedPointsValueUsd": 0,
             "sharedGroupKey": "room1"},
            {"travelerProfileId": "t3", "itemType": "hotel", "cashCost": 0, "imputedPointsValueUsd": 0,
             "sharedGroupKey": "room1"},
        ]
        shares = compute_gross_shares(assignments, travelers)
        assert shares["t1"] == 300
        assert shares["t2"] == 300
        assert shares["t3"] == 300

    def test_points_value_included_in_gross_share(self):
        travelers = [{"travelerId": "t1", "displayName": "Eric"}]
        assignments = [
            {"travelerProfileId": "t1", "itemType": "flight", "cashCost": 100, "imputedPointsValueUsd": 500},
        ]
        shares = compute_gross_shares(assignments, travelers)
        assert shares["t1"] == 600


class TestContributionTotals:
    def test_cash_contributions(self):
        ledger = [
            {"travelerProfileId": "t1", "entryType": "cash_paid", "amountUsd": 500},
            {"travelerProfileId": "t2", "entryType": "cash_paid", "amountUsd": 300},
        ]
        totals = compute_contribution_totals(ledger)
        assert totals["t1"] == 500
        assert totals["t2"] == 300

    def test_points_contributions_added(self):
        ledger = [
            {"travelerProfileId": "t1", "entryType": "cash_paid", "amountUsd": 200},
            {"travelerProfileId": "t1", "entryType": "points_used", "amountUsd": 1200},
        ]
        totals = compute_contribution_totals(ledger)
        assert totals["t1"] == 1400

    def test_taxes_counted_as_contribution(self):
        ledger = [
            {"travelerProfileId": "t1", "entryType": "tax_paid", "amountUsd": 150},
        ]
        totals = compute_contribution_totals(ledger)
        assert totals["t1"] == 150

    def test_adjustment_counted(self):
        ledger = [
            {"travelerProfileId": "t1", "entryType": "adjustment", "amountUsd": -50},
        ]
        totals = compute_contribution_totals(ledger)
        assert totals["t1"] == -50


class TestSettlementFairness:
    def test_equal_split_no_points(self):
        """4 travelers, equal cash costs, no points — everyone settles at zero."""
        travelers = [
            {"travelerId": f"t{i}", "displayName": name}
            for i, name in enumerate(["Eric", "Mom", "Dad", "Friend"], 1)
        ]
        assignments = [
            {"travelerProfileId": f"t{i}", "itemType": "flight", "cashCost": 600, "imputedPointsValueUsd": 0}
            for i in range(1, 5)
        ]
        ledger = [
            {"travelerProfileId": f"t{i}", "entryType": "cash_paid", "amountUsd": 600}
            for i in range(1, 5)
        ]

        shares = compute_gross_shares(assignments, travelers)
        contributions = compute_contribution_totals(ledger)

        for i in range(1, 5):
            tid = f"t{i}"
            net = contributions[tid] - shares[tid]
            assert net == 0, f"Traveler {tid} should have net zero"

    def test_hotel_points_contributor_owes_less(self):
        """Eric uses 60k Hyatt points covering $1200 hotel shared 3 ways."""
        travelers = [
            {"travelerId": "t1", "displayName": "Eric"},
            {"travelerId": "t2", "displayName": "Mom"},
            {"travelerId": "t3", "displayName": "Dad"},
        ]
        assignments = [
            {"travelerProfileId": "t1", "itemType": "flight", "cashCost": 500, "imputedPointsValueUsd": 0},
            {"travelerProfileId": "t2", "itemType": "flight", "cashCost": 500, "imputedPointsValueUsd": 0},
            {"travelerProfileId": "t3", "itemType": "flight", "cashCost": 500, "imputedPointsValueUsd": 0},
            {"travelerProfileId": "t1", "itemType": "hotel", "cashCost": 0, "imputedPointsValueUsd": 1200,
             "sharedGroupKey": "room1"},
            {"travelerProfileId": "t2", "itemType": "hotel", "cashCost": 0, "imputedPointsValueUsd": 0,
             "sharedGroupKey": "room1"},
            {"travelerProfileId": "t3", "itemType": "hotel", "cashCost": 0, "imputedPointsValueUsd": 0,
             "sharedGroupKey": "room1"},
        ]
        ledger = [
            {"travelerProfileId": "t1", "entryType": "cash_paid", "amountUsd": 500},
            {"travelerProfileId": "t1", "entryType": "points_used", "amountUsd": 1200,
             "pointsAmount": 60000, "pointsProgram": "Hyatt"},
            {"travelerProfileId": "t2", "entryType": "cash_paid", "amountUsd": 500},
            {"travelerProfileId": "t3", "entryType": "cash_paid", "amountUsd": 500},
        ]

        shares = compute_gross_shares(assignments, travelers)
        contributions = compute_contribution_totals(ledger)

        # Hotel $1200 shared 3 ways = $400 each
        assert shares["t1"] == 500 + 400  # flight + hotel share
        assert shares["t2"] == 500 + 400
        assert shares["t3"] == 500 + 400

        # Eric contributed $500 cash + $1200 points value = $1700
        assert contributions["t1"] == 1700
        # Mom and Dad each contributed $500 cash
        assert contributions["t2"] == 500
        assert contributions["t3"] == 500

        # Eric over-contributed: 1700 - 900 = +$800 (credit)
        assert contributions["t1"] - shares["t1"] == 800
        # Mom owes: 500 - 900 = -$400
        assert contributions["t2"] - shares["t2"] == -400
        # Dad owes: 500 - 900 = -$400
        assert contributions["t3"] - shares["t3"] == -400

    def test_over_contributor_owed_by_others(self):
        """Sponsor pays all flights. Others owe them."""
        travelers = [
            {"travelerId": "t1", "displayName": "Sponsor"},
            {"travelerId": "t2", "displayName": "Guest1"},
            {"travelerId": "t3", "displayName": "Guest2"},
        ]
        assignments = [
            {"travelerProfileId": "t1", "itemType": "flight", "cashCost": 800, "imputedPointsValueUsd": 0},
            {"travelerProfileId": "t2", "itemType": "flight", "cashCost": 800, "imputedPointsValueUsd": 0},
            {"travelerProfileId": "t3", "itemType": "flight", "cashCost": 800, "imputedPointsValueUsd": 0},
        ]
        ledger = [
            {"travelerProfileId": "t1", "entryType": "cash_paid", "amountUsd": 2400},
        ]

        shares = compute_gross_shares(assignments, travelers)
        contributions = compute_contribution_totals(ledger)

        # Sponsor's share is only $800 (their own flight)
        assert shares["t1"] == 800
        # But they paid $2400
        assert contributions["t1"] == 2400
        # Net credit = $1600
        assert contributions["t1"] - shares["t1"] == 1600

        # Each guest owes $800
        assert shares["t2"] == 800
        assert contributions.get("t2", 0) - shares["t2"] == -800

    def test_zero_point_travelers_supported(self):
        """Travelers with zero points should still get correct shares."""
        travelers = [
            {"travelerId": "t1", "displayName": "PointsRich"},
            {"travelerId": "t2", "displayName": "NoPts"},
        ]
        assignments = [
            {"travelerProfileId": "t1", "itemType": "flight", "cashCost": 0, "imputedPointsValueUsd": 600},
            {"travelerProfileId": "t2", "itemType": "flight", "cashCost": 600, "imputedPointsValueUsd": 0},
        ]
        ledger = [
            {"travelerProfileId": "t1", "entryType": "points_used", "amountUsd": 600},
            {"travelerProfileId": "t2", "entryType": "cash_paid", "amountUsd": 600},
        ]

        shares = compute_gross_shares(assignments, travelers)
        contributions = compute_contribution_totals(ledger)

        # Both have $600 share and $600 contribution -> net zero
        assert shares["t1"] == 600
        assert shares["t2"] == 600
        assert contributions["t1"] == 600
        assert contributions["t2"] == 600


# =============================================================================
# TEST: POINTS VALUATION
# =============================================================================

class TestPointsValuation:
    def test_actual_redemption_value_preferred(self):
        val = get_imputed_value_usd("Hyatt", 60000, actual_redemption_value=1200.0)
        assert val == 1200.0

    def test_custom_cpp(self):
        val = get_imputed_value_usd("Chase UR", 100000, custom_cpp=1.8)
        assert val == 1800.0

    def test_market_default_fallback(self):
        val = get_imputed_value_usd("chase", 100000)
        assert val > 0
        # 1.8 cpp for chase → $1800
        assert val == (100000 * 1.8) / 100.0

    def test_zero_points_returns_zero(self):
        val = get_imputed_value_usd("chase", 0)
        assert val == 0.0

    def test_unknown_program_uses_default(self):
        val = get_imputed_value_usd("unknown_program", 10000)
        assert val > 0  # Should use default 1.0 cpp
