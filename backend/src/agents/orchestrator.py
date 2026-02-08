"""
Orchestrator Agent - Coordinates the entire optimization pipeline.

This is the main entry point that:
1. Parses trip requirements
2. Coordinates Flight Agents
3. Runs ILP optimization (V3 solver)
4. Ranks results by OOP
5. Generates cost breakdowns

NOTE: Updated to use V3 optimization solver for improved:
- Three optimization modes (OOP, CPP, Balanced)
- Integer-safe transfers
- Single-ticket enforcement for connections
"""

import asyncio
import logging
import uuid
from typing import Optional, Literal
from datetime import datetime

from .base import BaseAgent, AgentConfig
from .models import (
    OptimizeSoloRequest, OptimizeSoloResponse, OptimizeGroupRequest, OptimizeGroupResponse,
    RankedItinerary, OOPMetrics, GroupOOPMetrics,
    FlightSearchRequest,
    FlightSegment,
    CashPayment, PointsPayment, TransferInstruction,
    GroupMemberCost, Settlement,
    NO_BUDGET_LIMIT,
)
from .flight_agent import FlightAgent
from .cost_breakdown_agent import CostBreakdownAgent
from .config import (
    DEFAULT_OPTIMIZATION_MODE, OOP_CONFIG, 
    get_transfer_path, AIRLINE_PROGRAMS
)
from .group_allocator import GroupBookingAllocator, SegmentOption

# Import pricing sanitizer - CRITICAL for preventing -1 sentinel leakage
from ..utils.pricing import sanitize_cash_price, sanitize_surcharge, sanitize_points_cost
from .group_models import (
    MemberBookingCapability,
    BookingAllocationStrategy,
    GroupBookingPlan,
    SettlementSplitMethod,
)

# =============================================================================
# MULTI-AIRPORT CITY SUPPORT
# =============================================================================

# Known metro areas with multiple airports
# Used to expand searches to all airports in a city.
# IMPORTANT: Only city names/aliases are keys here (NOT individual airport codes).
# This ensures that selecting a specific airport (e.g. "LGA") returns only that
# airport, while selecting a city (e.g. "New York") expands to all metro airports.
METRO_AIRPORTS = {
    # US Cities
    "seattle": ["SEA"],
    "new york": ["JFK", "EWR", "LGA"],
    "nyc": ["JFK", "EWR", "LGA"],
    "los angeles": ["LAX", "BUR", "SNA", "ONT"],
    "la": ["LAX", "BUR", "SNA", "ONT"],
    "san francisco": ["SFO", "OAK", "SJC"],
    "sf": ["SFO", "OAK", "SJC"],
    "chicago": ["ORD", "MDW"],
    "washington": ["IAD", "DCA", "BWI"],
    "washington dc": ["IAD", "DCA", "BWI"],
    "dc": ["IAD", "DCA", "BWI"],
    "miami": ["MIA", "FLL"],
    "dallas": ["DFW", "DAL"],
    "houston": ["IAH", "HOU"],
    "boston": ["BOS"],
    # European Cities
    "london": ["LHR", "LGW", "STN", "LTN"],
    "paris": ["CDG", "ORY"],
    "milan": ["MXP", "LIN", "BGY"],
    "rome": ["FCO", "CIA"],
    "frankfurt": ["FRA", "HHN"],
    "amsterdam": ["AMS"],
    # Asian Cities
    "tokyo": ["NRT", "HND"],
    "seoul": ["ICN", "GMP"],
    "shanghai": ["PVG", "SHA"],
    "beijing": ["PEK", "PKX"],
    "hong kong": ["HKG"],
    "singapore": ["SIN"],
    # Middle East
    "dubai": ["DXB", "DWC"],
}

# Reverse lookup: airport code -> all airports in the same metro area.
# Built from METRO_AIRPORTS for internal use (e.g. inter-airport transfer detection).
# This is NOT used for expanding user input — only for checking metro membership.
_AIRPORT_TO_METRO: dict[str, list[str]] = {}
for _city_key, _airport_list in METRO_AIRPORTS.items():
    for _code in _airport_list:
        if _code not in _AIRPORT_TO_METRO:
            _AIRPORT_TO_METRO[_code] = _airport_list

# Ground transfer costs between airports in the same metro area (in USD)
# Format: (airport1, airport2) -> (cost_usd, time_minutes)
INTER_AIRPORT_TRANSFERS = {
    # Paris
    ("CDG", "ORY"): (50, 90),
    ("ORY", "CDG"): (50, 90),
    # London
    ("LHR", "LGW"): (60, 120),
    ("LGW", "LHR"): (60, 120),
    ("LHR", "STN"): (70, 150),
    ("STN", "LHR"): (70, 150),
    ("LGW", "STN"): (80, 180),
    ("STN", "LGW"): (80, 180),
    # NYC
    ("JFK", "EWR"): (80, 90),
    ("EWR", "JFK"): (80, 90),
    ("JFK", "LGA"): (50, 60),
    ("LGA", "JFK"): (50, 60),
    ("EWR", "LGA"): (60, 75),
    ("LGA", "EWR"): (60, 75),
    # Tokyo
    ("NRT", "HND"): (40, 120),
    ("HND", "NRT"): (40, 120),
    # Default for unknown pairs in same metro
}

DEFAULT_INTER_AIRPORT_TRANSFER = (40, 90)  # $40, 90 minutes


def _get_all_airports_for_location(location: str) -> list[str]:
    """
    Get all airports for a location (city name or airport code).
    
    City names expand to all metro airports; specific airport codes return only
    that airport (unidirectional expansion).
    
    Examples:
        "Paris" -> ["CDG", "ORY"]          (city -> all metro airports)
        "CDG" -> ["CDG"]                   (specific airport -> only that airport)
        "New York" -> ["JFK", "EWR", "LGA"]
        "LGA" -> ["LGA"]                   (specific airport -> only that airport)
        "Paris (CDG,ORY,BVA)" -> ["CDG", "ORY", "BVA"]
        "SEA" -> ["SEA"]
        "SEA,BFI,PDX" -> ["SEA", "BFI", "PDX"]  # Comma-separated multi-airport
    
    Returns list of airport codes.
    """
    import re
    
    if not location:
        return []
    
    location = location.strip()
    
    # Check if it's a comma-separated list of IATA codes (e.g., "SEA,BFI,PDX")
    # This format is used when the user selects multiple airports from the frontend
    if "," in location and "(" not in location:
        parts = [p.strip().upper() for p in location.split(",")]
        # All parts must be valid 3-letter IATA codes
        if all(re.match(r'^[A-Z]{3}$', p) for p in parts):
            return parts
    
    # Check if it's in format "City (CODE1,CODE2,CODE3)"
    if "(" in location and ")" in location:
        codes_part = location.split("(")[1].split(")")[0]
        codes = [c.strip().upper() for c in codes_part.split(",") if c.strip()]
        # Return explicitly listed codes
        return codes if codes else []
    
    # If it's a 3-letter airport code, return ONLY that airport (no metro expansion).
    # This ensures "LGA" -> ["LGA"], not ["JFK", "EWR", "LGA"].
    if len(location) == 3 and location.isalpha():
        return [location.upper()]
    
    # Check METRO_AIRPORTS mapping (city names only — no airport code keys)
    location_lower = location.lower()
    if location_lower in METRO_AIRPORTS:
        return METRO_AIRPORTS[location_lower]
    
    # Try partial match on city names
    for metro_name, airports in METRO_AIRPORTS.items():
        if metro_name in location_lower or location_lower in metro_name:
            return airports
    
    # Fallback: treat as single airport code
    return [location.upper()[:3]] if location else []


def _get_primary_airport(location: str) -> str:
    """Get the primary (first) airport for a location."""
    airports = _get_all_airports_for_location(location)
    return airports[0] if airports else location.upper()[:3]


def _get_inter_airport_transfer(airport1: str, airport2: str) -> tuple[float, int]:
    """
    Get transfer cost and time between two airports.
    
    Returns (cost_usd, time_minutes) or (0, 0) if same airport.
    """
    if airport1 == airport2:
        return (0, 0)
    
    key = (airport1.upper(), airport2.upper())
    if key in INTER_AIRPORT_TRANSFERS:
        return INTER_AIRPORT_TRANSFERS[key]
    
    # Check if they're in the same metro area using the reverse lookup
    metro1 = _AIRPORT_TO_METRO.get(airport1.upper())
    metro2 = _AIRPORT_TO_METRO.get(airport2.upper())
    
    # If both airports belong to the same metro group, use default transfer cost
    if metro1 is not None and metro1 is metro2:
        return DEFAULT_INTER_AIRPORT_TRANSFER
    
    # Different metros - no direct transfer possible
    return (0, 0)


# V3 Optimization - lazy import to avoid slow startup
def _get_v3_optimizer():
    from ..optimization.adapter_v3 import run_v3_optimization
    return run_v3_optimization

logger = logging.getLogger(__name__)


