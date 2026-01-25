"""
Test script for the optimized itinerary generator.

This tests that:
1. Routes are always generated (even when points aren't available)
2. Cash fallback options are included
3. Booking instructions are properly generated
"""

import asyncio
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from src.handlers.min_oop_optimizer import (
    TripCostItem,
    PointsOption,
    minimize_out_of_pocket,
    create_flight_cost_item,
    ensure_cash_option,
    estimate_cash_cost_from_points,
)
from src.handlers.booking_instructions import (
    generate_transfer_step,
    generate_flight_booking_step,
    generate_complete_booking_plan,
    booking_plan_to_dict,
)
from src.handlers.transfer_strategy import EXTENDED_TRANSFER_GRAPH


def test_cash_fallback():
    """Test that items without points options still get optimized."""
    print("\n=== Testing Cash Fallback ===")
    
    # Create a flight with only cash option
    flight = create_flight_cost_item(
        item_id="test_flight_1",
        origin="JFK",
        destination="LAX",
        cash_cost=350.0,
        points_options=[],  # No points option
    )
    
    # Run optimization with no points
    solution = minimize_out_of_pocket(
        items=[flight],
        available_points={},
    )
    
    print(f"Status: {solution.status}")
    print(f"Total OOP: ${solution.total_out_of_pocket:.2f}")
    print(f"Payment plan: {len(solution.payment_plan)} items")
    
    if solution.payment_plan:
        payment = solution.payment_plan[0]
        print(f"  - {payment.description}: {payment.payment_type} = ${payment.cash_paid:.2f}")
    
    assert solution.status in ["Optimal", "Fallback"], "Should return valid status"
    assert solution.total_out_of_pocket == 350.0, "Should pay cash price"
    assert len(solution.payment_plan) == 1, "Should have one payment"
    assert solution.payment_plan[0].payment_type == "cash", "Should be cash payment"
    
    print("✅ Cash fallback test passed!")


def test_points_optimization():
    """Test that points are used when available and beneficial."""
    print("\n=== Testing Points Optimization ===")
    
    # Create a flight with both cash and points options
    flight = create_flight_cost_item(
        item_id="test_flight_2",
        origin="JFK",
        destination="CDG",
        cash_cost=850.0,
        points_options=[
            {"program_code": "AF", "points_required": 55000, "surcharge": 120.0},
        ],
    )
    
    # Run optimization with Chase points (can transfer to AF)
    solution = minimize_out_of_pocket(
        items=[flight],
        available_points={"chase": 100000},
        transfer_graph=EXTENDED_TRANSFER_GRAPH,
    )
    
    print(f"Status: {solution.status}")
    print(f"Total OOP: ${solution.total_out_of_pocket:.2f}")
    print(f"All cash would be: ${solution.all_cash_cost:.2f}")
    print(f"Savings: ${solution.savings:.2f} ({solution.savings_percentage:.1f}%)")
    print(f"Points used: {solution.total_points_used:,}")
    
    if solution.payment_plan:
        payment = solution.payment_plan[0]
        print(f"  - {payment.description}: {payment.payment_type}")
        if payment.points_used:
            print(f"    Points: {payment.points_used:,} {payment.program_name}")
            print(f"    Cash (fees): ${payment.cash_paid:.2f}")
    
    # Should use points since surcharge ($120) < cash ($850)
    assert solution.status == "Optimal", "Should find optimal solution"
    assert solution.total_out_of_pocket == 120.0, "Should pay only surcharge"
    assert solution.savings > 700, "Should save significant amount"
    
    print("✅ Points optimization test passed!")


def test_cash_estimation():
    """Test cash cost estimation from points."""
    print("\n=== Testing Cash Cost Estimation ===")
    
    # Test flight estimation
    flight_cash = estimate_cash_cost_from_points(
        points_cost=55000,
        surcharge=120.0,
        item_type="flight",
    )
    print(f"Flight cash estimate: ${flight_cash:.2f} (from 55K points + $120 surcharge)")
    
    # Test hotel estimation
    hotel_cash = estimate_cash_cost_from_points(
        points_cost=80000,
        surcharge=30.0,
        item_type="hotel",
    )
    print(f"Hotel cash estimate: ${hotel_cash:.2f} (from 80K points + $30 surcharge)")
    
    assert flight_cash > 0, "Flight estimate should be positive"
    assert hotel_cash > 0, "Hotel estimate should be positive"
    
    print("✅ Cash estimation test passed!")


def test_ensure_cash_option():
    """Test that ensure_cash_option adds cash costs when missing."""
    print("\n=== Testing ensure_cash_option ===")
    
    # Create item with no cash cost
    item = TripCostItem(
        item_id="test_item",
        item_type="flight",
        description="Test flight",
        cash_cost=0,  # No cash cost
        points_options=[
            PointsOption(
                program_code="UA",
                program_type="airline",
                points_required=25000,
                surcharge=5.60,
            )
        ],
    )
    
    print(f"Before: cash_cost = ${item.cash_cost:.2f}")
    
    item = ensure_cash_option(item)
    
    print(f"After: cash_cost = ${item.cash_cost:.2f}")
    
    assert item.cash_cost > 0, "Should have positive cash cost after ensure_cash_option"
    
    print("✅ ensure_cash_option test passed!")


