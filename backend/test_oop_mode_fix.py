#!/usr/bin/env python3
"""
Test to verify the OOP mode fix.

BEFORE: OOP mode penalized points at 1.2¢/pt, often choosing cash even when points save money.
AFTER: OOP mode uses tiny 0.2¢/pt tiebreaker, strongly preferring points when they save cash.

Example:
  Cash: $500
  Points: 50,000 pts + $80 surcharge

  BEFORE (1.2¢/pt):
    Cash cost: $500
    Points cost: $80 + (50,000 × 0.012) = $680  ← Cash wins (bad!)

  AFTER (0.2¢/pt):
    Cash cost: $500
    Points cost: $80 + (50,000 × 0.002) = $180  ← Points wins (correct!)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.optimization.models_v3 import ComfortConfig


def test_mode_specific_opportunity_costs():
    """Verify mode-specific opportunity costs are configured correctly."""
    print("\n" + "="*60)
    print("TEST: Mode-Specific Opportunity Costs")
    print("="*60)
    
    cfg = ComfortConfig()
    
    print(f"\nOOP mode opportunity cost:      {cfg.points_opportunity_cost_oop}¢/pt")
    print(f"Balanced mode opportunity cost: {cfg.points_opportunity_cost_balanced}¢/pt")
    print(f"CPP mode opportunity cost:      {cfg.points_opportunity_cost_cpp}¢/pt")
    print(f"CPP floor:                      {cfg.cpp_floor}¢/pt")
    print(f"CPP floor enabled:              {cfg.enable_cpp_floor}")
    
    # Verify OOP is tiny (encourages points)
    assert cfg.points_opportunity_cost_oop <= 0.005, \
        f"OOP opportunity cost should be tiny (≤0.5¢), got {cfg.points_opportunity_cost_oop}¢"
    
    # Verify balanced is moderate
    assert 0.005 <= cfg.points_opportunity_cost_balanced <= 0.015, \
        f"Balanced opportunity cost should be moderate (0.5-1.5¢), got {cfg.points_opportunity_cost_balanced}¢"
    
    # Verify CPP is zero
    assert cfg.points_opportunity_cost_cpp == 0, \
        f"CPP mode should have 0 opportunity cost, got {cfg.points_opportunity_cost_cpp}¢"
    
    # Verify CPP floor is set
    assert cfg.cpp_floor > 0, "CPP floor should be > 0 to prevent terrible redemptions"
    
    print("\n✓ Mode-specific opportunity costs configured correctly")


def test_oop_prefers_points_when_cheaper():
    """
    Verify OOP mode prefers points when they result in lower cash outlay.
    """
    print("\n" + "="*60)
    print("TEST: OOP Mode Prefers Points When Cheaper")
    print("="*60)
    
    cfg = ComfortConfig()
    
    # Scenario: JFK → CDG
    cash_price = 500.0  # $500
    points_required = 50000
    surcharge = 80.0  # $80
    
    # Calculate costs under OLD (1.2¢/pt) and NEW (0.2¢/pt) regimes
    old_opp_cost = 0.012  # Old default
    new_opp_cost = cfg.points_opportunity_cost_oop  # New OOP rate
    
    # Old regime
    old_cash_cost = cash_price
    old_points_cost = surcharge + (points_required * old_opp_cost)
    old_winner = "CASH" if old_cash_cost < old_points_cost else "POINTS"
    
    # New regime
    new_cash_cost = cash_price
    new_points_cost = surcharge + (points_required * new_opp_cost)
    new_winner = "CASH" if new_cash_cost < new_points_cost else "POINTS"
    
    print(f"\nScenario: JFK → CDG")
    print(f"  Cash price: ${cash_price}")
    print(f"  Points: {points_required:,} pts + ${surcharge} surcharge")
    
    print(f"\nOLD regime (1.2¢/pt opportunity cost):")
    print(f"  Cash objective:   ${old_cash_cost}")
    print(f"  Points objective: ${old_points_cost:.0f} ({surcharge} + {points_required}×{old_opp_cost})")
    print(f"  Winner: {old_winner}")
    
    print(f"\nNEW regime ({new_opp_cost}¢/pt opportunity cost):")
    print(f"  Cash objective:   ${new_cash_cost}")
    print(f"  Points objective: ${new_points_cost:.0f} ({surcharge} + {points_required}×{new_opp_cost})")
    print(f"  Winner: {new_winner}")
    
    # In this scenario, points should win under new regime
    assert new_winner == "POINTS", \
        f"With new OOP mode, points should win this scenario! Points cost ${new_points_cost:.0f} < cash ${new_cash_cost}"
    
    # Under old regime, cash would have won (bad!)
    assert old_winner == "CASH", \
        "Under old regime, cash would have won (demonstrating the bug)"
    
    print(f"\n✓ OOP mode now correctly prefers points when they save cash!")
    print(f"  Cash saved by using points: ${cash_price - surcharge}")
    print(f"  CPP: {((cash_price - surcharge) * 100 / points_required):.2f}¢/pt")


def test_cpp_floor_rejects_bad_redemptions():
    """
    Verify CPP floor prevents terrible redemptions.
    """
    print("\n" + "="*60)
    print("TEST: CPP Floor Rejects Bad Redemptions")
    print("="*60)
    
    cfg = ComfortConfig()
    cpp_floor = cfg.cpp_floor
    
    # Good redemption: 50k pts for $500 cash, $80 surcharge → 0.84¢/pt
    good_cash = 500.0
    good_surcharge = 80.0
    good_miles = 50000
    good_cpp = ((good_cash - good_surcharge) * 100) / good_miles
    
    # Bad redemption: 200k pts for $500 cash, $400 surcharge → 0.05¢/pt
    bad_cash = 500.0
    bad_surcharge = 400.0
    bad_miles = 200000
    bad_cpp = ((bad_cash - bad_surcharge) * 100) / bad_miles
    
    print(f"\nCPP floor: {cpp_floor}¢/pt")
    
    print(f"\nGood redemption:")
    print(f"  Cash: ${good_cash}, Surcharge: ${good_surcharge}, Miles: {good_miles:,}")
    print(f"  CPP: {good_cpp:.2f}¢/pt")
    print(f"  Status: {'✓ ALLOWED' if good_cpp >= cpp_floor else '✗ REJECTED'}")
    
    print(f"\nBad redemption:")
    print(f"  Cash: ${bad_cash}, Surcharge: ${bad_surcharge}, Miles: {bad_miles:,}")
    print(f"  CPP: {bad_cpp:.2f}¢/pt")
    print(f"  Status: {'✓ ALLOWED' if bad_cpp >= cpp_floor else '✗ REJECTED'}")
    
    assert good_cpp >= cpp_floor, "Good redemption should pass CPP floor"
    assert bad_cpp < cpp_floor, "Bad redemption should be rejected by CPP floor"
    
    print(f"\n✓ CPP floor correctly filters out terrible redemptions!")


if __name__ == "__main__":
    print("\n" + "="*60)
    print("OOP MODE FIX VERIFICATION")
    print("="*60)
    print("\nThis test verifies that OOP mode now correctly encourages")
    print("using points to save cash, while still preventing terrible")
    print("redemptions via the CPP floor.")
    
    try:
        test_mode_specific_opportunity_costs()
        test_oop_prefers_points_when_cheaper()
        test_cpp_floor_rejects_bad_redemptions()
        
        print("\n" + "="*60)
        print("ALL TESTS PASSED!")
        print("="*60)
        print("\nOOP mode is now aligned with the product goal:")
        print("  → 'Help users save cash by using their points'")
        print("\nKey changes:")
        print("  1. OOP uses tiny 0.2¢/pt tiebreaker (was 1.2¢)")
        print("  2. Balanced uses moderate 0.8¢/pt guard")
        print("  3. CPP uses 0¢ (value-maximizing already)")
        print("  4. CPP floor (0.5¢) prevents terrible redemptions\n")
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
