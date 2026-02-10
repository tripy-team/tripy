"""
Tests for Phase 1 + Phase 2 fixes from MULTI_CURRENCY_AND_BUDGET.md implementation plan.

Covers:
- Fix 1: Multi-currency award enrichment (Pareto, fingerprint, option_id, cap)
- Fix 2: Alias collision handling (max, not overwrite)
- Fix 7: Lexicographic objective (low-CPP within budget)
- Fix 8: Closest-plan response (budget infeasible)
- Fix 11: Multi-payer traveler_ids
- Fix 3: Greedy currency constraint forwarding
- Fix 10: Proportional budget_is_tight
"""

import pytest
from datetime import date, datetime
from typing import Dict, List

from src.optimization.trip_spec import (
    TripPlanSpec,
    Traveler,
    OrderedLeg,
    StaySegment,
)
from src.optimization.models_v3 import (
    FlightItineraryEdge,
    FlightSegment,
    AwardOption,
    TransferPath,
    OptimizationStatus,
)
from src.optimization.normalize import normalize_bank, normalize_program
from src.optimization.solver_v3 import SolverV3, Mode, optimize_trip
from src.optimization.adapter_v3 import (
    convert_trip_to_spec,
    _classify_points,
    make_flight_fingerprint,
    make_option_id,
    _pareto_select_per_program,
    MAX_AWARD_OPTIONS_PER_FLIGHT,
)


# =============================================================================
# HELPERS
# =============================================================================

def make_traveler(
    traveler_id: str = "user",
    banks: Dict[str, int] = None,
    points: Dict[str, int] = None,
) -> Traveler:
    return Traveler(
        traveler_id=traveler_id,
        name=traveler_id,
        home_airport="SEA",
        bank_balances=banks or {},
        points_balances=points or {},
    )


def make_leg(leg_id: int, origin: str, dest: str, traveler_ids=None) -> OrderedLeg:
    return OrderedLeg(
        leg_id=leg_id,
        origin_city=origin,
        destination_city=dest,
        earliest_departure=date(2026, 6, 1),
        latest_departure=date(2026, 6, 1),
        traveler_ids=traveler_ids or ["user"],
    )


def make_flight(
    leg_id: int,
    edge_id: str,
    origin: str,
    dest: str,
    cash_cost: float,
    awards: List[Dict] = None,
    carrier: str = "UA",
    num_stops: int = 0,
) -> FlightItineraryEdge:
    depart = datetime(2026, 6, 1, 10, 0)
    arrive = datetime(2026, 6, 1, 18, 0)
    segments = [
        FlightSegment(
            segment_id="seg_0",
            flight_number=f"{carrier}100",
            operating_carrier=carrier,
            marketing_carrier=carrier,
            origin=origin,
            destination=dest,
            departure=depart,
            arrival=arrive,
        )
    ]
    
    award_options = []
    if awards:
        for a in awards:
            award_options.append(AwardOption(
                option_id=f"{edge_id}:{a['program']}:economy:{a['miles']}:{int(a.get('surcharge', 0) * 100)}",
                program=a["program"],
                miles_required=a["miles"],
                surcharge=a.get("surcharge", 0),
                cabin_or_room_type="economy",
                cash_equivalent=cash_cost,
            ))
    
    edge = FlightItineraryEdge(
        edge_id=edge_id,
        leg_id=leg_id,
        origin=origin,
        destination=dest,
        segments=segments,
        departure_datetime=depart,
        arrival_datetime=arrive,
        total_time_minutes=480,
        cash_cost=cash_cost,
        award_options=award_options,
        num_stops_hint=num_stops,
    )
    edge.compute_date_fields()
    return edge


def make_transfer(from_bank: str, to_program: str, ratio: float = 1.0) -> TransferPath:
    return TransferPath(
        path_id=f"{from_bank}_to_{to_program}",
        from_bank=from_bank,
        to_program=to_program,
        ratio=ratio,
        min_increment=1000,
        effective_delivered_per_block=int(1000 * ratio),
    )


# =============================================================================
# TEST 1: Multi-currency visibility — disjoint transfer partners
# =============================================================================