def test_booking_instructions():
    """Test booking instruction generation."""
    print("\n=== Testing Booking Instructions ===")
    
    # Generate transfer step
    transfer_step = generate_transfer_step(
        step_number=1,
        from_bank="chase",
        to_program="AF",
        points_to_transfer=55000,
        for_items=["JFK → CDG"],
        days_until_travel=14,
    )
    
    print(f"Transfer step: {transfer_step.title}")
    print(f"  From: {transfer_step.from_program_name}")
    print(f"  To: {transfer_step.to_program_name}")
    print(f"  Points: {transfer_step.points_amount:,}")
    print(f"  Time: {transfer_step.transfer_time}")
    print(f"  Sub-steps: {len(transfer_step.sub_steps)}")
    
    assert transfer_step.from_program == "chase", "Should be from Chase"
    assert transfer_step.to_program == "AF", "Should be to Air France"
    assert transfer_step.points_amount == 55000, "Should transfer 55K points"
    assert len(transfer_step.sub_steps) > 0, "Should have sub-steps"
    
    print("✅ Booking instructions test passed!")


def test_multi_segment_optimization():
    """Test optimization with multiple flight segments."""
    print("\n=== Testing Multi-Segment Optimization ===")
    
    # Create multiple flight segments
    flights = [
        create_flight_cost_item(
            item_id="outbound",
            origin="JFK",
            destination="CDG",
            cash_cost=850.0,
            points_options=[
                {"program_code": "AF", "points_required": 55000, "surcharge": 120.0},
            ],
        ),
        create_flight_cost_item(
            item_id="return",
            origin="CDG",
            destination="JFK",
            cash_cost=750.0,
            points_options=[
                {"program_code": "AF", "points_required": 55000, "surcharge": 120.0},
            ],
        ),
    ]
    
    # Run optimization
    solution = minimize_out_of_pocket(
        items=flights,
        available_points={"chase": 150000},  # Enough for both
        transfer_graph=EXTENDED_TRANSFER_GRAPH,
    )
    
    print(f"Status: {solution.status}")
    print(f"Total OOP: ${solution.total_out_of_pocket:.2f}")
    print(f"All cash would be: ${solution.all_cash_cost:.2f}")
    print(f"Savings: ${solution.savings:.2f} ({solution.savings_percentage:.1f}%)")
    print(f"Points used: {solution.total_points_used:,}")
    
    for payment in solution.payment_plan:
        print(f"  - {payment.description}: {payment.payment_type} = ${payment.cash_paid:.2f}")
    
    # Should use points for both flights
    assert solution.status == "Optimal", "Should find optimal solution"
    assert solution.total_out_of_pocket == 240.0, "Should pay only surcharges"
    assert solution.total_points_used == 110000, "Should use 110K points total"
    
    print("✅ Multi-segment optimization test passed!")


def test_insufficient_points():
    """Test behavior when points are insufficient."""
    print("\n=== Testing Insufficient Points ===")
    
    flight = create_flight_cost_item(
        item_id="test_flight",
        origin="JFK",
        destination="CDG",
        cash_cost=850.0,
        points_options=[
            {"program_code": "AF", "points_required": 55000, "surcharge": 120.0},
        ],
    )
    
    # Run optimization with insufficient points
    solution = minimize_out_of_pocket(
        items=[flight],
        available_points={"chase": 30000},  # Not enough for 55K
        transfer_graph=EXTENDED_TRANSFER_GRAPH,
    )
    
    print(f"Status: {solution.status}")
    print(f"Total OOP: ${solution.total_out_of_pocket:.2f}")
    print(f"Payment type: {solution.payment_plan[0].payment_type if solution.payment_plan else 'N/A'}")
    
    # Should fall back to cash since points are insufficient
    assert solution.status in ["Optimal", "Fallback"], "Should return valid status"
    assert len(solution.payment_plan) == 1, "Should have one payment"
    # The optimizer might choose cash since points are insufficient
    print(f"Payment: {solution.payment_plan[0].payment_type} = ${solution.payment_plan[0].cash_paid:.2f}")
    
    print("✅ Insufficient points test passed!")


def run_all_tests():
    """Run all tests."""
    print("=" * 60)
    print("OPTIMIZED ITINERARY IMPLEMENTATION TESTS")
    print("=" * 60)
    
    try:
        test_cash_fallback()
        test_points_optimization()
        test_cash_estimation()
        test_ensure_cash_option()
        test_booking_instructions()
        test_multi_segment_optimization()
        test_insufficient_points()
        
        print("\n" + "=" * 60)
        print("ALL TESTS PASSED! ✅")
        print("=" * 60)
        return True
        
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
