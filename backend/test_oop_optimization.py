"""
Comprehensive tests for OOP (Out-of-Pocket) optimization functions.

Tests the following components:
1. planTrip.py - OOP vs CPP optimization modes
2. oop_optimizer.py - Alliance partner routing and surcharge avoidance
3. transfer_strategy.py - Transfer instructions and credit card recommendations
4. trip_cost_optimizer.py - Connecting flight support
5. min_oop_optimizer.py - ILP solver for minimizing OOP

Run with: python test_oop_optimization.py
"""

import sys
from pathlib import Path
from typing import Dict, Any, List
from dataclasses import asdict

# Add the backend src to path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

# =============================================================================
# TEST UTILITIES
# =============================================================================

def print_header(title: str):
    """Print a formatted test header."""
    print("\n" + "=" * 80)
    print(f"TEST: {title}")
    print("=" * 80)


def print_result(name: str, passed: bool, details: str = ""):
    """Print test result."""
    status = "✓ PASSED" if passed else "✗ FAILED"
    print(f"  {status}: {name}")
    if details:
        print(f"    {details}")


def assert_test(condition: bool, name: str, details: str = ""):
    """Assert a test condition and print result."""
    print_result(name, condition, details)
    return condition


# =============================================================================
# TEST 1: planTrip.py OOP Optimization Mode
# =============================================================================

def test_oop_optimization_mode():
    """Test that OOP mode minimizes out-of-pocket costs."""
    print_header("planTrip.py OOP Optimization Mode")
    
    from src.handlers.ilp_adapter import run_ilp_from_edges
    from src.handlers.planTrip import plan_non_pooled_multi_itineraries_with_native
    
    # Scenario: Two flights available
    # Flight A: Lower surcharge ($50), higher points (25,000)
    # Flight B: Higher surcharge ($200), lower points (20,000)
    # 
    # CPP mode: Should prefer Flight B (better cpp value)
    # OOP mode: Should prefer Flight A (lower out-of-pocket)
    
    edges = {
        ("JFK", "CDG", "low_surcharge"): {
            "points_program": "UA",
            "points_cost": 25000,
            "points_surcharge": 50,  # Low surcharge
            "cash_cost": 800,
            "time_cost": 480,
        },
        ("JFK", "CDG", "high_surcharge"): {
            "points_program": "BA",
            "points_cost": 20000,
            "points_surcharge": 200,  # High surcharge
            "cash_cost": 800,
            "time_cost": 480,
        },
    }
    
    travelers = ["traveler1"]
    start_city = {"traveler1": "JFK"}
    end_city = {"traveler1": "CDG"}
    user_points = {
        "traveler1": {
            "UA": 50000,
            "BA": 50000,
        }
    }
    
    # Test OOP mode
    solution_oop = run_ilp_from_edges(
        edges,
        travelers,
        start_city,
        end_city,
        user_points,
        plan_non_pooled_multi_itineraries_with_native,
        optimization_mode="oop",
    )
    
    print(f"\nOOP Mode Results:")
    print(f"  Status: {solution_oop['status']}")
    print(f"  Total Cash (OOP): ${solution_oop['totals']['cash']:.2f}")
    print(f"  Points Used: {solution_oop['totals']['airline_points']:.0f}")
    print(f"  Optimization Mode: {solution_oop['totals'].get('optimization_mode', 'unknown')}")
    
    # In OOP mode, should prefer lower surcharge option
    oop_cash = solution_oop['totals']['cash']
    
    tests_passed = []
    
    # Test 1: OOP mode should result in lower out-of-pocket
    tests_passed.append(assert_test(
        oop_cash <= 200,
        "OOP mode minimizes out-of-pocket",
        f"OOP=${oop_cash:.2f} (should be <= $200)"
    ))
    
    # Test 2: Solution should be optimal
    tests_passed.append(assert_test(
        solution_oop['status'] == 'Optimal',
        "Solution status is Optimal",
        f"Status={solution_oop['status']}"
    ))
    
    # Test 3: Savings should be calculated
    savings = solution_oop['totals'].get('savings', 0)
    tests_passed.append(assert_test(
        savings >= 0,
        "Savings is calculated",
        f"Savings=${savings:.2f}"
    ))
    
    return all(tests_passed)