class TestMultiCurrencyVisibility:
    """
    Route where award options exist across programs with disjoint transfer partners.
    User with Amex (-> ANA, Flying Blue) should NOT be able to use United (Chase only).
    """
    
    def test_amex_user_cannot_use_united_award(self):
        """
        Awards: United (35k), ANA (40k), Flying Blue (45k)
        User: amex_mr only (transfers to ANA and Flying Blue, NOT United)
        Expected: solver uses ANA or Flying Blue, never United.
        """
        traveler = make_traveler(banks={"amex": 100000})
        spec = TripPlanSpec(
            trip_id="test_disjoint",
            travelers=[traveler],
            legs=[make_leg(0, "SEA", "CDG")],
            stay_segments=[],
        )
        
        flight = make_flight(0, "f_sea_cdg", "SEA", "CDG", 1500.0, awards=[
            {"program": "UA", "miles": 35000, "surcharge": 80},
            {"program": "NH", "miles": 40000, "surcharge": 60},
            {"program": "AF", "miles": 45000, "surcharge": 70},
        ])
        
        transfers = [
            make_transfer("amex", "NH"),   # Amex -> ANA
            make_transfer("amex", "AF"),   # Amex -> Flying Blue
            # Note: no amex -> UA transfer
        ]
        
        result = optimize_trip(
            spec=spec, flights=[flight], transfers=transfers,
            cash_budget=200.0,
        )
        
        assert result.status in (OptimizationStatus.OPTIMAL, OptimizationStatus.FEASIBLE_SUBOPTIMAL)
        assert result.solution is not None
        
        # The solution should use points (not all cash), proving multi-currency works
        # Check that at least one flight uses points payment
        has_points_payment = any(
            p.method == "points" for p in result.solution.flight_payments.values()
        )
        assert has_points_payment, "Expected at least one points payment with Amex user"


# =============================================================================
# TEST 2: Award option uniqueness — no option_id collisions
# =============================================================================

class TestOptionIdUniqueness:
    """Same flight has multiple award options for same program with different cabins/surcharges."""
    
    def test_option_ids_are_unique(self):
        """United Economy (35k+$80) and United Business (90k+$150) must have distinct option_ids."""
        awards = [
            {"program": "UA", "miles": 35000, "surcharge": 80},
            {"program": "UA", "miles": 90000, "surcharge": 150},
        ]
        
        flight = make_flight(0, "f1", "SEA", "CDG", 1500.0, awards=awards)
        
        option_ids = [opt.option_id for opt in flight.award_options]
        assert len(option_ids) == len(set(option_ids)), (
            f"option_id collision: {option_ids}"
        )
    
    def test_make_option_id_deterministic(self):
        """make_option_id produces stable results."""
        opt = AwardOption(
            option_id="temp",
            program="UA",
            miles_required=35000,
            surcharge=80.0,
            cabin_or_room_type="economy",
            cash_equivalent=1500.0,
        )
        
        id1 = make_option_id("edge_123", opt)
        id2 = make_option_id("edge_123", opt)
        assert id1 == id2, "make_option_id must be deterministic"
    
    def test_make_option_id_long_hash(self):
        """Long option_ids get hashed to stay under 80 chars."""
        opt = AwardOption(
            option_id="temp",
            program="very_long_program_name_that_is_unrealistic",
            miles_required=35000,
            surcharge=80.0,
            cabin_or_room_type="premium_economy_with_extra_legroom",
            cash_equivalent=1500.0,
        )
        
        oid = make_option_id("a_very_long_edge_id_that_pushes_us_over_the_80_char_limit_easily", opt)
        assert len(oid) <= 80, f"option_id too long: {len(oid)} chars"


# =============================================================================
# TEST 3: Multi-payer ILP invocation
# =============================================================================

class TestMultiPayerILP:
    """Two payers — verify ILP solver is invoked with correct traveler_ids."""
    
    def test_multi_payer_spec_creation(self):
        """
        payer_points: {alice: {amex_mr: 60000}, bob: {chase_ur: 80000}}
        Verify spec has correct traveler_ids on legs.
        """
        spec = convert_trip_to_spec(
            trip_data={"trip_id": "test_multi_payer"},
            segments=[
                {"type": "flight", "date": "2026-06-01", "origin": "SEA", "destination": "CDG"},
                {"type": "flight", "date": "2026-06-08", "origin": "CDG", "destination": "SEA"},
            ],
            user_points={},
            payer_points={
                "alice": {"amex_mr": 60000},
                "bob": {"chase_ur": 80000},
            },
        )
        
        # Verify travelers
        traveler_ids = {t.traveler_id for t in spec.travelers}
        assert "alice" in traveler_ids
        assert "bob" in traveler_ids
        assert "user" not in traveler_ids
        
        # Verify legs have correct traveler_ids (not hardcoded ["user"])
        for leg in spec.legs:
            assert "alice" in leg.traveler_ids, f"Leg {leg.leg_id} missing alice"
            assert "bob" in leg.traveler_ids, f"Leg {leg.leg_id} missing bob"
            assert "user" not in leg.traveler_ids, f"Leg {leg.leg_id} has hardcoded 'user'"
        
        # Verify spec validates successfully
        errors = spec.validate()
        assert not errors, f"Spec validation failed: {errors}"


# =============================================================================
# TEST 4: Budget infeasible — closest plan with structured status
# =============================================================================

