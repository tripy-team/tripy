"""
Route Graph Builder

Constructs a route graph that properly represents both
direct and connecting flights as edges.
"""

import logging
from datetime import date, datetime
from typing import List, Dict, Optional, Any, Tuple

from .models import (
    TripInput,
    RouteGraph,
    RouteEdge,
    FlightLeg,
    Layover,
    TransferPartner,
    ConnectingFlightOption,
    FlightSearchResult,
)
from .connection_validator import ConnectionValidator
from .flight_searcher import ComprehensiveFlightSearcher
from .errors import MissingFlightDataError, NoValidRouteError

logger = logging.getLogger(__name__)


class RouteGraphBuilder:
    """
    Constructs a complete route graph with all flight options.
    Every edge MUST have real pricing data.
    """
    
    def __init__(
        self,
        connection_validator: Optional[ConnectionValidator] = None,
        flight_searcher: Optional[ComprehensiveFlightSearcher] = None
    ):
        self.connection_validator = connection_validator or ConnectionValidator()
        self.flight_searcher = flight_searcher or ComprehensiveFlightSearcher(
            connection_validator=self.connection_validator
        )
    
    async def build(
        self,
        trip_data: TripInput,
        flight_search_results: Optional[Dict[Tuple[str, str], FlightSearchResult]] = None
    ) -> RouteGraph:
        """
        Builds complete route graph from trip input.
        
        If flight_search_results is not provided, will fetch flights.
        
        Args:
            trip_data: Validated trip input
            flight_search_results: Optional pre-fetched flight results
        
        Returns:
            RouteGraph with all flight options
        
        Raises:
            MissingFlightDataError: If any required segment has no flights
        """
        graph = RouteGraph()
        
        # Add nodes
        self._add_nodes(graph, trip_data)
        
        # Determine required segments
        required_segments = self._get_required_segments(trip_data)
        
        # Fetch flights if not provided
        if flight_search_results is None:
            flight_search_results = await self._fetch_all_flights(
                required_segments,
                trip_data
            )
        
        # Track missing segments
        missing_segments = []
        
        # Add edges from flight search results
        for (origin, destination), search_result in flight_search_results.items():
            if not search_result.success or not search_result.options:
                missing_segments.append((origin, destination))
                continue
            
            for option in search_result.options:
                # Only add valid options
                if option.is_valid:
                    edge = self._create_edge(origin, destination, option)
                    graph.add_edge(edge)
                else:
                    logger.debug(
                        f"Skipping invalid option {option.option_id} for {origin} → {destination}"
                    )
        
        # Check for missing segments
        if missing_segments:
            raise MissingFlightDataError(
                message=f"No flight options found for {len(missing_segments)} route segment(s)",
                missing_segments=missing_segments,
                trip_data=trip_data
            )
        
        # Validate graph completeness
        self._validate_graph_completeness(graph, trip_data, required_segments)
        
        logger.info(
            f"Built route graph: {len(graph.nodes)} nodes, {len(graph.edges)} edges"
        )
        
        return graph
    
    def _add_nodes(self, graph: RouteGraph, trip_data: TripInput):
        """Add all nodes to the graph."""
        
        # Add origin
        graph.add_node(
            trip_data.start_destination,
            node_type="origin",
            days=0
        )
        
        # Add destinations
        for dest in trip_data.destinations:
            if not dest.excluded:
                graph.add_node(
                    dest.airport_code,
                    node_type="destination",
                    days=dest.days or 0
                )
        
        # Add end (may be same as origin for round trips)
        if trip_data.end_destination != trip_data.start_destination:
            graph.add_node(
                trip_data.end_destination,
                node_type="end",
                days=0
            )
    
    def _get_required_segments(
        self,
        trip_data: TripInput
    ) -> List[Tuple[str, str, date]]:
        """
        Determines which O-D pairs are required for this trip.
        For multi-city trips, generates all necessary pairs.
        
        Returns:
            List of (origin, destination, date) tuples
        """
        # Get ordered list of all stops (preserving route order)
        stops = [trip_data.start_destination]
        
        for dest in trip_data.destinations:
            if not dest.excluded:
                stops.append(dest.airport_code)
        
        stops.append(trip_data.end_destination)
        
        # For segment generation, get unique intermediate stops
        # but keep track if this is a round trip
        is_round_trip = trip_data.start_destination == trip_data.end_destination
        
        # Get unique intermediate stops (destinations only, not start/end)
        intermediate_stops = []
        seen = set()
        for dest in trip_data.destinations:
            if not dest.excluded and dest.airport_code not in seen:
                seen.add(dest.airport_code)
                intermediate_stops.append(dest.airport_code)
        
        # Build unique stops list for segment generation
        unique_stops = [trip_data.start_destination] + intermediate_stops
        if not is_round_trip:
            # One-way trip: add end destination if different
            if trip_data.end_destination not in seen:
                unique_stops.append(trip_data.end_destination)
        
        # Generate required pairs (all combinations for flexibility)
        segments = []
        search_date = trip_data.start_date or date.today()
        
        # Generate segments between all unique stops
        for i, origin in enumerate(unique_stops[:-1]):
            for destination in unique_stops[i+1:]:
                if origin != destination:
                    segments.append((origin, destination, search_date))
        
        # For round trips, also need the return segments from each destination back to origin
        if is_round_trip and intermediate_stops:
            origin = trip_data.start_destination
            for dest in intermediate_stops:
                # Return segment: dest → origin
                return_segment = (dest, origin, search_date)
                if return_segment not in segments:
                    segments.append(return_segment)
        
        logger.info(f"Required segments: {len(segments)} (round_trip={is_round_trip})")
        
        return segments
    
    async def _fetch_all_flights(
        self,
        segments: List[Tuple[str, str, date]],
        trip_data: TripInput
    ) -> Dict[Tuple[str, str], FlightSearchResult]:
        """Fetch flights for all segments in parallel."""
        
        results = await self.flight_searcher.search_multiple_segments(
            segments=segments,
            cabin_class=trip_data.cabin_class,
            user_points=trip_data.points_balances,
        )
        
        return results
    
    def _create_edge(
        self,
        origin: str,
        destination: str,
        option: ConnectingFlightOption
    ) -> RouteEdge:
        """
        Creates a route edge from a flight option.
        """
        return RouteEdge(
            edge_id=f"{origin}_{destination}_{option.option_id}",
            from_node=origin,
            to_node=destination,
            flight_option=option,
            option_type=option.option_type,
            cash_cost=option.cash_price_usd,
            points_cost=option.points_cost,
            points_program=option.points_program,
            surcharge=option.surcharge_usd,
            total_duration_minutes=option.total_duration_minutes,
            departure_datetime=option.departure_datetime,
            arrival_datetime=option.arrival_datetime,
            departure_time=option.legs[0].departure_time if option.legs else None,
            arrival_time=option.legs[-1].arrival_time if option.legs else None,
            is_direct=option.is_direct,
            num_stops=option.num_stops,
            connection_airports=option.connection_airports,
            legs=option.legs,
            layovers=option.layovers,
            booking_link=option.booking_link,
            requires_separate_bookings=option.requires_separate_bookings,
            transfer_partners=option.transfer_partners,
            seats_available=option.seats_available,
            operating_airline=option.operating_carriers[0] if option.operating_carriers else None,
            data_source=option.data_source,
            data_fetched_at=option.fetched_at,
            data_expires_at=option.expires_at,
        )
    
    def _validate_graph_completeness(
        self,
        graph: RouteGraph,
        trip_data: TripInput,
        required_segments: List[Tuple[str, str, date]]
    ):
        """
        Validates that the graph has all required edges.
        Raises explicit error if any segment is missing.
        """
        missing_segments = []
        
        for origin, destination, _ in required_segments:
            edges = graph.get_edges(origin, destination)
            if not edges:
                missing_segments.append((origin, destination))
        
        if missing_segments:
            raise MissingFlightDataError(
                message="No flight options found for required route segments",
                missing_segments=missing_segments,
                trip_data=trip_data
            )
    
    def build_from_edges_dict(
        self,
        edges_dict: Dict[Tuple[str, str, str], Dict[str, Any]],
        trip_data: TripInput
    ) -> RouteGraph:
        """
        Build route graph from existing edges dictionary.
        Used when edges are already fetched (e.g., from itinerary_service).
        
        Args:
            edges_dict: Dictionary of edges from flight search
            trip_data: Trip input data
        
        Returns:
            RouteGraph
        """
        graph = RouteGraph()
        
        # Add nodes
        self._add_nodes(graph, trip_data)
        
        # Convert edges to RouteEdge objects
        for edge_key, edge_data in edges_dict.items():
            if not isinstance(edge_key, tuple) or len(edge_key) < 3:
                continue
            
            dep, arr, fn = edge_key
            
            # Create flight leg
            leg = FlightLeg(
                leg_index=0,
                departure_airport=dep,
                arrival_airport=arr,
                departure_time=edge_data.get("departure_time"),
                arrival_time=edge_data.get("arrival_time"),
                duration_minutes=int(edge_data.get("time_cost", 0) or 0),
                airline_code=edge_data.get("operating_airline", "")[:2] if edge_data.get("operating_airline") else "",
                flight_number=fn,
            )
            
            # Parse transfer partners
            transfer_partners = []
            for partner in (edge_data.get("transfer_partners") or []):
                if isinstance(partner, str):
                    transfer_partners.append(TransferPartner(bank_program=partner))
                elif isinstance(partner, dict):
                    transfer_partners.append(TransferPartner(
                        bank_program=partner.get("bank", partner.get("source", "")),
                        transfer_ratio=partner.get("ratio", 1.0),
                        is_instant=partner.get("instant", False),
                    ))
            
            edge = RouteEdge(
                edge_id=f"{dep}_{arr}_{fn}",
                from_node=dep,
                to_node=arr,
                option_type="award" if edge_data.get("points_cost") else "cash",
                cash_cost=edge_data.get("cash_cost"),
                points_cost=edge_data.get("points_cost"),
                points_program=edge_data.get("points_program"),
                surcharge=edge_data.get("points_surcharge"),
                total_duration_minutes=int(edge_data.get("time_cost", 0) or 0),
                departure_time=edge_data.get("departure_time"),
                arrival_time=edge_data.get("arrival_time"),
                is_direct=True,
                num_stops=0,
                legs=[leg],
                transfer_partners=transfer_partners,
                operating_airline=edge_data.get("operating_airline"),
                data_source="edges_dict",
                data_fetched_at=datetime.utcnow(),
            )
            
            graph.add_edge(edge)
        
        logger.info(
            f"Built route graph from edges: {len(graph.nodes)} nodes, {len(graph.edges)} edges"
        )
        
        return graph
    
    def enumerate_routes(
        self,
        graph: RouteGraph,
        trip_data: TripInput,
        max_routes: int = 100
    ) -> List[List[str]]:
        """
        Enumerates valid routes through the graph.
        
        Args:
            graph: Route graph
            trip_data: Trip input
            max_routes: Maximum routes to return
        
        Returns:
            List of routes (each route is a list of airport codes)
        
        Raises:
            NoValidRouteError: If no valid route exists
        """
        import itertools
        
        start = trip_data.start_destination
        end = trip_data.end_destination
        
        # Get must-visit cities
        must_visit = [
            d.airport_code for d in trip_data.destinations 
            if d.must_include and not d.excluded
        ]
        
        # Generate permutations
        valid_routes = []
        
        if len(must_visit) <= 7:
            permutations = list(itertools.permutations(must_visit))
        else:
            # For larger sets, use sampling
            import random
            all_perms = list(itertools.permutations(must_visit))
            permutations = random.sample(all_perms, min(5040, len(all_perms)))
        
        for perm in permutations:
            route = [start] + list(perm) + [end]
            
            # Check if all edges exist
            valid = True
            for i in range(len(route) - 1):
                if not graph.get_edges(route[i], route[i+1]):
                    valid = False
                    break
            
            if valid:
                valid_routes.append(route)
                if len(valid_routes) >= max_routes:
                    break
        
        if not valid_routes:
            raise NoValidRouteError(
                message=f"No valid route exists visiting all cities: {must_visit}",
                start=start,
                end=end,
                must_visit=must_visit,
                reasons=["No available flights for required route segments"]
            )
        
        return valid_routes
