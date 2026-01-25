"""
Hotel Agent - Intelligently searches for hotels using multiple APIs.

This agent:
1. Selects optimal hotel programs based on user's points
2. Searches AwardTool and SerpAPI in parallel
3. Normalizes and merges results
4. Calculates CPP for each option
"""

import asyncio
import logging
import uuid
from typing import Optional

from .base import BaseAgent, AgentConfig
from .models import HotelSearchRequest, HotelSearchResult, HotelOption
from .config import TRANSFER_GRAPH, HOTEL_PROGRAMS

logger = logging.getLogger(__name__)


class HotelAgent(BaseAgent[HotelSearchRequest, HotelSearchResult]):
    """Agentic hotel search with intelligent program selection."""
    
    @property
    def name(self) -> str:
        return "HotelAgent"
    
    @property
    def system_prompt(self) -> str:
        return """You are a hotel search specialist. Your job is to:
1. Select optimal hotel programs based on user's points and city
2. Execute parallel searches for award and cash options
3. Match results to user's star rating preferences

Consider:
- Program presence in the city (Hyatt strong in some cities, Marriott in others)
- Points value (Hyatt typically best CPP, Hilton lowest)
- User's existing balances and transfer options

Return JSON with: {"programs": ["HYATT", "MAR", ...], "reasoning": "..."}"""

    async def execute(self, request: HotelSearchRequest) -> HotelSearchResult:
        """Execute hotel search with intelligent program selection."""
        import time
        start_time = time.time()
        
        # Calculate nights
        from datetime import datetime
        check_in = datetime.strptime(request.check_in, "%Y-%m-%d")
        check_out = datetime.strptime(request.check_out, "%Y-%m-%d")
        nights = (check_out - check_in).days
        
        # Step 1: Determine which programs to search
        programs = await self._select_programs(request)
        
        # Step 2: Execute parallel searches
        tasks = []
        
        # Award hotel searches
        for program in programs:
            tasks.append(self._search_award_hotels(
                request.city, request.check_in, request.check_out,
                [program], request.star_ratings
            ))
        
        # Cash hotel search
        tasks.append(self._search_cash_hotels(
            request.city, request.check_in, request.check_out,
            request.guests, request.star_ratings
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
            option.nights = nights
            if option.award_available and option.cash_price_total and option.award_points_total:
                cash_saved = option.cash_price_total - (option.award_surcharge or 0)
                if option.award_points_total > 0 and cash_saved > 0:
                    option.cpp = (cash_saved / option.award_points_total) * 100
                    option.oop_if_award = option.award_surcharge or 0
        
        # Sort by OOP (lowest first)
        all_options.sort(key=lambda x: x.oop_if_award if x.award_available else (x.cash_price_total or float('inf')))
        
        duration_ms = int((time.time() - start_time) * 1000)
        
        return HotelSearchResult(
            city=request.city,
            check_in=request.check_in,
            check_out=request.check_out,
            options=all_options,
            programs_searched=programs,
            star_ratings_searched=request.star_ratings,
            search_duration_ms=duration_ms,
            errors=errors,
        )
    
    async def _select_programs(self, request: HotelSearchRequest) -> list[str]:
        """Select which hotel programs to search."""
        available_programs = set()
        
        # Get programs user can transfer to
        for bank_program, balance in request.user_points.items():
            if balance <= 0:
                continue
            if bank_program in TRANSFER_GRAPH:
                available_programs.update(TRANSFER_GRAPH[bank_program].get("hotels", []))
        
        # Also add direct hotel points
        for program in request.user_points:
            if program in HOTEL_PROGRAMS:
                available_programs.add(program)
        
        # Default to all programs if none specified
        if not available_programs:
            available_programs = {"HYATT", "MAR", "HH", "IHG"}
        
        # Prioritize by typical CPP (Hyatt best, then Marriott, etc.)
        preferred_order = ["HYATT", "MAR", "IHG", "HH"]
        selected = []
        for prog in preferred_order:
            if prog in available_programs:
                selected.append(prog)
        
        return selected[:4]
    
    async def _search_award_hotels(
        self,
        city: str,
        check_in: str,
        check_out: str,
        programs: list[str],
        star_ratings: list[int],
    ) -> list[HotelOption]:
        """Search for award hotels using AwardTool API."""
        try:
            from ..handlers.hotels import search_awardtool_hotels
            
            results = await search_awardtool_hotels(
                city=city,
                check_in=check_in,
                check_out=check_out,
                programs=programs,
            )
            
            options = []
            for r in results:
                star = r.get("star_rating", 4)
                if star not in star_ratings:
                    continue
                
                option = HotelOption(
                    id=str(uuid.uuid4()),
                    source="awardtool",
                    name=r.get("name", "Hotel"),
                    brand=r.get("brand"),
                    star_rating=star,
                    city=city,
                    check_in=check_in,
                    check_out=check_out,
                    nights=1,
                    cash_price_per_night=r.get("cash_rate"),
                    cash_price_total=r.get("cash_total"),
                    award_program=r.get("program", programs[0] if programs else ""),
                    award_points_per_night=r.get("points_per_night"),
                    award_points_total=r.get("points_total"),
                    award_surcharge=r.get("surcharge", 0),
                    award_available=r.get("available", False),
                )
                options.append(option)
            
            return options
        except Exception as e:
            logger.error(f"Award hotel search failed: {e}")
            return self._get_dummy_award_hotels(city, check_in, check_out, programs, star_ratings)
    
    async def _search_cash_hotels(
        self,
        city: str,
        check_in: str,
        check_out: str,
        guests: int,
        star_ratings: list[int],
    ) -> list[HotelOption]:
        """Search for cash hotels using SerpAPI."""
        try:
            from ..services.serp_api_functions import search_google_hotels
            
            results = await search_google_hotels(
                city=city,
                check_in=check_in,
                check_out=check_out,
                guests=guests,
            )
            
            options = []
            for r in results.get("properties", []):
                star = r.get("star_rating", 4)
                if star not in star_ratings:
                    continue
                
                price = r.get("rate_per_night", {}).get("lowest")
                if not price:
                    continue
                
                from datetime import datetime
                ci = datetime.strptime(check_in, "%Y-%m-%d")
                co = datetime.strptime(check_out, "%Y-%m-%d")
                nights = (co - ci).days
                
                option = HotelOption(
                    id=str(uuid.uuid4()),
                    source="serpapi",
                    name=r.get("name", "Hotel"),
                    brand=r.get("brand"),
                    star_rating=star,
                    city=city,
                    check_in=check_in,
                    check_out=check_out,
                    nights=nights,
                    cash_price_per_night=float(str(price).replace("$", "").replace(",", "")),
                    cash_price_total=float(str(price).replace("$", "").replace(",", "")) * nights,
                    award_available=False,
                    address=r.get("address"),
                )
                options.append(option)
            
            return options
        except Exception as e:
            logger.error(f"Cash hotel search failed: {e}")
            return self._get_dummy_cash_hotels(city, check_in, check_out, star_ratings)
    
    def _get_dummy_award_hotels(
        self,
        city: str,
        check_in: str,
        check_out: str,
        programs: list[str],
        star_ratings: list[int],
    ) -> list[HotelOption]:
        """Generate dummy award hotel data."""
        from datetime import datetime
        ci = datetime.strptime(check_in, "%Y-%m-%d")
        co = datetime.strptime(check_out, "%Y-%m-%d")
        nights = (co - ci).days
        
        options = []
        
        for program in programs:
            for star in star_ratings:
                # Points per night by program and star
                points_per_night = {
                    "HYATT": {3: 8000, 4: 15000, 5: 25000},
                    "MAR": {3: 15000, 4: 30000, 5: 50000},
                    "HH": {3: 20000, 4: 40000, 5: 80000},
                    "IHG": {3: 15000, 4: 30000, 5: 50000},
                }.get(program, {}).get(star, 20000)
                
                cash_per_night = {3: 150, 4: 250, 5: 450}.get(star, 200)
                
                options.append(HotelOption(
                    id=str(uuid.uuid4()),
                    source="dummy",
                    name=f"{HOTEL_PROGRAMS.get(program, {}).get('name', program)} {city}",
                    brand=HOTEL_PROGRAMS.get(program, {}).get("name"),
                    star_rating=star,
                    city=city,
                    check_in=check_in,
                    check_out=check_out,
                    nights=nights,
                    cash_price_per_night=float(cash_per_night),
                    cash_price_total=float(cash_per_night * nights),
                    award_program=program,
                    award_points_per_night=points_per_night,
                    award_points_total=points_per_night * nights,
                    award_surcharge=0.0,
                    award_available=True,
                ))
        
        return options
    
    def _get_dummy_cash_hotels(
        self,
        city: str,
        check_in: str,
        check_out: str,
        star_ratings: list[int],
    ) -> list[HotelOption]:
        """Generate dummy cash hotel data."""
        from datetime import datetime
        ci = datetime.strptime(check_in, "%Y-%m-%d")
        co = datetime.strptime(check_out, "%Y-%m-%d")
        nights = (co - ci).days
        
        options = []
        
        for star in star_ratings:
            cash_per_night = {3: 150, 4: 250, 5: 450}.get(star, 200)
            
            options.append(HotelOption(
                id=str(uuid.uuid4()),
                source="dummy",
                name=f"{star}-Star Hotel in {city}",
                star_rating=star,
                city=city,
                check_in=check_in,
                check_out=check_out,
                nights=nights,
                cash_price_per_night=float(cash_per_night),
                cash_price_total=float(cash_per_night * nights),
                award_available=False,
            ))
        
        return options
