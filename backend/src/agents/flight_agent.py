"""
Flight Agent - Intelligently searches for flights using multiple APIs.

This agent:
1. Selects optimal award programs to search based on user's points
2. Executes parallel searches across AwardTool and SerpAPI
3. Normalizes and merges results
4. Calculates CPP for each option
"""

import asyncio
import logging
import uuid
from typing import Optional

from .base import BaseAgent, AgentConfig
from .models import FlightSearchRequest, FlightSearchResult, FlightOption
from .config import TRANSFER_GRAPH, AIRLINE_PROGRAMS, CABIN_CLASSES

logger = logging.getLogger(__name__)


class FlightAgent(BaseAgent[FlightSearchRequest, FlightSearchResult]):
    """Agentic flight search with intelligent program selection."""
    
    @property
    def name(self) -> str:
        return "FlightAgent"
    
    @property
    def system_prompt(self) -> str:
        return """You are a flight search specialist. Your job is to:
1. Analyze the route and user's points to select optimal award programs
2. Execute parallel searches across multiple APIs
3. Merge results and identify best options

Consider:
- Which programs have good availability on this route
- Transfer partners for the user's bank points
- Surcharge patterns (avoid BA/LH for high surcharges unless necessary)
- Cabin class availability patterns

Return JSON with: {"programs": ["UA", "AA", ...], "reasoning": "..."}"""

    async def execute(self, request: FlightSearchRequest) -> FlightSearchResult:
        """Execute flight search with intelligent program selection."""
        import time
        start_time = time.time()
        
        # Step 1: Determine which programs to search
        programs = await self._select_programs(request)
        
        # Step 2: Execute parallel searches
        tasks = []
        
        # Award searches
        for program in programs:
            tasks.append(self._search_award_flights(
                request.origin, request.destination, request.date,
                [program], request.cabin_classes
            ))
        
        # Cash searches
        for cabin in request.cabin_classes:
            tasks.append(self._search_cash_flights(
                request.origin, request.destination, request.date, cabin
            ))
        
        # Step 3: Gather results
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Step 4: Merge and normalize
        all_options = []
        errors = []
        
        for result in results:
            if isinstance(result, Exception):
                errors.append(str(result))
            elif isinstance(result, list):
                all_options.extend(result)
        
        # Step 5: Calculate CPP for award options
        for option in all_options:
            if option.award_available and option.cash_price and option.award_points:
                cash_saved = option.cash_price - (option.award_surcharge or 0)
                if option.award_points > 0 and cash_saved > 0:
                    option.cpp = (cash_saved / option.award_points) * 100
                    option.oop_if_award = option.award_surcharge or 0
        
        # Sort by OOP (lowest first), handling None values
        all_options.sort(key=lambda x: (
            x.oop_if_award if x.oop_if_award is not None and x.award_available 
            else (x.cash_price if x.cash_price is not None else float('inf'))
        ))
        
        duration_ms = int((time.time() - start_time) * 1000)
        
        return FlightSearchResult(
            origin=request.origin,
            destination=request.destination,
            date=request.date,
            options=all_options,
            programs_searched=programs,
            cabins_searched=request.cabin_classes,
            search_duration_ms=duration_ms,
            errors=errors,
        )
    
    async def _select_programs(self, request: FlightSearchRequest) -> list[str]:
        """Select which award programs to search."""
        # Get programs user can transfer to
        available_programs = set()
        
        for bank_program, balance in request.user_points.items():
            if balance <= 0:
                continue
            if bank_program in TRANSFER_GRAPH:
                available_programs.update(TRANSFER_GRAPH[bank_program].get("airlines", []))
        
        # Also add direct airline miles user might have
        for program in request.user_points:
            if program in AIRLINE_PROGRAMS:
                available_programs.add(program)
        
        # Default to common US programs if no points specified
        if not available_programs:
            available_programs = {"UA", "AA", "DL", "AF"}
        
        # Use LLM to prioritize if available
        if self.client and len(available_programs) > 5:
            try:
                result = await self._call_llm_json([
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": f"""
Route: {request.origin} → {request.destination}
Available programs: {list(available_programs)}
User points: {request.user_points}

Select the top 5 programs most likely to have good award availability and value.
Return JSON: {{"programs": ["UA", "AA", ...], "reasoning": "..."}}
"""}
                ])
                if result and "programs" in result:
                    return result["programs"][:5]
            except Exception as e:
                logger.warning(f"LLM program selection failed: {e}")
        
        # Return top 5 by preference
        preferred_order = ["UA", "AA", "DL", "AF", "VS", "BA", "SQ", "NH"]
        selected = []
        for prog in preferred_order:
            if prog in available_programs and len(selected) < 5:
                selected.append(prog)
        
        # Add remaining if needed
        for prog in available_programs:
            if prog not in selected and len(selected) < 5:
                selected.append(prog)
        
        return selected[:5]
    
    async def _search_award_flights(
        self,
        origin: str,
        destination: str,
        date: str,
        programs: list[str],
        cabins: list[str],
    ) -> list[FlightOption]:
        """Search for award flights using AwardTool API."""
        print(f"[FlightAgent] _search_award_flights called: {origin}->{destination} date={date} programs={programs}")
        logger.info(f"[FlightAgent] Searching award flights: {origin}->{destination} date={date}")
        try:
            from ..handlers.flights import search_awardtool_flights
            
            results = await search_awardtool_flights(
                origin=origin,
                destination=destination,
                date=date,
                programs=programs,
                cabins=cabins,
            )
            print(f"[FlightAgent] search_awardtool_flights returned {len(results) if results else 0} results")
            
            if not results:
                logger.info(f"No award flights found for {origin}->{destination}, using dummy data")
                return self._get_dummy_award_flights(origin, destination, date, programs, cabins)
            
            # Convert to FlightOption
            options = []
            for r in results:
                option = FlightOption(
                    id=str(uuid.uuid4()),
                    source="awardtool",
                    origin=origin,
                    destination=destination,
                    airline=r.get("airline", programs[0] if programs else ""),
                    cabin_class=r.get("cabin", "Economy"),
                    cash_price=r.get("cash_price"),
                    award_program=r.get("program", programs[0] if programs else ""),
                    award_points=r.get("points"),
                    award_surcharge=r.get("surcharge", 0),
                    award_available=r.get("available", False),
                    departure_time=r.get("departure_time"),
                    arrival_time=r.get("arrival_time"),
                    duration_minutes=r.get("duration"),
                    stops=r.get("stops", 0),
                    flight_numbers=r.get("flight_numbers", []),
                )
                options.append(option)
            
            logger.info(f"Found {len(options)} award flight options for {origin}->{destination}")
            return options
        except ImportError as e:
            logger.error(f"Import error in award flight search: {e}")
            return self._get_dummy_award_flights(origin, destination, date, programs, cabins)
        except Exception as e:
            logger.error(f"Award flight search failed: {e}")
            # Return dummy data for development
            return self._get_dummy_award_flights(origin, destination, date, programs, cabins)
    
    async def _search_cash_flights(
        self,
        origin: str,
        destination: str,
        date: str,
        cabin: str,
    ) -> list[FlightOption]:
        """Search for cash flights using SerpAPI."""
        try:
            from ..services.serp_api_functions import search_google_flights
            
            cabin_code = CABIN_CLASSES.get(cabin, {}).get("serpapi_code", 1)
            
            results = await search_google_flights(
                origin=origin,
                destination=destination,
                date=date,
                travel_class=cabin_code,
            )
            
            options = []
            for r in results.get("best_flights", []) + results.get("other_flights", []):
                price = r.get("price")
                if not price:
                    continue
                
                flights = r.get("flights", [])
                first_flight = flights[0] if flights else {}
                
                option = FlightOption(
                    id=str(uuid.uuid4()),
                    source="serpapi",
                    origin=origin,
                    destination=destination,
                    airline=first_flight.get("airline", ""),
                    cabin_class=cabin,
                    cash_price=float(price),
                    award_available=False,
                    departure_time=first_flight.get("departure_airport", {}).get("time"),
                    arrival_time=first_flight.get("arrival_airport", {}).get("time"),
                    duration_minutes=r.get("total_duration"),
                    stops=len(flights) - 1 if flights else 0,
                )
                options.append(option)
            
            return options
        except Exception as e:
            logger.error(f"Cash flight search failed: {e}")
            return self._get_dummy_cash_flights(origin, destination, date, cabin)
    
    def _get_dummy_award_flights(
        self,
        origin: str,
        destination: str,
        date: str,
        programs: list[str],
        cabins: list[str],
    ) -> list[FlightOption]:
        """Generate dummy award flight data for development."""
        options = []
        
        for program in programs:
            for cabin in cabins:
                # Generate realistic dummy data
                base_points = {
                    "Economy": 35000,
                    "Premium Economy": 55000,
                    "Business": 85000,
                    "First": 150000,
                }.get(cabin, 35000)
                
                base_surcharge = {
                    "BA": 450,  # High surcharges
                    "LH": 350,
                    "VS": 200,
                    "UA": 50,   # Low surcharges
                    "AA": 50,
                    "DL": 50,
                    "AF": 100,
                }.get(program, 75)
                
                # Generate departure time based on the travel date
                departure_time = f"{date}T10:00:00" if date else None
                arrival_time = f"{date}T14:00:00" if date else None  # 4 hour flight estimate
                
                options.append(FlightOption(
                    id=str(uuid.uuid4()),
                    source="dummy",
                    origin=origin,
                    destination=destination,
                    airline=program,
                    cabin_class=cabin,
                    cash_price=self._estimate_cash_price(origin, destination, cabin),
                    award_program=program,
                    award_points=base_points,
                    award_surcharge=float(base_surcharge),
                    award_available=True,
                    departure_time=departure_time,
                    arrival_time=arrival_time,
                    duration_minutes=240,  # 4 hour estimate
                    stops=0,
                ))
        
        return options
    
    def _get_dummy_cash_flights(
        self,
        origin: str,
        destination: str,
        date: str,
        cabin: str,
    ) -> list[FlightOption]:
        """Generate dummy cash flight data."""
        price = self._estimate_cash_price(origin, destination, cabin)
        
        # Generate departure time based on the travel date
        departure_time = f"{date}T08:00:00" if date else None
        arrival_time = f"{date}T12:00:00" if date else None  # 4 hour flight estimate
        
        return [FlightOption(
            id=str(uuid.uuid4()),
            source="dummy",
            origin=origin,
            destination=destination,
            airline="AA",
            cabin_class=cabin,
            cash_price=price,
            award_available=False,
            departure_time=departure_time,
            arrival_time=arrival_time,
            duration_minutes=240,  # 4 hour estimate
            stops=0,
        )]
    
    def _estimate_cash_price(self, origin: str, destination: str, cabin: str) -> float:
        """Estimate cash price based on route and cabin."""
        # Simple distance-based estimate
        domestic_routes = {
            ("JFK", "LAX"), ("LAX", "JFK"),
            ("JFK", "MIA"), ("MIA", "JFK"),
            ("SFO", "JFK"), ("JFK", "SFO"),
        }
        
        is_domestic = (origin, destination) in domestic_routes or (
            origin[:2] in ["JF", "LA", "SF", "MI", "OR", "SE", "CH", "DFW"] and
            destination[:2] in ["JF", "LA", "SF", "MI", "OR", "SE", "CH", "DFW"]
        )
        
        base_price = 300 if is_domestic else 800
        
        cabin_multiplier = {
            "Economy": 1.0,
            "Premium Economy": 1.8,
            "Business": 4.0,
            "First": 8.0,
        }.get(cabin, 1.0)
        
        return base_price * cabin_multiplier