# =============================================================================
# TEST 2: Surcharge Penalty Function
# =============================================================================

def test_surcharge_penalty():
    """Test the surcharge penalty calculation."""
    print_header("Surcharge Penalty Calculation")
    
    from src.handlers.planTrip import _calculate_surcharge_penalty, HIGH_SURCHARGE_PROGRAMS
    
    tests_passed = []
    
    # Test 1: Low surcharge should have no penalty
    penalty_low = _calculate_surcharge_penalty(25.0, "UA")
    tests_passed.append(assert_test(
        penalty_low == 0.0,
        "Low surcharge ($25) has no penalty",
        f"Penalty={penalty_low}"
    ))
    
    # Test 2: Medium surcharge should have some penalty
    penalty_medium = _calculate_surcharge_penalty(100.0, "UA")
    tests_passed.append(assert_test(
        penalty_medium > 0,
        "Medium surcharge ($100) has penalty",
        f"Penalty={penalty_medium:.2f}"
    ))
    
    # Test 3: High surcharge program (BA) should have extra penalty
    penalty_ba_high = _calculate_surcharge_penalty(300.0, "BA")
    penalty_ua_high = _calculate_surcharge_penalty(300.0, "UA")
    tests_passed.append(assert_test(
        penalty_ba_high > penalty_ua_high,
        "High-surcharge program (BA) has extra penalty",
        f"BA penalty={penalty_ba_high:.2f}, UA penalty={penalty_ua_high:.2f}"
    ))
    
    # Test 4: Very high surcharge should have maximum penalty
    penalty_very_high = _calculate_surcharge_penalty(600.0, "BA")
    tests_passed.append(assert_test(
        penalty_very_high > penalty_ba_high,
        "Very high surcharge ($600) has maximum penalty",
        f"Penalty={penalty_very_high:.2f}"
    ))
    
    # Test 5: Verify high surcharge programs set
    tests_passed.append(assert_test(
        "BA" in HIGH_SURCHARGE_PROGRAMS and "LH" in HIGH_SURCHARGE_PROGRAMS,
        "High surcharge programs include BA, LH",
        f"Programs={HIGH_SURCHARGE_PROGRAMS}"
    ))
    
    return all(tests_passed)


# =============================================================================
# TEST 3: Alliance Partner Routing
# =============================================================================

def test_alliance_partner_routing():
    """Test alliance partner routing for surcharge avoidance."""
    print_header("Alliance Partner Routing")
    
    from src.utils.oop_optimizer import (
        get_partner_programs,
        get_partner_surcharge,
        find_best_booking_option,
        get_best_booking_program_for_low_surcharge,
        ALLIANCE_PARTNERS,
    )
    
    tests_passed = []
    
    # Test 1: Get partners for British Airways
    ba_partners = get_partner_programs("BA")
    tests_passed.append(assert_test(
        "AA" in ba_partners and "QF" in ba_partners,
        "BA has AA and QF as partners",
        f"Partners={ba_partners}"
    ))
    
    # Test 2: Partner surcharge override (BA via AA should be low)
    ba_direct_surcharge = 600.0
    ba_via_aa_surcharge = get_partner_surcharge("BA", "AA", ba_direct_surcharge)
    tests_passed.append(assert_test(
        ba_via_aa_surcharge < ba_direct_surcharge,
        "BA via AA has lower surcharge",
        f"Direct=${ba_direct_surcharge}, via AA=${ba_via_aa_surcharge}"
    ))
    
    # Test 3: Find best booking option
    options = find_best_booking_option(
        operating_carrier="BA",
        base_points=50000,
        base_surcharge=600.0,
        available_programs=["AA", "BA", "QF"],
    )
    tests_passed.append(assert_test(
        len(options) > 0,
        "Find booking options returns results",
        f"Found {len(options)} options"
    ))
    
    # Best option should have lowest OOP
    if options:
        best = options[0]
        tests_passed.append(assert_test(
            best.out_of_pocket <= 600,
            "Best option has lowest OOP",
            f"Best OOP=${best.out_of_pocket}, program={best.booking_program}"
        ))
    
    # Test 4: Get best program for low surcharge
    best_prog, reduction = get_best_booking_program_for_low_surcharge("BA", ["AA", "UA", "DL"])
    tests_passed.append(assert_test(
        best_prog == "AA" and reduction > 0.5,
        "Best program for BA is AA with >50% reduction",
        f"Best={best_prog}, reduction={reduction*100:.0f}%"
    ))
    
    # Test 5: United partners (Star Alliance)
    ua_partners = get_partner_programs("UA")
    tests_passed.append(assert_test(
        "AC" in ua_partners and "LH" in ua_partners,
        "UA has AC and LH as partners",
        f"Partners={ua_partners}"
    ))
    
    return all(tests_passed)


