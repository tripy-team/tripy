"""
Test ILP optimizer for JFK to FLL route on 02/11/2026
"""

import sys
import json
from pathlib import Path

backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

from src.handlers.ilp_adapter import run_ilp_from_edges
from src.handlers.planTrip import plan_non_pooled_multi_itineraries_with_native


def test_jfk_to_fll():
    # Define flight options from JFK to FLL
    edges = {
        # Direct flight option 1
        ("JFK", "FLL", "direct_aa"): {
            "points_program": "AA",
            "points_cost": 12500,
            "points_surcharge": 5.6,
            "cash_cost": 250,
            "time_cost": 180,  # 3 hours
        },
        # Direct flight option 2
        ("JFK", "FLL", "direct_b6"): {
            "points_program": "B6",  # JetBlue
            "points_cost": 8500,
            "points_surcharge": 5.6,
            "cash_cost": 200,
            "time_cost": 185,
        },
        # Connecting via ATL
        ("JFK", "ATL", "connect_dl_1"): {
            "points_program": "DL",
            "points_cost": 7500,
            "points_surcharge": 5.6,
            "cash_cost": 150,
            "time_cost": 150,
        },
        ("ATL", "FLL", "connect_dl_2"): {
            "points_program": "DL",
            "points_cost": 7500,
            "points_surcharge": 5.6,
            "cash_cost": 150,
            "time_cost": 120,
        },
    }
    
    travelers = ["john"]
    start_city = {"john": "JFK"}
    end_city = {"john": "FLL"}
    
    # User has various airline miles and credit card points
    user_points = {
        "john": {
            "AA": 25000,
            "B6": 15000,
            "DL": 30000,
            "chase": 50000,
            "amex": 40000,
        }
    }
    
    # Transfer options
    transfer_graph = {
        "chase": {
            "AA": 1.0,
            "B6": 1.0,
        },
        "amex": {
            "DL": 1.0,
            "B6": 1.0,
        },
    }
    
    solution = run_ilp_from_edges(
        edges,
        travelers,
        start_city,
        end_city,
        user_points,
        plan_non_pooled_multi_itineraries_with_native,
        transfer_graph=transfer_graph,
        transfer_bonuses={},
        bank_block_size=1000,
    )
    
    # Output as JSON
    print(json.dumps(solution, indent=2, default=str))


if __name__ == "__main__":
    test_jfk_to_fll()