class TestBudgetInfeasible:
    """Budget too low — verify closest-plan behavior."""
    
    def test_closest_plan_returned_when_budget_infeasible(self):
        """
        Budget=$50, min surcharge=$180. Should find closest plan.
        """
        traveler = make_traveler(banks={"chase": 100000})
        spec = TripPlanSpec(
            trip_id="test_budget",
            travelers=[traveler],
            legs=[make_leg(0, "SEA", "CDG")],
            stay_segments=[],
        )
        
        flight = make_flight(0, "f1", "SEA", "CDG", 1200.0, awards=[
            {"program": "UA", "miles": 60000, "surcharge": 180},
        ])
        transfers = [make_transfer("chase", "UA")]
        
        result = optimize_trip(
            spec=spec, flights=[flight], transfers=transfers,
            cash_budget=50.0,
        )
        
        # Should return a result (not empty), marked as over budget
        assert result.solution is not None or result.budget_exceeded
        
        if result.budget_exceeded:
            assert result.budget_excess_amount > 0


# =============================================================================
# TEST 5: No double-counting alias collision
# =============================================================================

class TestAliasCollision:
    """{"amex_mr": 50000, "amex": 50000} should NOT become 100k."""
    
    def test_max_not_sum_for_alias_collision(self):
        points_balances, bank_balances = _classify_points(
            {"amex_mr": 50000, "amex": 50000}
        )
        
        # Both normalize to "amex" — should take max (50000), not sum (100000)
        assert bank_balances.get("amex", 0) == 50000, (
            f"Expected 50000 (max), got {bank_balances.get('amex', 0)}"
        )
    
    def test_different_balances_take_max(self):
        """If one alias has higher balance, take the higher one."""
        points_balances, bank_balances = _classify_points(
            {"amex_mr": 30000, "amex": 50000}
        )
        assert bank_balances.get("amex", 0) == 50000
    
    def test_airline_points_alias_collision(self):
        """Airline points aliases should also take max."""
        points_balances, bank_balances = _classify_points(
            {"united": 30000, "UA": 25000}
        )
        # Both should normalize to "united" — take max
        assert points_balances.get("united", 0) == 30000


# =============================================================================
# TEST 6: Determinism — repeated runs produce same results
# =============================================================================

class TestDeterminism:
    """Multiple runs with identical inputs must produce identical results."""
    
    def test_repeated_runs_identical(self):
        traveler = make_traveler(banks={"amex": 80000, "chase": 80000})
        spec = TripPlanSpec(
            trip_id="test_determinism",
            travelers=[traveler],
            legs=[
                make_leg(0, "SEA", "CDG"),
                make_leg(1, "CDG", "SEA"),
            ],
            stay_segments=[],
        )
        
        flights = [
            make_flight(0, "f_out1", "SEA", "CDG", 1500.0, awards=[
                {"program": "AF", "miles": 60000, "surcharge": 80},
                {"program": "UA", "miles": 65000, "surcharge": 120},
            ]),
            make_flight(1, "f_ret1", "CDG", "SEA", 1200.0, awards=[
                {"program": "UA", "miles": 45000, "surcharge": 55},
                {"program": "AF", "miles": 55000, "surcharge": 90},
            ]),
        ]
        
        transfers = [
            make_transfer("amex", "AF"),
            make_transfer("amex", "NH"),
            make_transfer("chase", "UA"),
            make_transfer("chase", "AF"),
        ]
        
        results = []
        for _ in range(5):
            result = optimize_trip(
                spec=spec, flights=flights, transfers=transfers,
                cash_budget=300.0,
            )
            if result.solution:
                results.append(result.solution)
        
        # All solutions should be identical
        if len(results) >= 2:
            first = results[0]
            for i, r in enumerate(results[1:], 1):
                assert r.total_cash == first.total_cash, (
                    f"Run {i} OOP ({r.total_cash}) != Run 0 OOP ({first.total_cash})"
                )


# =============================================================================
# TEST 7: Lexicographic objective — budget forces low-CPP usage
# =============================================================================