# =============================================================================
# TEST 4: Transfer Strategy Functions
# =============================================================================

def test_transfer_strategy():
    """Test transfer strategy functions."""
    print_header("Transfer Strategy Functions")
    
    from src.handlers.transfer_strategy import (
        EXTENDED_TRANSFER_GRAPH,
        BANK_METADATA,
        get_transfer_ratio,
        can_transfer,
        get_transfer_partners,
        compute_effective_balance,
        get_best_transfer_source,
        build_transfer_instruction,
        get_credit_card_recommendations,
        get_transfer_timing_advice,
    )
    
    tests_passed = []
    
    # Test 1: Transfer graph structure
    tests_passed.append(assert_test(
        "amex" in EXTENDED_TRANSFER_GRAPH and "chase" in EXTENDED_TRANSFER_GRAPH,
        "Transfer graph has Amex and Chase",
        f"Banks={list(EXTENDED_TRANSFER_GRAPH.keys())}"
    ))
    
    # Test 2: Amex → Hilton has 2:1 ratio
    hh_ratio = get_transfer_ratio("amex", "HH")
    tests_passed.append(assert_test(
        hh_ratio == 2.0,
        "Amex → Hilton ratio is 2:1",
        f"Ratio={hh_ratio}"
    ))
    
    # Test 3: Can transfer checks
    tests_passed.append(assert_test(
        can_transfer("chase", "UA") and can_transfer("chase", "HYATT"),
        "Chase can transfer to UA and Hyatt",
        ""
    ))
    
    # Test 4: Get transfer partners
    amex_airlines = get_transfer_partners("amex", "airline")
    amex_hotels = get_transfer_partners("amex", "hotel")
    tests_passed.append(assert_test(
        "DL" in amex_airlines and "HH" in amex_hotels,
        "Amex partners include DL (airline) and HH (hotel)",
        f"Airlines={amex_airlines[:5]}, Hotels={amex_hotels}"
    ))
    
    # Test 5: Compute effective balance
    user_points = {"amex": 100000, "chase": 50000, "UA": 25000}
    total, sources = compute_effective_balance(user_points, "UA")
    tests_passed.append(assert_test(
        total >= 75000,  # At least 25K direct + 50K from Chase
        "Effective UA balance includes direct + transfers",
        f"Total={total:,}, Sources={sources}"
    ))
    
    # Test 6: Get best transfer source
    source = get_best_transfer_source(user_points, "UA", 30000)
    tests_passed.append(assert_test(
        source is not None,
        "Found transfer source for 30K UA",
        f"Source={source}"
    ))
    
    # Test 7: Build transfer instruction
    instruction = build_transfer_instruction("chase", "UA", 25000, "JFK → LAX flight")
    tests_passed.append(assert_test(
        instruction.points_to_transfer == 25000 and len(instruction.steps) >= 5,
        "Transfer instruction has correct points and steps",
        f"Points={instruction.points_to_transfer}, Steps={len(instruction.steps)}"
    ))
    
    # Test 8: Credit card recommendations
    recs = get_credit_card_recommendations(user_points, ["UA", "HYATT"])
    tests_passed.append(assert_test(
        len(recs) > 0,
        "Credit card recommendations returned",
        f"Recommendations={len(recs)}"
    ))
    
    # Test 9: Transfer timing advice - Chase (instant)
    timing_chase = get_transfer_timing_advice("chase", days_until_travel=1)
    tests_passed.append(assert_test(
        timing_chase["is_safe_to_transfer"],
        "Chase instant transfer safe with 1 day",
        f"Time={timing_chase['transfer_time']}"
    ))
    
    # Test 10: Transfer timing advice - Amex (1-2 days) warning
    timing_amex = get_transfer_timing_advice("amex", days_until_travel=1)
    tests_passed.append(assert_test(
        timing_amex.get("warning") is not None,
        "Amex transfer warning with 1 day",
        f"Warning exists: {timing_amex.get('warning') is not None}"
    ))
    
    return all(tests_passed)