class OrchestratorAgent(BaseAgent):
    """
    Main orchestrator that coordinates all agents and optimization.
    """
    
    def __init__(self, config: AgentConfig = None):
        super().__init__(config)
        self.flight_agent = FlightAgent()
        self.cost_agent = CostBreakdownAgent()
        self.group_allocator = GroupBookingAllocator()
    
    @property
    def name(self) -> str:
        return "OrchestratorAgent"
    
    @property
    def system_prompt(self) -> str:
        return "You are a travel optimization coordinator."
    
    async def execute(self, request) -> list[RankedItinerary]:
        """Generic execute - delegates to specific methods."""
        if isinstance(request, OptimizeGroupRequest):
            return await self.optimize_group(request)
        return await self.optimize_solo(request)
    
    async def optimize_solo(
        self,
        request: OptimizeSoloRequest,
    ) -> OptimizeSoloResponse:
        """
        Optimize a solo trip (flights only).
        
        1. Fetch trip details from database
        2. Search flights via agents
        3. Run OOP optimization
        4. Rank and return results
        """
        print(f"[Orchestrator] optimize_solo called for trip {request.trip_id}")
        print(f"[Orchestrator] Points: {request.points}, Budget: {request.budget}")
        logger.info(f"[Orchestrator] Starting solo optimization for trip {request.trip_id}")
        
        # Get trip details
        trip_data = await self._get_trip_data(request.trip_id)
        print(f"[Orchestrator] Trip data fetched: {bool(trip_data)}")
        if trip_data:
            print(f"[Orchestrator] Trip destinations: {trip_data.get('destinations', [])}")
        
        if not trip_data:
            return OptimizeSoloResponse(
                trip_id=request.trip_id,
                itineraries=[],
                best_option={"outOfPocket": 0, "savingsPercentage": 0, "pointsUsed": 0},
                warnings=["Trip not found"],
            )
        
        # Build segments to search (includes all route permutations for multi-city)
        segments = self._build_trip_segments(trip_data)
        route_variants = trip_data.get("route_variants", [])
        num_variants = len(route_variants) if route_variants else 1
        
        print(f"[Orchestrator] Built {len(segments) if segments else 0} segments across {num_variants} route variants")
        if segments:
            for i, seg in enumerate(segments):
                print(f"[Orchestrator] Segment {i+1}: {seg}")
        
        if not segments:
            return OptimizeSoloResponse(
                trip_id=request.trip_id,
                itineraries=[],
                best_option={"outOfPocket": 0, "savingsPercentage": 0, "pointsUsed": 0},
                warnings=["No valid route found"],
            )
        
        # Search flights for all unique O-D pairs
        print(f"[Orchestrator] Starting search for {len(segments)} unique O-D pairs...")
        search_results = await self._search_all_segments(
            segments=segments,
            user_points=request.points,
            cabin_classes=request.cabin_classes or ["Economy", "Business"],
            include_budget_airlines=request.include_budget_airlines,
            max_stops=request.max_stops,
            departure_hour_range=request.departure_hour_range,
            arrival_hour_range=request.arrival_hour_range,
        )
        print(f"[Orchestrator] Search completed, got {len(search_results) if search_results else 0} results")
        
        # Run optimization with selected mode
        optimization_mode = getattr(request, 'optimization_mode', 'oop') or 'oop'
        logger.info(f"[Orchestrator] Running optimization with mode={optimization_mode}")
        
        # ═══════════════════════════════════════════════════════════════════════
        # MULTI-ROUTE OPTIMIZATION
        # ═══════════════════════════════════════════════════════════════════════
        # For multi-city trips, run optimization for EACH route variant and
        # compare results to find the optimal city ordering.
        
        all_optimized = []
        all_warnings = []
        
        if num_variants > 1 and route_variants:
            logger.info(f"[Orchestrator] Evaluating {num_variants} route permutations...")
            
            for variant_idx, route in enumerate(route_variants):
                route_str = " → ".join(route)
                logger.info(f"[Orchestrator] Route variant {variant_idx + 1}/{num_variants}: {route_str}")
                
                # Build segments for this specific route variant
                variant_segments = self._build_segments_for_route(route, trip_data)
                
                # Run optimization for this route variant
                try:
                    variant_results, variant_warnings = await self._run_oop_optimization(
                        segments=variant_segments,
                        search_results=search_results,
                        user_points=request.points,
                        budget=request.budget,
                        trip_data=trip_data,
                        mode=optimization_mode,
                        risk_mode=getattr(request, 'risk_mode', 'balanced') or 'balanced',
                        include_basic_economy=getattr(request, 'include_basic_economy', False),
                        flexibility_priority=getattr(request, 'flexibility_priority', 'medium') or 'medium',
                        allowed_currencies=getattr(request, 'allowed_currencies', None),
                        max_points_by_currency=getattr(request, 'max_points_by_currency', None),
                        max_cash_budget=getattr(request, 'max_cash_budget', None),
                    )
                    
                    # Tag results with route variant info
                    for itin in variant_results:
                        itin.route = route_str
                        itin.name = f"Route: {route_str}"
                    
                    if variant_results:
                        best_oop = min(r.oop_metrics.total_out_of_pocket for r in variant_results)
                        logger.info(f"[Orchestrator] Route {variant_idx + 1} best OOP: ${best_oop:.2f}")
                    
                    all_optimized.extend(variant_results)
                    all_warnings.extend(variant_warnings)
                except Exception as e:
                    logger.warning(f"[Orchestrator] Route variant {variant_idx + 1} failed: {e}")
            
            optimized = all_optimized
        else:
            # Single route - run optimization directly
            optimized, all_warnings = await self._run_oop_optimization(
                segments=segments,
                search_results=search_results,
                user_points=request.points,
                budget=request.budget,
                trip_data=trip_data,
                mode=optimization_mode,
                risk_mode=getattr(request, 'risk_mode', 'balanced') or 'balanced',
                include_basic_economy=getattr(request, 'include_basic_economy', False),
                flexibility_priority=getattr(request, 'flexibility_priority', 'medium') or 'medium',
                allowed_currencies=getattr(request, 'allowed_currencies', None),
                max_points_by_currency=getattr(request, 'max_points_by_currency', None),
                max_cash_budget=getattr(request, 'max_cash_budget', None),
            )
        
        # Rank by OOP (lowest first)
        optimized.sort(key=lambda x: x.oop_metrics.total_out_of_pocket)
        
        # Assign ranks
        for i, itinerary in enumerate(optimized):
            itinerary.rank = i + 1
        
        # Get top 5
        top_results = optimized[:5]
        
        # Cache individual itineraries for breakdown endpoint
        from ..utils.cache_layer import set_json
        for itinerary in top_results:
            try:
                # Cache the itinerary data
                itinerary_data = {
                    "id": itinerary.id,
                    "rank": itinerary.rank,
                    "name": itinerary.name,
                    "route": itinerary.route,
                    "segments": [seg.model_dump() for seg in itinerary.segments],
                    "oopMetrics": {
                        "totalCashPrice": itinerary.oop_metrics.total_cash_price,
                        "totalOutOfPocket": itinerary.oop_metrics.total_out_of_pocket,
                        "totalPointsUsed": itinerary.oop_metrics.total_points_used,
                        "cashSaved": itinerary.oop_metrics.cash_saved,
                        "savingsPercentage": itinerary.oop_metrics.savings_percentage,
                        "averageCPP": itinerary.oop_metrics.average_cpp,
                        "pointsBreakdown": itinerary.oop_metrics.points_breakdown,
                    },
                    "transfers": [t.model_dump() for t in itinerary.transfers],
                    "withinBudget": itinerary.within_budget,
                    "withinPoints": itinerary.within_points,
                    "summary": itinerary.summary,
                }
                set_json(f"itinerary:{itinerary.id}", itinerary_data, 30 * 60)  # 30 min cache
            except Exception as e:
                logger.warning(f"Failed to cache itinerary {itinerary.id}: {e}")
        
        best = top_results[0] if top_results else None
        
        # Deduplicate warnings
        unique_warnings = list(dict.fromkeys(all_warnings))
        
        # Build structured warnings + flat list (backward compat)
        from ..schemas.optimize import WarningItem, StructuredWarnings
        structured = StructuredWarnings()
        suggested_budget = None
        
        if best and not best.within_budget and request.budget:
            budget_exceeded_by = best.oop_metrics.total_out_of_pocket - request.budget
            suggested_budget = int(best.oop_metrics.total_out_of_pocket * 1.1)
            over_budget_msg = (
                f"No itinerary found within your ${request.budget:.0f} budget. "
                f"The minimum cost for this trip is ${best.oop_metrics.total_out_of_pocket:.0f}. "
                f"We recommend setting your budget to at least ${suggested_budget:,}"
            )
            structured.budget = WarningItem(
                category="budget",
                severity="error",
                headline="Budget Too Low",
                message=over_budget_msg,
                details={
                    "user_budget": request.budget,
                    "min_cost": best.oop_metrics.total_out_of_pocket,
                    "suggested_budget": suggested_budget,
                },
            )
            # Flat list backward compat (no leading emoji — frontend controls styling)
            if over_budget_msg not in unique_warnings:
                unique_warnings.insert(0, over_budget_msg)
        
        # Classify existing warnings into structured categories
        for w in unique_warnings:
            if "points could not be used" in w.lower() or "cannot transfer" in w.lower():
                if not structured.points:
                    structured.points = WarningItem(
                        category="points",
                        severity="warning",
                        headline="Points Unavailable",
                        message=w.lstrip("⚠️ "),
                    )
            elif "estimated" in w.lower() or "degraded" in w.lower() or "fallback" in w.lower():
                if not structured.degradation:
                    structured.degradation = WarningItem(
                        category="degradation",
                        severity="warning",
                        headline="Limited Flight Data",
                        message=w.lstrip("⚠️ "),
                    )
        
        return OptimizeSoloResponse(
            trip_id=request.trip_id,
            itineraries=top_results,
            best_option={
                "outOfPocket": best.oop_metrics.total_out_of_pocket if best else 0,
                "savingsPercentage": best.oop_metrics.savings_percentage if best else 0,
                "pointsUsed": best.oop_metrics.total_points_used if best else 0,
                "withinBudget": best.within_budget if best else True,
                "suggestedBudget": suggested_budget,
                "userBudget": request.budget,
            },
            warnings=unique_warnings,
            structured_warnings=structured,
        )
    
    async def optimize_group(
        self,
        request: OptimizeGroupRequest,
        members_data: list[dict] = None,
    ) -> OptimizeGroupResponse:
        """
        Optimize a group trip with per-member customized routes.
        
        Each member gets their own route based on their departure/arrival airports:
        - Member A from SEA: SEA → destination → SEA
        - Member B from JFK: JFK → destination → JFK
        
        Args:
            request: Group optimization request with member points
            members_data: Optional list of member dicts with airport info
                         If not provided, will be fetched from trip service
        
        Returns:
            OptimizeGroupResponse with per-member itineraries
        """
        logger.info(f"[Orchestrator] Starting per-member group optimization for trip {request.trip_id}")
        
        # 1. Get trip data
        trip_data = await self._get_trip_data(request.trip_id)
        if not trip_data:
            return OptimizeGroupResponse(
                trip_id=request.trip_id,
                itineraries=[],
                group_metrics=None,
                best_option={"totalOutOfPocket": 0, "perPersonAverage": 0, "totalSavings": 0},
                warnings=["Trip not found"],
            )
        
        # 2. Get member data with airports
        if not members_data:
            # Fetch from trip service
            from ..services.trip_member_service import list_members
            members_data = list_members(request.trip_id) or []
        
        if not members_data:
            logger.warning("[Orchestrator] No members found for group trip")
            # Fall back to solo optimization if no member data
            return await self._optimize_group_solo_fallback(request)
        
        logger.info(f"[Orchestrator] Optimizing for {len(members_data)} members")
        
        # 3. Build per-member segments
        member_segments = self._build_per_member_segments(trip_data, members_data)
        
        if not member_segments:
            logger.warning("[Orchestrator] Could not build per-member segments, falling back to solo")
            return await self._optimize_group_solo_fallback(request)
        
        # 4. PARALLEL: Search flights for ALL members simultaneously
        logger.info(f"[Orchestrator] Starting PARALLEL flight searches for {len(member_segments)} members")
        start_time = asyncio.get_event_loop().time()
        
        # Create search tasks for all members
        async def search_for_member(member_id: str, segments: list) -> tuple[str, dict]:
            """Search flights for a single member's segments."""
            member_points = request.member_points.get(member_id, {})
            logger.info(f"[Orchestrator] [PARALLEL] Starting search for member {member_id} ({len(segments)} segments)")
            search_results = await self._search_all_segments(
                segments=segments,
                user_points=member_points,
                cabin_classes=request.cabin_classes or ["Economy", "Business"],
                include_budget_airlines=request.include_budget_airlines,
                max_stops=request.max_stops,
                departure_hour_range=request.departure_hour_range,
                arrival_hour_range=request.arrival_hour_range,
            )
            logger.info(f"[Orchestrator] [PARALLEL] Completed search for member {member_id}")
            return (member_id, search_results)
        
        # Run ALL flight searches in parallel
        search_tasks = [
            search_for_member(member_id, segments)
            for member_id, segments in member_segments.items()
        ]
        search_results_list = await asyncio.gather(*search_tasks, return_exceptions=True)
        
        # Build a map of member_id -> search_results
        member_search_results = {}
        for result in search_results_list:
            if isinstance(result, Exception):
                logger.error(f"[Orchestrator] Flight search failed: {result}")
                continue
            member_id, search_results = result
            member_search_results[member_id] = search_results
        
        search_elapsed = asyncio.get_event_loop().time() - start_time
        logger.info(f"[Orchestrator] PARALLEL flight searches completed in {search_elapsed:.1f}s for {len(member_search_results)} members")
        
        # 5. PARALLEL: Run optimization for ALL members simultaneously
        logger.info(f"[Orchestrator] Starting PARALLEL optimization for {len(member_search_results)} members")
        opt_start_time = asyncio.get_event_loop().time()
        
        async def optimize_for_member(member_id: str) -> tuple[str, list, list]:
            """Run optimization for a single member."""
            segments = member_segments[member_id]
            search_results = member_search_results.get(member_id, {})
            member_points = request.member_points.get(member_id, {})
            member_budget = request.member_budgets.get(member_id) if request.member_budgets else request.budget
            member_trip_data = dict(trip_data)
            
            logger.info(f"[Orchestrator] [PARALLEL] Starting optimization for member {member_id}")
            
            try:
                member_itineraries, member_warnings = await self._run_oop_optimization(
                    segments=segments,
                    search_results=search_results,
                    user_points=member_points,
                    budget=member_budget or 1e9,
                    trip_data=member_trip_data,
                    mode="oop",
                    risk_mode="balanced",
                    include_basic_economy=False,
                    flexibility_priority="medium",
                    allowed_currencies=None,
                    max_points_by_currency=None,
                    max_cash_budget=member_budget,
                )
                logger.info(f"[Orchestrator] [PARALLEL] Completed optimization for member {member_id}: {len(member_itineraries)} itineraries")
                return (member_id, member_itineraries, member_warnings)
            except Exception as e:
                logger.error(f"[Orchestrator] [PARALLEL] Optimization failed for member {member_id}: {e}")
                return (member_id, [], [f"Could not optimize route for member {member_id}: {str(e)}"])
        
        # Run ALL optimizations in parallel
        opt_tasks = [
            optimize_for_member(member_id)
            for member_id in member_search_results.keys()
        ]
        opt_results_list = await asyncio.gather(*opt_tasks, return_exceptions=True)
        
        opt_elapsed = asyncio.get_event_loop().time() - opt_start_time
        logger.info(f"[Orchestrator] PARALLEL optimizations completed in {opt_elapsed:.1f}s")
        
        # 6. Collect results from all members
        all_member_itineraries = []
        total_oop = 0
        total_savings = 0
        all_warnings = []
        
        for result in opt_results_list:
            if isinstance(result, Exception):
                logger.error(f"[Orchestrator] Optimization task failed: {result}")
                all_warnings.append(f"Optimization failed: {str(result)}")
                continue
                
            member_id, member_itineraries, member_warnings = result
            
            # Tag itineraries with member_id (travelerId)
            for itin in member_itineraries:
                itin.traveler_id = member_id
                # Find member name
                member_info = next((m for m in members_data if 
                    (m.get("user_id") or m.get("userId") or m.get("member_id")) == member_id), None)
                if member_info:
                    member_name = member_info.get("name") or member_info.get("display_name") or member_id[:8]
                    itin.name = f"{member_name}'s Route"
            
            if member_itineraries:
                # Add the best itinerary for this member
                best_member_itin = member_itineraries[0]
                all_member_itineraries.append(best_member_itin)
                total_oop += best_member_itin.oop_metrics.total_out_of_pocket
                total_savings += best_member_itin.oop_metrics.cash_saved
                
            all_warnings.extend(member_warnings)
        
        total_elapsed = search_elapsed + opt_elapsed
        logger.info(f"[Orchestrator] Total parallel optimization time: {total_elapsed:.1f}s (searches: {search_elapsed:.1f}s, optimization: {opt_elapsed:.1f}s)")
        
        # 7. Build group response
        num_members = len(member_segments)
        
        group_best_option = {
            "totalOutOfPocket": total_oop,
            "perPersonAverage": total_oop / num_members if num_members > 0 else 0,
            "totalSavings": total_savings,
            "withinBudget": True,  # Will be updated based on individual budgets
        }
        
        # Deduplicate warnings
        unique_warnings = list(dict.fromkeys(all_warnings))
        
        return OptimizeGroupResponse(
            trip_id=request.trip_id,
            itineraries=all_member_itineraries,
            group_metrics=None,  # TODO: Add detailed per-member metrics
            best_option=group_best_option,
            warnings=unique_warnings,
        )
    
    async def _optimize_group_solo_fallback(
        self,
        request: OptimizeGroupRequest,
    ) -> OptimizeGroupResponse:
        """
        Fallback to solo optimization when per-member optimization isn't possible.
        Uses combined points (legacy behavior).
        """
        logger.warning(
            "GROUP OPTIMIZATION: Using fallback pooled approach. "
            "Per-member routes not available."
        )
        
        combined_points = {}
        for member_id, points in request.member_points.items():
            for program, balance in points.items():
                if program not in combined_points:
                    combined_points[program] = 0
                combined_points[program] += balance
        
        solo_request = OptimizeSoloRequest(
            trip_id=request.trip_id,
            points=combined_points,
            budget=sum(request.member_budgets.values()) if request.member_budgets else request.budget,
            cabin_classes=request.cabin_classes,
        )
        
        solo_result = await self.optimize_solo(solo_request)
        
        num_members = max(len(request.member_budgets), 1)
        total_oop = solo_result.best_option["outOfPocket"]
        
        group_best_option = {
            "totalOutOfPocket": total_oop,
            "perPersonAverage": total_oop / num_members,
            "totalSavings": total_oop * solo_result.best_option["savingsPercentage"] / 100,
            "withinBudget": solo_result.best_option.get("withinBudget", True),
            "suggestedBudget": solo_result.best_option.get("suggestedBudget"),
            "userBudget": solo_result.best_option.get("userBudget"),
        }
        
        return OptimizeGroupResponse(
            trip_id=request.trip_id,
            itineraries=solo_result.itineraries,
            group_metrics=None,
            best_option=group_best_option,
            warnings=[
                "⚠️ Using shared route (per-member routes not available). "
                "All members will use the same flight segments."
            ] + solo_result.warnings,
        )
    
    async def optimize_group_with_allocation(
        self,
        request: OptimizeGroupRequest,
        strategy: BookingAllocationStrategy,
        split_method: str = "equal",
        members_override: list[MemberBookingCapability] = None,
    ) -> GroupBookingPlan:
        """
        Optimize group trip with PROPER booking allocation.
        
        This is the CORRECT approach - it assigns each segment to a
        specific member who will use their OWN points (not pooled).
        
        Args:
            request: Group optimization request with member points
            strategy: How to allocate bookings (optimize, by_type, by_direction, manual)
            split_method: How to split costs for settlement (equal, proportional_travelers, etc.)
            members_override: Optional pre-built member capabilities (overrides request.member_points)
        
        Returns:
            GroupBookingPlan with per-member assignments and settlements
        """
        logger.info(f"[Orchestrator] Starting group allocation for trip {request.trip_id}")
        logger.info(f"[Orchestrator] Strategy: {strategy.strategy_type}")
        
        # 1. Get trip data
        trip_data = await self._get_trip_data(request.trip_id)
        if not trip_data:
            raise ValueError(f"Trip {request.trip_id} not found")
        
        # 2. Build trip segments from destinations
        segments = self._build_trip_segments_from_data(trip_data)
        logger.info(f"[Orchestrator] Built {len(segments)} segments")
        
        # 3. Search for flight options for each segment
        segment_options = await self._search_segment_options(
            segments=segments,
            cabin_classes=request.cabin_classes or ["Economy", "Business"],
        )
        logger.info(f"[Orchestrator] Found options for {len(segment_options)} segments")
        
        # 4. Use override members or build from request
        if members_override:
            members = members_override
        else:
            members = [
                MemberBookingCapability(
                    member_id=member_id,
                    member_name=member_id,  # TODO: Get actual name from user service
                    points=points,
                    max_cash_budget=request.member_budgets.get(member_id) if request.member_budgets else None,
                )
                for member_id, points in request.member_points.items()
            ]
        
        logger.info(f"[Orchestrator] Members: {[m.member_id for m in members]}")
        
        # 5. Convert split_method string to enum
        try:
            split_method_enum = SettlementSplitMethod(split_method)
        except ValueError:
            split_method_enum = SettlementSplitMethod.EQUAL
        
        # 6. Run allocation (this properly handles per-member points!)
        plan = self.group_allocator.allocate(
            trip_id=request.trip_id,
            segments=segment_options,
            members=members,
            strategy=strategy,
            split_method=split_method_enum,
        )
        
        logger.info(f"[Orchestrator] Allocation complete:")
        logger.info(f"  - Total OOP: ${plan.total_group_oop:.2f}")
        logger.info(f"  - Total points: {plan.total_points_used:,}")
        logger.info(f"  - Settlements: {len(plan.settlements)}")
        
        return plan
    
    def _build_trip_segments_from_data(self, trip_data: dict) -> list[dict]:
        """Build trip segments from trip data for allocation."""
        segments = []
        destinations = trip_data.get("destinations", [])
        
        if not destinations:
            logger.warning("[Orchestrator] No destinations found in trip data")
            return segments
        
        logger.info(f"[Orchestrator] Building segments from {len(destinations)} destinations")
        
        # Find start and end destinations from the list
        start_dest = None
        end_dest = None
        intermediate = []
        
        for dest in destinations:
            logger.debug(f"[Orchestrator] Processing destination: {dest}")
            # Support both camelCase (from DB) and snake_case (from test data)
            is_start = dest.get("isStart") or dest.get("is_start")
            is_end = dest.get("isEnd") or dest.get("is_end")
            name = dest.get("name", dest.get("city", dest.get("destination", "")))
            
            if is_start:
                start_dest = name
            if is_end:
                end_dest = name
            # Only add to intermediate if it's not start/end
            if not is_start and not is_end and name:
                intermediate.append(name)
        
        # Fallback if no explicit start/end markers
        if not start_dest and destinations:
            start_dest = destinations[0].get("name", "JFK")
            logger.info(f"[Orchestrator] No explicit start, defaulting to first destination: {start_dest}")
        if not end_dest:
            end_dest = start_dest  # Round trip by default
            logger.info(f"[Orchestrator] No explicit end, defaulting to start: {end_dest}")
        
        logger.info(f"[Orchestrator] Route: start={start_dest}, intermediate={intermediate}, end={end_dest}")
        
        origin = start_dest
        prev_city = origin
        
        # Build route: start -> intermediate cities -> end
        route_cities = intermediate
        if end_dest and end_dest != start_dest:
            route_cities = intermediate + [end_dest]
        elif end_dest == start_dest and intermediate:
            # Round trip: go through intermediates then back home
            route_cities = intermediate
        
        start_date = trip_data.get("start_date", "2026-03-01")
        end_date = trip_data.get("end_date", "2026-03-08")
        
        from datetime import datetime, timedelta
        try:
            current_date = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            total_days = (end_dt - current_date).days
            num_segments = len(route_cities) + 1 if end_dest == start_dest else len(route_cities)
            days_per_city = max(1, total_days // max(num_segments, 1))
        except:
            current_date = datetime.now()
            days_per_city = 3
        
        for i, city in enumerate(route_cities):
            # Flight to this destination (flights only - no hotels)
            segments.append({
                "id": f"flight_{i}_to_{city}",
                "type": "flight",
                "origin": prev_city,
                "destination": city,
                "date": current_date.strftime("%Y-%m-%d"),
            })
            
            current_date += timedelta(days=days_per_city)
            prev_city = city
        
        # Return flight to origin (if round trip)
        if prev_city != origin:
            segments.append({
                "id": f"flight_return_to_{origin}",
                "type": "flight",
                "origin": prev_city,
                "destination": origin,
                "date": current_date.strftime("%Y-%m-%d"),
            })
        
        return segments
    
    async def _search_segment_options(
        self,
        segments: list[dict],
        cabin_classes: list[str],
    ) -> list[list[SegmentOption]]:
        """Search for booking options for each segment (flights only)."""
        all_options = []
        
        for segment in segments:
            # Only handle flight segments
            if segment["type"] == "flight":
                options = await self._search_flight_options(
                    origin=segment["origin"],
                    destination=segment["destination"],
                    date=segment["date"],
                    cabin_classes=cabin_classes,
                )
            else:
                # Skip non-flight segments
                options = []
            
            # Convert to SegmentOption format
            # CRITICAL: Use sanitizers to prevent -1 sentinel from AwardTool/SERP leaking through
            segment_options = []
            for i, opt in enumerate(options):
                # Sanitize cash price - None means unknown, never -1 or 0
                raw_cash = opt.get("cash_price") or opt.get("price")
                sanitized_cash = sanitize_cash_price(raw_cash, context=f"{segment['id']}_opt_{i}")
                
                # Sanitize points - None means unavailable, never negative
                raw_points = opt.get("award_points") or opt.get("points")
                sanitized_points = sanitize_points_cost(raw_points, context=f"{segment['id']}_opt_{i}")
                
                # Sanitize surcharge - 0.0 for unknown/invalid, never negative
                raw_surcharge = opt.get("award_surcharge") or opt.get("surcharge")
                sanitized_surcharge = sanitize_surcharge(raw_surcharge, context=f"{segment['id']}_opt_{i}")
                
                segment_options.append(SegmentOption(
                    segment_id=segment["id"],
                    segment_type=segment["type"],
                    option_id=f"{segment['id']}_opt_{i}",
                    # Use sanitized value, default to None for unknown (not 0!)
                    cash_price=sanitized_cash if sanitized_cash is not None else 0.0,  # SegmentOption requires float
                    award_available=opt.get("award_available", False) and sanitized_points is not None,
                    award_program=opt.get("award_program", opt.get("program")),
                    award_points=sanitized_points,
                    award_surcharge=sanitized_surcharge,
                    summary=opt.get("summary", self._build_option_summary(segment, opt)),
                ))
            
            # Ensure at least one option exists (cash fallback)
            if not segment_options:
                segment_options.append(SegmentOption(
                    segment_id=segment["id"],
                    segment_type=segment["type"],
                    option_id=f"{segment['id']}_cash",
                    cash_price=500.0 if segment["type"] == "flight" else 200.0,  # Fallback prices
                    award_available=False,
                    summary=f"Cash booking for {segment['id']}",
                ))
            
            all_options.append(segment_options)
        
        return all_options
    
    async def _search_flight_options(
        self,
        origin: str,
        destination: str,
        date: str,
        cabin_classes: list[str],
    ) -> list[dict]:
        """Search flight options using FlightAgent."""
        try:
            request = FlightSearchRequest(
                origin=origin,
                destination=destination,
                date=date,
                cabin_classes=cabin_classes,
            )
            result = await self.flight_agent.execute(request)
            
            # CRITICAL FIX: FlightSearchResult has 'options', not 'flights'
            # Also: FlightOption has 'award_points', not 'award_price'
            options = []
            for flight in result.options[:5]:  # Limit to top 5
                options.append({
                    "cash_price": flight.cash_price,
                    "award_available": flight.award_available and flight.award_points is not None,
                    "award_program": flight.award_program if flight.award_points else None,
                    "award_points": flight.award_points,
                    "award_surcharge": flight.award_surcharge or 0,
                    "summary": f"{origin}→{destination} on {flight.airline}",
                    # Pass through additional fields for better display
                    "departure_time": flight.departure_time,
                    "arrival_time": flight.arrival_time,
                    "duration_minutes": flight.duration_minutes,
                    "stops": flight.stops,
                    "airline": flight.airline,
                    "operating_airline": flight.operating_airline,
                    "cabin_class": flight.cabin_class,
                    "flight_numbers": flight.flight_numbers,
                })
            
            logger.info(f"[Orchestrator] _search_flight_options: {origin}->{destination} returned {len(options)} options")
            return options
        except Exception as e:
            logger.warning(f"Flight search failed: {e}")
            return self._get_dummy_flight_options(origin, destination)
    
    def _get_dummy_flight_options(self, origin: str, destination: str) -> list[dict]:
        """Get dummy flight options when search fails.
        
        NOTE: Uses programs that are common transfer partners (DL, AF, BA)
        to work with AMEX/Chase/Citi transferable points.
        """
        return [
            {
                "cash_price": 450.0,
                "award_available": True,
                "award_program": "DL",  # Delta - AMEX, Citi, Bilt partner
                "award_points": 40000,
                "award_surcharge": 25.0,
                "summary": f"{origin}→{destination} on Delta",
            },
            {
                "cash_price": 520.0,
                "award_available": True,
                "award_program": "AF",  # Air France - AMEX, Chase, Citi partner
                "award_points": 35000,
                "award_surcharge": 50.0,
                "summary": f"{origin}→{destination} on Air France",
            },
            {
                "cash_price": 480.0,
                "award_available": True,
                "award_program": "BA",  # British Airways - AMEX, Chase partner
                "award_points": 30000,
                "award_surcharge": 150.0,
                "summary": f"{origin}→{destination} on British Airways",
            },
            {
                "cash_price": 380.0,
                "award_available": False,
                "summary": f"{origin}→{destination} budget carrier",
            },
        ]
    
    def _build_option_summary(self, segment: dict, option: dict) -> str:
        """Build a summary string for a flight option."""
        return f"{segment['origin']}→{segment['destination']}"
    
    async def _get_trip_data(self, trip_id: str) -> Optional[dict]:
        """Get trip data from database."""
        import asyncio
        
        try:
            loop = asyncio.get_event_loop()
            
            # Try solo trip service first (new schema)
            try:
                from ..services.solo_trip_service import get_solo_trip
                trip = await loop.run_in_executor(None, get_solo_trip, trip_id)
                
                if trip:
                    # Solo trips store destinations directly in the record
                    # Format: ["Paris (CDG,ORY,BVA)", "Rome (FCO,CIA)"]
                    raw_destinations = trip.get("destinations", [])
                    origin = trip.get("origin", "")
                    final_destination = trip.get("finalDestination", origin)
                    
                    # Build destinations list with proper structure
                    destinations = []
                    
                    # Add origin as start point with all airports
                    if origin:
                        origin_airports = _get_all_airports_for_location(origin)
                        destinations.append({
                            "name": origin,
                            "isStart": True,
                            "isEnd": origin == final_destination,
                            "all_airports": origin_airports,
                        })
                        logger.info(f"[Orchestrator] Origin '{origin}' -> airports: {origin_airports}")
                    
                    # Add intermediate destinations with ALL airport options
                    for dest in raw_destinations:
                        # Extract ALL airport codes from format like "Paris (CDG,ORY,BVA)"
                        all_airports = _get_all_airports_for_location(dest)
                        primary_airport = all_airports[0] if all_airports else dest
                        
                        destinations.append({
                            "name": primary_airport,
                            "mustInclude": True,
                            "all_airports": all_airports,  # Store ALL airports for multi-airport search
                        })
                        
                        logger.info(f"[Orchestrator] Destination '{dest}' -> airports: {all_airports}")
                    
                    # Add final destination if different from origin
                    if final_destination and final_destination != origin:
                        final_airports = _get_all_airports_for_location(final_destination)
                        destinations.append({
                            "name": final_destination,
                            "isEnd": True,
                            "all_airports": final_airports,
                        })
                        logger.info(f"[Orchestrator] Final destination '{final_destination}' -> airports: {final_airports}")
                    
                    logger.info(f"[Orchestrator] Solo trip loaded: origin={origin}, destinations={raw_destinations}, final={final_destination}")
                    logger.info(f"[Orchestrator] Parsed destinations: {destinations}")
                    
                    one_way = (trip.get("tripType") or "").strip().lower() == "one_way"
                    return {
                        "trip_id": trip_id,
                        "start_date": trip.get("startDate"),
                        "end_date": trip.get("endDate"),
                        "destinations": destinations,
                        "one_way": one_way,
                        "include_hotels": trip.get("includeHotels", True),
                        "max_budget": trip.get("maxBudget"),
                    }
            except ImportError:
                pass  # Solo trip service not available
            
            # Fall back to legacy trip service
            from ..services.trip_service import get_trip
            from ..services.destination_service import list_destinations
            
            trip = await loop.run_in_executor(None, get_trip, trip_id)
            if not trip:
                logger.warning(f"Trip {trip_id} not found, using test data")
                return self._get_test_trip_data(trip_id)
            
            destinations = await loop.run_in_executor(None, list_destinations, trip_id)
            
            return {
                "trip_id": trip_id,
                "start_date": trip.get("startDate"),
                "end_date": trip.get("endDate"),
                "destinations": destinations or [],
                "include_hotels": trip.get("includeHotels", True),
                "max_budget": trip.get("maxBudget"),
            }
        except Exception as e:
            logger.error(f"Failed to get trip data: {e}")
            return self._get_test_trip_data(trip_id)
    
    def _get_test_trip_data(self, trip_id: str) -> dict:
        """Return test trip data for development/testing."""
        return {
            "trip_id": trip_id,
            "start_date": "2026-03-01",
            "end_date": "2026-03-08",
            "destinations": [
                {"name": "JFK", "is_start": True, "is_end": True},
                {"name": "CDG", "must_include": True},
            ],
        }
    
    def _build_trip_segments(self, trip_data: dict) -> list[dict]:
        """
        Build list of flight segments to search (flights only).
        
        IMPORTANT: This function creates ONE segment per city-pair leg.
        Multiple airports in a city are treated as ALTERNATIVES (OR), not
        separate required stops (AND).
        
        For example, Paris → [CDG, ORY] means the optimizer can pick EITHER
        airport, not that it must visit both.
        
        The segment includes:
        - origin_city, dest_city: City names for display
        - allowed_origin_airports: List of valid origin airports
        - allowed_destination_airports: List of valid destination airports
        - airport_search_pairs: List of (origin_apt, dest_apt) to search
        """
        destinations = trip_data.get("destinations", [])
        start_date = trip_data.get("start_date", "2026-03-01")
        one_way = trip_data.get("one_way", False)
        # One-way trips only need departure date; arrival/return date is not used
        end_date = trip_data.get("end_date") or ("" if one_way else "2026-03-08")
        if one_way and not end_date:
            end_date = start_date
        end_date = end_date or "2026-03-08"
        
        # Build airport mapping for each destination
        # {destination_name: [list of airports]}
        dest_to_airports = {}
        
        # Find start and end points with all their airports
        start = None
        start_airports = []
        end = None
        end_airports = []
        intermediate = []
        intermediate_airports = {}
        
        for dest in destinations:
            name = dest.get("name", "")
            all_airports = dest.get("all_airports") or _get_all_airports_for_location(name)
            dest_to_airports[name] = all_airports
            
            # Support both camelCase (from DB) and snake_case (from test data)
            is_start = dest.get("isStart") or dest.get("is_start")
            is_end = dest.get("isEnd") or dest.get("is_end")
            must_include = dest.get("mustInclude") or dest.get("must_include")
            
            if is_start:
                start = name
                start_airports = all_airports
            if is_end:
                end = name
                end_airports = all_airports
            if must_include and not is_start and not is_end:
                intermediate.append(name)
                intermediate_airports[name] = all_airports
        
        # Default to first destination as both start and end if not specified
        if not start and destinations:
            start = destinations[0].get("name", "JFK")
            start_airports = dest_to_airports.get(start, [start])
        if not end:
            end = start
            end_airports = start_airports
        
        if not start:
            return []
        
        logger.info(f"[Orchestrator] Multi-airport mapping (airports are OR alternatives):")
        logger.info(f"[Orchestrator]   Start ({start}): {start_airports}")
        for city, airports in intermediate_airports.items():
            logger.info(f"[Orchestrator]   Intermediate ({city}): {airports}")
        logger.info(f"[Orchestrator]   End ({end}): {end_airports}")
        
        # ═══════════════════════════════════════════════════════════════════════
        # GENERATE ALL ROUTE PERMUTATIONS
        # ═══════════════════════════════════════════════════════════════════════
        import itertools
        
        if len(intermediate) > 1:
            permutations = list(itertools.permutations(intermediate))
            logger.info(f"[Orchestrator] Multi-city: {len(permutations)} route permutations")
        else:
            permutations = [tuple(intermediate)]
        
        # Store route variants for optimizer
        route_variants = []
        all_segments = []
        
        from datetime import datetime, timedelta
        
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        except Exception:
            start_dt = datetime.now()
            end_dt = start_dt + timedelta(days=7)
        
        # ═══════════════════════════════════════════════════════════════════════
        # CREATE ONE SEGMENT PER CITY-PAIR (not per airport pair!)
        # ═══════════════════════════════════════════════════════════════════════
        # Multiple airports in a city are ALTERNATIVES, not separate stops.
        
        for perm_idx, perm in enumerate(permutations):
            route_cities = [start] + list(perm) + ([end] if end != start else [start])
            route_variants.append(route_cities)
            
            total_days = (end_dt - start_dt).days
            days_per_city = max(1, total_days // max(len(route_cities) - 1, 1))
            current_date = start_dt
            
            # For each leg in the route, create ONE segment with airport alternatives
            for i in range(len(route_cities) - 1):
                origin_city = route_cities[i]
                dest_city = route_cities[i + 1]
                is_return_leg = (i == len(route_cities) - 2 and (dest_city == start or end == start))
                
                # Get all airports for origin and destination (these are OR alternatives)
                origin_airports = dest_to_airports.get(origin_city, [origin_city])
                dest_airports = dest_to_airports.get(dest_city, [dest_city])
                
                # For return leg, use end_date
                flight_date = end_dt.strftime("%Y-%m-%d") if is_return_leg else current_date.strftime("%Y-%m-%d")
                
                # Generate all airport pairs for searching (we'll consolidate results)
                airport_search_pairs = [
                    (orig_apt, dest_apt)
                    for orig_apt in origin_airports
                    for dest_apt in dest_airports
                ]
                
                # Create ONE segment for this city-pair
                # The optimizer will pick ONE flight from any valid airport combination
                segment = {
                    "type": "flight",
                    # Use first airport as "primary" for API compatibility
                    "origin": origin_airports[0],
                    "destination": dest_airports[0],
                    "date": flight_date,
                    "route_variant": perm_idx,
                    "leg_index": i,
                    # City info for display and grouping
                    "origin_city": origin_city,
                    "dest_city": dest_city,
                    # CRITICAL: All valid airports are alternatives (OR), not requirements (AND)
                    "allowed_origin_airports": origin_airports,
                    "allowed_destination_airports": dest_airports,
                    # All airport pairs we need to search for flight data
                    "airport_search_pairs": airport_search_pairs,
                }
                all_segments.append(segment)
                
                current_date += timedelta(days=days_per_city)
        
        # Store metadata for optimizer
        trip_data["route_variants"] = route_variants
        trip_data["num_route_variants"] = len(permutations)
        trip_data["dest_to_airports"] = dest_to_airports
        
        # Deduplicate segments by city-pair (not airport-pair)
        unique_segments = self._deduplicate_city_pair_segments(all_segments)
        
        # Count search pairs
        total_searches = sum(len(seg.get("airport_search_pairs", [])) for seg in unique_segments)
        logger.info(f"[Orchestrator] Generated {len(unique_segments)} city-pair legs requiring {total_searches} airport-pair searches")
        
        # Log the segments
        for seg in unique_segments:
            origin_apts = seg.get("allowed_origin_airports", [seg["origin"]])
            dest_apts = seg.get("allowed_destination_airports", [seg["destination"]])
            logger.info(f"[Orchestrator]   Leg: {seg['origin_city']} ({origin_apts}) → {seg['dest_city']} ({dest_apts}) on {seg['date']}")
        
        return unique_segments
    
    def _deduplicate_city_pair_segments(self, segments: list[dict]) -> list[dict]:
        """
        Deduplicate segments by city-pair + date (not airport-pair).
        
        Merges airport_search_pairs from duplicate city-pair segments.
        """
        seen = {}  # (origin_city, dest_city, date) -> segment
        
        for seg in segments:
            origin_city = seg.get("origin_city", seg["origin"])
            dest_city = seg.get("dest_city", seg["destination"])
            key = (origin_city, dest_city, seg["date"])
            
            if key not in seen:
                seen[key] = seg
            else:
                # Merge airport_search_pairs
                existing = seen[key]
                existing_pairs = set(tuple(p) for p in existing.get("airport_search_pairs", []))
                new_pairs = set(tuple(p) for p in seg.get("airport_search_pairs", []))
                merged_pairs = list(existing_pairs | new_pairs)
                existing["airport_search_pairs"] = merged_pairs
                
                # Merge allowed airports
                existing_origins = set(existing.get("allowed_origin_airports", []))
                new_origins = set(seg.get("allowed_origin_airports", []))
                existing["allowed_origin_airports"] = list(existing_origins | new_origins)
                
                existing_dests = set(existing.get("allowed_destination_airports", []))
                new_dests = set(seg.get("allowed_destination_airports", []))
                existing["allowed_destination_airports"] = list(existing_dests | new_dests)
        
        return list(seen.values())
    
    def _deduplicate_segments(self, segments: list[dict]) -> list[dict]:
        """
        Remove duplicate O-D pairs from segments to avoid redundant searches.
        
        Different route orderings may share some segments (e.g., the return leg).
        We only need to search each unique O-D + date combination once.
        """
        seen = set()
        unique = []
        
        for seg in segments:
            key = (seg["origin"], seg["destination"], seg["date"])
            if key not in seen:
                seen.add(key)
                unique.append(seg)
        
        return unique
    
    def _build_per_member_segments(
        self,
        trip_data: dict,
        members: list[dict],
    ) -> dict[str, list[dict]]:
        """
        Build per-member route segments based on their departure/arrival airports.
        
        Each member may have a different:
        - departure_airport: Where they fly FROM
        - arrival_airport: Where they fly TO (for one-way) or same as departure (round trip)
        - is_round_trip: Whether they return to their departure airport
        
        Args:
            trip_data: Trip data with destinations and dates
            members: List of member dicts with airport preferences
            
        Returns:
            Dict mapping member_id -> list of segments for that member
        """
        from datetime import datetime, timedelta
        
        destinations = trip_data.get("destinations", [])
        start_date = trip_data.get("start_date", "2026-03-01")
        end_date = trip_data.get("end_date", "2026-03-08")
        
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        except:
            start_dt = datetime.now()
            end_dt = start_dt + timedelta(days=7)
        
        # Find the destination cities (excluding start/end markers)
        dest_cities = []
        dest_airports_map = {}
        
        for dest in destinations:
            name = dest.get("name", "")
            all_airports = dest.get("all_airports") or _get_all_airports_for_location(name)
            dest_airports_map[name] = all_airports
            
            is_start = dest.get("isStart") or dest.get("is_start")
            is_end = dest.get("isEnd") or dest.get("is_end")
            must_include = dest.get("mustInclude") or dest.get("must_include")
            
            # Collect intermediate destinations (the places the group visits)
            if must_include and not is_start and not is_end:
                dest_cities.append(name)
        
        # If no intermediate destinations, use the trip's destination
        if not dest_cities:
            for dest in destinations:
                is_start = dest.get("isStart") or dest.get("is_start")
                is_end = dest.get("isEnd") or dest.get("is_end")
                if not is_start:
                    dest_cities.append(dest.get("name", ""))
                    break
        
        if not dest_cities:
            logger.warning("[Orchestrator] No destination cities found for per-member routes")
            return {}
        
        logger.info(f"[Orchestrator] Building per-member routes to destinations: {dest_cities}")
        
        member_segments = {}
        
        for member in members:
            member_id = member.get("user_id") or member.get("userId") or member.get("member_id")
            departure_airport = member.get("departure_airport") or member.get("origin_airport") or "JFK"
            arrival_airport = member.get("arrival_airport") or departure_airport
            is_round_trip = member.get("is_round_trip", True)
            
            if is_round_trip:
                arrival_airport = departure_airport  # For round trips, return to departure
            
            logger.info(f"[Orchestrator] Member {member_id}: {departure_airport} → {dest_cities} → {arrival_airport} (round_trip={is_round_trip})")
            
            segments = []
            total_days = (end_dt - start_dt).days
            num_legs = len(dest_cities) + 1 if not is_round_trip else len(dest_cities) * 2
            days_per_leg = max(1, total_days // max(num_legs, 1))
            current_date = start_dt
            
            # Outbound: departure_airport → first destination
            first_dest = dest_cities[0]
            first_dest_airports = dest_airports_map.get(first_dest, [first_dest])
            
            segments.append({
                "type": "flight",
                "origin": departure_airport,
                "destination": first_dest_airports[0],
                "date": current_date.strftime("%Y-%m-%d"),
                "member_id": member_id,
                "leg_type": "outbound",
                "leg_index": 0,
                "origin_city": departure_airport,
                "dest_city": first_dest,
                "allowed_origin_airports": [departure_airport],
                "allowed_destination_airports": first_dest_airports,
                "airport_search_pairs": [(departure_airport, apt) for apt in first_dest_airports],
            })
            current_date += timedelta(days=days_per_leg)
            
            # Inter-destination flights (if multiple destinations)
            for i in range(len(dest_cities) - 1):
                origin_city = dest_cities[i]
                dest_city = dest_cities[i + 1]
                origin_airports = dest_airports_map.get(origin_city, [origin_city])
                dest_airports = dest_airports_map.get(dest_city, [dest_city])
                
                segments.append({
                    "type": "flight",
                    "origin": origin_airports[0],
                    "destination": dest_airports[0],
                    "date": current_date.strftime("%Y-%m-%d"),
                    "member_id": member_id,
                    "leg_type": "inter_destination",
                    "leg_index": i + 1,
                    "origin_city": origin_city,
                    "dest_city": dest_city,
                    "allowed_origin_airports": origin_airports,
                    "allowed_destination_airports": dest_airports,
                    "airport_search_pairs": [
                        (orig, dest) for orig in origin_airports for dest in dest_airports
                    ],
                })
                current_date += timedelta(days=days_per_leg)
            
            # Return leg: last destination → arrival_airport
            last_dest = dest_cities[-1]
            last_dest_airports = dest_airports_map.get(last_dest, [last_dest])
            
            segments.append({
                "type": "flight",
                "origin": last_dest_airports[0],
                "destination": arrival_airport,
                "date": end_dt.strftime("%Y-%m-%d"),  # Return on end date
                "member_id": member_id,
                "leg_type": "return",
                "leg_index": len(dest_cities),
                "origin_city": last_dest,
                "dest_city": arrival_airport,
                "allowed_origin_airports": last_dest_airports,
                "allowed_destination_airports": [arrival_airport],
                "airport_search_pairs": [(apt, arrival_airport) for apt in last_dest_airports],
            })
            
            member_segments[member_id] = segments
            logger.info(f"[Orchestrator] Member {member_id} has {len(segments)} flight segments")
        
        return member_segments
    
    def _build_segments_for_route(self, route: list[str], trip_data: dict) -> list[dict]:
        """
        Build flight segments for a specific route ordering.
        
        Args:
            route: List of airport codes in order [start, city1, city2, ..., end]
            trip_data: Trip data with dates
        
        Returns:
            List of segment dicts for this specific route
        """
        from datetime import datetime, timedelta
        
        start_date = trip_data.get("start_date", "2026-03-01")
        end_date = trip_data.get("end_date", "2026-03-08")
        
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
        except:
            start_dt = datetime.now()
            end_dt = start_dt + timedelta(days=7)
        
        total_days = (end_dt - start_dt).days
        days_per_city = max(1, total_days // max(len(route) - 1, 1))
        current_date = start_dt
        
        segments = []
        start_airport = route[0] if route else None
        
        for i in range(len(route) - 1):
            origin = route[i]
            destination = route[i + 1]
            is_return_leg = (i == len(route) - 2 and destination == start_airport)
            
            # For return leg, use end_date
            flight_date = end_dt.strftime("%Y-%m-%d") if is_return_leg else current_date.strftime("%Y-%m-%d")
            
            segments.append({
                "type": "flight",
                "origin": origin,
                "destination": destination,
                "date": flight_date,
            })
            
            current_date += timedelta(days=days_per_city)
        
        return segments
    
    async def _search_all_segments(
        self,
        segments: list[dict],
        user_points: dict,
        cabin_classes: list[str],
        include_budget_airlines: bool = True,
        max_stops: int = 0,
        departure_hour_range: list[int] | None = None,
        arrival_hour_range: list[int] | None = None,
    ) -> dict:
        """
        Search flights for all segments in parallel (flights only).
        
        MULTI-AIRPORT SUPPORT: Each segment may have multiple airport pairs
        to search. We search ALL pairs and consolidate results into the
        segment, so the optimizer sees all flight options for the city-pair.
        """
        tasks = []
        task_metadata = []  # Track which segment and airport pair each task belongs to
        
        for i, segment in enumerate(segments):
            if segment["type"] != "flight":
                continue
            
            # Get airport pairs to search (may be multiple for multi-airport cities)
            airport_pairs = segment.get("airport_search_pairs")
            if not airport_pairs:
                # Fallback: single airport pair from origin/destination
                airport_pairs = [(segment["origin"], segment["destination"])]
            
            # Search each airport pair
            for origin_apt, dest_apt in airport_pairs:
                tasks.append(self.flight_agent.execute(FlightSearchRequest(
                    origin=origin_apt,
                    destination=dest_apt,
                    date=segment["date"],
                    cabin_classes=cabin_classes,
                    user_points=user_points,
                    include_budget_airlines=include_budget_airlines,
                    max_stops=max_stops,
                    departure_hour_range=departure_hour_range,
                    arrival_hour_range=arrival_hour_range,
                )))
                task_metadata.append({
                    "segment_idx": i,
                    "origin_airport": origin_apt,
                    "dest_airport": dest_apt,
                })
        
        logger.info(f"[Orchestrator] Searching {len(tasks)} airport pairs for {len(segments)} segments")
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Consolidate results by segment
        # Each segment gets ALL flight options from ALL its airport pairs
        search_results = {}
        segment_options = {}  # segment_idx -> list of FlightOption
        
        for metadata, result in zip(task_metadata, results):
            seg_idx = metadata["segment_idx"]
            origin_apt = metadata["origin_airport"]
            dest_apt = metadata["dest_airport"]
            
            if seg_idx not in segment_options:
                segment_options[seg_idx] = []
            
            if isinstance(result, Exception):
                logger.error(f"Search failed for {origin_apt}->{dest_apt}: {result}")
                continue
            
            if result and hasattr(result, "options") and result.options:
                # Add airport info to each option for debugging
                for opt in result.options:
                    # Store the actual airports used (for multi-airport tracking)
                    if not hasattr(opt, '_searched_origin'):
                        opt._searched_origin = origin_apt
                        opt._searched_destination = dest_apt
                
                segment_options[seg_idx].extend(result.options)
                logger.info(f"[Orchestrator] {origin_apt}->{dest_apt}: found {len(result.options)} options")
        
        # Create consolidated results for each segment
        for i, segment in enumerate(segments):
            if segment["type"] != "flight":
                continue
            
            key = f"flight_{i}"
            options = segment_options.get(i, [])
            
            # Deduplicate options by a reasonable key (airline + departure time + price)
            seen_keys = set()
            unique_options = []
            for opt in options:
                # Create dedup key
                dedup_key = (
                    getattr(opt, 'airline', ''),
                    getattr(opt, 'departure_time', ''),
                    getattr(opt, 'cash_price', 0),
                    getattr(opt, 'award_points', 0),
                )
                if dedup_key not in seen_keys:
                    seen_keys.add(dedup_key)
                    unique_options.append(opt)
            
            # Sort options by cash price (cheapest first) so greedy picks the best deal
            unique_options.sort(key=lambda o: o.cash_price if o.cash_price else float('inf'))
            
            # Create a mock result object with consolidated options
            from .models import FlightSearchResult
            search_results[key] = FlightSearchResult(
                options=unique_options,
                origin=segment.get("origin_city", segment["origin"]),
                destination=segment.get("dest_city", segment["destination"]),
                date=segment["date"],
                programs_searched=getattr(result, 'programs_searched', []) if result else [],
                errors=[],
            )
            
            origin_apts = segment.get("allowed_origin_airports", [segment["origin"]])
            dest_apts = segment.get("allowed_destination_airports", [segment["destination"]])
            logger.info(f"[Orchestrator] {key}: {len(unique_options)} unique options for {segment.get('origin_city', segment['origin'])} ({origin_apts}) → {segment.get('dest_city', segment['destination'])} ({dest_apts})")
        
        return search_results
    
    async def _run_oop_optimization(
        self,
        segments: list[dict],
        search_results: dict,
        user_points: dict,
        budget: float,  # Required float - use NO_BUDGET_LIMIT for unlimited
        trip_data: dict,
        mode: str = "oop",
        risk_mode: str = "balanced",
        include_basic_economy: bool = False,
        flexibility_priority: str = "medium",
        allowed_currencies: list[str] = None,
        max_points_by_currency: dict[str, int] = None,
        max_cash_budget: float = None,
    ) -> tuple[list[RankedItinerary], list[str]]:
        """
        Run optimization using V3 ILP solver.
        
        Returns:
            Tuple of (itineraries, warnings)
        
        V3 improvements:
        - Joint flight + hotel optimization
        - Three modes: OOP, CPP, Balanced
        - Integer-safe transfers
        - Single-ticket enforcement for connections
        - Proper group room allocation
        - Policy evaluation with risk modes
        - MULTI-CURRENCY SUPPORT: Uses all provided currencies optimally
        
        Falls back to greedy algorithm if V3 fails.
        
        Note: budget is required (use NO_BUDGET_LIMIT for unlimited)
        """
        # SAFETY: Convert None to NO_BUDGET_LIMIT to prevent TypeError in downstream code
        if budget is None:
            budget = NO_BUDGET_LIMIT
        
        logger.info(f"[Orchestrator] Running V3 optimization (mode={mode}, risk_mode={risk_mode})")
        if allowed_currencies:
            logger.info(f"[Orchestrator] Currency restriction: only using {allowed_currencies}")
        if max_points_by_currency:
            logger.info(f"[Orchestrator] Currency caps: {max_points_by_currency}")
        
        try:
            # Try V3 solver first (lazy import)
            run_v3_optimization = _get_v3_optimizer()
            itineraries = await run_v3_optimization(
                segments=segments,
                search_results=search_results,
                user_points=user_points,
                budget=budget,
                trip_data=trip_data,
                mode=mode,
                risk_mode=risk_mode,
                include_basic_economy=include_basic_economy,
                flexibility_priority=flexibility_priority,
                allowed_currencies=allowed_currencies,
                max_points_by_currency=max_points_by_currency,
                max_cash_budget=max_cash_budget,
            )
            
            if itineraries:
                logger.info(f"[Orchestrator] V3 solver returned {len(itineraries)} itineraries")
                return itineraries, []  # V3 solver returns no warnings via this path
            else:
                logger.warning("[Orchestrator] V3 solver returned no itineraries, falling back to greedy")
        
        except Exception as e:
            logger.error(f"[Orchestrator] V3 solver failed: {e}, falling back to greedy")
        
        # Fallback to original greedy algorithm (returns tuple of itineraries and warnings)
        return await self._run_greedy_optimization(
            segments=segments,
            search_results=search_results,
            user_points=user_points,
            budget=budget,
            trip_data=trip_data,
        )
    
    async def _run_greedy_optimization(
        self,
        segments: list[dict],
        search_results: dict,
        user_points: dict,
        budget: float,  # Required float - use NO_BUDGET_LIMIT for unlimited
        trip_data: dict,
    ) -> tuple[list[RankedItinerary], list[str]]:
        """
        Fallback greedy optimization algorithm.
        
        This is the original algorithm that:
        1. For each segment, picks the option with lowest OOP
        2. Respects points balance constraints
        3. Generates transfer instructions
        
        NOTE: When budget is set, we should prefer points to stay within budget.
        
        Returns:
            Tuple of (itineraries, warnings)
        
        Note: budget is required (use NO_BUDGET_LIMIT for unlimited)
        """
        # SAFETY: Convert None to NO_BUDGET_LIMIT to prevent errors
        if budget is None:
            budget = NO_BUDGET_LIMIT
        
        budget_display = 'unlimited' if budget >= NO_BUDGET_LIMIT else f'${budget}'
        logger.info(f"[Greedy] Starting greedy optimization with budget={budget_display}")
        logger.info(f"[Greedy] User points: {user_points}")
        
        # Track remaining points
        remaining_points = dict(user_points)
        
        # Calculate if budget is tight (need to prefer points)
        # Budget is "tight" if it's a real limit (not the unlimited sentinel)
        budget_is_tight = budget > 0 and budget < NO_BUDGET_LIMIT
        
        # Track segments where points couldn't be used and why
        transfer_incompatible_segments = []
        
        # Build itinerary
        itinerary_segments = []
        total_cash_price = 0.0
        total_oop = 0.0
        total_points_used = 0
        points_breakdown = {}
        transfers = []
        route = []
        warnings = []
        
        for i, segment in enumerate(segments):
            if segment["type"] == "flight":
                key = f"flight_{i}"
                result = search_results.get(key)
                
                if not result or not result.options:
                    continue
                
                # Pick best option - when budget is tight, prefer points over cash
                best = self._pick_best_flight_option(
                    result.options, 
                    remaining_points,
                    prefer_points=budget_is_tight
                )
                
                if best:
                    # Enrich award flights with real times from SerpAPI cash flights
                    # Award flights from AwardTool often lack departure/arrival times
                    # or use a midnight placeholder (T00:00:00)
                    has_placeholder_dep = best.departure_time and "T00:00:00" in best.departure_time
                    needs_time_enrichment = (
                        not best.arrival_time or 
                        has_placeholder_dep
                    )
                    if needs_time_enrichment:
                        # First pass: match same airline
                        for other_opt in result.options:
                            if other_opt is best:
                                continue
                            if not other_opt.departure_time or not other_opt.arrival_time:
                                continue
                            if "T00:00:00" in (other_opt.departure_time or ""):
                                continue  # Skip other placeholder times
                            other_airline = (other_opt.airline or "").upper()[:2]
                            best_airline = (best.airline or "").upper()[:2]
                            if other_airline == best_airline:
                                if has_placeholder_dep:
                                    best.departure_time = other_opt.departure_time
                                if not best.arrival_time:
                                    best.arrival_time = other_opt.arrival_time
                                if not best.duration_minutes and other_opt.duration_minutes:
                                    best.duration_minutes = other_opt.duration_minutes
                                # Also borrow leg/segment data if missing
                                if not best.segments and other_opt.segments:
                                    best.segments = other_opt.segments
                                logger.info(f"[Greedy] Enriched {best.origin}->{best.destination} times from matching {other_airline} SerpAPI flight")
                                break
                        
                        # Second pass: accept any airline for same route if still missing
                        if not best.arrival_time or (best.departure_time and "T00:00:00" in best.departure_time):
                            for other_opt in result.options:
                                if other_opt is best:
                                    continue
                                if not other_opt.departure_time or not other_opt.arrival_time:
                                    continue
                                if "T00:00:00" in (other_opt.departure_time or ""):
                                    continue
                                if best.departure_time and "T00:00:00" in best.departure_time:
                                    best.departure_time = other_opt.departure_time
                                if not best.arrival_time:
                                    best.arrival_time = other_opt.arrival_time
                                if not best.duration_minutes and other_opt.duration_minutes:
                                    best.duration_minutes = other_opt.duration_minutes
                                if not best.segments and other_opt.segments:
                                    best.segments = other_opt.segments
                                logger.info(f"[Greedy] Enriched {best.origin}->{best.destination} times from {other_opt.airline} SerpAPI flight (cross-airline)")
                                break
                    
                    seg, points_used, transfer = self._create_flight_segment(
                        best, remaining_points, force_points=budget_is_tight
                    )
                    itinerary_segments.append(seg)
                    
                    total_cash_price += best.cash_price or 0
                    
                    if seg.payment.method == "cash":
                        total_oop += seg.payment.amount
                    else:
                        total_oop += seg.payment.surcharge
                        total_points_used += seg.payment.points_used
                        prog = seg.payment.program
                        points_breakdown[prog] = points_breakdown.get(prog, 0) + seg.payment.points_used
                        if transfer:
                            transfers.append(transfer)
                    
                    if best.origin not in route:
                        route.append(best.origin)
                    route.append(best.destination)
            
        if not itinerary_segments:
            return [], warnings
        
        # Calculate metrics
        cash_saved = total_cash_price - total_oop
        savings_pct = (cash_saved / total_cash_price * 100) if total_cash_price > 0 else 0
        
        # Calculate average CPP
        cpp_values = []
        for seg in itinerary_segments:
            if seg.payment.method == "points" and seg.payment.cpp_achieved:
                cpp_values.append(seg.payment.cpp_achieved)
        avg_cpp = sum(cpp_values) / len(cpp_values) if cpp_values else 0
        
        # Check budget (if unlimited or total_oop under budget, we're good)
        within_budget = budget >= NO_BUDGET_LIMIT or total_oop <= budget
        
        budget_display = 'unlimited' if budget >= NO_BUDGET_LIMIT else f'${budget}'
        logger.info(f"[Greedy] Final result: OOP=${total_oop:.0f}, budget={budget_display}, within_budget={within_budget}")
        logger.info(f"[Greedy] Points used: {total_points_used:,}, cash saved: ${cash_saved:.0f}")
        
        if not within_budget and budget < NO_BUDGET_LIMIT:
            budget_exceeded_by = total_oop - budget
            suggested_budget = int(total_oop * 1.1)  # 10% buffer
            logger.warning(f"[Greedy] ⚠️ Budget exceeded by ${budget_exceeded_by:.0f}. Suggested budget: ${suggested_budget:,}")
            
            # Add clear message that no itinerary within budget exists
            warnings.append(
                f"⚠️ No itinerary found within your ${budget:.0f} budget. "
                f"The minimum cost for this trip is ${total_oop:.0f}. "
                f"We recommend setting your budget to at least ${suggested_budget:,}."
            )
            
            # Check if this is due to transfer partner incompatibility
            if total_points_used == 0 and user_points:
                # Get user's reachable airlines
                from .config import TRANSFER_GRAPH
                user_banks = list(user_points.keys())
                # Humanize bank keys: "bank_of_america" → "Bank of America"
                user_banks_display = [b.replace("_", " ").title() for b in user_banks]
                reachable_airlines = set()
                for bank_name, config in TRANSFER_GRAPH.items():
                    bank_normalized = bank_name.lower().replace(" ", "_")
                    for user_prog in user_points.keys():
                        user_prog_normalized = user_prog.lower().replace(" ", "_").replace("-", "_")
                        if (bank_normalized == user_prog_normalized or 
                            bank_normalized.replace("_", "") == user_prog_normalized.replace("_", "") or
                            bank_normalized.split("_")[0] == user_prog_normalized.split("_")[0]):
                            reachable_airlines.update(config.get("airlines", []))
                
                # Build points warning with guard against empty reachable airlines
                banks_str = ", ".join(user_banks_display)
                if reachable_airlines:
                    airlines_str = ", ".join(sorted(reachable_airlines))
                    points_msg = (
                        f"Points could not be used because the available award flights are on airlines "
                        f"that your points ({banks_str}) cannot transfer to. "
                        f"Your points can transfer to: {airlines_str}. "
                        f"Consider adding more cards to access more airlines."
                    )
                else:
                    points_msg = (
                        f"Points could not be used because your points program ({banks_str}) "
                        f"does not have transfer partners that match the available flights on this route. "
                        f"Consider adding more cards to access more airlines."
                    )
                warnings.append(points_msg)
        
        # Build appropriate summary based on budget status
        if within_budget:
            summary = f"Save ${cash_saved:.0f} ({savings_pct:.0f}% off) by using {total_points_used:,} points"
        else:
            budget_exceeded_by = total_oop - budget if budget < NO_BUDGET_LIMIT else 0
            min_budget_needed = int(total_oop * 1.1)  # 10% buffer
            if total_points_used > 0:
                summary = f"⚠️ Min budget needed: ${min_budget_needed:,}. Using {total_points_used:,} points saves ${cash_saved:.0f}"
            else:
                summary = f"⚠️ Min budget needed: ${min_budget_needed:,}. No points could be applied to this route."
        
        # Generate a descriptive name based on budget status
        if within_budget:
            itinerary_name = "Optimized Itinerary"
        else:
            min_budget_needed = int(total_oop * 1.1)
            itinerary_name = f"Min Budget Needed: ${min_budget_needed:,}"
        
        itinerary = RankedItinerary(
            id=str(uuid.uuid4()),
            rank=1,
            name=itinerary_name,
            route=route,
            segments=itinerary_segments,
            oop_metrics=OOPMetrics(
                total_cash_price=total_cash_price,
                total_out_of_pocket=total_oop,
                total_points_used=total_points_used,
                cash_saved=cash_saved,
                savings_percentage=savings_pct,
                average_cpp=avg_cpp,
                points_breakdown=points_breakdown,
            ),
            transfers=transfers,
            within_budget=within_budget,
            within_points=True,  # We already respected limits
            summary=summary,
        )
        
        return [itinerary], warnings
    
    def _pick_best_flight_option(self, options: list, remaining_points: dict, prefer_points: bool = False):
        """
        Pick the best flight option considering OOP.
        
        When budget is tight (prefer_points=True), progressively relaxes constraints:
        1. First try with relaxed CPP/surcharge thresholds
        2. Then try with NO restrictions (any award we can afford)
        3. Only fall back to cash if no awards available at all
        
        Args:
            options: List of flight options (sorted by cash_price ascending)
            remaining_points: User's remaining points balances
            prefer_points: If True, prefer points over cash (for tight budgets)
        """
        config = OOP_CONFIG
        
        if not prefer_points:
            # Normal mode: use standard thresholds
            min_cpp = config["min_cpp_threshold"]
            max_surcharge_ratio = config["max_surcharge_ratio"]
            
            for option in options:
                if option.award_available and option.award_points:
                    if option.cash_price and option.award_surcharge:
                        surcharge_ratio = option.award_surcharge / option.cash_price
                        if surcharge_ratio > max_surcharge_ratio:
                            continue
                    if option.cpp and option.cpp < min_cpp:
                        continue
                    if self._can_afford_points(option.award_program, option.award_points, remaining_points):
                        logger.info(f"[Greedy] Selected points option: {option.award_points:,} pts + ${option.award_surcharge or 0:.0f}")
                        return option
                
                if option.cash_price and not option.award_available:
                    return option
            
            # Fall back to cheapest cash option
            cash_options = [o for o in options if o.cash_price]
            if cash_options:
                return min(cash_options, key=lambda o: o.cash_price)
            return options[0] if options else None
        
        # ═══════════════════════════════════════════════════════════════════════
        # BUDGET-TIGHT MODE: Progressively relax constraints to find ANY award
        # ═══════════════════════════════════════════════════════════════════════
        
        # First, analyze all available options
        total_options = len(options)
        award_available_count = sum(1 for o in options if o.award_available and o.award_points)
        affordable_count = sum(1 for o in options if o.award_available and o.award_points and 
                              self._can_afford_points(o.award_program, o.award_points, remaining_points))
        
        logger.info(f"[Greedy] DIAGNOSTIC: {total_options} total options, {award_available_count} with awards, {affordable_count} affordable")
        
        if award_available_count == 0:
            logger.warning(f"[Greedy] ⚠️ NO OPTIONS have award_available=True! Points cannot be used.")
        elif affordable_count == 0:
            # Check WHY awards aren't affordable - is it balance or transfer partner issue?
            user_banks = [k for k in remaining_points.keys()]
            from .config import TRANSFER_GRAPH
            
            # Get all airlines user can book with
            reachable_airlines = set()
            for bank_name, config in TRANSFER_GRAPH.items():
                bank_normalized = bank_name.lower().replace(" ", "_")
                for user_prog in remaining_points.keys():
                    user_prog_normalized = user_prog.lower().replace(" ", "_").replace("-", "_")
                    if (bank_normalized == user_prog_normalized or 
                        bank_normalized.replace("_", "") == user_prog_normalized.replace("_", "") or
                        bank_normalized.split("_")[0] == user_prog_normalized.split("_")[0]):
                        reachable_airlines.update(config.get("airlines", []))
            
            # Check which awards are on unreachable airlines
            unreachable_count = 0
            unreachable_programs = set()
            for o in options:
                if o.award_available and o.award_points:
                    prog_upper = o.award_program.upper() if o.award_program else ""
                    # Extract airline code (first 2 chars if longer name)
                    airline_code = prog_upper[:2] if len(prog_upper) >= 2 else prog_upper
                    if airline_code not in reachable_airlines and prog_upper not in reachable_airlines:
                        unreachable_count += 1
                        unreachable_programs.add(o.award_program)
            
            if unreachable_count > 0 and unreachable_count == award_available_count:
                logger.warning(
                    f"[Greedy] ⚠️ {award_available_count} awards available but ALL are on airlines your points "
                    f"CANNOT transfer to! Your banks: {user_banks}, reachable airlines: {reachable_airlines}, "
                    f"award programs: {unreachable_programs}"
                )
                logger.warning(
                    f"[Greedy] 💡 TIP: Awards exist on {unreachable_programs} but your {user_banks} points "
                    f"cannot transfer to these programs. Consider adding Chase UR or other bank points."
                )
            else:
                logger.warning(f"[Greedy] ⚠️ {award_available_count} awards available but NONE are affordable with remaining points: {remaining_points}")
                # Log what awards exist but can't afford
                for o in options:
                    if o.award_available and o.award_points:
                        logger.info(f"[Greedy]   - {o.award_program}: needs {o.award_points:,} pts")
        
        # PASS 1: Relaxed thresholds (CPP >= 0.1, surcharge <= 80%)
        logger.info("[Greedy] Budget tight - trying relaxed thresholds (CPP >= 0.1, surcharge <= 80%)")
        for option in options:
            if option.award_available and option.award_points:
                if option.cash_price and option.award_surcharge:
                    surcharge_ratio = option.award_surcharge / option.cash_price
                    if surcharge_ratio > 0.80:
                        continue
                if option.cpp and option.cpp < 0.1:
                    continue
                if self._can_afford_points(option.award_program, option.award_points, remaining_points):
                    logger.info(f"[Greedy] PASS 1: Found award with relaxed thresholds: {option.award_points:,} pts + ${option.award_surcharge or 0:.0f}")
                    return option
        
        # PASS 2: Very relaxed (any positive CPP, surcharge <= 95%)
        logger.info("[Greedy] No awards in pass 1 - trying very relaxed (CPP > 0, surcharge <= 95%)")
        for option in options:
            if option.award_available and option.award_points:
                if option.cash_price and option.award_surcharge:
                    surcharge_ratio = option.award_surcharge / option.cash_price
                    if surcharge_ratio > 0.95:
                        continue
                # Accept any positive CPP (or no CPP data)
                if option.cpp and option.cpp <= 0:
                    continue
                if self._can_afford_points(option.award_program, option.award_points, remaining_points):
                    logger.info(f"[Greedy] PASS 2: Found award with very relaxed thresholds: {option.award_points:,} pts + ${option.award_surcharge or 0:.0f}")
                    return option
        
        # PASS 3: NO RESTRICTIONS - any award we can afford (last resort before cash)
        logger.info("[Greedy] No awards in pass 2 - trying ANY award we can afford (no restrictions)")
        for option in options:
            if option.award_available and option.award_points:
                if self._can_afford_points(option.award_program, option.award_points, remaining_points):
                    surcharge = option.award_surcharge or 0
                    logger.info(f"[Greedy] PASS 3: Found award with NO restrictions: {option.award_points:,} pts + ${surcharge:.0f}")
                    return option
        
        # FINAL FALLBACK: No awards available at all, must use cash
        logger.warning(
            f"[Greedy] ⚠️ NO VIABLE AWARDS after all passes. "
            f"Stats: {award_available_count}/{total_options} had awards, {affordable_count} affordable. "
            f"Falling back to cash."
        )
        
        # Log why awards failed
        if award_available_count > 0 and affordable_count == 0:
            # This means awards exist but user can't use them (transfer partner issue or insufficient balance)
            logger.warning(
                "[Greedy] Awards exist but none are usable - likely due to transfer partner incompatibility. "
                "User's points cannot transfer to the airlines with award availability on this route."
            )
        elif award_available_count > 0 and affordable_count > 0:
            logger.warning("[Greedy] Awards were available and affordable but failed CPP/surcharge checks even with no restrictions - this is unexpected!")
        
        # Find the CHEAPEST cash option (not just the first one)
        cash_options = [o for o in options if o.cash_price]
        if cash_options:
            cheapest = min(cash_options, key=lambda o: o.cash_price)
            logger.info(f"[Greedy] Using cash: ${cheapest.cash_price:.0f} (cheapest of {len(cash_options)} cash options, no awards available)")
            return cheapest
        
        return options[0] if options else None
    
    # Fixed-value bank programs that cannot be used for airline award bookings
    _FIXED_VALUE_BANK_KEYWORDS = frozenset([
        "bank of america", "bank_of_america", "boa", "bofa",
        "wells fargo", "wells_fargo",
        "discover", "discover miles", "discover_miles",
        "us bank", "us_bank", "usbank",
    ])
    
    def _is_fixed_value_bank(self, program: str) -> bool:
        """Check if program is a fixed-value bank (no airline transfer partners)."""
        if not program:
            return False
        lower = program.lower().replace("-", "_").replace(" ", "_")
        return any(kw.replace(" ", "_") in lower for kw in self._FIXED_VALUE_BANK_KEYWORDS)
    
    def _can_afford_points(self, program: str, points_needed: int, remaining_points: dict) -> bool:
        """
        Check if user can afford points (direct or via transfer).
        
        Handles normalization between different key formats:
        - TRANSFER_GRAPH uses: "Amex MR", "Chase UR", etc.
        - User points might use: "amex_mr", "chase_ur", "amex", "chase", etc.
        """
        # Normalize program name for comparison
        program_upper = program.upper() if program else ""
        
        # Check direct balance (normalize both sides for comparison)
        for user_prog, balance in remaining_points.items():
            # Skip fixed-value bank programs - they can't be used for award bookings
            if self._is_fixed_value_bank(user_prog):
                continue
            user_prog_upper = user_prog.upper().replace("_", " ").replace("-", " ")
            if program_upper == user_prog_upper or program_upper in user_prog_upper:
                if balance >= points_needed:
                    return True
        
        # Check transfer partners (airlines only)
        from .config import TRANSFER_GRAPH
        
        # Build a mapping of normalized bank names to their config
        for bank_name, config in TRANSFER_GRAPH.items():
            if program_upper in [a.upper() for a in config.get("airlines", [])]:
                ratio = config["ratios"].get(program, config["ratios"].get(program_upper, 1.0))
                needed_from_bank = int(points_needed / ratio)
                
                # Check if user has this bank - normalize the comparison
                bank_normalized = bank_name.lower().replace(" ", "_")
                for user_prog, balance in remaining_points.items():
                    user_prog_normalized = user_prog.lower().replace(" ", "_").replace("-", "_")
                    
                    # Match by normalized key or partial match
                    if (bank_normalized == user_prog_normalized or 
                        bank_normalized.replace("_", "") == user_prog_normalized.replace("_", "") or
                        bank_normalized.split("_")[0] == user_prog_normalized.split("_")[0]):  # e.g., "amex" matches "amex_mr"
                        if balance >= needed_from_bank:
                            logger.info(
                                f"[Greedy] Can afford {program}: {points_needed:,} pts via {bank_name} "
                                f"(user has {balance:,} {user_prog}, need {needed_from_bank:,})"
                            )
                            return True
        
        return False
    
    def _create_flight_segment(self, option, remaining_points: dict, force_points: bool = False) -> tuple:
        """
        Create flight segment with payment decision.
        
        Args:
            option: The flight option to use
            remaining_points: User's remaining points balances
            force_points: If True, use points regardless of CPP threshold (for tight budgets)
        """
        transfer = None
        points_used = 0
        
        # Decide cash vs points
        # When force_points=True, skip CPP threshold check
        if force_points:
            use_points = (
                option.award_available and 
                option.award_points and
                self._can_afford_points(option.award_program, option.award_points, remaining_points)
            )
        else:
            use_points = (
                option.award_available and 
                option.award_points and
                option.cpp and option.cpp >= OOP_CONFIG["min_cpp_threshold"] and
                self._can_afford_points(option.award_program, option.award_points, remaining_points)
            )
        
        if use_points:
            # Find source for points
            source, actual_points = self._deduct_points(
                option.award_program, option.award_points, remaining_points
            )
            
            if source and source != option.award_program:
                # Need transfer
                path = get_transfer_path(source, option.award_program)
                if path:
                    transfer = TransferInstruction(
                        from_program=source,
                        to_program=option.award_program,
                        points_to_transfer=actual_points,
                        ratio=path["ratio"],
                        portal_url=path["portal_url"],
                        transfer_time=path["transfer_time"],
                        steps=[
                            f"Log in to {source} portal",
                            f"Navigate to transfer partners",
                            f"Select {option.award_program}",
                            f"Transfer {actual_points:,} points",
                        ],
                    )
            
            payment = PointsPayment(
                program=option.award_program,
                points_used=option.award_points,
                surcharge=option.award_surcharge or 0,
                cpp_achieved=option.cpp,
                cash_saved=(option.cash_price or 0) - (option.award_surcharge or 0),
                transfer=transfer,
                reason=f"Saves ${(option.cash_price or 0) - (option.award_surcharge or 0):.0f} at {option.cpp or 0:.1f}¢/pt",
            )
            points_used = option.award_points
        else:
            payment = CashPayment(
                amount=option.cash_price or 0,
                reason="Best value for this segment",
            )
        
        segment = FlightSegment(
            id=str(uuid.uuid4()),
            origin=option.origin,
            destination=option.destination,
            departure_time=option.departure_time,
            arrival_time=option.arrival_time,
            duration_minutes=option.duration_minutes,
            airline=option.airline,
            flight_number=option.flight_numbers[0] if option.flight_numbers else None,
            cabin_class=option.cabin_class,
            cash_price=option.cash_price or 0,
            payment=payment,
            booking_url=option.booking_url,
            # Pass through connection details from FlightOption
            stops=option.stops,
            legs=option.segments,
            layovers=[lay.model_dump() for lay in option.layovers] if option.layovers else [],
        )
        
        return segment, points_used, transfer
    
    def _deduct_points(self, program: str, points_needed: int, remaining_points: dict) -> tuple:
        """
        Deduct points from user's balance, return (source, actual_points_deducted).
        
        Handles normalization between different key formats.
        """
        program_upper = program.upper() if program else ""
        
        # Try direct first (normalize both sides)
        for user_prog, balance in list(remaining_points.items()):
            # Skip fixed-value bank programs - they can't be used for award bookings
            if self._is_fixed_value_bank(user_prog):
                continue
            user_prog_upper = user_prog.upper().replace("_", " ").replace("-", " ")
            if program_upper == user_prog_upper or program_upper in user_prog_upper:
                if balance >= points_needed:
                    remaining_points[user_prog] -= points_needed
                    return (user_prog, points_needed)
        
        # Try transfer partners (airlines only)
        from .config import TRANSFER_GRAPH
        for bank_name, config in TRANSFER_GRAPH.items():
            if program_upper in [a.upper() for a in config.get("airlines", [])]:
                ratio = config["ratios"].get(program, config["ratios"].get(program_upper, 1.0))
                needed_from_bank = int(points_needed / ratio)
                
                # Find matching user balance
                bank_normalized = bank_name.lower().replace(" ", "_")
                for user_prog, balance in list(remaining_points.items()):
                    user_prog_normalized = user_prog.lower().replace(" ", "_").replace("-", "_")
                    
                    if (bank_normalized == user_prog_normalized or 
                        bank_normalized.replace("_", "") == user_prog_normalized.replace("_", "") or
                        bank_normalized.split("_")[0] == user_prog_normalized.split("_")[0]):
                        if balance >= needed_from_bank:
                            remaining_points[user_prog] -= needed_from_bank
                            logger.info(
                                f"[Greedy] Deducted {needed_from_bank:,} from {user_prog} for {program} "
                                f"(remaining: {remaining_points[user_prog]:,})"
                            )
                            return (user_prog, needed_from_bank)
        
        return (None, 0)