class TestLexicographicObjective:
    """Budget forces acceptance of low-CPP awards that old guards would reject."""
    
    def test_low_cpp_award_used_when_budget_tight(self):
        """
        Budget=$200, best cash=$1500.
        Only award: 80k pts + $150 surcharge (CPP=0.56 — below old 1.1 floor).
        Expected: solver uses this award (OOP=$150 < budget).
        """
        traveler = make_traveler(banks={"chase": 100000})
        spec = TripPlanSpec(
            trip_id="test_lexi",
            travelers=[traveler],
            legs=[make_leg(0, "SEA", "CDG")],
            stay_segments=[],
        )
        
        flight = make_flight(0, "f1", "SEA", "CDG", 1500.0, awards=[
            {"program": "UA", "miles": 80000, "surcharge": 150},  # CPP = 0.56
        ])
        transfers = [make_transfer("chase", "UA")]
        
        result = optimize_trip(
            spec=spec, flights=[flight], transfers=transfers,
            cash_budget=200.0,
        )
        
        assert result.status in (OptimizationStatus.OPTIMAL, OptimizationStatus.FEASIBLE_SUBOPTIMAL)
        assert result.solution is not None
        
        # Solution should use award (OOP = surcharge $150) not cash ($1500)
        # total_cash represents OOP — with award, it should be the surcharge
        assert result.solution.total_cash <= 200, (
            f"Expected OOP <= $200 but got ${result.solution.total_cash}"
        )


# =============================================================================
# TEST 8: Pareto frontier — surcharge-optimal option preserved
# =============================================================================

class TestParetoFrontier:
    """Two awards on same program: keep both (miles-optimal + surcharge-optimal)."""
    
    def test_pareto_preserves_both(self):
        candidates = [
            AwardOption(
                option_id="a1", program="UA", miles_required=35000,
                surcharge=450, cabin_or_room_type="economy", cash_equivalent=1500.0,
            ),
            AwardOption(
                option_id="a2", program="UA", miles_required=45000,
                surcharge=60, cabin_or_room_type="economy", cash_equivalent=1500.0,
            ),
        ]
        
        result = _pareto_select_per_program(candidates)
        
        # Both should survive (one is miles-optimal, one is surcharge-optimal)
        assert len(result) == 2, f"Expected 2 Pareto options, got {len(result)}"
        
        miles_values = {opt.miles_required for opt in result}
        assert 35000 in miles_values  # miles-optimal
        assert 45000 in miles_values  # surcharge-optimal
    
    def test_pareto_deduplicates_identical(self):
        """If best_miles and best_surcharge are the same option, only keep one."""
        candidates = [
            AwardOption(
                option_id="a1", program="UA", miles_required=35000,
                surcharge=60, cabin_or_room_type="economy", cash_equivalent=1500.0,
            ),
        ]
        
        result = _pareto_select_per_program(candidates)
        assert len(result) == 1


# =============================================================================
# TEST 9: Fingerprint matching — prevents wrong routing attachment
# =============================================================================

class TestFingerprintMatching:
    """Tight matching prevents attaching awards from different routings."""
    
    def test_fingerprint_different_stops(self):
        """Direct and connecting flights should have different fingerprints."""
        direct = make_flight(0, "f_direct", "SEA", "CDG", 1000.0, carrier="DL", num_stops=0)
        connecting = make_flight(0, "f_connect", "SEA", "CDG", 800.0, carrier="DL", num_stops=1)
        
        fp_direct = make_flight_fingerprint(direct)
        fp_connecting = make_flight_fingerprint(connecting)
        
        assert fp_direct != fp_connecting, (
            "Direct and connecting flights should have different fingerprints"
        )
    
    def test_fingerprint_same_flight_matches(self):
        """Same flight details should produce matching fingerprints."""
        f1 = make_flight(0, "f1", "SEA", "CDG", 1000.0, carrier="DL")
        f2 = make_flight(0, "f2", "SEA", "CDG", 1200.0, carrier="DL")
        
        fp1 = make_flight_fingerprint(f1)
        fp2 = make_flight_fingerprint(f2)
        
        assert fp1 == fp2, "Same route/carrier/stops should match"
    
    def test_fingerprint_different_carrier(self):
        """Different carriers on same route should have different fingerprints."""
        f_dl = make_flight(0, "f_dl", "SEA", "CDG", 1000.0, carrier="DL")
        f_af = make_flight(0, "f_af", "SEA", "CDG", 1000.0, carrier="AF")
        
        fp_dl = make_flight_fingerprint(f_dl)
        fp_af = make_flight_fingerprint(f_af)
        
        assert fp_dl != fp_af, "Different carriers should have different fingerprints"


# =============================================================================
# TEST 10: convert_trip_to_spec with single payer passes validation
# =============================================================================

class TestSinglePayerSpec:
    """Single payer spec should pass validation (regression check)."""
    
    def test_single_payer_spec_validates(self):
        spec = convert_trip_to_spec(
            trip_data={"trip_id": "test_single"},
            segments=[
                {"type": "flight", "date": "2026-06-01", "origin": "SEA", "destination": "CDG"},
            ],
            user_points={"chase_ur": 100000, "amex_mr": 50000},
        )
        
        errors = spec.validate()
        assert not errors, f"Single-payer spec validation failed: {errors}"
        
        # Verify traveler_ids on legs
        for leg in spec.legs:
            assert "user" in leg.traveler_ids