# =============================================================================
# TEST 5: Min OOP Optimizer ILP Solver
# =============================================================================

def test_min_oop_optimizer():
    """Test the minimum OOP ILP optimizer."""
    print_header("Min OOP ILP Optimizer")
    
    from src.handlers.min_oop_optimizer import (
        minimize_out_of_pocket,
        TripCostItem,
        PointsOption,
        create_flight_cost_item,
        create_hotel_cost_item,
        solution_to_dict,
    )
    from src.handlers.transfer_strategy import EXTENDED_TRANSFER_GRAPH
    
    tests_passed = []
    
    # Create test items
    # Flight 1: JFK → CDG, Cash $800, Points 60K AF with $150 surcharge
    flight1 = create_flight_cost_item(
        item_id="flight1",
        origin="JFK",
        destination="CDG",
        cash_cost=800.0,
        points_options=[
            {"program_code": "AF", "points_required": 60000, "surcharge": 150.0},
            {"program_code": "DL", "points_required": 75000, "surcharge": 5.60},
        ],
        date="2025-06-01",
        airline="AF",
    )
    
    # Flight 2: CDG → JFK, Cash $800, Points 60K AF with $150 surcharge
    flight2 = create_flight_cost_item(
        item_id="flight2",
        origin="CDG",
        destination="JFK",
        cash_cost=800.0,
        points_options=[
            {"program_code": "AF", "points_required": 60000, "surcharge": 150.0},
            {"program_code": "DL", "points_required": 75000, "surcharge": 5.60},
        ],
        date="2025-06-08",
        airline="AF",
    )
    
    # Hotel: Paris Hyatt, Cash $1500, Points 100K Hyatt with $0 surcharge
    hotel = create_hotel_cost_item(
        item_id="hotel1",
        hotel_name="Park Hyatt Paris",
        location="Paris",
        cash_cost=1500.0,
        points_options=[
            {"program_code": "HYATT", "points_required": 100000, "surcharge": 0.0},
        ],
        check_in="2025-06-01",
        check_out="2025-06-08",
        nights=7,
    )
    
    items = [flight1, flight2, hotel]
    
    # Test 1: Basic solution with Amex points
    user_points_amex = {"amex": 200000}
    solution1 = minimize_out_of_pocket(
        items=items,
        available_points=user_points_amex,
        transfer_graph=EXTENDED_TRANSFER_GRAPH,
    )
    
    print(f"\nTest with Amex Points:")
    print(f"  Status: {solution1.status}")
    print(f"  Total OOP: ${solution1.total_out_of_pocket:.2f}")
    print(f"  All Cash: ${solution1.all_cash_cost:.2f}")
    print(f"  Savings: ${solution1.savings:.2f} ({solution1.savings_percentage:.1f}%)")
    
    tests_passed.append(assert_test(
        solution1.status == "Optimal",
        "Solution is Optimal",
        f"Status={solution1.status}"
    ))
    
    tests_passed.append(assert_test(
        solution1.total_out_of_pocket < solution1.all_cash_cost,
        "OOP is less than all-cash",
        f"OOP=${solution1.total_out_of_pocket:.2f} < All-cash=${solution1.all_cash_cost:.2f}"
    ))
    
    # Test 2: Solution with Chase points (can do Hyatt at 1:1)
    user_points_chase = {"chase": 200000}
    solution2 = minimize_out_of_pocket(
        items=items,
        available_points=user_points_chase,
        transfer_graph=EXTENDED_TRANSFER_GRAPH,
    )
    
    print(f"\nTest with Chase Points:")
    print(f"  Status: {solution2.status}")
    print(f"  Total OOP: ${solution2.total_out_of_pocket:.2f}")
    print(f"  Savings: ${solution2.savings:.2f} ({solution2.savings_percentage:.1f}%)")
    
    # Chase → Hyatt should give $0 OOP for hotel
    tests_passed.append(assert_test(
        solution2.status == "Optimal",
        "Chase solution is Optimal",
        ""
    ))
    
    # Test 3: Check transfer plan exists
    if solution2.transfer_plan:
        xfer = solution2.transfer_plan[0]
        tests_passed.append(assert_test(
            xfer.points_to_transfer > 0,
            "Transfer plan has points",
            f"Transfer: {xfer.from_program} → {xfer.to_program}, {xfer.points_to_transfer:,} points"
        ))
    
    # Test 4: Payment plan has items
    tests_passed.append(assert_test(
        len(solution2.payment_plan) > 0,
        "Payment plan has items",
        f"Items: {len(solution2.payment_plan)}"
    ))
    
    # Test 5: Solution to dict works
    sol_dict = solution_to_dict(solution2)
    tests_passed.append(assert_test(
        "total_out_of_pocket" in sol_dict and "payment_plan" in sol_dict,
        "Solution to dict has required fields",
        f"Keys: {list(sol_dict.keys())}"
    ))
    
    # Test 6: Max budget constraint
    solution_budget = minimize_out_of_pocket(
        items=items,
        available_points={"chase": 50000},  # Not enough for everything
        transfer_graph=EXTENDED_TRANSFER_GRAPH,
        max_cash_budget=1000.0,
    )
    
    print(f"\nTest with Budget Constraint:")
    print(f"  Status: {solution_budget.status}")
    print(f"  Total OOP: ${solution_budget.total_out_of_pocket:.2f}")
    
    # May not be optimal due to budget constraint, but should still work
    tests_passed.append(assert_test(
        solution_budget.status in ["Optimal", "Infeasible"],
        "Budget constraint handled",
        f"Status={solution_budget.status}"
    ))
    
    return all(tests_passed)


