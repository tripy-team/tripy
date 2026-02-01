"""
Orchestrator Agent - Coordinates the entire optimization pipeline.

This is the main entry point that:
1. Parses trip requirements
2. Coordinates Flight and Hotel Agents
3. Runs ILP optimization (V3 solver)
4. Ranks results by OOP
5. Generates cost breakdowns

NOTE: Updated to use V3 optimization solver for improved:
- Three optimization modes (OOP, CPP, Balanced)
- Hotel + flight joint optimization
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
    FlightSearchRequest, HotelSearchRequest,
    FlightSegment, HotelSegment,
    CashPayment, PointsPayment, TransferInstruction,
    GroupMemberCost, Settlement,
)
from .flight_agent import FlightAgent
from .hotel_agent import HotelAgent
from .cost_breakdown_agent import CostBreakdownAgent
from .config import (
    DEFAULT_OPTIMIZATION_MODE, OOP_CONFIG, 
    get_transfer_path, AIRLINE_PROGRAMS, HOTEL_PROGRAMS
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
        self.hotel_agent = HotelAgent()
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
        Optimize a solo trip.
        
        1. Fetch trip details from database
        2. Search flights and hotels via agents
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
        
        # Build segments to search
        segments = self._build_trip_segments(trip_data)
        print(f"[Orchestrator] Built {len(segments) if segments else 0} segments to search")
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
        
        # Search flights and hotels in parallel
        print(f"[Orchestrator] Starting search for {len(segments)} segments...")
        search_results = await self._search_all_segments(
            segments=segments,
            user_points=request.points,
            cabin_classes=request.cabin_classes or ["Economy", "Business"],
            hotel_stars=request.hotel_stars or [4, 5],
            include_hotels=request.include_hotels,
        )
        print(f"[Orchestrator] Search completed, got {len(search_results) if search_results else 0} results")
        
        # Run OOP optimization
        optimized = await self._run_oop_optimization(
            segments=segments,
            search_results=search_results,
            user_points=request.points,
            budget=request.budget,
            trip_data=trip_data,
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
        
        return OptimizeSoloResponse(
            trip_id=request.trip_id,
            itineraries=top_results,
            best_option={
                "outOfPocket": best.oop_metrics.total_out_of_pocket if best else 0,
                "savingsPercentage": best.oop_metrics.savings_percentage if best else 0,
                "pointsUsed": best.oop_metrics.total_points_used if best else 0,
            },
            warnings=[],
        )
    
    async def optimize_group(
        self,
        request: OptimizeGroupRequest,
    ) -> OptimizeGroupResponse:
        """
        Optimize a group trip with cost splitting.
        
        IMPORTANT: Points are NOT poolable across members!
        Each member can only use their OWN points for segments they book.
        """
        # TODO: CRITICAL FIX NEEDED - Points should NOT be pooled!
        # 
        # ❌ CURRENT (WRONG): Pools all points together as if they're fungible
        #    combined_points = alice.points + bob.points  # This is unrealistic!
        #
        # ✅ CORRECT APPROACH: Use GroupBookingAllocator to:
        #    1. Assign each segment to a specific member
        #    2. Each member uses THEIR OWN points for segments they book
        #    3. Settlement calculation handles who owes whom
        #
        # See REMAINING_IMPLEMENTATION_PLAN.md Section 1: Group Booking Allocation
        # for the correct implementation using per-member constraints.
        #
        # Example of why current approach is wrong:
        #   Alice has 100k Chase UR, Bob has 100k Chase UR
        #   Flight costs 150k Chase UR
        #   Current code: "Group has 200k, can book with combined points" - WRONG!
        #   Reality: Neither Alice nor Bob can book this flight alone with points
        
        logger.warning(
            "GROUP OPTIMIZATION: Using temporary pooled approach. "
            "This incorrectly assumes points can be combined across members. "
            "See REMAINING_IMPLEMENTATION_PLAN.md for correct implementation."
        )
        
        # TEMPORARY: Delegate to solo optimization with combined points
        # This gives an overly optimistic result since it assumes point fungibility
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
            hotel_stars=request.hotel_stars,
            include_hotels=request.include_hotels,
        )
        
        solo_result = await self.optimize_solo(solo_request)
        
        # Convert to group response with cost splitting
        # WARNING: This doesn't properly account for who books what
        return OptimizeGroupResponse(
            trip_id=request.trip_id,
            itineraries=solo_result.itineraries,
            group_metrics=None,  # TODO: Calculate per-member metrics with booking assignments
            best_option={
                "totalOutOfPocket": solo_result.best_option["outOfPocket"],
                "perPersonAverage": solo_result.best_option["outOfPocket"] / max(len(request.member_budgets), 1),
                "totalSavings": solo_result.best_option["outOfPocket"] * solo_result.best_option["savingsPercentage"] / 100,
            },
            warnings=[
                "⚠️ Group optimization currently uses a simplified model. "
                "Actual booking requires assigning segments to specific members."
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
        
        # 3. Search for flight/hotel options for each segment
        segment_options = await self._search_segment_options(
            segments=segments,
            cabin_classes=request.cabin_classes or ["Economy", "Business"],
            hotel_stars=request.hotel_stars or [4, 5],
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
        include_hotels = trip_data.get("include_hotels", True)
        
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
            # Flight to this destination
            segments.append({
                "id": f"flight_{i}_to_{city}",
                "type": "flight",
                "origin": prev_city,
                "destination": city,
                "date": current_date.strftime("%Y-%m-%d"),
            })
            
            # Hotel at this destination
            if include_hotels:
                check_out = current_date + timedelta(days=days_per_city)
                segments.append({
                    "id": f"hotel_{i}_{city}",
                    "type": "hotel",
                    "city": city,
                    "check_in": current_date.strftime("%Y-%m-%d"),
                    "check_out": check_out.strftime("%Y-%m-%d"),
                })
                current_date = check_out
            else:
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
        hotel_stars: list[int],
    ) -> list[list[SegmentOption]]:
        """Search for booking options for each segment."""
        all_options = []
        
        for segment in segments:
            if segment["type"] == "flight":
                options = await self._search_flight_options(
                    origin=segment["origin"],
                    destination=segment["destination"],
                    date=segment["date"],
                    cabin_classes=cabin_classes,
                )
            else:
                options = await self._search_hotel_options(
                    city=segment["city"],
                    check_in=segment["check_in"],
                    check_out=segment["check_out"],
                    star_ratings=hotel_stars,
                )
            
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
    
    async def _search_hotel_options(
        self,
        city: str,
        check_in: str,
        check_out: str,
        star_ratings: list[int],
    ) -> list[dict]:
        """Search hotel options using HotelAgent."""
        try:
            request = HotelSearchRequest(
                city=city,
                check_in=check_in,
                check_out=check_out,
                star_ratings=star_ratings,
            )
            result = await self.hotel_agent.execute(request)
            
            # CRITICAL FIX: HotelSearchResult has 'options', not 'hotels'
            # Also: HotelOption has 'award_points_total', not 'award_points'
            options = []
            for hotel in result.options[:5]:  # Limit to top 5
                options.append({
                    "cash_price": hotel.cash_price_total,
                    "cash_price_per_night": hotel.cash_price_per_night,
                    "award_available": hotel.award_available and hotel.award_points_total is not None,
                    "award_program": hotel.award_program if hotel.award_points_total else None,
                    "award_points": hotel.award_points_total,
                    "award_points_per_night": hotel.award_points_per_night,
                    "award_surcharge": hotel.award_surcharge or 0,
                    "summary": f"{hotel.name} in {city}",
                    # Pass through additional fields
                    "name": hotel.name,
                    "brand": hotel.brand,
                    "star_rating": hotel.star_rating,
                    "nights": hotel.nights,
                })
            
            logger.info(f"[Orchestrator] _search_hotel_options: {city} returned {len(options)} options")
            return options
        except Exception as e:
            logger.warning(f"Hotel search failed: {e}")
            return self._get_dummy_hotel_options(city)
    
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
    
    def _get_dummy_hotel_options(self, city: str) -> list[dict]:
        """Get dummy hotel options when search fails.
        
        NOTE: Uses HYATT (Chase transfer), HH (AMEX transfer), and MAR (AMEX/Chase transfer)
        to work with transferable points.
        """
        return [
            {
                "cash_price": 250.0,
                "award_available": True,
                "award_program": "HYATT",  # Chase transfer partner (best CPP typically)
                "award_points": 15000,
                "award_surcharge": 0,
                "summary": f"Hyatt in {city}",
            },
            {
                "cash_price": 200.0,
                "award_available": True,
                "award_program": "HH",  # Hilton - AMEX transfer partner
                "award_points": 50000,
                "award_surcharge": 0,
                "summary": f"Hilton in {city}",
            },
            {
                "cash_price": 220.0,
                "award_available": True,
                "award_program": "MAR",  # Marriott - AMEX/Chase/Bilt partner
                "award_points": 30000,
                "award_surcharge": 0,
                "summary": f"Marriott in {city}",
            },
            {
                "cash_price": 150.0,
                "award_available": False,
                "summary": f"Budget hotel in {city}",
            },
        ]
    
    def _build_option_summary(self, segment: dict, option: dict) -> str:
        """Build a summary string for an option."""
        if segment["type"] == "flight":
            return f"{segment['origin']}→{segment['destination']}"
        else:
            return f"Hotel in {segment['city']}"
    
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
                    
                    # Add origin as start point
                    if origin:
                        destinations.append({
                            "name": origin,
                            "isStart": True,
                            "isEnd": origin == final_destination,
                        })
                    
                    # Add intermediate destinations
                    for dest in raw_destinations:
                        # Extract airport code from format like "Paris (CDG,ORY,BVA)"
                        airport_code = dest
                        if "(" in dest and ")" in dest:
                            codes = dest.split("(")[1].split(")")[0]
                            airport_code = codes.split(",")[0].strip()  # Use first code
                        
                        destinations.append({
                            "name": airport_code,
                            "mustInclude": True,
                        })
                    
                    # Add final destination if different from origin
                    if final_destination and final_destination != origin:
                        destinations.append({
                            "name": final_destination,
                            "isEnd": True,
                        })
                    
                    logger.info(f"[Orchestrator] Solo trip loaded: origin={origin}, destinations={raw_destinations}, final={final_destination}")
                    logger.info(f"[Orchestrator] Parsed destinations: {destinations}")
                    
                    return {
                        "trip_id": trip_id,
                        "start_date": trip.get("startDate"),
                        "end_date": trip.get("endDate"),
                        "destinations": destinations,
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
            "include_hotels": True,
        }
    
    def _build_trip_segments(self, trip_data: dict) -> list[dict]:
        """Build list of segments to search."""
        destinations = trip_data.get("destinations", [])
        start_date = trip_data.get("start_date", "2026-03-01")
        end_date = trip_data.get("end_date", "2026-03-08")
        include_hotels = trip_data.get("include_hotels", True)
        
        # Find start and end points
        start = None
        end = None
        intermediate = []
        
        for dest in destinations:
            name = dest.get("name", "")
            # Support both camelCase (from DB) and snake_case (from test data)
            is_start = dest.get("isStart") or dest.get("is_start")
            is_end = dest.get("isEnd") or dest.get("is_end")
            must_include = dest.get("mustInclude") or dest.get("must_include")
            
            if is_start:
                start = name
            if is_end:
                end = name
            if must_include and not is_start and not is_end:
                intermediate.append(name)
        
        # Default to first destination as both start and end if not specified
        if not start and destinations:
            start = destinations[0].get("name", "JFK")
        if not end:
            end = start
        
        if not start:
            return []
        
        # Build route
        route = [start] + intermediate + ([end] if end != start else [start])
        
        # Build segments
        segments = []
        from datetime import datetime, timedelta
        
        try:
            current_date = datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date, "%Y-%m-%d")
            total_days = (end_dt - current_date).days
            days_per_city = max(1, total_days // max(len(route) - 1, 1))
        except:
            current_date = datetime.now()
            days_per_city = 3
        
        for i in range(len(route) - 1):
            origin = route[i]
            destination = route[i + 1]
            is_return_leg = (i == len(route) - 2 and destination == start)
            
            # Flight segment
            # For return leg, use end_date instead of calculated date
            flight_date = end_dt.strftime("%Y-%m-%d") if is_return_leg else current_date.strftime("%Y-%m-%d")
            segments.append({
                "type": "flight",
                "origin": origin,
                "destination": destination,
                "date": flight_date,
            })
            
            # Hotel segment (if not returning home)
            if include_hotels and destination != start:
                # For the last destination before returning home, check_out should be end_date
                is_last_stop = (i == len(route) - 3) or (len(route) == 3 and i == 0)
                if is_last_stop:
                    check_out = end_dt
                else:
                    check_out = current_date + timedelta(days=days_per_city)
                segments.append({
                    "type": "hotel",
                    "city": destination,
                    "check_in": current_date.strftime("%Y-%m-%d"),
                    "check_out": check_out.strftime("%Y-%m-%d"),
                })
                current_date = check_out
            else:
                current_date += timedelta(days=days_per_city)
        
        return segments
    
    async def _search_all_segments(
        self,
        segments: list[dict],
        user_points: dict,
        cabin_classes: list[str],
        hotel_stars: list[int],
        include_hotels: bool,
    ) -> dict:
        """Search flights and hotels for all segments in parallel."""
        tasks = []
        segment_keys = []
        
        for i, segment in enumerate(segments):
            if segment["type"] == "flight":
                tasks.append(self.flight_agent.execute(FlightSearchRequest(
                    origin=segment["origin"],
                    destination=segment["destination"],
                    date=segment["date"],
                    cabin_classes=cabin_classes,
                    user_points=user_points,
                )))
                segment_keys.append(f"flight_{i}")
            elif segment["type"] == "hotel" and include_hotels:
                tasks.append(self.hotel_agent.execute(HotelSearchRequest(
                    city=segment["city"],
                    check_in=segment["check_in"],
                    check_out=segment["check_out"],
                    star_ratings=hotel_stars,
                    user_points=user_points,
                )))
                segment_keys.append(f"hotel_{i}")
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        search_results = {}
        for key, result in zip(segment_keys, results):
            if isinstance(result, Exception):
                logger.error(f"Search failed for {key}: {result}")
                search_results[key] = None
            else:
                search_results[key] = result
        
        return search_results
    
    async def _run_oop_optimization(
        self,
        segments: list[dict],
        search_results: dict,
        user_points: dict,
        budget: float,
        trip_data: dict,
        mode: str = "oop",
    ) -> list[RankedItinerary]:
        """
        Run optimization using V3 ILP solver.
        
        V3 improvements:
        - Joint flight + hotel optimization
        - Three modes: OOP, CPP, Balanced
        - Integer-safe transfers
        - Single-ticket enforcement for connections
        - Proper group room allocation
        
        Falls back to greedy algorithm if V3 fails.
        """
        
        logger.info(f"[Orchestrator] Running V3 optimization (mode={mode})")
        
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
            )
            
            if itineraries:
                logger.info(f"[Orchestrator] V3 solver returned {len(itineraries)} itineraries")
                return itineraries
            else:
                logger.warning("[Orchestrator] V3 solver returned no itineraries, falling back to greedy")
        
        except Exception as e:
            logger.error(f"[Orchestrator] V3 solver failed: {e}, falling back to greedy")
        
        # Fallback to original greedy algorithm
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
        budget: float,
        trip_data: dict,
    ) -> list[RankedItinerary]:
        """
        Fallback greedy optimization algorithm.
        
        This is the original algorithm that:
        1. For each segment, picks the option with lowest OOP
        2. Respects points balance constraints
        3. Generates transfer instructions
        """
        # Track remaining points
        remaining_points = dict(user_points)
        
        # Build itinerary
        itinerary_segments = []
        total_cash_price = 0.0
        total_oop = 0.0
        total_points_used = 0
        points_breakdown = {}
        transfers = []
        route = []
        
        for i, segment in enumerate(segments):
            if segment["type"] == "flight":
                key = f"flight_{i}"
                result = search_results.get(key)
                
                if not result or not result.options:
                    continue
                
                # Pick best option (already sorted by OOP)
                best = self._pick_best_flight_option(result.options, remaining_points)
                
                if best:
                    seg, points_used, transfer = self._create_flight_segment(
                        best, remaining_points
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
            
            elif segment["type"] == "hotel":
                key = f"hotel_{i}"
                result = search_results.get(key)
                
                if not result or not result.options:
                    continue
                
                best = self._pick_best_hotel_option(result.options, remaining_points)
                
                if best:
                    seg, points_used, transfer = self._create_hotel_segment(
                        best, remaining_points
                    )
                    itinerary_segments.append(seg)
                    
                    total_cash_price += best.cash_price_total or 0
                    
                    if seg.payment.method == "cash":
                        total_oop += seg.payment.amount
                    else:
                        total_oop += seg.payment.surcharge
                        total_points_used += seg.payment.points_used
                        prog = seg.payment.program
                        points_breakdown[prog] = points_breakdown.get(prog, 0) + seg.payment.points_used
                        if transfer:
                            transfers.append(transfer)
        
        if not itinerary_segments:
            return []
        
        # Calculate metrics
        cash_saved = total_cash_price - total_oop
        savings_pct = (cash_saved / total_cash_price * 100) if total_cash_price > 0 else 0
        
        # Calculate average CPP
        cpp_values = []
        for seg in itinerary_segments:
            if seg.payment.method == "points" and seg.payment.cpp_achieved:
                cpp_values.append(seg.payment.cpp_achieved)
        avg_cpp = sum(cpp_values) / len(cpp_values) if cpp_values else 0
        
        itinerary = RankedItinerary(
            id=str(uuid.uuid4()),
            rank=1,
            name="Optimized Itinerary",
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
            within_budget=total_oop <= budget,
            within_points=True,  # We already respected limits
            summary=f"Save ${cash_saved:.0f} ({savings_pct:.0f}% off) by using {total_points_used:,} points",
        )
        
        return [itinerary]
    
    def _pick_best_flight_option(self, options: list, remaining_points: dict):
        """Pick the best flight option considering OOP."""
        config = OOP_CONFIG
        min_cpp = config["min_cpp_threshold"]
        max_surcharge_ratio = config["max_surcharge_ratio"]
        
        for option in options:
            # Check if award is viable
            if option.award_available and option.award_points:
                # Check surcharge ratio
                if option.cash_price and option.award_surcharge:
                    surcharge_ratio = option.award_surcharge / option.cash_price
                    if surcharge_ratio > max_surcharge_ratio:
                        continue
                
                # Check CPP threshold
                if option.cpp and option.cpp < min_cpp:
                    continue
                
                # Check if we have enough points (direct or via transfer)
                if self._can_afford_points(option.award_program, option.award_points, remaining_points):
                    return option
            
            # Fall back to cash option
            if option.cash_price and not option.award_available:
                return option
        
        # Return first cash option
        for option in options:
            if option.cash_price:
                return option
        
        return options[0] if options else None
    
    def _pick_best_hotel_option(self, options: list, remaining_points: dict):
        """Pick the best hotel option considering OOP."""
        config = OOP_CONFIG
        min_cpp = config["min_cpp_threshold"]
        
        for option in options:
            if option.award_available and option.award_points_total:
                if option.cpp and option.cpp < min_cpp:
                    continue
                
                if self._can_afford_points(option.award_program, option.award_points_total, remaining_points):
                    return option
            
            if option.cash_price_total and not option.award_available:
                return option
        
        for option in options:
            if option.cash_price_total:
                return option
        
        return options[0] if options else None
    
    def _can_afford_points(self, program: str, points_needed: int, remaining_points: dict) -> bool:
        """Check if user can afford points (direct or via transfer)."""
        # Check direct balance
        if program in remaining_points and remaining_points[program] >= points_needed:
            return True
        
        # Check transfer partners
        from .config import TRANSFER_GRAPH
        for bank, config in TRANSFER_GRAPH.items():
            if program in config.get("airlines", []) + config.get("hotels", []):
                ratio = config["ratios"].get(program, 1.0)
                needed_from_bank = int(points_needed / ratio)
                if bank in remaining_points and remaining_points[bank] >= needed_from_bank:
                    return True
        
        return False
    
    def _create_flight_segment(self, option, remaining_points: dict) -> tuple:
        """Create flight segment with payment decision."""
        transfer = None
        points_used = 0
        
        # Decide cash vs points
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
                reason=f"Saves ${(option.cash_price or 0) - (option.award_surcharge or 0):.0f} at {option.cpp:.1f}¢/pt",
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
        )
        
        return segment, points_used, transfer
    
    def _create_hotel_segment(self, option, remaining_points: dict) -> tuple:
        """Create hotel segment with payment decision."""
        transfer = None
        points_used = 0
        
        use_points = (
            option.award_available and
            option.award_points_total and
            option.cpp and option.cpp >= OOP_CONFIG["min_cpp_threshold"] and
            self._can_afford_points(option.award_program, option.award_points_total, remaining_points)
        )
        
        if use_points:
            source, actual_points = self._deduct_points(
                option.award_program, option.award_points_total, remaining_points
            )
            
            if source and source != option.award_program:
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
                points_used=option.award_points_total,
                surcharge=option.award_surcharge or 0,
                cpp_achieved=option.cpp,
                cash_saved=(option.cash_price_total or 0) - (option.award_surcharge or 0),
                transfer=transfer,
            )
            points_used = option.award_points_total
        else:
            payment = CashPayment(
                amount=option.cash_price_total or 0,
            )
        
        segment = HotelSegment(
            id=str(uuid.uuid4()),
            name=option.name,
            brand=option.brand,
            star_rating=option.star_rating,
            city=option.city,
            check_in=option.check_in,
            check_out=option.check_out,
            nights=option.nights,
            cash_price_per_night=option.cash_price_per_night or 0,
            cash_price_total=option.cash_price_total or 0,
            payment=payment,
            booking_url=option.booking_url,
        )
        
        return segment, points_used, transfer
    
    def _deduct_points(self, program: str, points_needed: int, remaining_points: dict) -> tuple:
        """Deduct points from user's balance, return (source, actual_points_deducted)."""
        # Try direct first
        if program in remaining_points and remaining_points[program] >= points_needed:
            remaining_points[program] -= points_needed
            return (program, points_needed)
        
        # Try transfer partners
        from .config import TRANSFER_GRAPH
        for bank, config in TRANSFER_GRAPH.items():
            if program in config.get("airlines", []) + config.get("hotels", []):
                ratio = config["ratios"].get(program, 1.0)
                needed_from_bank = int(points_needed / ratio)
                if bank in remaining_points and remaining_points[bank] >= needed_from_bank:
                    remaining_points[bank] -= needed_from_bank
                    return (bank, needed_from_bank)
        
        return (None, 0)
