"""
Comprehensive Flight Searcher

Searches for ALL flight options - direct AND connecting.
No fallbacks - if no flights found, return explicit failure.
"""

import asyncio
import logging
import hashlib
from datetime import date, datetime, timedelta
from typing import List, Dict, Optional, Any, Tuple

from .models import (
    FlightLeg,
    Layover,
    TransferPartner,
    ConnectingFlightOption,
    FlightSearchResult,
    CabinClass,
)
from .connection_validator import ConnectionValidator
from .errors import NoFlightsFoundError, APIError

logger = logging.getLogger(__name__)


class ComprehensiveFlightSearcher:
    """
    Searches for ALL flight options - direct AND connecting.
    No fallbacks - if no flights found, return explicit failure.
    """
    
    # Configuration
    MAX_CONCURRENT_API_CALLS = 6
    API_TIMEOUT_SECONDS = 30
    MAX_CONNECTION_LEGS = 2  # Maximum 2-stop itineraries
    
    def __init__(
        self,
        connection_validator: Optional[ConnectionValidator] = None
    ):
        """
        Initialize searcher.
        
        Args:
            connection_validator: Optional validator for connections.
        """
        self.connection_validator = connection_validator or ConnectionValidator()
    
    async def search_all_options(
        self,
        origin: str,
        destination: str,
        search_date: date,
        cabin_class: CabinClass = CabinClass.ECONOMY,
        include_connections: bool = True,
        user_points: Optional[Dict[str, int]] = None,
        filters: Optional[Dict[str, Any]] = None,
        num_adults: int = 1,
        num_children: int = 0,
    ) -> FlightSearchResult:
        """
        Searches for ALL flight options between origin and destination.
        Returns both direct and connecting flight options.
        
        NEVER returns estimated or placeholder data.
        
        Note: Prices returned are PER PERSON. Caller must multiply by party_size
        for total costs.
        
        Args:
            origin: Origin airport code
            destination: Destination airport code
            search_date: Date to search
            cabin_class: Cabin class to search
            include_connections: Whether to include connecting flights
            user_points: User's points balances
            filters: Additional filters
            num_adults: Number of adult passengers
            num_children: Number of child passengers
        
        Returns:
            FlightSearchResult with all options (prices are per-person)
        """
        # Import here to avoid circular imports
        from src.handlers.flights import (
            get_flights_award_first_with_points_async,
            get_flights_serp_first_with_points_async,
            get_flights_serp_only,
        )
        
        date_str = search_date.isoformat()
        filt = filters or {}
        filt["outbound_date"] = date_str
        filt["travel_class"] = self._cabin_to_filter(cabin_class)
        
        # Add party size to filters for flight APIs
        party_size = num_adults + num_children
        filt["pax"] = party_size
        filt["adults"] = num_adults
        filt["children"] = num_children
        
        logger.info(f"Flight search {origin}->{destination} with party_size={party_size} "
                   f"(adults={num_adults}, children={num_children})")
        
        all_options: List[ConnectingFlightOption] = []
        search_errors: List[Dict[str, Any]] = []
        
        # Try award-first strategy
        try:
            edges = await get_flights_award_first_with_points_async(
                origin=origin,
                destination=destination,
                user_points=user_points or {},
                filters=filt,
            )
            
            if edges:
                options = self._edges_to_options(
                    edges, 
                    origin, 
                    destination, 
                    search_date,
                    "award_first"
                )
                all_options.extend(options)
                logger.info(
                    f"Award-first search {origin}->{destination}: {len(options)} options"
                )
        except Exception as e:
            logger.warning(f"Award-first search failed: {e}")
            search_errors.append({
                "source": "award_first",
                "error": str(e),
                "recoverable": True
            })
        
        # If no options yet, try SERP-first
        if not all_options:
            try:
                edges = await get_flights_serp_first_with_points_async(
                    origin=origin,
                    destination=destination,
                    user_points=user_points or {},
                    filters=filt,
                )
                
                if edges:
                    options = self._edges_to_options(
                        edges,
                        origin,
                        destination,
                        search_date,
                        "serp_first"
                    )
                    all_options.extend(options)
                    logger.info(
                        f"SERP-first search {origin}->{destination}: {len(options)} options"
                    )
            except Exception as e:
                logger.warning(f"SERP-first search failed: {e}")
                search_errors.append({
                    "source": "serp_first",
                    "error": str(e),
                    "recoverable": True
                })
        
        # If still no options, try SERP-only
        if not all_options:
            try:
                edges = get_flights_serp_only(
                    origin=origin,
                    destination=destination,
                    date_str=date_str,
                    filters=filt,
                )
                
                if edges:
                    options = self._edges_to_options(
                        edges,
                        origin,
                        destination,
                        search_date,
                        "serp_only"
                    )
                    all_options.extend(options)
                    logger.info(
                        f"SERP-only search {origin}->{destination}: {len(options)} options"
                    )
            except Exception as e:
                logger.warning(f"SERP-only search failed: {e}")
                search_errors.append({
                    "source": "serp_only",
                    "error": str(e),
                    "recoverable": True
                })
        
        # Validate connections for all options
        validated_options = []
        for option in all_options:
            validated = self.connection_validator.build_option_with_validation(option)
            if validated.is_valid:
                validated_options.append(validated)
            else:
                logger.debug(
                    f"Option {option.option_id} has invalid connections, excluding"
                )
        
        # If no options found from any source, this is a failure
        if not validated_options:
            return FlightSearchResult(
                success=False,
                options=[],
                search_errors=search_errors,
                direct_options=[],
                connecting_options=[],
                failure_reason=self._determine_failure_reason(
                    origin, destination, search_date, search_errors
                ),
                origin=origin,
                destination=destination,
                search_date=search_date
            )
        
        # Separate direct and connecting
        direct_options = [o for o in validated_options if o.is_direct]
        connecting_options = [o for o in validated_options if not o.is_direct]
        
        return FlightSearchResult(
            success=True,
            options=validated_options,
            search_errors=search_errors,
            direct_options=direct_options,
            connecting_options=connecting_options,
            failure_reason=None,
            origin=origin,
            destination=destination,
            search_date=search_date
        )
    
    def _edges_to_options(
        self,
        edges: Dict[Tuple[str, str, str], Dict[str, Any]],
        origin: str,
        destination: str,
        search_date: date,
        data_source: str
    ) -> List[ConnectingFlightOption]:
        """
        Convert edges dictionary to list of flight options.
        """
        options = []
        
        for edge_key, edge_data in edges.items():
            if not isinstance(edge_key, tuple) or len(edge_key) < 3:
                continue
            
            dep_airport, arr_airport, flight_num = edge_key
            
            # Skip if not matching origin/destination
            if dep_airport != origin or arr_airport != destination:
                continue
            
            # Get pricing data
            cash_cost = edge_data.get("cash_cost")
            points_cost = edge_data.get("points_cost")
            points_program = edge_data.get("points_program")
            surcharge = edge_data.get("points_surcharge")
            time_cost = edge_data.get("time_cost")
            
            # Skip if no pricing data
            if cash_cost is None and points_cost is None:
                continue
            
            # Determine option type
            option_type = "award" if points_cost else "cash"
            
            # Create flight leg
            leg = FlightLeg(
                leg_index=0,
                departure_airport=dep_airport,
                arrival_airport=arr_airport,
                departure_time=edge_data.get("departure_time"),
                arrival_time=edge_data.get("arrival_time"),
                duration_minutes=int(time_cost) if time_cost else 0,
                airline_code=edge_data.get("operating_airline", "")[:2] if edge_data.get("operating_airline") else "",
                flight_number=flight_num,
            )
            
            # Generate option ID
            option_id = self._generate_option_id(dep_airport, arr_airport, flight_num, data_source)
            
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
            
            option = ConnectingFlightOption(
                option_id=option_id,
                option_type=option_type,
                origin=dep_airport,
                destination=arr_airport,
                is_direct=True,  # Single edge = direct
                num_stops=0,
                legs=[leg],
                layovers=[],
                connections_valid=True,
                total_duration_minutes=int(time_cost) if time_cost else 0,
                flight_time_minutes=int(time_cost) if time_cost else 0,
                layover_time_minutes=0,
                cash_price_usd=float(cash_cost) if cash_cost else None,
                points_cost=int(points_cost) if points_cost else None,
                points_program=points_program,
                surcharge_usd=float(surcharge) if surcharge else None,
                airlines=[leg.airline_code] if leg.airline_code else [],
                marketing_carriers=[leg.airline_code] if leg.airline_code else [],
                operating_carriers=[edge_data.get("operating_airline", "")[:2]] if edge_data.get("operating_airline") else [],
                transfer_partners=transfer_partners,
                data_source=data_source,
                fetched_at=datetime.utcnow(),
                expires_at=datetime.utcnow() + timedelta(hours=6),
            )
            
            options.append(option)
        
        return options
    
    def _generate_option_id(
        self,
        origin: str,
        destination: str,
        flight_num: str,
        source: str
    ) -> str:
        """Generate unique option ID."""
        raw = f"{origin}_{destination}_{flight_num}_{source}"
        return hashlib.md5(raw.encode()).hexdigest()[:12]
    
    def _cabin_to_filter(self, cabin_class: CabinClass) -> str:
        """Convert CabinClass to filter string."""
        mapping = {
            CabinClass.BASIC_ECONOMY: "economy",
            CabinClass.ECONOMY: "economy",
            CabinClass.PREMIUM_ECONOMY: "premium_economy",
            CabinClass.BUSINESS: "business",
            CabinClass.FIRST: "first",
        }
        return mapping.get(cabin_class, "economy")
    
    def _determine_failure_reason(
        self,
        origin: str,
        destination: str,
        search_date: date,
        errors: List[Dict[str, Any]]
    ) -> str:
        """Determine the reason for search failure."""
        if not errors:
            return f"No flights found between {origin} and {destination} on {search_date}"
        
        # Check for common issues
        all_api_errors = all(e.get("error") for e in errors)
        if all_api_errors:
            return (
                f"Could not retrieve flight data for {origin} → {destination}. "
                "This may be due to API issues. Please try again."
            )
        
        return (
            f"No flights found between {origin} and {destination} on {search_date}. "
            "Try different dates or nearby airports."
        )
    
    async def search_multiple_segments(
        self,
        segments: List[Tuple[str, str, date]],
        cabin_class: CabinClass = CabinClass.ECONOMY,
        user_points: Optional[Dict[str, int]] = None,
        num_adults: int = 1,
        num_children: int = 0,
    ) -> Dict[Tuple[str, str], FlightSearchResult]:
        """
        Search multiple segments in parallel.
        
        Args:
            segments: List of (origin, destination, date) tuples
            cabin_class: Cabin class
            user_points: User's points balances
            num_adults: Number of adult passengers
            num_children: Number of child passengers
        
        Returns:
            Dict mapping (origin, destination) to FlightSearchResult
        """
        semaphore = asyncio.Semaphore(self.MAX_CONCURRENT_API_CALLS)
        
        async def search_with_semaphore(origin: str, dest: str, search_date: date):
            async with semaphore:
                return await self.search_all_options(
                    origin=origin,
                    destination=dest,
                    search_date=search_date,
                    cabin_class=cabin_class,
                    user_points=user_points,
                    num_adults=num_adults,
                    num_children=num_children,
                )
        
        tasks = [
            search_with_semaphore(origin, dest, search_date)
            for origin, dest, search_date in segments
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        result_dict = {}
        for (origin, dest, _), result in zip(segments, results):
            if isinstance(result, Exception):
                logger.error(f"Search failed for {origin} → {dest}: {result}")
                result_dict[(origin, dest)] = FlightSearchResult(
                    success=False,
                    options=[],
                    search_errors=[{"error": str(result)}],
                    failure_reason=str(result),
                    origin=origin,
                    destination=dest,
                )
            else:
                result_dict[(origin, dest)] = result
        
        return result_dict
    
    def search_sync(
        self,
        origin: str,
        destination: str,
        search_date: date,
        cabin_class: CabinClass = CabinClass.ECONOMY,
        user_points: Optional[Dict[str, int]] = None,
        filters: Optional[Dict[str, Any]] = None
    ) -> FlightSearchResult:
        """
        Synchronous version of search_all_options.
        """
        return asyncio.run(
            self.search_all_options(
                origin=origin,
                destination=destination,
                search_date=search_date,
                cabin_class=cabin_class,
                user_points=user_points,
                filters=filters,
            )
        )