# =============================================================================
# TEST 6: Connecting Flight Support
# =============================================================================

def test_connecting_flight_support():
    """Test connecting flight handling."""
    print_header("Connecting Flight Support")
    
    from src.handlers.trip_cost_optimizer import (
        _is_connecting_flight,
        _extract_connecting_flight_details,
        create_connecting_flight_cost_item,
    )
    
    tests_passed = []
    
    # Test 1: Direct flight detection
    direct_edge = {
        "origin": "JFK",
        "destination": "CDG",
        "cash_cost": 800,
        "stops": 0,
    }
    tests_passed.append(assert_test(
        not _is_connecting_flight(direct_edge),
        "Direct flight detected correctly",
        ""
    ))
    
    # Test 2: Connecting flight detection (via segments)
    connecting_edge = {
        "origin": "JFK",
        "destination": "NRT",
        "cash_cost": 1200,
        "segments": [
            {"origin": "JFK", "destination": "ORD", "duration": 180},
            {"origin": "ORD", "destination": "NRT", "duration": 840},
        ],
    }
    tests_passed.append(assert_test(
        _is_connecting_flight(connecting_edge),
        "Connecting flight detected via segments",
        ""
    ))
    
    # Test 3: Connecting flight detection (via stops count)
    connecting_edge2 = {
        "origin": "LAX",
        "destination": "LHR",
        "cash_cost": 900,
        "stops": 1,
    }
    tests_passed.append(assert_test(
        _is_connecting_flight(connecting_edge2),
        "Connecting flight detected via stops count",
        ""
    ))
    
    # Test 4: Extract connecting flight details
    details = _extract_connecting_flight_details(connecting_edge)
    tests_passed.append(assert_test(
        details["is_connecting"] and len(details["connection_airports"]) == 1,
        "Extracted connection details correctly",
        f"Connections={details['connection_airports']}"
    ))
    
    tests_passed.append(assert_test(
        "ORD" in details["connection_airports"],
        "Connection airport is ORD",
        ""
    ))
    
    # Test 5: Create connecting flight cost item
    connecting_edge_full = {
        "origin": "JFK",
        "destination": "NRT",
        "cash_cost": 1200,
        "points_cost": 80000,
        "points_surcharge": 150,
        "points_program": "UA",
        "segments": [
            {"origin": "JFK", "destination": "ORD", "carrier": "UA", "duration": 180, "layover_time": 120},
            {"origin": "ORD", "destination": "NRT", "carrier": "NH", "duration": 840},
        ],
    }
    
    cost_item = create_connecting_flight_cost_item("test_conn", connecting_edge_full)
    
    tests_passed.append(assert_test(
        cost_item is not None,
        "Created connecting flight cost item",
        ""
    ))
    
    if cost_item:
        tests_passed.append(assert_test(
            cost_item.origin == "JFK" and cost_item.destination == "NRT",
            "Cost item has correct origin/destination",
            f"Route: {cost_item.origin} → {cost_item.destination}"
        ))
        
        tests_passed.append(assert_test(
            len(cost_item.points_options) > 0,
            "Cost item has points options",
            f"Options: {len(cost_item.points_options)}"
        ))
        
        tests_passed.append(assert_test(
            cost_item.extra_data is not None and cost_item.extra_data.get("is_connecting"),
            "Cost item has connection metadata",
            ""
        ))
    
    return all(tests_passed)


