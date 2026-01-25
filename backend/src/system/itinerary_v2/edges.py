"""
Edge merging utilities for the v2 itinerary pipeline.

Merges cash (SERP) and award (AwardTool) options into a unified EdgeOption list.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Dict, List, Optional, Tuple

from .schemas import EdgeOption, ScheduledLeg, LegOptions

logger = logging.getLogger(__name__)


def merge_options_for_leg(
    leg: ScheduledLeg,
    serp_options: List[EdgeOption],
    award_options: List[EdgeOption],
) -> LegOptions:
    """
    Merge SERP (cash) and AwardTool (award) options for a single leg.
    
    For v2 first cut, we keep them as separate options rather than
    attaching award pricing to SERP options (that's a later upgrade).
    
    Args:
        leg: The scheduled leg
        serp_options: Cash options from SERP
        award_options: Award options from AwardTool
        
    Returns:
        LegOptions with all available options for this leg
    """
    all_options = []
    
    # Add cash options
    for opt in serp_options:
        all_options.append(opt)
    
    # Add award options
    for opt in award_options:
        all_options.append(opt)
    
    # Sort by cost (cash first, then by miles)
    def sort_key(opt: EdgeOption) -> Tuple[int, float]:
        if opt.cash_usd is not None:
            # Cash options first, sorted by price
            return (0, opt.cash_usd)
        elif opt.award_miles is not None:
            # Award options second, sorted by surcharge + miles/100
            surcharge = opt.award_surcharge_usd or 0
            return (1, surcharge + opt.award_miles / 100)
        else:
            # Unknown options last
            return (2, float("inf"))
    
    all_options.sort(key=sort_key)
    
    return LegOptions(leg=leg, options=all_options)


def build_leg_options_map(
    legs: List[ScheduledLeg],
    serp_by_leg: Dict[Tuple[str, str, date], List[EdgeOption]],
    award_by_leg: Dict[Tuple[str, str, date], List[EdgeOption]],
) -> Dict[ScheduledLeg, LegOptions]:
    """
    Build a map of leg -> options for all scheduled legs.
    
    Args:
        legs: List of scheduled legs
        serp_by_leg: SERP options indexed by (origin, dest, date)
        award_by_leg: AwardTool options indexed by (origin, dest, date)
        
    Returns:
        Dict mapping each leg to its LegOptions
    """
    result = {}
    
    for leg in legs:
        key = (leg.origin, leg.destination, leg.date)
        serp_opts = serp_by_leg.get(key, [])
        award_opts = award_by_leg.get(key, [])
        
        result[leg] = merge_options_for_leg(leg, serp_opts, award_opts)
    
    return result


def convert_to_v1_edges_dict(
    leg_options_map: Dict[ScheduledLeg, LegOptions],
) -> Dict[Tuple[str, str, str], Dict]:
    """
    Convert v2 LegOptions to v1-style edges_dict for the ILP adapter.
    
    The v1 ILP expects edge keys as (origin, dest, flight_number/option_id)
    with values containing cash_cost, points_cost, points_surcharge, etc.
    
    Args:
        leg_options_map: Map of leg -> LegOptions
        
    Returns:
        Dict in v1 edges_dict format for run_ilp_from_edges
    """
    edges_dict = {}
    
    for leg, leg_options in leg_options_map.items():
        for opt in leg_options.options:
            # Use option_id as the "flight number" in the edge key
            edge_key = (opt.origin, opt.destination, opt.option_id)
            
            edge_data = {
                "time_cost": float(opt.duration_min or 480),  # Default 8 hours
            }
            
            # Add cash cost if available
            if opt.cash_usd is not None:
                edge_data["cash_cost"] = float(opt.cash_usd)
            
            # Add points cost if available
            if opt.award_miles is not None:
                edge_data["points_cost"] = float(opt.award_miles)
                edge_data["points_surcharge"] = float(opt.award_surcharge_usd or 0)
                edge_data["points_program"] = opt.award_program
            
            # Add operating airline for benefit matching
            if opt.operating_airline:
                edge_data["operating_airline"] = opt.operating_airline
            
            # Store segments for later rendering
            if opt.segments:
                edge_data["segments"] = opt.segments
            
            edges_dict[edge_key] = edge_data
    
    return edges_dict


def get_option_by_id(
    leg_options_map: Dict[ScheduledLeg, LegOptions],
    option_id: str,
) -> Optional[EdgeOption]:
    """
    Find an EdgeOption by its option_id.
    
    Args:
        leg_options_map: Map of leg -> LegOptions
        option_id: The option ID to find
        
    Returns:
        EdgeOption if found, None otherwise
    """
    for leg_options in leg_options_map.values():
        for opt in leg_options.options:
            if opt.option_id == option_id:
                return opt
    return None


def filter_options_by_budget(
    leg_options_map: Dict[ScheduledLeg, LegOptions],
    max_budget_per_leg: Optional[float] = None,
    min_options_per_leg: int = 3,
) -> Dict[ScheduledLeg, LegOptions]:
    """
    Filter options to keep only those within budget, keeping at least min_options.
    
    Args:
        leg_options_map: Original leg options map
        max_budget_per_leg: Maximum cash cost per leg
        min_options_per_leg: Minimum options to keep per leg
        
    Returns:
        Filtered leg options map
    """
    if max_budget_per_leg is None:
        return leg_options_map
    
    result = {}
    
    for leg, leg_options in leg_options_map.items():
        # Filter by budget
        filtered = [
            opt for opt in leg_options.options
            if (opt.cash_usd is None or opt.cash_usd <= max_budget_per_leg)
            or (opt.award_surcharge_usd is not None and opt.award_surcharge_usd <= max_budget_per_leg)
        ]
        
        # Keep at least min_options_per_leg
        if len(filtered) < min_options_per_leg:
            filtered = leg_options.options[:min_options_per_leg]
        
        result[leg] = LegOptions(leg=leg, options=filtered)
    
    return result


def summarize_leg_options(
    leg_options_map: Dict[ScheduledLeg, LegOptions],
) -> Dict[str, Dict]:
    """
    Create a summary of options per leg for logging.
    
    Args:
        leg_options_map: Map of leg -> LegOptions
        
    Returns:
        Dict with leg summaries for logging
    """
    summary = {}
    
    for leg, leg_options in leg_options_map.items():
        leg_key = f"{leg.origin}->{leg.destination}"
        
        cash_options = [o for o in leg_options.options if o.cash_usd is not None]
        award_options = [o for o in leg_options.options if o.award_miles is not None]
        
        summary[leg_key] = {
            "date": str(leg.date),
            "total_options": len(leg_options.options),
            "cash_options": len(cash_options),
            "award_options": len(award_options),
            "min_cash": min((o.cash_usd for o in cash_options), default=None),
            "min_award_miles": min((o.award_miles for o in award_options), default=None),
        }
    
    return summary
