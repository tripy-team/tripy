"""
Multi-criteria pruning for V3 optimization.

CRITICAL: Pruning by cash alone destroys CPP mode quality.
Use multiple criteria, then union.

Strategy:
1. Keep top K by each criterion (cash, time, award value)
2. Union the selected candidates
3. Cap total if still too many
"""

from typing import List, Dict, Set, Optional
from collections import defaultdict

from .models_v3 import (
    FlightItineraryEdge, 
    PruningConfig,
)
from .trip_spec import TripPlanSpec, TimeOfDay


def prune_flights(
    flights: List[FlightItineraryEdge],
    config: PruningConfig,
    trip_spec: Optional[TripPlanSpec] = None,
) -> List[FlightItineraryEdge]:
    """
    Prune flights using MULTIPLE criteria, then union.
    
    This ensures CPP mode doesn't lose good awards just because cash is high.
    
    Strategy:
    1. Apply hard filters (max_stops, max_duration)
    2. Optionally prefer flights matching time preferences
    3. Group by (leg_id, origin, destination, date)
    4. Keep top K by each criterion
    5. Union selected
    6. Cap total per O-D
    """
    
    # ═══════════════════════════════════════════════════════════════════════
    # STEP 1: Hard filters
    # ═══════════════════════════════════════════════════════════════════════
    
    filtered = []
    for f in flights:
        # Max stops
        if f.num_stops > config.max_stops:
            continue
        
        # Max duration
        if f.total_time_minutes / 60 > config.max_duration_hours:
            continue
        
        filtered.append(f)
    
    # ═══════════════════════════════════════════════════════════════════════
    # STEP 1.5: Score time preference match
    # ═══════════════════════════════════════════════════════════════════════
    
    # Cache time preference scores for later use
    time_pref_scores: Dict[str, float] = {}
    for f in filtered:
        time_pref_scores[f.edge_id] = _compute_time_preference_score(f, trip_spec)
    
    # ═══════════════════════════════════════════════════════════════════════
    # STEP 2: Group by O-D key
    # ═══════════════════════════════════════════════════════════════════════
    
    by_od: Dict[tuple, List[FlightItineraryEdge]] = defaultdict(list)
    for f in filtered:
        # Key: (leg_id, origin, destination, departure_date)
        key = (
            f.leg_id,
            f.origin,
            f.destination,
            f.departs_on_date,
        )
        by_od[key].append(f)
    
    # ═══════════════════════════════════════════════════════════════════════
    # STEP 3-5: Multi-criteria selection per O-D
    # ═══════════════════════════════════════════════════════════════════════
    
    pruned = []
    
    for od_key, od_flights in by_od.items():
        selected: Set[str] = set()
        
        # ═══════════════════════════════════════════════════════════════════
        # Criterion 1: Top K by lowest cash
        # ═══════════════════════════════════════════════════════════════════
        
        by_cash = sorted(od_flights, key=lambda f: f.cash_cost)
        for f in by_cash[:config.max_by_cash]:
            selected.add(f.edge_id)
        
        # ═══════════════════════════════════════════════════════════════════
        # Criterion 2: Top K by shortest time
        # ═══════════════════════════════════════════════════════════════════
        
        by_time = sorted(od_flights, key=lambda f: f.total_time_minutes)
        for f in by_time[:config.max_by_time]:
            selected.add(f.edge_id)
        
        # ═══════════════════════════════════════════════════════════════════
        # Criterion 3: Top K by best award value
        # ═══════════════════════════════════════════════════════════════════
        
        by_award = sorted(
            od_flights,
            key=lambda f: f.best_award_value(),
            reverse=True
        )
        for f in by_award[:config.max_by_award]:
            selected.add(f.edge_id)
        
        # ═══════════════════════════════════════════════════════════════════
        # Criterion 4: Top K by fewest stops (prefer nonstop)
        # ═══════════════════════════════════════════════════════════════════
        
        by_stops = sorted(
            od_flights,
            key=lambda f: (f.num_stops, f.total_time_minutes, f.cash_cost)
        )
        # Keep top 5 with fewest stops (ensures nonstops get through)
        for f in by_stops[:5]:
            selected.add(f.edge_id)
        
        # ═══════════════════════════════════════════════════════════════════
        # Criterion 5: Top K by time preference match (if specified)
        # ═══════════════════════════════════════════════════════════════════
        
        if trip_spec is not None:
            by_time_pref = sorted(
                od_flights,
                key=lambda f: time_pref_scores.get(f.edge_id, 0.0),
                reverse=True
            )
            # Keep top K flights that match time preferences
            for f in by_time_pref[:config.max_by_time]:
                if time_pref_scores.get(f.edge_id, 0.0) > 0:
                    selected.add(f.edge_id)
        
        # ═══════════════════════════════════════════════════════════════════
        # Collect selected
        # ═══════════════════════════════════════════════════════════════════
        
        od_selected = [f for f in od_flights if f.edge_id in selected]
        
        # Cap total if needed
        if len(od_selected) > config.max_total_per_od:
            # Score by combined heuristic and take top
            od_selected.sort(
                key=lambda f: _flight_combined_score(f, time_pref_scores.get(f.edge_id, 0.0)), 
                reverse=True
            )
            od_selected = od_selected[:config.max_total_per_od]
        
        pruned.extend(od_selected)
    
    return pruned