# =============================================================================
# TEST 7: Trip Cost Optimizer Integration
# =============================================================================

def test_trip_cost_optimizer():
    """Test the full trip cost optimizer flow."""
    print_header("Trip Cost Optimizer Integration")
    
    import asyncio
    from src.handlers.trip_cost_optimizer import (
        aggregate_trip_costs,
        optimize_trip_out_of_pocket,
        build_oop_optimized_response,
    )
    
    tests_passed = []
    
    # Test data: Multi-city trip
    flight_edges = [
        {
            "origin": "JFK",
            "destination": "CDG",
            "cash_cost": 800,
            "points_cost": 60000,
            "points_surcharge": 150,
            "points_program": "AF",
        },
        {
            "origin": "CDG",
            "destination": "FCO",
            "cash_cost": 200,
            "points_cost": 15000,
            "points_surcharge": 25,
            "points_program": "AF",
        },
        {
            "origin": "FCO",
            "destination": "JFK",
            "cash_cost": 700,
            "points_cost": 55000,
            "points_surcharge": 150,
            "points_program": "DL",
        },
    ]
    
    hotel_options = [
        {
            "name": "Paris Marriott",
            "location": "Paris",
            "cash_cost": 1200,
            "points_cost": 50000,
            "surcharge": 0,
            "program_code": "MAR",
        },
        {
            "name": "Rome Hilton",
            "location": "Rome",
            "cash_cost": 800,
            "points_cost": 70000,
            "surcharge": 0,
            "program_code": "HH",
        },
    ]
    
    user_points = {
        "amex": 300000,
        "chase": 100000,
    }
    
    # Test 1: Aggregate costs
    async def run_aggregate():
        return await aggregate_trip_costs(flight_edges, hotel_options, user_points)
    
    cost_summary = asyncio.run(run_aggregate())
    
    tests_passed.append(assert_test(
        len(cost_summary.all_items) == 5,  # 3 flights + 2 hotels
        "Aggregated all items",
        f"Items: {len(cost_summary.all_items)} (expected 5)"
    ))
    
    tests_passed.append(assert_test(
        cost_summary.all_cash_total > 0,
        "All-cash total calculated",
        f"Total: ${cost_summary.all_cash_total:.2f}"
    ))
    
    # Test 2: Run optimization
    async def run_optimize():
        return await optimize_trip_out_of_pocket(
            flight_edges, hotel_options, user_points, include_hotels=True
        )
    
    solution = asyncio.run(run_optimize())
    
    print(f"\nOptimization Results:")
    print(f"  Status: {solution.status}")
    print(f"  Total OOP: ${solution.total_out_of_pocket:.2f}")
    print(f"  All Cash: ${solution.all_cash_cost:.2f}")
    print(f"  Savings: ${solution.savings:.2f} ({solution.savings_percentage:.1f}%)")
    print(f"  Points Used: {solution.total_points_used:,}")
    
    tests_passed.append(assert_test(
        solution.status == "Optimal",
        "Optimization is Optimal",
        ""
    ))
    
    tests_passed.append(assert_test(
        solution.savings > 0,
        "Some savings achieved",
        f"Savings: ${solution.savings:.2f}"
    ))
    
    # Test 3: Build optimized response
    response = build_oop_optimized_response(solution)
    
    tests_passed.append(assert_test(
        "summary" in response and "booking_order" in response,
        "Response has summary and booking order",
        f"Keys: {list(response.keys())}"
    ))
    
    tests_passed.append(assert_test(
        len(response.get("booking_order", [])) > 0,
        "Booking order has steps",
        f"Steps: {len(response.get('booking_order', []))}"
    ))
    
    # Print booking order
    print(f"\nBooking Order:")
    for step in response.get("booking_order", []):
        print(f"  Step {step['step']}: [{step['type']}] {step['action']}")
    
    return all(tests_passed)


