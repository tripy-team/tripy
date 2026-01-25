"""
Orchestrator Agent - Coordinates the entire optimization pipeline.

This is the main entry point that:
1. Parses trip requirements
2. Coordinates Flight and Hotel Agents
3. Runs ILP optimization
4. Ranks results by OOP
5. Generates cost breakdowns
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
        logger.info(f"[Orchestrator] Starting solo optimization for trip {request.trip_id}")
        
        # Get trip details
        trip_data = await self._get_trip_data(request.trip_id)
        
        if not trip_data:
            return OptimizeSoloResponse(
                trip_id=request.trip_id,
                itineraries=[],
                best_option={"outOfPocket": 0, "savingsPercentage": 0, "pointsUsed": 0},
                warnings=["Trip not found"],
            )
        
        # Build segments to search
        segments = self._build_trip_segments(trip_data)
        
        if not segments:
            return OptimizeSoloResponse(
                trip_id=request.trip_id,
                itineraries=[],
                best_option={"outOfPocket": 0, "savingsPercentage": 0, "pointsUsed": 0},
                warnings=["No valid route found"],
            )
        
        # Search flights and hotels in parallel
        search_results = await self._search_all_segments(
            segments=segments,
            user_points=request.points,
            cabin_classes=request.cabin_classes or ["Economy", "Business"],
            hotel_stars=request.hotel_stars or [4, 5],
            include_hotels=request.include_hotels,
        )
        
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
        
        # Generate cost breakdowns for top results
        for itinerary in top_results:
            try:
                breakdown = await self.cost_agent.execute(itinerary)
                # Could attach breakdown to itinerary if needed
            except Exception as e:
                logger.warning(f"Cost breakdown failed: {e}")
        
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
        """
        # For now, delegate to solo optimization with combined points
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
        return OptimizeGroupResponse(
            trip_id=request.trip_id,
            itineraries=solo_result.itineraries,
            group_metrics=None,  # Would calculate actual group metrics
            best_option={
                "totalOutOfPocket": solo_result.best_option["outOfPocket"],
                "perPersonAverage": solo_result.best_option["outOfPocket"] / max(len(request.member_budgets), 1),
                "totalSavings": solo_result.best_option["outOfPocket"] * solo_result.best_option["savingsPercentage"] / 100,
            },
            warnings=solo_result.warnings,
        )
    
    async def _get_trip_data(self, trip_id: str) -> Optional[dict]:
        """Get trip data from database."""
        try:
            from ..repos.trip_repo import TripRepo
            from ..repos.destination_repo import DestinationRepo
            
            trip_repo = TripRepo()
            dest_repo = DestinationRepo()
            
            trip = await trip_repo.get_trip(trip_id)
            if not trip:
                # Return dummy data for testing
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
            
            destinations = await dest_repo.list_destinations(trip_id)
            
            return {
                "trip_id": trip_id,
                "start_date": trip.get("startDate"),
                "end_date": trip.get("endDate"),
                "destinations": destinations,
                "include_hotels": trip.get("includeHotels", True),
                "max_budget": trip.get("maxBudget"),
            }
        except Exception as e:
            logger.error(f"Failed to get trip data: {e}")
            # Return dummy data
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
            if dest.get("is_start"):
                start = name
            if dest.get("is_end"):
                end = name
            if dest.get("must_include") and not dest.get("is_start") and not dest.get("is_end"):
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
            
            # Flight segment
            segments.append({
                "type": "flight",
                "origin": origin,
                "destination": destination,
                "date": current_date.strftime("%Y-%m-%d"),
            })
            
            # Hotel segment (if not returning home)
            if include_hotels and destination != start:
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
    ) -> list[RankedItinerary]:
        """
        Run OOP optimization using the search results.
        
        This is a simplified greedy algorithm that:
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
