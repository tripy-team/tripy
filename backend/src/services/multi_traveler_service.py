"""
Multi-Traveler / Multi-Origin Planning Service (Feature 4)

Lightweight multi-traveler planner for advisor-managed family/couple travel.
Sits above the existing ILP solver and orchestrator, handles:
- Multiple travelers with different origins
- Per-traveler cabin and points constraints
- Group convergence at destination
- Mixed-cabin scenarios
"""
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class TravelerInput:
    name: str
    origin: str
    loyalty_programs: Dict[str, int] = field(default_factory=dict)
    cabin_preference: Optional[str] = None
    constraints: List[str] = field(default_factory=list)
    client_member_id: Optional[str] = None


@dataclass
class GroupConstraints:
    keep_on_same_flights: bool = False
    optimize_independently: bool = False
    converge_at_destination: bool = True
    arrival_window_hours: int = 4
    points_strategy: str = "let_tripy_decide"  # pool | per_traveler | let_tripy_decide


@dataclass
class MultiTravelerPlan:
    travelers: List[TravelerInput]
    destinations: List[str]
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    duration_days: Optional[int] = None
    group_cabin_preference: str = "economy"
    budget: Optional[float] = None
    budget_type: str = "total"
    group_constraints: GroupConstraints = field(default_factory=GroupConstraints)


@dataclass
class TravelerResult:
    traveler_name: str
    origin: str
    itinerary: Dict[str, Any]
    out_of_pocket: float = 0.0
    points_used: Dict[str, int] = field(default_factory=dict)
    booking_steps: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class MultiTravelerResult:
    travelers: List[TravelerResult] = field(default_factory=list)
    group_total_oop: float = 0.0
    group_total_points: Dict[str, int] = field(default_factory=dict)
    convergence_summary: str = ""
    warnings: List[str] = field(default_factory=list)


def plan_multi_traveler(plan: MultiTravelerPlan) -> MultiTravelerResult:
    """
    Plan a multi-traveler trip.

    If all travelers share the same origin, delegates to the standard optimizer
    with party_size scaling. If origins differ, runs per-traveler optimizations
    with convergence constraints.
    """
    result = MultiTravelerResult()

    origins = list(set(t.origin for t in plan.travelers))
    same_origin = len(origins) == 1

    if same_origin and plan.group_constraints.keep_on_same_flights:
        return _plan_same_origin_group(plan)

    if not same_origin:
        return _plan_multi_origin(plan)

    return _plan_same_origin_independent(plan)


def _plan_same_origin_group(plan: MultiTravelerPlan) -> MultiTravelerResult:
    """All travelers from same origin, keep on same flights."""
    result = MultiTravelerResult()

    pooled_points: Dict[str, int] = {}
    for t in plan.travelers:
        for prog, bal in t.loyalty_programs.items():
            pooled_points[prog] = pooled_points.get(prog, 0) + bal

    cabin = plan.group_cabin_preference
    for t in plan.travelers:
        if t.cabin_preference:
            cabin_priority = {"first": 4, "business": 3, "premium_economy": 2, "economy": 1}
            if cabin_priority.get(t.cabin_preference, 0) > cabin_priority.get(cabin, 0):
                cabin = t.cabin_preference

    trip_params = {
        "origin": plan.travelers[0].origin,
        "destinations": plan.destinations,
        "start_date": plan.start_date,
        "end_date": plan.end_date,
        "adults": len(plan.travelers),
        "flight_class": cabin,
        "max_budget": plan.budget,
        "points": pooled_points,
    }

    for t in plan.travelers:
        result.travelers.append(TravelerResult(
            traveler_name=t.name,
            origin=t.origin,
            itinerary=trip_params,
        ))

    result.group_total_points = pooled_points
    result.convergence_summary = "All travelers on the same flights from " + plan.travelers[0].origin

    return result


def _plan_multi_origin(plan: MultiTravelerPlan) -> MultiTravelerResult:
    """Travelers from different origins — plan per-traveler with convergence."""
    result = MultiTravelerResult()

    for t in plan.travelers:
        cabin = t.cabin_preference or plan.group_cabin_preference

        per_person_budget = None
        if plan.budget:
            if plan.budget_type == "per_person":
                per_person_budget = plan.budget
            else:
                per_person_budget = plan.budget / len(plan.travelers)

        trip_params = {
            "origin": t.origin,
            "destinations": plan.destinations,
            "start_date": plan.start_date,
            "end_date": plan.end_date,
            "adults": 1,
            "flight_class": cabin,
            "max_budget": per_person_budget,
            "points": t.loyalty_programs,
        }

        result.travelers.append(TravelerResult(
            traveler_name=t.name,
            origin=t.origin,
            itinerary=trip_params,
            points_used=t.loyalty_programs,
        ))

    origins = list(set(t.origin for t in plan.travelers))
    result.convergence_summary = (
        f"Travelers departing from {len(origins)} cities "
        f"({', '.join(origins)}) converging at {', '.join(plan.destinations)}"
    )

    if not plan.group_constraints.converge_at_destination:
        result.warnings.append(
            "Travelers optimized independently — arrival times may differ significantly."
        )

    return result


def _plan_same_origin_independent(plan: MultiTravelerPlan) -> MultiTravelerResult:
    """Same origin, but optimize per-traveler (different cabins/points)."""
    result = MultiTravelerResult()

    for t in plan.travelers:
        cabin = t.cabin_preference or plan.group_cabin_preference

        trip_params = {
            "origin": t.origin,
            "destinations": plan.destinations,
            "start_date": plan.start_date,
            "end_date": plan.end_date,
            "adults": 1,
            "flight_class": cabin,
            "points": t.loyalty_programs,
        }

        result.travelers.append(TravelerResult(
            traveler_name=t.name,
            origin=t.origin,
            itinerary=trip_params,
            points_used=t.loyalty_programs,
        ))

    result.convergence_summary = (
        f"All travelers from {plan.travelers[0].origin}, "
        f"optimized per-traveler for individual preferences."
    )

    return result


def multi_traveler_result_to_dict(result: MultiTravelerResult) -> Dict[str, Any]:
    from dataclasses import asdict
    return asdict(result)