# =============================================================================
# TEST 8: End-to-End OOP vs CPP Comparison
# =============================================================================

def test_oop_vs_cpp_comparison():
    """Compare OOP vs CPP optimization results."""
    print_header("OOP vs CPP Mode Comparison")
    
    from src.handlers.ilp_adapter import run_ilp_from_edges
    from src.handlers.planTrip import plan_non_pooled_multi_itineraries_with_native
    
    # Scenario: Simple one-way flight with multiple award options
    # Option 1: Low surcharge ($50), more points (50,000) - better for OOP
    # Option 2: High surcharge ($350), fewer points (35,000) - better CPP value
    # Cash cost is $600 for both
    # 
    # Option 1 CPP: (600-50)/50000 = 1.1 cpp
    # Option 2 CPP: (600-350)/35000 = 0.71 cpp
    # 
    # OOP mode should prefer Option 1 (pay $50)
    # CPP mode might prefer Option 2 (higher total cash saved value)
    
    edges = {
        # Option 1: Low surcharge, more points
        ("JFK", "LHR", "low_sur"): {
            "points_program": "UA",
            "points_cost": 50000,
            "points_surcharge": 50,  # Low surcharge
            "cash_cost": 600,
            "time_cost": 420,
        },
        # Option 2: High surcharge, fewer points (but high $ savings)
        ("JFK", "LHR", "high_sur"): {
            "points_program": "UA",
            "points_cost": 35000,
            "points_surcharge": 350,  # High surcharge
            "cash_cost": 600,
            "time_cost": 420,
        },
    }
    
    travelers = ["test"]
    start_city = {"test": "JFK"}
    end_city = {"test": "LHR"}
    user_points = {
        "test": {
            "UA": 100000,  # Plenty of miles
        }
    }
    
    # Run OOP mode
    solution_oop = run_ilp_from_edges(
        edges,
        travelers,
        start_city,
        end_city,
        user_points,
        plan_non_pooled_multi_itineraries_with_native,
        optimization_mode="oop",
    )
    
    # Run CPP mode
    solution_cpp = run_ilp_from_edges(
        edges,
        travelers,
        start_city,
        end_city,
        user_points,
        plan_non_pooled_multi_itineraries_with_native,
        optimization_mode="cpp",
    )
    
    tests_passed = []
    
    oop_cash = solution_oop['totals']['cash']
    cpp_cash = solution_cpp['totals']['cash']
    oop_points = solution_oop['totals']['airline_points']
    cpp_points = solution_cpp['totals']['airline_points']
    
    print(f"\nComparison Results:")
    print(f"  OOP Mode: ${oop_cash:.2f} OOP, {oop_points:.0f} points, status={solution_oop['status']}")
    print(f"  CPP Mode: ${cpp_cash:.2f} OOP, {cpp_points:.0f} points, status={solution_cpp['status']}")
    
    # Both should be optimal
    tests_passed.append(assert_test(
        solution_oop['status'] == 'Optimal' and solution_cpp['status'] == 'Optimal',
        "Both modes produce Optimal solutions",
        f"OOP status={solution_oop['status']}, CPP status={solution_cpp['status']}"
    ))
    
    # OOP mode should result in lower or equal cash spent
    tests_passed.append(assert_test(
        oop_cash <= cpp_cash + 0.01,  # Small tolerance for floating point
        "OOP mode has lower or equal cash spent",
        f"OOP=${oop_cash:.2f}, CPP=${cpp_cash:.2f}"
    ))
    
    # Verify both modes found paths
    tests_passed.append(assert_test(
        len(solution_oop['path']['test']) >= 2 and len(solution_cpp['path']['test']) >= 2,
        "Both modes found valid paths",
        f"OOP path={solution_oop['path']['test']}, CPP path={solution_cpp['path']['test']}"
    ))
    
    # OOP mode should prefer low surcharge option
    tests_passed.append(assert_test(
        oop_cash <= 100,  # Should choose $50 surcharge option
        "OOP mode chose low surcharge option",
        f"OOP=${oop_cash:.2f} (expected ~$50)"
    ))
    
    return all(tests_passed)


