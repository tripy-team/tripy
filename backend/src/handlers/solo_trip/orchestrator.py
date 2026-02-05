"""
Solo Trip Orchestrator

Main entry point for the solo trip algorithm.
Coordinates all components to generate optimized itineraries.
NO FALLBACKS - explicit errors only.
"""

import asyncio
import logging
from datetime import datetime, date
from typing import Dict, Any, List, Optional, Tuple

from .models import (
    TripInput,
    RouteGraph,
    Itinerary,
    FlightSegment,
    TransferPlan,
    PointsTransfer,
    OptimizationResult,
    CabinClass,
)
from .validator import StrictTripInputValidator, ValidationResult
from .connection_validator import ConnectionValidator
from .flight_searcher import ComprehensiveFlightSearcher
from .route_graph_builder import RouteGraphBuilder
from .booking_instructions import BookingInstructionGenerator, BookingInstructions
from .errors import (
    SoloTripError,
    ValidationError,
    NoFlightsFoundError,
    NoValidRouteError,
    BudgetExceededError,
    OptimizationFailedError,
    MissingFlightDataError,
)

logger = logging.getLogger(__name__)


class SoloTripOrchestrator:
    """
    Main orchestrator for the solo trip algorithm.
    Coordinates validation, flight search, optimization, and result generation.
    
    NO FALLBACKS - all errors are explicit and actionable.
    """
    
    def __init__(self):
        self.validator = StrictTripInputValidator()
        self.connection_validator = ConnectionValidator()
        self.flight_searcher = ComprehensiveFlightSearcher(
            connection_validator=self.connection_validator
        )
        self.graph_builder = RouteGraphBuilder(
            connection_validator=self.connection_validator,
            flight_searcher=self.flight_searcher
        )
        self.booking_generator = BookingInstructionGenerator()
    
    async def generate_itinerary(
        self,
        trip_data: Dict[str, Any],
        user_points: Optional[Dict[str, int]] = None,
        transfer_graph: Optional[Dict[str, Dict[str, float]]] = None,
    ) -> Dict[str, Any]:
        """
        Main entry point for generating an optimized itinerary.
        
        Args:
            trip_data: Raw trip data dictionary
            user_points: User's points balances
            transfer_graph: Transfer graph for points
        
        Returns:
            Dictionary with itinerary data and status
        
        Raises:
            SoloTripError: If any step fails (no fallbacks)
        """
        
        # Phase 1: Validate input
        logger.info("Phase 1: Validating input...")
        validation = self.validator.validate(trip_data)
        
        if not validation.valid:
            # Return validation errors - NOT a fallback, explicit failure
            logger.warning(f"Validation failed: {validation.errors}")
            raise validation.errors[0] if validation.errors else ValidationError(
                field="unknown",
                message="Validation failed",
                code="VALIDATION_FAILED"
            )
        
        # Build validated trip input
        trip_input = self.validator.build_trip_input(trip_data)
        
        # Phase 2: Search for flights
        logger.info("Phase 2: Searching for flights...")
        try:
            graph = await self.graph_builder.build(trip_input)
        except MissingFlightDataError as e:
            logger.warning(f"Missing flight data: {e}")
            raise
        except Exception as e:
            logger.error(f"Flight search failed: {e}")
            raise NoFlightsFoundError(
                message=f"Failed to search for flights: {str(e)}",
                origin=trip_input.start_destination,
                destination=trip_input.end_destination,
                date=str(trip_input.start_date or ""),
                strategies_tried=["award_first", "serp_first", "serp_only"]
            )
        
        # Phase 3: Run optimization
        logger.info("Phase 3: Running optimization...")
        try:
            optimization_result = await self._run_optimization(
                graph=graph,
                trip_input=trip_input,
                user_points=user_points or trip_input.points_balances,
                transfer_graph=transfer_graph,
            )
        except Exception as e:
            logger.error(f"Optimization failed: {e}")
            raise OptimizationFailedError(
                message=f"Failed to optimize itinerary: {str(e)}",
                status="error"
            )
        
        # Phase 4: Process results
        logger.info("Phase 4: Processing results...")
        
        # Check budget status
        if not optimization_result.within_budget and trip_input.max_budget:
            logger.info(
                f"Budget exceeded: minimum ${optimization_result.total_oop:.2f} "
                f"vs budget ${trip_input.max_budget:.2f}"
            )
            # NOT a failure - we still return the real itinerary
            # but with clear indication that budget was exceeded
        
        # Generate booking instructions
        booking_instructions = None
        if optimization_result.itinerary:
            booking_instructions = self.booking_generator.generate(
                optimization_result.itinerary
            )
        
        # Build response
        return {
            "success": optimization_result.success,
            "status": "optimal" if optimization_result.within_budget else "budget_exceeded",
            "itinerary": optimization_result.itinerary.to_dict() if optimization_result.itinerary else None,
            "optimization_result": optimization_result.to_dict(),
            "booking_instructions": booking_instructions.to_dict() if booking_instructions else None,
            "budget_status": {
                "within_budget": optimization_result.within_budget,
                "user_budget": optimization_result.user_budget,
                "minimum_cost": optimization_result.total_oop,
                "exceeded_by": optimization_result.budget_exceeded_by,
            },
            "warnings": validation.warnings,
            "generated_at": datetime.utcnow().isoformat(),
        }
    
    async def _run_optimization(
        self,
        graph: RouteGraph,
        trip_input: TripInput,
        user_points: Dict[str, int],
        transfer_graph: Optional[Dict[str, Dict[str, float]]] = None,
    ) -> OptimizationResult:
        """
        Run ILP optimization on the route graph.
        
        Note: Flight prices in edges_dict are PER PERSON. We scale the budget
        to per-person for ILP comparison, then scale final costs back to party total.
        """
        # Import ILP functions
        from src.handlers.ilp_adapter import run_ilp_from_edges
        from src.handlers.planTrip import plan_non_pooled_multi_itineraries_with_native
        from src.utils.award_programs import DEFAULT_TRANSFER_GRAPH
        
        # Use default transfer graph if not provided
        if transfer_graph is None:
            transfer_graph = DEFAULT_TRANSFER_GRAPH
        
        # Convert graph to edges dict
        edges_dict = graph.to_edges_dict()
        
        # Party size for cost scaling
        party_size = trip_input.party_size
        logger.info(f"Party size: {party_size} (adults={trip_input.num_adults}, children={trip_input.num_children})")
        
        # Build traveler data (solo trip = single traveler, but party_size may be > 1)
        traveler_id = trip_input.trip_id or "traveler_1"
        travelers = [traveler_id]
        
        start_city_by_trav = {traveler_id: trip_input.start_destination}
        end_city_by_trav = {traveler_id: trip_input.end_destination}
        user_points_by_trav = {traveler_id: user_points}
        
        # Get must-visit cities
        must_visit = [
            d.airport_code for d in trip_input.destinations
            if d.must_include and not d.excluded
        ]
        
        # Budget is for the entire party, but flight prices are per-person
        # Divide budget by party_size for ILP comparison
        if trip_input.max_budget:
            budget_for_ilp = trip_input.max_budget / party_size
            logger.info(f"Total budget: ${trip_input.max_budget}, Per-person budget for ILP: ${budget_for_ilp:.2f}")
        else:
            budget_for_ilp = 1e9
        
        # Run ILP with per-person budget
        try:
            solution = run_ilp_from_edges(
                edges_dict,
                travelers,
                start_city_by_trav,
                end_city_by_trav,
                user_points_by_trav,
                plan_non_pooled_multi_itineraries_with_native,
                meetup_cities=[],
                require_meetup_in_graph=False,
                must_visit_cities=must_visit,
                transfer_graph=transfer_graph,
                transfer_bonuses={},
                bank_block_size=1000,
                allow_all_payers=True,
                default_cash_if_missing=1e7,
                default_time_if_missing=1e6,
                default_cash_budget=budget_for_ilp,  # Per-person budget
                optimization_mode="oop",  # Minimize out-of-pocket
            )
        except Exception as e:
            logger.error(f"ILP optimization error: {e}")
            raise OptimizationFailedError(
                message=f"ILP optimization failed: {str(e)}",
                status="error"
            )
        
        # Check solution status
        status = solution.get("status", "Unknown")
        if status != "Optimal":
            # Try to find minimum cost without budget constraint
            logger.info(f"ILP status {status}, trying unconstrained optimization...")
            
            try:
                unconstrained_solution = run_ilp_from_edges(
                    edges_dict,
                    travelers,
                    start_city_by_trav,
                    end_city_by_trav,
                    user_points_by_trav,
                    plan_non_pooled_multi_itineraries_with_native,
                    meetup_cities=[],
                    require_meetup_in_graph=False,
                    must_visit_cities=must_visit,
                    transfer_graph=transfer_graph,
                    transfer_bonuses={},
                    bank_block_size=1000,
                    allow_all_payers=True,
                    default_cash_if_missing=1e7,
                    default_time_if_missing=1e6,
                    default_cash_budget=1e9,  # No budget constraint
                    optimization_mode="oop",
                )
                
                if unconstrained_solution.get("status") == "Optimal":
                    solution = unconstrained_solution
                    status = "Optimal"
            except Exception as e:
                logger.warning(f"Unconstrained optimization failed: {e}")
        
        if status != "Optimal":
            # This only happens if NO routes exist at all (not a budget issue)
            raise OptimizationFailedError(
                message=(
                    f"No routes found between your destinations on the selected dates (status: {status}). "
                    "This is not a budget issue - no flights are available for this route. "
                    "Try different dates or modify your destinations."
                ),
                status=status
            )
        
        # Extract solution data (per-person costs from ILP)
        totals = solution.get("totals", {})
        per_person_oop = totals.get("cash", 0)
        
        # Scale to total party cost
        total_oop = per_person_oop * party_size
        logger.info(f"Per-person OOP: ${per_person_oop:.2f}, Total party OOP: ${total_oop:.2f}")
        
        # Build itinerary from solution (with party_size for cost scaling)
        itinerary = self._build_itinerary_from_solution(
            solution=solution,
            graph=graph,
            trip_input=trip_input,
            party_size=party_size,
        )
        
        # Check budget (compare total party cost against total budget)
        within_budget = True
        exceeded_by = None
        suggested_budget = None
        if trip_input.max_budget and total_oop > trip_input.max_budget:
            within_budget = False
            exceeded_by = total_oop - trip_input.max_budget
            suggested_budget = int(total_oop * 1.1)  # 10% buffer
        
        # Build party context for message
        party_context = ""
        if party_size > 1:
            party_context = f" for {trip_input.num_adults} adult{'s' if trip_input.num_adults != 1 else ''}"
            if trip_input.num_children > 0:
                party_context += f" and {trip_input.num_children} child{'ren' if trip_input.num_children != 1 else ''}"
        
        return OptimizationResult(
            success=True,
            itinerary=itinerary,
            total_oop=total_oop,
            within_budget=within_budget,
            user_budget=trip_input.max_budget,
            budget_exceeded_by=exceeded_by,
            suggested_budget=suggested_budget,
            message=None if within_budget else (
                f"Your budget of ${trip_input.max_budget:,.0f} is too low for this trip{party_context}. "
                f"The minimum cost is ${total_oop:,.0f}. "
                f"We recommend setting your budget to at least ${suggested_budget:,}."
            ),
            solution=solution,
            status=status,
        )
    
    def _build_itinerary_from_solution(
        self,
        solution: Dict[str, Any],
        graph: RouteGraph,
        trip_input: TripInput,
        party_size: int = 1,
    ) -> Itinerary:
        """Build Itinerary object from ILP solution.
        
        Args:
            solution: ILP solution dict
            graph: Route graph with flight options
            trip_input: Trip input data
            party_size: Number of travelers (for cost scaling)
        
        Returns:
            Itinerary with costs scaled to party total
        """
        
        totals = solution.get("totals", {})
        paths = solution.get("path", {})
        pay_modes = solution.get("pay_mode", {})
        
        # Per-person totals from ILP
        per_person_cash = totals.get("cash", 0)
        per_person_cash_fares = totals.get("cash_fares", 0)
        per_person_surcharges = totals.get("surcharges", 0)
        
        # Scale to party totals
        total_oop = per_person_cash * party_size
        total_cash = per_person_cash_fares * party_size
        total_surcharges = per_person_surcharges * party_size
        
        # Get the path (should be only one for solo trip)
        path = []
        for traveler_id, p in paths.items():
            if p:
                path = p
                break
        
        # Build flight segments from payments (scale costs by party_size)
        flight_segments = []
        for traveler_id, payments in pay_modes.items():
            for payment in payments:
                edge_data = payment.get("edge", [])
                if len(edge_data) < 3:
                    continue
                
                origin, dest, fn = edge_data[0], edge_data[1], edge_data[2]
                
                # Get edge from graph
                edge_key = (origin, dest, fn)
                route_edge = None
                for e in graph.edges:
                    if e.from_node == origin and e.to_node == dest:
                        if e.legs and e.legs[0].flight_number == fn:
                            route_edge = e
                            break
                        elif e.edge_id.endswith(fn):
                            route_edge = e
                            break
                
                # Get per-person costs from payment
                per_person_fare = payment.get("fare")
                per_person_surcharge = payment.get("surcharge")
                per_person_miles = int(payment.get("miles", 0)) if payment.get("type") == "points" else None
                
                # Scale to party costs
                scaled_cash_cost = per_person_fare * party_size if per_person_fare else None
                scaled_surcharge = per_person_surcharge * party_size if per_person_surcharge else None
                scaled_points = per_person_miles * party_size if per_person_miles else None
                
                # Build segment with scaled costs
                segment = FlightSegment(
                    segment_id=f"{origin}_{dest}_{fn}",
                    origin=origin,
                    destination=dest,
                    legs=route_edge.legs if route_edge else [],
                    layovers=route_edge.layovers if route_edge else [],
                    is_direct=route_edge.is_direct if route_edge else True,
                    num_stops=route_edge.num_stops if route_edge else 0,
                    connection_airports=route_edge.connection_airports if route_edge else [],
                    total_duration_minutes=route_edge.total_duration_minutes if route_edge else 0,
                    payment_method="points" if payment.get("type") == "points" else "cash",
                    cash_cost=scaled_cash_cost,
                    points_cost=scaled_points,
                    points_program=payment.get("via", {}).get("airline") if payment.get("type") == "points" else None,
                    surcharge=scaled_surcharge,
                    booking_link=route_edge.booking_link if route_edge else None,
                )
                flight_segments.append(segment)
        
        # Build transfer plan (scale points by party_size)
        transfers = []
        for payer, by_source in (totals.get("transfers") or {}).items():
            for source, by_airline in (by_source or {}).items():
                for airline, data in (by_airline or {}).items():
                    per_person_source_points = data.get("source_points", 0)
                    if per_person_source_points > 0:
                        transfers.append(PointsTransfer(
                            from_bank=source,
                            to_airline=airline,
                            bank_points=per_person_source_points * party_size,
                            airline_points=int(data.get("delivered_airline_points", 0)) * party_size,
                            ratio=1.0,
                            is_instant=source.lower() in ["chase", "bilt"],
                        ))
        
        transfer_plan = TransferPlan(
            transfers=transfers,
            has_delayed_transfers=any(not t.is_instant for t in transfers),
        )
        
        # Build itinerary with scaled totals
        return Itinerary(
            itinerary_id=f"itin_{trip_input.trip_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}",
            flight_segments=flight_segments,
            transfer_plan=transfer_plan,
            total_oop=total_oop,
            total_cash=total_cash,
            total_surcharges=total_surcharges,
            points_used={},  # Could be extracted from solution
            party_size=party_size,
            num_adults=trip_input.num_adults,
            num_children=trip_input.num_children,
            origin=trip_input.start_destination,
            destination=trip_input.end_destination,
            path=path,
            stops=[s for s in path[1:-1]] if len(path) > 2 else [],
            generated_at=datetime.utcnow(),
            data_freshness=datetime.utcnow(),
            name="Optimized Route",
            score=100,
        )
    
    def generate_itinerary_sync(
        self,
        trip_data: Dict[str, Any],
        user_points: Optional[Dict[str, int]] = None,
        transfer_graph: Optional[Dict[str, Dict[str, float]]] = None,
    ) -> Dict[str, Any]:
        """Synchronous version of generate_itinerary."""
        return asyncio.run(
            self.generate_itinerary(trip_data, user_points, transfer_graph)
        )


# Singleton instance
_orchestrator: Optional[SoloTripOrchestrator] = None


def get_orchestrator() -> SoloTripOrchestrator:
    """Get or create the orchestrator singleton."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = SoloTripOrchestrator()
    return _orchestrator


async def generate_optimized_itinerary(
    trip_data: Dict[str, Any],
    user_points: Optional[Dict[str, int]] = None,
    transfer_graph: Optional[Dict[str, Dict[str, float]]] = None,
) -> Dict[str, Any]:
    """
    Main entry point for generating an optimized itinerary.
    
    This is the function to call from the itinerary service.
    NO FALLBACKS - errors are explicit and actionable.
    """
    orchestrator = get_orchestrator()
    return await orchestrator.generate_itinerary(
        trip_data=trip_data,
        user_points=user_points,
        transfer_graph=transfer_graph,
    )


def generate_optimized_itinerary_sync(
    trip_data: Dict[str, Any],
    user_points: Optional[Dict[str, int]] = None,
    transfer_graph: Optional[Dict[str, Dict[str, float]]] = None,
) -> Dict[str, Any]:
    """Synchronous version for non-async contexts."""
    return asyncio.run(
        generate_optimized_itinerary(trip_data, user_points, transfer_graph)
    )