def _compute_time_preference_score(
    flight: FlightItineraryEdge,
    trip_spec: Optional[TripPlanSpec],
) -> float:
    """
    Compute a score (0.0 to 1.0) based on how well the flight matches time preferences.
    
    Returns 0.5 if no preferences specified (neutral).
    Returns 1.0 for perfect match, 0.0 for complete mismatch.
    """
    if trip_spec is None:
        return 0.5
    
    # Get preferences for this leg
    dep_pref = trip_spec.get_departure_preference(flight.leg_id)
    arr_pref = trip_spec.get_arrival_preference(flight.leg_id)
    
    # If no preferences, neutral score
    if dep_pref is None and arr_pref is None:
        return 0.5
    
    score = 0.0
    count = 0
    
    # Check departure time match
    if dep_pref is not None and flight.departure_datetime:
        dep_hour = flight.departure_datetime.hour
        if dep_pref.matches_hour(dep_hour):
            score += 1.0
        count += 1
    
    # Check arrival time match
    if arr_pref is not None and flight.arrival_datetime:
        arr_hour = flight.arrival_datetime.hour
        if arr_pref.matches_hour(arr_hour):
            score += 1.0
        count += 1
    
    return score / count if count > 0 else 0.5


def _flight_combined_score(f: FlightItineraryEdge, time_pref_score: float = 0.5) -> float:
    """
    Combined heuristic score for final tie-breaking.
    
    Higher score = more likely to keep.
    
    Args:
        f: The flight to score
        time_pref_score: Score from 0-1 for time preference match (0.5 = neutral)
    """
    
    # Cash score (lower is better, normalized)
    cash_score = 1.0 - min(1.0, f.cash_cost / 5000)
    
    # Time score (shorter is better, normalized to 24h)
    time_score = 1.0 - min(1.0, f.total_time_minutes / (24 * 60))
    
    # Award score (higher value is better)
    best_award = f.best_award_value()
    award_score = min(1.0, best_award / 2000) if best_award > 0 else 0
    
    # Nonstop bonus: strongly prefer nonstop flights
    # Nonstop gets +0.3, 1-stop gets 0, 2-stop gets -0.3
    nonstop_bonus = 0.3 if f.num_stops == 0 else (-0.15 * f.num_stops)
    
    # Carrier change penalty
    carrier_penalty = 0.1 if f.has_carrier_change else 0
    
    # Time preference bonus (0-0.15 extra points for matching preferences)
    time_pref_bonus = (time_pref_score - 0.5) * 0.3  # Range: -0.15 to +0.15
    
    return (
        0.20 * cash_score + 
        0.20 * award_score + 
        0.20 * time_score + 
        0.10 * time_pref_score +  # Direct bonus for matching time preferences
        nonstop_bonus +           # Strong bonus for nonstop flights
        time_pref_bonus -         # Additional bonus/penalty
        carrier_penalty
    )


def prune_award_options(
    flights: List[FlightItineraryEdge],
    hotels: list,  # Ignored - no hotels
    config: PruningConfig,
) -> None:
    """
    Prune award options per edge to top K programs.
    
    This modifies the objects in-place.
    """
    
    max_programs = config.max_award_programs_per_edge
    
    # Flights
    for f in flights:
        if len(f.award_options) <= max_programs:
            continue
        
        # Sort by raw_value descending, keep top K
        f.award_options.sort(key=lambda opt: opt.raw_value, reverse=True)
        
        # Keep top K, but ensure different programs
        kept = []
        programs_seen = set()
        for opt in f.award_options:
            if opt.program not in programs_seen:
                kept.append(opt)
                programs_seen.add(opt.program)
            elif len(kept) < max_programs:
                # Allow same program if we haven't hit limit
                kept.append(opt)
            
            if len(kept) >= max_programs:
                break
        
        f.award_options = kept


def count_candidates(
    flights: List[FlightItineraryEdge],
) -> Dict[str, int]:
    """Count candidates for metrics."""
    
    return {
        "flights": len(flights),
        "flight_award_options": sum(len(f.award_options) for f in flights),
    }