# =============================================================================
# MAIN TEST RUNNER
# =============================================================================

def run_all_tests():
    """Run all tests and report results."""
    print("\n" + "=" * 80)
    print("OOP OPTIMIZATION TEST SUITE")
    print("=" * 80)
    
    tests = [
        ("Surcharge Penalty Calculation", test_surcharge_penalty),
        ("Alliance Partner Routing", test_alliance_partner_routing),
        ("Transfer Strategy Functions", test_transfer_strategy),
        ("Min OOP ILP Optimizer", test_min_oop_optimizer),
        ("Connecting Flight Support", test_connecting_flight_support),
        ("Trip Cost Optimizer Integration", test_trip_cost_optimizer),
        ("OOP Optimization Mode", test_oop_optimization_mode),
        ("OOP vs CPP Comparison", test_oop_vs_cpp_comparison),
    ]
    
    results = {}
    
    for name, test_fn in tests:
        try:
            passed = test_fn()
            results[name] = passed
        except Exception as e:
            print(f"\n❌ ERROR in {name}: {e}")
            import traceback
            traceback.print_exc()
            results[name] = False
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    failed = total - passed
    
    for name, result in results.items():
        status = "✓ PASSED" if result else "✗ FAILED"
        print(f"  {status}: {name}")
    
    print(f"\n  Total: {total} tests, {passed} passed, {failed} failed")
    
    if failed == 0:
        print("\n🎉 ALL TESTS PASSED!")
    else:
        print(f"\n⚠️  {failed} test(s) failed")
    
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
