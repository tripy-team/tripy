"""
Dynamic Destination Routing Optimizer

Optimizes the order of intermediate destinations in multi-city trips
to minimize out-of-pocket costs while maximizing points value.

Key Features:
1. Fixed start and end cities with dynamic intermediate ordering
2. Generates and evaluates all route permutations
3. Calculates comprehensive metrics (OOP, CPP, travel time)
4. Generates detailed transfer instructions for optimal route

Example:
    FLL (fixed start) → [HND, CDG] (dynamic order) → MCO (fixed end)
    
    Evaluates:
    - Route A: FLL → HND → CDG → MCO
    - Route B: FLL → CDG → HND → MCO
    
    Recommends the route with lowest OOP that fits user's points budget.
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from itertools import permutations
from typing import Dict, List, Optional, Any, Tuple
from enum import Enum

from .transfer_strategy import (
    build_transfer_instruction,
    get_best_transfer_source,
    PROGRAM_METADATA,
    BANK_METADATA,
    EXTENDED_TRANSFER_GRAPH,
)


logger = logging.getLogger(__name__)


# =============================================================================
# MODELS
# =============================================================================

class RouteStatus(Enum):
    """Route evaluation status."""
    FEASIBLE = "feasible"           # Can be booked within budget
    EXCEEDS_POINTS = "exceeds_points"  # Needs more points than available
    EXCEEDS_CASH = "exceeds_cash"      # Exceeds cash budget
    NO_AVAILABILITY = "no_availability"  # No flights found


@dataclass
class SegmentData:
    """Flight segment data with pricing."""
    segment_id: str
    origin: str
    destination: str
    
    # Cash option
    cash_price: float = 0.0
    
    # Award option
    award_available: bool = False
    points_cost: int = 0
    points_program: Optional[str] = None
    points_program_name: Optional[str] = None
    surcharge: float = 0.0
    
    # Calculated
    cash_saved: float = 0.0  # cash_price - surcharge
    cpp: float = 0.0         # cents per point value
    
    # Flight details
    airline: Optional[str] = None
    flight_number: Optional[str] = None
    duration_minutes: int = 0
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    is_direct: bool = True
    num_stops: int = 0
    
    # Data source
    data_source: str = ""
    booking_link: Optional[str] = None
    
    def calculate_value(self):
        """Calculate cash saved and CPP."""
        if self.award_available and self.points_cost > 0:
            self.cash_saved = self.cash_price - self.surcharge
            self.cpp = (self.cash_saved * 100 / self.points_cost) if self.points_cost > 0 else 0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "segment_id": self.segment_id,
            "origin": self.origin,
            "destination": self.destination,
            "cash_price": self.cash_price,
            "award_available": self.award_available,
            "points_cost": self.points_cost,
            "points_program": self.points_program,
            "points_program_name": self.points_program_name,
            "surcharge": self.surcharge,
            "cash_saved": self.cash_saved,
            "cpp": round(self.cpp, 2),
            "airline": self.airline,
            "flight_number": self.flight_number,
            "duration_minutes": self.duration_minutes,
            "departure_time": self.departure_time,
            "arrival_time": self.arrival_time,
            "is_direct": self.is_direct,
            "num_stops": self.num_stops,
            "data_source": self.data_source,
            "booking_link": self.booking_link,
        }


@dataclass
class TransferStep:
    """A single transfer instruction step."""
    step_number: int
    source_program: str       # "chase"
    source_program_name: str  # "Chase Ultimate Rewards"
    target_program: str       # "UA"
    target_program_name: str  # "United MileagePlus"
    points_to_transfer: int   # Bank points
    resulting_points: int     # Airline/hotel points
    transfer_ratio: str       # "1:1"
    transfer_time: str        # "Instant"
    portal_url: str
    booking_url: str
    for_segment: str          # "FLL → HND"
    cpp_value: float          # Value in cents per point
    cash_saved: float         # Dollar value
    
    instructions: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "step_number": self.step_number,
            "source_program": self.source_program,
            "source_program_name": self.source_program_name,
            "target_program": self.target_program,
            "target_program_name": self.target_program_name,
            "points_to_transfer": self.points_to_transfer,
            "resulting_points": self.resulting_points,
            "transfer_ratio": self.transfer_ratio,
            "transfer_time": self.transfer_time,
            "portal_url": self.portal_url,
            "booking_url": self.booking_url,
            "for_segment": self.for_segment,
            "cpp_value": round(self.cpp_value, 2),
            "cash_saved": round(self.cash_saved, 2),
            "instructions": self.instructions,
        }


@dataclass
class RouteOption:
    """A complete route option with all segments."""
    route_id: str
    route_name: str           # e.g., "Route A"
    path: List[str]           # ["FLL", "HND", "CDG", "MCO"]
    path_display: str         # "FLL → HND → CDG → MCO"
    
    segments: List[SegmentData] = field(default_factory=list)
    
    # Totals
    total_cash_price: float = 0.0
    total_points: int = 0
    total_surcharges: float = 0.0
    total_cash_saved: float = 0.0
    average_cpp: float = 0.0
    total_duration_minutes: int = 0
    
    # Status
    status: RouteStatus = RouteStatus.FEASIBLE
    feasible: bool = True
    
    # Comparison
    points_within_budget: bool = True
    points_budget: int = 0
    points_over_budget: int = 0
    
    def calculate_totals(self):
        """Calculate route totals from segments."""
        self.total_cash_price = sum(s.cash_price for s in self.segments)
        self.total_points = sum(s.points_cost for s in self.segments if s.award_available)
        self.total_surcharges = sum(s.surcharge for s in self.segments if s.award_available)
        self.total_cash_saved = sum(s.cash_saved for s in self.segments if s.award_available)
        self.total_duration_minutes = sum(s.duration_minutes for s in self.segments)
        
        # Average CPP (weighted by points)
        if self.total_points > 0:
            self.average_cpp = (self.total_cash_saved * 100 / self.total_points)
        else:
            self.average_cpp = 0.0
    
    def check_feasibility(self, points_budget: int):
        """Check if route is feasible within points budget."""
        self.points_budget = points_budget
        self.points_within_budget = self.total_points <= points_budget
        self.points_over_budget = max(0, self.total_points - points_budget)
        
        if not self.points_within_budget:
            self.status = RouteStatus.EXCEEDS_POINTS
            self.feasible = False
        elif not self.segments:
            self.status = RouteStatus.NO_AVAILABILITY
            self.feasible = False
        else:
            self.status = RouteStatus.FEASIBLE
            self.feasible = True
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "route_id": self.route_id,
            "route_name": self.route_name,
            "path": self.path,
            "path_display": self.path_display,
            "segments": [s.to_dict() for s in self.segments],
            "total_cash_price": round(self.total_cash_price, 2),
            "total_points": self.total_points,
            "total_surcharges": round(self.total_surcharges, 2),
            "total_cash_saved": round(self.total_cash_saved, 2),
            "average_cpp": round(self.average_cpp, 2),
            "total_duration_minutes": self.total_duration_minutes,
            "total_duration_hours": round(self.total_duration_minutes / 60, 1),
            "status": self.status.value,
            "feasible": self.feasible,
            "points_within_budget": self.points_within_budget,
            "points_budget": self.points_budget,
            "points_over_budget": self.points_over_budget,
        }


@dataclass
class ComparisonMetric:
    """A single metric in the comparison matrix."""
    metric_name: str
    route_a_value: Any
    route_b_value: Any
    winner: str              # "route_a", "route_b", or "tie"
    winner_display: str      # "Route A" or "Route B"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "metric_name": self.metric_name,
            "route_a_value": self.route_a_value,
            "route_b_value": self.route_b_value,
            "winner": self.winner,
            "winner_display": self.winner_display,
        }


@dataclass
class DynamicRouteResult:
    """Complete result of dynamic route optimization."""
    success: bool
    
    # Input
    start_city: str
    end_city: str
    intermediate_cities: List[str]
    points_budget: int
    
    # Route options evaluated
    route_options: List[RouteOption] = field(default_factory=list)
    
    # Comparison matrix
    comparison_matrix: List[ComparisonMetric] = field(default_factory=list)
    
    # Recommendation
    recommended_route: Optional[RouteOption] = None
    recommendation_reasons: List[str] = field(default_factory=list)
    
    # Transfer instructions for recommended route
    transfer_steps: List[TransferStep] = field(default_factory=list)
    
    # Strategy summary
    strategy_summary: str = ""
    
    # Totals for recommended
    total_points_used: int = 0
    remaining_points: int = 0
    total_cash_saved: float = 0.0
    average_cpp: float = 0.0
    total_surcharges: float = 0.0
    
    # Metadata
    computed_at: Optional[datetime] = None
    computation_time_ms: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "success": self.success,
            "start_city": self.start_city,
            "end_city": self.end_city,
            "intermediate_cities": self.intermediate_cities,
            "points_budget": self.points_budget,
            "route_options": [r.to_dict() for r in self.route_options],
            "comparison_matrix": [m.to_dict() for m in self.comparison_matrix],
            "recommended_route": self.recommended_route.to_dict() if self.recommended_route else None,
            "recommendation_reasons": self.recommendation_reasons,
            "transfer_steps": [s.to_dict() for s in self.transfer_steps],
            "strategy_summary": self.strategy_summary,
            "total_points_used": self.total_points_used,
            "remaining_points": self.remaining_points,
            "total_cash_saved": round(self.total_cash_saved, 2),
            "average_cpp": round(self.average_cpp, 2),
            "total_surcharges": round(self.total_surcharges, 2),
            "computed_at": self.computed_at.isoformat() if self.computed_at else None,
            "computation_time_ms": self.computation_time_ms,
        }


# =============================================================================
# OPTIMIZER SERVICE
# =============================================================================

class DynamicRouteOptimizer:
    """
    Optimizes the order of intermediate destinations for multi-city trips.
    
    The algorithm:
    1. Generate all permutations of intermediate cities
    2. For each permutation, build a complete route (start → intermediates → end)
    3. Fetch flight data for all segments in each route
    4. Calculate metrics (OOP, points, CPP, travel time)
    5. Compare routes and select optimal
    6. Generate transfer instructions for the optimal route
    
    Usage:
        optimizer = DynamicRouteOptimizer()
        result = await optimizer.optimize(
            start_city="FLL",
            end_city="MCO",
            intermediate_cities=["HND", "CDG"],
            user_points={"chase": 200000},
            travel_date="2025-06-15"
        )
    """
    
    # Optimization weights (from DYNAMIC_ROUTING_EXAMPLE.md)
    W1_POINTS_SAVINGS = 10**6    # Highest: maximize cash saved via points
    W2_CASH_MINIMIZE = 10**3     # Second: minimize out-of-pocket
    W3_TRAVEL_TIME = 1.0         # Lowest: minimize travel time
    
    # Minimum CPP threshold - only use points if value >= this
    MIN_CPP_THRESHOLD = 1.0
    
    def __init__(self):
        self._flight_cache: Dict[str, SegmentData] = {}
    
    async def optimize(
        self,
        start_city: str,
        end_city: str,
        intermediate_cities: List[str],
        user_points: Dict[str, int],
        travel_date: str,
        cabin_class: str = "economy",
        max_routes_to_evaluate: int = 24,
    ) -> DynamicRouteResult:
        """
        Optimize multi-city routing.
        
        Args:
            start_city: Fixed starting airport (IATA code)
            end_city: Fixed ending airport (IATA code)
            intermediate_cities: List of airports to visit (order will be optimized)
            user_points: User's points balances {"chase": 200000, "amex": 50000}
            travel_date: Travel start date (YYYY-MM-DD)
            cabin_class: Cabin class for flights
            max_routes_to_evaluate: Maximum route permutations to evaluate
            
        Returns:
            DynamicRouteResult with optimal route and transfer instructions
        """
        start_time = datetime.now()
        
        # Calculate total points budget
        total_points_budget = sum(user_points.values())
        
        result = DynamicRouteResult(
            success=False,
            start_city=start_city,
            end_city=end_city,
            intermediate_cities=intermediate_cities,
            points_budget=total_points_budget,
        )
        
        try:
            # Step 1: Generate all route permutations
            logger.info(f"Generating route permutations for {len(intermediate_cities)} intermediate cities")
            route_permutations = self._generate_route_permutations(
                start_city, end_city, intermediate_cities, max_routes_to_evaluate
            )
            
            # Step 2: Fetch flight data for all unique segments
            logger.info(f"Fetching flight data for {len(route_permutations)} routes")
            all_segments = self._get_all_unique_segments(route_permutations)
            segment_data = await self._fetch_all_segment_data(
                all_segments, user_points, travel_date, cabin_class
            )
            
            # Step 3: Build and evaluate route options
            logger.info("Evaluating route options")
            route_options = self._build_route_options(
                route_permutations, segment_data, total_points_budget
            )
            result.route_options = route_options
            
            # Step 4: Compare routes and select optimal
            logger.info("Comparing routes")
            recommended, comparison, reasons = self._compare_and_select(
                route_options, total_points_budget
            )
            
            result.comparison_matrix = comparison
            result.recommended_route = recommended
            result.recommendation_reasons = reasons
            
            if recommended:
                # Step 5: Generate transfer instructions
                logger.info("Generating transfer instructions")
                transfer_steps = self._generate_transfer_steps(
                    recommended, user_points
                )
                result.transfer_steps = transfer_steps
                
                # Set summary metrics
                result.total_points_used = recommended.total_points
                result.remaining_points = total_points_budget - recommended.total_points
                result.total_cash_saved = recommended.total_cash_saved
                result.average_cpp = recommended.average_cpp
                result.total_surcharges = recommended.total_surcharges
                
                # Generate strategy summary
                result.strategy_summary = self._generate_strategy_summary(
                    recommended, transfer_steps, user_points, total_points_budget
                )
                
                result.success = True
            
            result.computed_at = datetime.now()
            result.computation_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
        except Exception as e:
            logger.error(f"Route optimization failed: {e}", exc_info=True)
            result.success = False
        
        return result
    
    # =========================================================================
    # ROUTE GENERATION
    # =========================================================================
    
    def _generate_route_permutations(
        self,
        start: str,
        end: str,
        intermediates: List[str],
        max_routes: int,
    ) -> List[List[str]]:
        """
        Generate all permutations of intermediate cities.
        
        Returns list of routes, each as [start, intermediate1, intermediate2, ..., end]
        """
        if not intermediates:
            return [[start, end]]
        
        routes = []
        for perm in permutations(intermediates):
            route = [start] + list(perm) + [end]
            routes.append(route)
            
            if len(routes) >= max_routes:
                logger.warning(f"Truncating routes to {max_routes} permutations")
                break
        
        return routes
    
    def _get_all_unique_segments(
        self,
        routes: List[List[str]],
    ) -> List[Tuple[str, str]]:
        """Get all unique origin-destination pairs from routes."""
        segments = set()
        for route in routes:
            for i in range(len(route) - 1):
                segments.add((route[i], route[i + 1]))
        return list(segments)
    
    # =========================================================================
    # DATA FETCHING
    # =========================================================================
    
    async def _fetch_all_segment_data(
        self,
        segments: List[Tuple[str, str]],
        user_points: Dict[str, int],
        travel_date: str,
        cabin_class: str,
    ) -> Dict[Tuple[str, str], SegmentData]:
        """
        Fetch flight data for all segments in parallel.
        
        Returns dict mapping (origin, dest) -> SegmentData
        """
        # Create tasks for parallel fetching
        tasks = []
        for origin, dest in segments:
            tasks.append(self._fetch_segment_data(
                origin, dest, user_points, travel_date, cabin_class
            ))
        
        # Execute in parallel
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Build result dict
        segment_data = {}
        for (origin, dest), result in zip(segments, results):
            if isinstance(result, Exception):
                logger.warning(f"Failed to fetch {origin}→{dest}: {result}")
                # Create empty segment
                segment_data[(origin, dest)] = SegmentData(
                    segment_id=f"{origin}_{dest}",
                    origin=origin,
                    destination=dest,
                )
            else:
                segment_data[(origin, dest)] = result
        
        return segment_data
    
    async def _fetch_segment_data(
        self,
        origin: str,
        destination: str,
        user_points: Dict[str, int],
        travel_date: str,
        cabin_class: str,
    ) -> SegmentData:
        """
        Fetch flight data for a single segment.
        
        Integrates with existing flight search handlers.
        """
        from .flights import get_flights_award_first_with_points_async
        
        segment = SegmentData(
            segment_id=f"{origin}_{destination}",
            origin=origin,
            destination=destination,
        )
        
        try:
            filters = {
                "outbound_date": travel_date,
                "travel_class": cabin_class,
                "pax": 1,
            }
            
            edges = await get_flights_award_first_with_points_async(
                origin, destination, user_points, filters
            )
            
            if edges:
                # Find best award and cash options
                best_award = None
                best_award_surcharge = float('inf')
                best_cash = None
                best_cash_price = float('inf')
                
                for key, data in edges.items():
                    points_cost = data.get("points_cost")
                    surcharge = data.get("points_surcharge")
                    cash_price = data.get("cash_cost")
                    
                    # Track best award option (lowest surcharge)
                    if points_cost and surcharge is not None:
                        if surcharge < best_award_surcharge:
                            best_award = data
                            best_award_surcharge = surcharge
                    
                    # Track best cash option (lowest price)
                    if cash_price is not None:
                        if cash_price < best_cash_price:
                            best_cash = data
                            best_cash_price = cash_price
                
                # Populate segment data
                # SANITIZE: Ensure no negative values leak through for duration/stops/prices
                # -1 is commonly used as a sentinel value meaning "unknown"
                def _sanitize_nonneg(val, default=0):
                    """Return val if non-negative, else default. Prevents -1 sentinel leak."""
                    if val is None:
                        return default
                    try:
                        v = int(val) if isinstance(val, (int, float)) else int(val)
                        return v if v >= 0 else default
                    except (ValueError, TypeError):
                        return default
                
                def _sanitize_nonneg_float(val, default=0.0):
                    """Return val if non-negative, else default."""
                    if val is None:
                        return default
                    try:
                        v = float(val)
                        return v if v >= 0 else default
                    except (ValueError, TypeError):
                        return default
                
                if best_cash:
                    segment.cash_price = _sanitize_nonneg_float(best_cash_price, 0.0)
                    segment.airline = best_cash.get("operating_airline")
                    segment.duration_minutes = _sanitize_nonneg(best_cash.get("time_cost"), 0)
                    segment.departure_time = best_cash.get("departure_time")
                    segment.arrival_time = best_cash.get("arrival_time")
                    segment.data_source = best_cash.get("data_source", "serp")
                
                if best_award:
                    segment.award_available = True
                    segment.points_cost = _sanitize_nonneg(best_award.get("points_cost"), 0)
                    segment.points_program = best_award.get("points_program")
                    segment.points_program_name = PROGRAM_METADATA.get(
                        best_award.get("points_program", "").upper(), {}
                    ).get("name", best_award.get("points_program"))
                    segment.surcharge = _sanitize_nonneg_float(best_award.get("points_surcharge"), 0.0)
                    segment.booking_link = best_award.get("booking_link")
                    
                    # Use award flight details if cash not available
                    if not best_cash:
                        segment.airline = best_award.get("operating_airline")
                        segment.duration_minutes = _sanitize_nonneg(best_award.get("time_cost"), 0)
                        segment.departure_time = best_award.get("departure_time")
                        segment.arrival_time = best_award.get("arrival_time")
                        segment.data_source = best_award.get("data_source", "awardtool")
                
                # Calculate value
                segment.calculate_value()
        
        except Exception as e:
            logger.warning(f"Error fetching {origin}→{destination}: {e}")
        
        return segment
    
    # =========================================================================
    # ROUTE BUILDING
    # =========================================================================
    
    def _build_route_options(
        self,
        routes: List[List[str]],
        segment_data: Dict[Tuple[str, str], SegmentData],
        points_budget: int,
    ) -> List[RouteOption]:
        """Build RouteOption objects from routes and segment data."""
        options = []
        
        for idx, route in enumerate(routes):
            route_letter = chr(65 + idx)  # A, B, C, ...
            
            option = RouteOption(
                route_id=f"route_{route_letter.lower()}",
                route_name=f"Route {route_letter}",
                path=route,
                path_display=" → ".join(route),
            )
            
            # Add segments
            for i in range(len(route) - 1):
                origin, dest = route[i], route[i + 1]
                segment = segment_data.get((origin, dest))
                if segment:
                    option.segments.append(segment)
            
            # Calculate totals
            option.calculate_totals()
            option.check_feasibility(points_budget)
            
            options.append(option)
        
        return options
    
    # =========================================================================
    # COMPARISON AND SELECTION
    # =========================================================================
    
    def _compare_and_select(
        self,
        options: List[RouteOption],
        points_budget: int,
    ) -> Tuple[Optional[RouteOption], List[ComparisonMetric], List[str]]:
        """
        Compare route options and select optimal.
        
        Uses weighted scoring:
        Score = W1 × cash_saved - W2 × surcharges - W3 × travel_time
        
        Returns (recommended_route, comparison_matrix, reasons)
        """
        if not options:
            return None, [], ["No route options available"]
        
        if len(options) == 1:
            return options[0], [], ["Only one route option available"]
        
        # For simplicity, compare first two routes
        # (In production, would compare all and pick best)
        route_a = options[0]
        route_b = options[1] if len(options) > 1 else None
        
        comparison = []
        reasons = []
        
        if route_b:
            # Build comparison matrix
            comparison = self._build_comparison_matrix(route_a, route_b)
        
        # Calculate weighted scores for feasible routes
        feasible_routes = [r for r in options if r.feasible]
        
        if not feasible_routes:
            # All routes exceed budget - pick least over budget
            options.sort(key=lambda r: r.points_over_budget)
            recommended = options[0]
            reasons.append(f"All routes exceed points budget by at least {recommended.points_over_budget:,} points")
            return recommended, comparison, reasons
        
        # Score feasible routes
        scored_routes = []
        for route in feasible_routes:
            score = (
                self.W1_POINTS_SAVINGS * route.total_cash_saved -
                self.W2_CASH_MINIMIZE * route.total_surcharges -
                self.W3_TRAVEL_TIME * route.total_duration_minutes
            )
            scored_routes.append((route, score))
        
        # Sort by score (highest first)
        scored_routes.sort(key=lambda x: -x[1])
        recommended = scored_routes[0][0]
        
        # Generate reasons
        if recommended.feasible:
            reasons.append(f"User has {points_budget:,} points - {recommended.route_name} uses {recommended.total_points:,} ✓")
        
        if len(feasible_routes) > 1 and recommended == route_a:
            if route_a.average_cpp > route_b.average_cpp:
                reasons.append(f"{recommended.route_name} has better average CPP ({route_a.average_cpp:.2f} vs {route_b.average_cpp:.2f})")
            if route_a.total_duration_minutes < route_b.total_duration_minutes:
                hours_diff = (route_b.total_duration_minutes - route_a.total_duration_minutes) / 60
                reasons.append(f"{recommended.route_name} has shorter travel time ({hours_diff:.0f}h less)")
            if route_a.total_surcharges < route_b.total_surcharges:
                surcharge_diff = route_b.total_surcharges - route_a.total_surcharges
                reasons.append(f"{recommended.route_name} has lower surcharges (${surcharge_diff:.0f} less)")
        
        return recommended, comparison, reasons
    
    def _build_comparison_matrix(
        self,
        route_a: RouteOption,
        route_b: RouteOption,
    ) -> List[ComparisonMetric]:
        """Build comparison matrix between two routes."""
        metrics = []
        
        # Total Points
        winner = "route_a" if route_a.total_points < route_b.total_points else "route_b"
        if route_a.total_points == route_b.total_points:
            winner = "tie"
        metrics.append(ComparisonMetric(
            metric_name="Total Points",
            route_a_value=f"{route_a.total_points:,}",
            route_b_value=f"{route_b.total_points:,}",
            winner=winner,
            winner_display=route_a.route_name if winner == "route_a" else (route_b.route_name if winner == "route_b" else "Tie"),
        ))
        
        # Cash Value (total saved)
        winner = "route_a" if route_a.total_cash_saved > route_b.total_cash_saved else "route_b"
        if route_a.total_cash_saved == route_b.total_cash_saved:
            winner = "tie"
        metrics.append(ComparisonMetric(
            metric_name="Cash Value",
            route_a_value=f"${route_a.total_cash_saved:,.0f}",
            route_b_value=f"${route_b.total_cash_saved:,.0f}",
            winner=winner,
            winner_display=route_a.route_name if winner == "route_a" else (route_b.route_name if winner == "route_b" else "Tie"),
        ))
        
        # Average CPP
        winner = "route_a" if route_a.average_cpp > route_b.average_cpp else "route_b"
        if abs(route_a.average_cpp - route_b.average_cpp) < 0.01:
            winner = "tie"
        metrics.append(ComparisonMetric(
            metric_name="Average CPP",
            route_a_value=f"{route_a.average_cpp:.2f}",
            route_b_value=f"{route_b.average_cpp:.2f}",
            winner=winner,
            winner_display=route_a.route_name if winner == "route_a" else (route_b.route_name if winner == "route_b" else "Tie"),
        ))
        
        # Travel Time
        winner = "route_a" if route_a.total_duration_minutes < route_b.total_duration_minutes else "route_b"
        if route_a.total_duration_minutes == route_b.total_duration_minutes:
            winner = "tie"
        metrics.append(ComparisonMetric(
            metric_name="Travel Time",
            route_a_value=f"{route_a.total_duration_minutes // 60}h",
            route_b_value=f"{route_b.total_duration_minutes // 60}h",
            winner=winner,
            winner_display=route_a.route_name if winner == "route_a" else (route_b.route_name if winner == "route_b" else "Tie"),
        ))
        
        # Surcharges
        winner = "route_a" if route_a.total_surcharges < route_b.total_surcharges else "route_b"
        if route_a.total_surcharges == route_b.total_surcharges:
            winner = "tie"
        metrics.append(ComparisonMetric(
            metric_name="Surcharges",
            route_a_value=f"${route_a.total_surcharges:,.0f}",
            route_b_value=f"${route_b.total_surcharges:,.0f}",
            winner=winner,
            winner_display=route_a.route_name if winner == "route_a" else (route_b.route_name if winner == "route_b" else "Tie"),
        ))
        
        # Feasibility
        route_a_feasible = "✓" if route_a.feasible else f"✗ ({route_a.points_over_budget:,})"
        route_b_feasible = "✓" if route_b.feasible else f"✗ ({route_b.points_over_budget:,})"
        if route_a.feasible and not route_b.feasible:
            winner = "route_a"
        elif route_b.feasible and not route_a.feasible:
            winner = "route_b"
        else:
            winner = "tie"
        metrics.append(ComparisonMetric(
            metric_name="Feasibility",
            route_a_value=route_a_feasible,
            route_b_value=route_b_feasible,
            winner=winner,
            winner_display=route_a.route_name if winner == "route_a" else (route_b.route_name if winner == "route_b" else "Both feasible"),
        ))
        
        return metrics
    
    # =========================================================================
    # TRANSFER INSTRUCTIONS
    # =========================================================================
    
    def _generate_transfer_steps(
        self,
        route: RouteOption,
        user_points: Dict[str, int],
    ) -> List[TransferStep]:
        """Generate detailed transfer instructions for a route."""
        steps = []
        step_num = 1
        
        for segment in route.segments:
            if not segment.award_available or segment.points_cost <= 0:
                continue
            
            # Find best transfer source
            target_program = segment.points_program or ""
            source = get_best_transfer_source(
                user_points, target_program, segment.points_cost
            )
            
            if source:
                src_program, src_points, ratio = source
            else:
                # Default to first bank with sufficient points
                src_program = None
                src_points = segment.points_cost
                ratio = 1.0
                for bank, balance in user_points.items():
                    if bank.lower() in EXTENDED_TRANSFER_GRAPH:
                        if target_program.upper() in EXTENDED_TRANSFER_GRAPH[bank.lower()]:
                            if balance >= segment.points_cost:
                                src_program = bank.lower()
                                src_points = segment.points_cost
                                ratio = EXTENDED_TRANSFER_GRAPH[bank.lower()][target_program.upper()].get("ratio", 1.0)
                                break
                
                if not src_program:
                    continue
            
            # Build transfer step
            bank_meta = BANK_METADATA.get(src_program.lower(), {})
            prog_meta = PROGRAM_METADATA.get(target_program.upper(), {})
            
            ratio_display = f"1:{int(ratio)}" if ratio >= 1 else f"{int(1/ratio)}:1"
            resulting_points = int(src_points * ratio)
            
            # Build instructions
            instructions = [
                f"Visit {bank_meta.get('name', src_program)} portal",
                f"Navigate to 'Transfer Points' section",
                f"Select {prog_meta.get('name', target_program)}",
                f"Enter {prog_meta.get('name', target_program)} membership number",
                f"Transfer {src_points:,} points ({ratio_display} ratio, {bank_meta.get('default_transfer_time', 'instant')})",
                f"Visit {prog_meta.get('name', target_program)} booking portal",
                f"Search for {segment.origin} → {segment.destination} award flights",
                f"Book using {resulting_points:,} miles + ${segment.surcharge:.2f} in taxes",
            ]
            
            step = TransferStep(
                step_number=step_num,
                source_program=src_program,
                source_program_name=bank_meta.get("name", src_program),
                target_program=target_program,
                target_program_name=prog_meta.get("name", target_program),
                points_to_transfer=src_points,
                resulting_points=resulting_points,
                transfer_ratio=ratio_display,
                transfer_time=bank_meta.get("default_transfer_time", "instant"),
                portal_url=bank_meta.get("portal_url", ""),
                booking_url=prog_meta.get("booking_url", ""),
                for_segment=f"{segment.origin} → {segment.destination}",
                cpp_value=segment.cpp,
                cash_saved=segment.cash_saved,
                instructions=instructions,
            )
            
            steps.append(step)
            step_num += 1
        
        return steps
    
    def _generate_strategy_summary(
        self,
        route: RouteOption,
        transfer_steps: List[TransferStep],
        user_points: Dict[str, int],
        points_budget: int,
    ) -> str:
        """Generate a human-readable strategy summary."""
        # Identify primary points source
        sources = {}
        for step in transfer_steps:
            src = step.source_program_name
            sources[src] = sources.get(src, 0) + step.points_to_transfer
        
        primary_source = max(sources.items(), key=lambda x: x[1])[0] if sources else "your points"
        num_partners = len(set(s.target_program for s in transfer_steps))
        
        summary = (
            f"For your multi-city route ({route.path_display}), "
            f"using {primary_source} as your primary points source, "
            f"leveraging {num_partners} airline partner{'s' if num_partners != 1 else ''} for optimal routing, "
            f"saving ${route.total_cash_saved:,.2f} ({route.average_cpp:.2f} cpp), "
            f"based on live award availability."
            f"\n\n"
            f"Total Points Used:    {route.total_points:,} / {points_budget:,} available\n"
            f"Total Cash Saved:     ${route.total_cash_saved:,.2f}\n"
            f"Average Value:        {route.average_cpp:.2f} cents per point\n"
            f"Total Surcharges:     ${route.total_surcharges:,.2f}\n"
            f"Remaining Points:     {points_budget - route.total_points:,}"
        )
        
        return summary


# =============================================================================
# API HELPERS
# =============================================================================

async def optimize_multi_city_route(
    start_city: str,
    end_city: str,
    intermediate_cities: List[str],
    user_points: Dict[str, int],
    travel_date: str,
    cabin_class: str = "economy",
) -> Dict[str, Any]:
    """
    API helper to optimize a multi-city route.
    
    Returns a dictionary suitable for JSON response.
    """
    optimizer = DynamicRouteOptimizer()
    result = await optimizer.optimize(
        start_city=start_city,
        end_city=end_city,
        intermediate_cities=intermediate_cities,
        user_points=user_points,
        travel_date=travel_date,
        cabin_class=cabin_class,
    )
    return result.to_dict()
