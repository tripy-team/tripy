# Tripy Implementation Plan v4.0

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | Jan 2026 | Initial implementation plan |
| v2.0 | Jan 2026 | Added multi-modal transport, autocomplete, chatbot |
| v3.0 | Jan 2026 | Detailed algorithm implementation, minimize out-of-pocket objective |
| v4.0 | Jan 2026 | **No hardcoded data**, dynamic credit card benefits, real-time API integrations |

---

## Executive Summary

This document outlines a **fully dynamic implementation** where:

1. **Zero hardcoded data** - All transport routes, schedules, and prices come from real-time APIs
2. **Dynamic credit card benefits** - Card perks (free bags, lounge access, credits) stored in database and applied automatically
3. **Benefits affect optimization** - The ILP considers card benefits as cost reductions

### Core Principle

> **Everything is fetched or calculated dynamically. The only "constants" are API endpoints and database schema.**

---

## Table of Contents

1. [Data Architecture Overview](#data-architecture-overview)
2. [Real-Time Transport APIs](#real-time-transport-apis)
3. [Credit Card Benefits System](#credit-card-benefits-system)
4. [Enhanced ILP Objective Function](#enhanced-ilp-objective-function)
5. [Database Schema](#database-schema)
6. [API Integrations](#api-integrations)
7. [Caching Strategy](#caching-strategy)
8. [Implementation Details](#implementation-details)

---

## Data Architecture Overview

### What Was Hardcoded (v3) vs Dynamic (v4)

| Data Type | v3 (Hardcoded) | v4 (Dynamic) |
|-----------|----------------|--------------|
| Train routes | `EUROPEAN_CORRIDORS = {...}` | Trainline/DB/SNCF APIs |
| Train prices | Estimated min/max ranges | Real-time API prices |
| Bus routes | `BUS_ROUTES = {...}` | FlixBus/Greyhound APIs |
| Flight schedules | AwardTool API | AwardTool + Amadeus APIs |
| Transfer partners | `DEFAULT_TRANSFER_GRAPH` | Database table `transfer_partners` |
| Card benefits | None / partial | Database table `card_benefits` |
| Airline surcharges | From API response | API + database overrides |

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA SOURCES (ALL EXTERNAL)                         │
└─────────────────────────────────────────────────────────────────────────────┘
        │                    │                    │                    │
        ▼                    ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   FLIGHTS    │    │    TRAINS    │    │    BUSES     │    │    CARDS     │
│              │    │              │    │              │    │              │
│ • AwardTool  │    │ • Trainline  │    │ • FlixBus    │    │ • DynamoDB   │
│ • Amadeus    │    │ • DB (Bahn)  │    │ • BusBud     │    │ • Admin API  │
│ • SerpAPI    │    │ • SNCF       │    │ • Greyhound  │    │              │
│ • Skyscanner │    │ • Amtrak     │    │ • Megabus    │    │              │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │                   │
       └───────────────────┴───────────────────┴───────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         UNIFIED EDGE BUILDER                                │
│                                                                             │
│   Normalizes all transport options into common edge format:                 │
│   {origin, destination, mode, cash_cost, time_cost, points_cost, ...}      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BENEFITS CALCULATOR                                 │
│                                                                             │
│   For each edge + user's cards:                                            │
│   - Calculate applicable benefits (free bags, credits, etc.)               │
│   - Adjust effective cost                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ILP OPTIMIZER                                       │
│                                                                             │
│   MINIMIZE: out_of_pocket - card_benefits_value + time_penalty             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Real-Time Transport APIs

### 2.1 Flight APIs (No Change from v3)

```python
# backend/src/services/flight_service.py

"""
Flight service - fetches real-time flight data from multiple APIs.
NO hardcoded routes or prices.
"""

from typing import Dict, List, Optional, Tuple
import httpx
import asyncio
from datetime import datetime
import os


class FlightService:
    """Unified flight search across multiple providers."""
    
    def __init__(self):
        self.awardtool_key = os.getenv("AWARDTOOL_API_KEY")
        self.amadeus_key = os.getenv("AMADEUS_API_KEY")
        self.amadeus_secret = os.getenv("AMADEUS_API_SECRET")
        self.serpapi_key = os.getenv("SERPAPI_API_KEY")
        
        self._amadeus_token = None
        self._amadeus_token_expiry = None
    
    async def search_flights(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int = 1,
        include_award: bool = True,
    ) -> List[Dict]:
        """
        Search all flight APIs in parallel.
        
        Returns unified list of flight options.
        """
        tasks = []
        
        # AwardTool for award availability
        if include_award and self.awardtool_key:
            tasks.append(self._search_awardtool(origin, destination, date, passengers))
        
        # Amadeus for cash prices and schedules
        if self.amadeus_key:
            tasks.append(self._search_amadeus(origin, destination, date, passengers))
        
        # SerpAPI as fallback
        if self.serpapi_key:
            tasks.append(self._search_serpapi(origin, destination, date))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Merge and deduplicate
        flights = []
        seen_keys = set()
        
        for result in results:
            if isinstance(result, Exception):
                continue
            for flight in (result or []):
                key = (flight.get("flight_number"), flight.get("departure"))
                if key not in seen_keys:
                    seen_keys.add(key)
                    flights.append(flight)
        
        return flights
    
    async def _search_awardtool(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[Dict]:
        """
        Query AwardTool API for award flight availability.
        
        Returns flights with both cash price and points options.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.awardtool.com/v1/search",
                json={
                    "origin": origin,
                    "destination": destination,
                    "date": date,
                    "passengers": passengers,
                    "cabin": "economy",
                },
                headers={"Authorization": f"Bearer {self.awardtool_key}"},
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            flights = []
            
            for f in data.get("flights", []):
                flights.append({
                    "flight_number": f.get("flight_number"),
                    "airline": f.get("airline"),
                    "origin": origin,
                    "destination": destination,
                    "departure": f.get("departure_time"),
                    "arrival": f.get("arrival_time"),
                    "duration_minutes": f.get("duration_minutes"),
                    "cash_price": f.get("cash_price"),
                    "award_programs": [
                        {
                            "program": prog.get("program"),
                            "miles": prog.get("miles_required"),
                            "surcharge": prog.get("taxes_fees"),
                            "cabin": prog.get("cabin"),
                            "availability": prog.get("seats_available"),
                        }
                        for prog in f.get("award_options", [])
                    ],
                    "source": "awardtool",
                })
            
            return flights
    
    async def _search_amadeus(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[Dict]:
        """
        Query Amadeus Flight Offers API.
        
        Provides accurate cash prices and full schedule data.
        """
        token = await self._get_amadeus_token()
        if not token:
            return []
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://api.amadeus.com/v2/shopping/flight-offers",
                params={
                    "originLocationCode": origin,
                    "destinationLocationCode": destination,
                    "departureDate": date,
                    "adults": passengers,
                    "currencyCode": "USD",
                    "max": 20,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            flights = []
            
            for offer in data.get("data", []):
                for itinerary in offer.get("itineraries", []):
                    for segment in itinerary.get("segments", []):
                        flights.append({
                            "flight_number": f"{segment['carrierCode']}{segment['number']}",
                            "airline": segment.get("carrierCode"),
                            "origin": segment.get("departure", {}).get("iataCode"),
                            "destination": segment.get("arrival", {}).get("iataCode"),
                            "departure": segment.get("departure", {}).get("at"),
                            "arrival": segment.get("arrival", {}).get("at"),
                            "duration_minutes": self._parse_duration(segment.get("duration")),
                            "cash_price": float(offer.get("price", {}).get("total", 0)),
                            "award_programs": [],  # Amadeus doesn't have award data
                            "source": "amadeus",
                        })
            
            return flights
    
    async def _get_amadeus_token(self) -> Optional[str]:
        """Get or refresh Amadeus OAuth token."""
        if self._amadeus_token and self._amadeus_token_expiry:
            if datetime.now() < self._amadeus_token_expiry:
                return self._amadeus_token
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.amadeus.com/v1/security/oauth2/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.amadeus_key,
                    "client_secret": self.amadeus_secret,
                },
            )
            
            if response.status_code != 200:
                return None
            
            data = response.json()
            self._amadeus_token = data.get("access_token")
            expires_in = data.get("expires_in", 1800)
            self._amadeus_token_expiry = datetime.now() + timedelta(seconds=expires_in - 60)
            
            return self._amadeus_token
    
    def _parse_duration(self, iso_duration: str) -> int:
        """Parse ISO 8601 duration (PT2H30M) to minutes."""
        if not iso_duration:
            return 0
        
        import re
        match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?', iso_duration)
        if not match:
            return 0
        
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        return hours * 60 + minutes
```

### 2.2 Train APIs (Fully Dynamic)

```python
# backend/src/services/train_service.py

"""
Train service - fetches real-time train data from multiple regional APIs.
NO hardcoded routes, stations, or prices.
"""

from typing import Dict, List, Optional
import httpx
import asyncio
from dataclasses import dataclass
from datetime import datetime
import os


@dataclass
class TrainOption:
    """Unified train option from any provider."""
    origin_station: str
    origin_name: str
    destination_station: str
    destination_name: str
    operator: str
    train_number: str
    departure: datetime
    arrival: datetime
    duration_minutes: int
    price_usd: float
    cabin_class: str
    booking_url: Optional[str] = None


class TrainService:
    """
    Unified train search across regional providers.
    
    Supported regions:
    - Europe: Trainline API (covers UK, France, Germany, Italy, Spain, etc.)
    - USA: Amtrak API
    - Japan: JR Group APIs
    """
    
    def __init__(self):
        self.trainline_key = os.getenv("TRAINLINE_API_KEY")
        self.amtrak_key = os.getenv("AMTRAK_API_KEY")
        self.jr_key = os.getenv("JR_API_KEY")
    
    async def search_trains(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int = 1,
    ) -> List[TrainOption]:
        """
        Search all applicable train APIs based on region.
        
        Args:
            origin: IATA airport code or city code
            destination: IATA airport code or city code
            date: YYYY-MM-DD format
            passengers: Number of passengers
        
        Returns:
            List of TrainOption objects
        """
        # Determine region from origin/destination
        region = await self._detect_region(origin, destination)
        
        if region == "europe":
            return await self._search_trainline(origin, destination, date, passengers)
        elif region == "usa":
            return await self._search_amtrak(origin, destination, date, passengers)
        elif region == "japan":
            return await self._search_jr(origin, destination, date, passengers)
        else:
            # Try all and merge
            tasks = [
                self._search_trainline(origin, destination, date, passengers),
                self._search_amtrak(origin, destination, date, passengers),
                self._search_jr(origin, destination, date, passengers),
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            trains = []
            for r in results:
                if not isinstance(r, Exception):
                    trains.extend(r)
            return trains
    
    async def _detect_region(self, origin: str, destination: str) -> str:
        """
        Detect region from airport/city codes.
        
        Uses a location lookup API - NOT hardcoded.
        """
        # Query our location service (backed by Amadeus or similar)
        from src.services.location_service import LocationService
        loc_service = LocationService()
        
        origin_info = await loc_service.get_location_info(origin)
        dest_info = await loc_service.get_location_info(destination)
        
        origin_country = origin_info.get("country_code", "") if origin_info else ""
        dest_country = dest_info.get("country_code", "") if dest_info else ""
        
        # European countries (EU + UK + Switzerland + Norway)
        european_countries = await self._get_european_countries()
        
        if origin_country in european_countries and dest_country in european_countries:
            return "europe"
        
        if origin_country == "US" and dest_country == "US":
            return "usa"
        
        if origin_country == "JP" and dest_country == "JP":
            return "japan"
        
        return "unknown"
    
    async def _get_european_countries(self) -> set:
        """
        Get list of European country codes from database.
        NOT hardcoded - fetched from regions table.
        """
        from src.repos.region_repo import RegionRepo
        repo = RegionRepo()
        
        # Query database for European region countries
        european_region = await repo.get_region_by_name("Europe")
        if european_region:
            return set(european_region.get("country_codes", []))
        
        # Fallback: Query a geography API
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://restcountries.com/v3.1/region/europe",
                params={"fields": "cca2"},
            )
            if response.status_code == 200:
                countries = response.json()
                return {c.get("cca2") for c in countries}
        
        return set()
    
    async def _search_trainline(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[TrainOption]:
        """
        Search Trainline API (Europe's largest train booking platform).
        
        Covers: UK, France, Germany, Italy, Spain, Belgium, Netherlands, etc.
        """
        if not self.trainline_key:
            return []
        
        # First, resolve airport codes to station codes
        origin_station = await self._resolve_to_station(origin, "trainline")
        dest_station = await self._resolve_to_station(destination, "trainline")
        
        if not origin_station or not dest_station:
            return []
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://api.trainline.eu/v1/search",
                json={
                    "departure_station_id": origin_station["id"],
                    "arrival_station_id": dest_station["id"],
                    "departure_date": date,
                    "passengers": [{"age": 30}] * passengers,
                    "currency": "USD",
                },
                headers={
                    "X-API-Key": self.trainline_key,
                    "Content-Type": "application/json",
                },
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            trains = []
            
            for journey in data.get("journeys", []):
                trains.append(TrainOption(
                    origin_station=origin_station["code"],
                    origin_name=origin_station["name"],
                    destination_station=dest_station["code"],
                    destination_name=dest_station["name"],
                    operator=journey.get("operator", ""),
                    train_number=journey.get("train_number", ""),
                    departure=datetime.fromisoformat(journey.get("departure")),
                    arrival=datetime.fromisoformat(journey.get("arrival")),
                    duration_minutes=journey.get("duration_minutes", 0),
                    price_usd=journey.get("price", {}).get("amount", 0),
                    cabin_class=journey.get("class", "standard"),
                    booking_url=journey.get("booking_url"),
                ))
            
            return trains
    
    async def _search_amtrak(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[TrainOption]:
        """
        Search Amtrak API (US rail).
        """
        if not self.amtrak_key:
            return []
        
        origin_station = await self._resolve_to_station(origin, "amtrak")
        dest_station = await self._resolve_to_station(destination, "amtrak")
        
        if not origin_station or not dest_station:
            return []
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://api.amtrak.com/v1/fares",
                params={
                    "origin": origin_station["code"],
                    "destination": dest_station["code"],
                    "departure_date": date,
                    "passengers": passengers,
                },
                headers={"Authorization": f"Bearer {self.amtrak_key}"},
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            trains = []
            
            for train in data.get("trains", []):
                trains.append(TrainOption(
                    origin_station=origin_station["code"],
                    origin_name=origin_station["name"],
                    destination_station=dest_station["code"],
                    destination_name=dest_station["name"],
                    operator="Amtrak",
                    train_number=train.get("train_number", ""),
                    departure=datetime.fromisoformat(train.get("departure")),
                    arrival=datetime.fromisoformat(train.get("arrival")),
                    duration_minutes=train.get("duration_minutes", 0),
                    price_usd=train.get("fare_usd", 0),
                    cabin_class=train.get("class", "coach"),
                    booking_url=train.get("booking_url"),
                ))
            
            return trains
    
    async def _search_jr(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[TrainOption]:
        """
        Search JR (Japan Rail) APIs for Shinkansen and local trains.
        """
        if not self.jr_key:
            return []
        
        origin_station = await self._resolve_to_station(origin, "jr")
        dest_station = await self._resolve_to_station(destination, "jr")
        
        if not origin_station or not dest_station:
            return []
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://api.jreast.co.jp/v1/routes",
                params={
                    "from": origin_station["code"],
                    "to": dest_station["code"],
                    "date": date,
                    "passengers": passengers,
                },
                headers={"X-API-Key": self.jr_key},
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            trains = []
            
            for route in data.get("routes", []):
                trains.append(TrainOption(
                    origin_station=origin_station["code"],
                    origin_name=origin_station["name"],
                    destination_station=dest_station["code"],
                    destination_name=dest_station["name"],
                    operator=route.get("operator", "JR"),
                    train_number=route.get("train_name", ""),
                    departure=datetime.fromisoformat(route.get("departure")),
                    arrival=datetime.fromisoformat(route.get("arrival")),
                    duration_minutes=route.get("duration_minutes", 0),
                    price_usd=route.get("fare_usd", 0),  # Converted from JPY
                    cabin_class=route.get("class", "ordinary"),
                    booking_url=route.get("booking_url"),
                ))
            
            return trains
    
    async def _resolve_to_station(
        self,
        code: str,
        provider: str,
    ) -> Optional[Dict]:
        """
        Resolve airport/city code to train station.
        
        Uses provider's station search API - NOT hardcoded mapping.
        """
        # First check if it's already a station code in our cache
        from src.services.station_service import StationService
        station_service = StationService()
        
        # Try direct lookup
        station = await station_service.get_station_by_code(code, provider)
        if station:
            return station
        
        # Search by name/location
        stations = await station_service.search_stations_near_airport(code, provider)
        if stations:
            return stations[0]  # Return closest station
        
        return None
```

### 2.3 Station Resolution Service (Dynamic)

```python
# backend/src/services/station_service.py

"""
Station service - resolves airports/cities to train stations dynamically.
NO hardcoded station mappings.
"""

from typing import Dict, List, Optional
import httpx
from src.repos.station_cache_repo import StationCacheRepo


class StationService:
    """
    Resolves locations to train stations using provider APIs.
    Results are cached in database for performance.
    """
    
    def __init__(self):
        self.cache_repo = StationCacheRepo()
        self.trainline_key = os.getenv("TRAINLINE_API_KEY")
    
    async def get_station_by_code(
        self,
        code: str,
        provider: str,
    ) -> Optional[Dict]:
        """
        Get station info by code.
        
        First checks cache, then queries provider API.
        """
        # Check cache
        cached = await self.cache_repo.get_station(code, provider)
        if cached:
            return cached
        
        # Query provider
        station = await self._fetch_station_from_provider(code, provider)
        if station:
            await self.cache_repo.save_station(station, provider)
        
        return station
    
    async def search_stations_near_airport(
        self,
        airport_code: str,
        provider: str,
        max_distance_km: float = 50,
    ) -> List[Dict]:
        """
        Find train stations near an airport.
        
        Uses location service to get airport coordinates,
        then queries train provider for nearby stations.
        """
        from src.services.location_service import LocationService
        loc_service = LocationService()
        
        # Get airport location
        airport = await loc_service.get_location_info(airport_code)
        if not airport:
            return []
        
        lat = airport.get("latitude")
        lon = airport.get("longitude")
        city_name = airport.get("city_name", "")
        
        if not lat or not lon:
            return []
        
        # Search stations near coordinates
        if provider == "trainline":
            return await self._search_trainline_stations(lat, lon, city_name)
        elif provider == "amtrak":
            return await self._search_amtrak_stations(lat, lon, city_name)
        elif provider == "jr":
            return await self._search_jr_stations(lat, lon, city_name)
        
        return []
    
    async def _search_trainline_stations(
        self,
        lat: float,
        lon: float,
        city_name: str,
    ) -> List[Dict]:
        """Search Trainline for stations near coordinates."""
        async with httpx.AsyncClient() as client:
            # Try coordinate-based search
            response = await client.get(
                "https://api.trainline.eu/v1/stations",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "radius_km": 30,
                },
                headers={"X-API-Key": self.trainline_key},
            )
            
            if response.status_code == 200:
                data = response.json()
                return [
                    {
                        "id": s.get("id"),
                        "code": s.get("code"),
                        "name": s.get("name"),
                        "latitude": s.get("latitude"),
                        "longitude": s.get("longitude"),
                        "country": s.get("country_code"),
                    }
                    for s in data.get("stations", [])
                ]
            
            # Fallback: search by city name
            response = await client.get(
                "https://api.trainline.eu/v1/stations/search",
                params={"query": city_name},
                headers={"X-API-Key": self.trainline_key},
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get("stations", [])[:5]
            
            return []
```

### 2.4 Bus Service (Fully Dynamic)

```python
# backend/src/services/bus_service.py

"""
Bus service - fetches real-time bus data from providers.
NO hardcoded routes.
"""

from typing import Dict, List, Optional
import httpx
import asyncio
from dataclasses import dataclass


@dataclass
class BusOption:
    """Unified bus option from any provider."""
    origin: str
    origin_name: str
    destination: str
    destination_name: str
    operator: str
    departure: str
    arrival: str
    duration_minutes: int
    price_usd: float
    booking_url: Optional[str] = None


class BusService:
    """
    Unified bus search across providers.
    
    Providers:
    - FlixBus (Europe, USA)
    - BusBud (aggregator)
    - Greyhound (USA)
    - Megabus (USA, UK)
    """
    
    def __init__(self):
        self.flixbus_key = os.getenv("FLIXBUS_API_KEY")
        self.busbud_key = os.getenv("BUSBUD_API_KEY")
    
    async def search_buses(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int = 1,
    ) -> List[BusOption]:
        """
        Search all bus providers in parallel.
        """
        tasks = [
            self._search_flixbus(origin, destination, date, passengers),
            self._search_busbud(origin, destination, date, passengers),
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        buses = []
        for r in results:
            if not isinstance(r, Exception):
                buses.extend(r)
        
        return buses
    
    async def _search_flixbus(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[BusOption]:
        """Query FlixBus API."""
        if not self.flixbus_key:
            return []
        
        # Resolve airport/city to FlixBus station
        origin_station = await self._resolve_to_bus_stop(origin, "flixbus")
        dest_station = await self._resolve_to_bus_stop(destination, "flixbus")
        
        if not origin_station or not dest_station:
            return []
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                "https://global.api.flixbus.com/search/service/v4/search",
                params={
                    "from_city_id": origin_station["id"],
                    "to_city_id": dest_station["id"],
                    "departure_date": date,
                    "products": '{"adult": ' + str(passengers) + '}',
                    "currency": "USD",
                },
                headers={"X-API-Key": self.flixbus_key},
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            buses = []
            
            for trip in data.get("trips", []):
                for result in trip.get("results", []):
                    buses.append(BusOption(
                        origin=origin,
                        origin_name=origin_station["name"],
                        destination=destination,
                        destination_name=dest_station["name"],
                        operator="FlixBus",
                        departure=result.get("departure", {}).get("date"),
                        arrival=result.get("arrival", {}).get("date"),
                        duration_minutes=result.get("duration", {}).get("minutes", 0),
                        price_usd=result.get("price", {}).get("total", 0),
                        booking_url=result.get("booking_url"),
                    ))
            
            return buses
    
    async def _search_busbud(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[BusOption]:
        """
        Query BusBud API (aggregator covering multiple bus companies).
        """
        if not self.busbud_key:
            return []
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            # BusBud uses geohashes, so we need to resolve locations first
            from src.services.location_service import LocationService
            loc_service = LocationService()
            
            origin_info = await loc_service.get_location_info(origin)
            dest_info = await loc_service.get_location_info(destination)
            
            if not origin_info or not dest_info:
                return []
            
            response = await client.get(
                f"https://napi.busbud.com/x-departures/{origin_info['geohash']}/{dest_info['geohash']}/{date}",
                headers={
                    "X-Busbud-Token": self.busbud_key,
                    "Accept": "application/vnd.busbud+json; version=2; profile=https://schema.busbud.com/v2/",
                },
                params={"adult": passengers},
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            buses = []
            
            for dep in data.get("departures", []):
                buses.append(BusOption(
                    origin=origin,
                    origin_name=dep.get("origin_location", {}).get("name", ""),
                    destination=destination,
                    destination_name=dep.get("destination_location", {}).get("name", ""),
                    operator=dep.get("operator", {}).get("name", ""),
                    departure=dep.get("departure_time"),
                    arrival=dep.get("arrival_time"),
                    duration_minutes=dep.get("duration", 0),
                    price_usd=dep.get("prices", {}).get("total", 0) / 100,  # BusBud uses cents
                    booking_url=dep.get("links", {}).get("deeplink"),
                ))
            
            return buses
```

---

## Credit Card Benefits System

### 3.1 Overview

Credit card benefits are **stored in a database** and **dynamically applied** during optimization.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CREDIT CARD BENEFITS FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

1. User adds card to profile
   └── Stored in: user_cards table

2. Card benefits loaded from: card_benefits table
   └── Benefits like: free_bags, lounge_access, priority_boarding

3. During optimization:
   ├── For each flight edge
   │   ├── Check if user has a card with benefits for that airline
   │   │   └── e.g., Amex Delta Gold → free bags on Delta flights
   │   ├── Calculate benefit value
   │   │   └── e.g., 2 free bags × $35/bag = $70 saved
   │   └── Add to ILP objective as negative cost (savings)
   │
   └── Output includes:
       ├── Which card to use for each booking
       └── Total benefits realized
```

### 3.2 Database Schema for Card Benefits

```sql
-- Card definitions (managed by admin, NOT hardcoded)
CREATE TABLE credit_cards (
    id VARCHAR(50) PRIMARY KEY,
    issuer VARCHAR(50) NOT NULL,           -- 'amex', 'chase', 'citi', etc.
    name VARCHAR(100) NOT NULL,            -- 'Delta SkyMiles Gold Card'
    annual_fee DECIMAL(10,2),
    points_program VARCHAR(50),            -- 'delta_skymiles', 'chase_ur', etc.
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Card benefits (many benefits per card)
CREATE TABLE card_benefits (
    id VARCHAR(50) PRIMARY KEY,
    card_id VARCHAR(50) REFERENCES credit_cards(id),
    benefit_type VARCHAR(50) NOT NULL,     -- See benefit types below
    benefit_value JSONB NOT NULL,          -- Flexible value structure
    conditions JSONB,                       -- When benefit applies
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- User's cards
CREATE TABLE user_cards (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    card_id VARCHAR(50) REFERENCES credit_cards(id),
    is_primary BOOLEAN DEFAULT FALSE,
    added_at TIMESTAMP DEFAULT NOW()
);

-- Transfer partners (dynamic, not hardcoded)
CREATE TABLE transfer_partners (
    id VARCHAR(50) PRIMARY KEY,
    source_program VARCHAR(50) NOT NULL,   -- 'chase_ur', 'amex_mr', etc.
    destination_program VARCHAR(50) NOT NULL, -- 'UA', 'DL', etc.
    transfer_ratio DECIMAL(5,3) DEFAULT 1.0,  -- 1.0 = 1:1
    bonus_ratio DECIMAL(5,3) DEFAULT 1.0,     -- Current promotion (1.25 = 25% bonus)
    bonus_expires_at TIMESTAMP,
    min_transfer INT DEFAULT 1000,
    transfer_time_days INT DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3.3 Benefit Types

```python
# backend/src/models/card_benefits.py

"""
Card benefit types and their value calculations.
All benefit rules are database-driven, not hardcoded.
"""

from enum import Enum
from typing import Dict, Any, List, Optional
from dataclasses import dataclass


class BenefitType(Enum):
    """Types of credit card travel benefits."""
    
    # Baggage benefits
    FREE_CHECKED_BAG = "free_checked_bag"
    FREE_CARRY_ON = "free_carry_on"
    
    # Airport benefits
    LOUNGE_ACCESS = "lounge_access"
    PRIORITY_BOARDING = "priority_boarding"
    TSA_PRECHECK_CREDIT = "tsa_precheck_credit"
    GLOBAL_ENTRY_CREDIT = "global_entry_credit"
    
    # Travel credits
    AIRLINE_INCIDENTAL_CREDIT = "airline_incidental_credit"
    TRAVEL_CREDIT = "travel_credit"
    HOTEL_CREDIT = "hotel_credit"
    
    # Status benefits
    ELITE_STATUS = "elite_status"
    COMPANION_CERTIFICATE = "companion_certificate"
    
    # Booking benefits
    TRIP_DELAY_INSURANCE = "trip_delay_insurance"
    TRIP_CANCELLATION_INSURANCE = "trip_cancellation_insurance"
    RENTAL_CAR_INSURANCE = "rental_car_insurance"
    
    # Earning benefits
    BONUS_POINTS_CATEGORY = "bonus_points_category"


@dataclass
class BenefitValue:
    """Calculated value of a benefit for a specific booking."""
    benefit_type: BenefitType
    card_id: str
    card_name: str
    monetary_value: float
    description: str
    applies_to: str  # "entire_booking", "cardholder_only", "per_segment"
    conditions_met: List[str]


class CardBenefitsCalculator:
    """
    Calculates the monetary value of card benefits for a booking.
    
    All rules come from the database - nothing is hardcoded.
    """
    
    def __init__(self, benefits_repo):
        self.benefits_repo = benefits_repo
        self._benefit_calculators = {
            BenefitType.FREE_CHECKED_BAG: self._calc_free_bag,
            BenefitType.LOUNGE_ACCESS: self._calc_lounge,
            BenefitType.AIRLINE_INCIDENTAL_CREDIT: self._calc_airline_credit,
            BenefitType.COMPANION_CERTIFICATE: self._calc_companion,
            # ... more calculators
        }
    
    async def calculate_benefits_for_edge(
        self,
        edge: Dict,
        user_cards: List[Dict],
        passengers: int,
        booking_date: str,
    ) -> List[BenefitValue]:
        """
        Calculate all applicable card benefits for a transport edge.
        
        Args:
            edge: Transport edge with airline, origin, destination
            user_cards: List of user's credit cards
            passengers: Number of passengers in booking
            booking_date: Date of travel
        
        Returns:
            List of applicable benefits with monetary values
        """
        benefits = []
        
        airline = edge.get("airline", "")
        mode = edge.get("mode", "flight")
        
        if mode != "flight":
            return []  # Card benefits typically only apply to flights
        
        for card in user_cards:
            card_benefits = await self.benefits_repo.get_benefits_for_card(card["card_id"])
            
            for benefit in card_benefits:
                benefit_type = BenefitType(benefit["benefit_type"])
                conditions = benefit.get("conditions", {})
                
                # Check if benefit applies to this airline/booking
                if not self._check_conditions(conditions, airline, edge, booking_date):
                    continue
                
                # Calculate value
                calculator = self._benefit_calculators.get(benefit_type)
                if calculator:
                    value = await calculator(
                        benefit=benefit,
                        edge=edge,
                        passengers=passengers,
                        card=card,
                    )
                    if value:
                        benefits.append(value)
        
        return benefits
    
    def _check_conditions(
        self,
        conditions: Dict,
        airline: str,
        edge: Dict,
        booking_date: str,
    ) -> bool:
        """
        Check if benefit conditions are met.
        
        Conditions are stored in database as JSON, e.g.:
        {
            "airlines": ["DL", "DL*"],  # Delta and Delta partners
            "booking_method": ["direct", "points"],
            "cabin_classes": ["economy", "premium_economy", "business", "first"],
            "routes": {"domestic": true, "international": true},
        }
        """
        # Check airline condition
        if "airlines" in conditions:
            allowed_airlines = conditions["airlines"]
            if airline not in allowed_airlines:
                # Check for partner airlines (e.g., "DL*" means Delta partners)
                partner_match = any(
                    a.endswith("*") and airline.startswith(a[:-1])
                    for a in allowed_airlines
                )
                if not partner_match:
                    return False
        
        # Check cabin class
        if "cabin_classes" in conditions:
            cabin = edge.get("cabin", "economy")
            if cabin not in conditions["cabin_classes"]:
                return False
        
        # Check route type
        if "routes" in conditions:
            route_type = self._get_route_type(edge)
            if not conditions["routes"].get(route_type, False):
                return False
        
        return True
    
    async def _calc_free_bag(
        self,
        benefit: Dict,
        edge: Dict,
        passengers: int,
        card: Dict,
    ) -> Optional[BenefitValue]:
        """
        Calculate free checked bag benefit value.
        
        Example benefit_value from database:
        {
            "bags_per_person": 1,
            "applies_to": "booking_party",  # or "cardholder_only"
            "bag_value_usd": 35,
        }
        """
        value_config = benefit.get("benefit_value", {})
        
        bags_per_person = value_config.get("bags_per_person", 1)
        applies_to = value_config.get("applies_to", "cardholder_only")
        bag_value = value_config.get("bag_value_usd", 35)
        
        if applies_to == "booking_party":
            # Benefit applies to all passengers
            total_bags = bags_per_person * passengers
        else:
            # Only cardholder
            total_bags = bags_per_person
        
        monetary_value = total_bags * bag_value
        
        return BenefitValue(
            benefit_type=BenefitType.FREE_CHECKED_BAG,
            card_id=card["card_id"],
            card_name=card.get("card_name", ""),
            monetary_value=monetary_value,
            description=f"{total_bags} free checked bag(s) @ ${bag_value}/bag",
            applies_to=applies_to,
            conditions_met=[f"Flying {edge.get('airline', '')}"],
        )
    
    async def _calc_lounge(
        self,
        benefit: Dict,
        edge: Dict,
        passengers: int,
        card: Dict,
    ) -> Optional[BenefitValue]:
        """
        Calculate lounge access value.
        
        Example benefit_value from database:
        {
            "lounge_network": "delta_sky_club",  # or "priority_pass", "centurion"
            "guests_included": 2,
            "estimated_value_usd": 50,
        }
        """
        value_config = benefit.get("benefit_value", {})
        
        guests = min(value_config.get("guests_included", 0), passengers - 1)
        value_per_person = value_config.get("estimated_value_usd", 50)
        
        # Only count if there's a lounge at the departure airport
        has_lounge = await self._check_lounge_at_airport(
            edge.get("origin"),
            value_config.get("lounge_network"),
        )
        
        if not has_lounge:
            return None
        
        # Cardholder + guests
        total_people = 1 + guests
        monetary_value = total_people * value_per_person
        
        return BenefitValue(
            benefit_type=BenefitType.LOUNGE_ACCESS,
            card_id=card["card_id"],
            card_name=card.get("card_name", ""),
            monetary_value=monetary_value,
            description=f"Lounge access for {total_people} @ ${value_per_person}/person",
            applies_to="cardholder_plus_guests",
            conditions_met=[f"Lounge available at {edge.get('origin')}"],
        )
    
    async def _calc_airline_credit(
        self,
        benefit: Dict,
        edge: Dict,
        passengers: int,
        card: Dict,
    ) -> Optional[BenefitValue]:
        """
        Calculate airline incidental credit value.
        
        Example benefit_value from database:
        {
            "annual_credit_usd": 200,
            "selected_airline": "DL",  # User must select one airline per year
            "covers": ["baggage", "seat_selection", "inflight_purchases"],
        }
        """
        value_config = benefit.get("benefit_value", {})
        
        selected_airline = value_config.get("selected_airline")
        if selected_airline and edge.get("airline") != selected_airline:
            return None
        
        # Check if user has remaining credit this year
        # (Would query user_card_credit_usage table)
        remaining_credit = await self._get_remaining_credit(
            card["id"],
            benefit["id"],
        )
        
        if remaining_credit <= 0:
            return None
        
        # Estimate what portion of credit applies to this booking
        # (Conservative estimate: seat selection + baggage)
        estimated_use = min(remaining_credit, 50)  # $50 estimate
        
        return BenefitValue(
            benefit_type=BenefitType.AIRLINE_INCIDENTAL_CREDIT,
            card_id=card["card_id"],
            card_name=card.get("card_name", ""),
            monetary_value=estimated_use,
            description=f"Up to ${remaining_credit} airline credit available",
            applies_to="cardholder",
            conditions_met=[f"Flying {edge.get('airline', '')}"],
        )
```

### 3.4 Sample Card Benefit Data (Database Records)

```python
# Example data that would be in the database (loaded via admin API)

SAMPLE_CARDS = [
    {
        "id": "amex_delta_gold",
        "issuer": "amex",
        "name": "Delta SkyMiles Gold American Express Card",
        "annual_fee": 0,  # No annual fee first year
        "points_program": "delta_skymiles",
    },
    {
        "id": "amex_delta_platinum",
        "issuer": "amex",
        "name": "Delta SkyMiles Platinum American Express Card",
        "annual_fee": 350,
        "points_program": "delta_skymiles",
    },
    {
        "id": "chase_sapphire_reserve",
        "issuer": "chase",
        "name": "Chase Sapphire Reserve",
        "annual_fee": 550,
        "points_program": "chase_ur",
    },
    {
        "id": "amex_platinum",
        "issuer": "amex",
        "name": "The Platinum Card from American Express",
        "annual_fee": 695,
        "points_program": "amex_mr",
    },
]

SAMPLE_BENEFITS = [
    # Amex Delta Gold - Free first checked bag
    {
        "id": "amex_delta_gold_bag",
        "card_id": "amex_delta_gold",
        "benefit_type": "free_checked_bag",
        "benefit_value": {
            "bags_per_person": 1,
            "applies_to": "booking_party",  # Everyone in the booking!
            "bag_value_usd": 35,
        },
        "conditions": {
            "airlines": ["DL"],  # Delta only
            "booking_method": ["direct", "delta_vacations"],
        },
    },
    # Amex Delta Platinum - Free first checked bag
    {
        "id": "amex_delta_plat_bag",
        "card_id": "amex_delta_platinum",
        "benefit_type": "free_checked_bag",
        "benefit_value": {
            "bags_per_person": 1,
            "applies_to": "booking_party",
            "bag_value_usd": 35,
        },
        "conditions": {
            "airlines": ["DL"],
        },
    },
    # Amex Delta Platinum - Companion certificate
    {
        "id": "amex_delta_plat_companion",
        "card_id": "amex_delta_platinum",
        "benefit_type": "companion_certificate",
        "benefit_value": {
            "companion_fare_usd": 0,  # Free companion
            "taxes_apply": True,
            "route_type": "domestic_us",
            "cabin": "main_cabin",
            "estimated_value_usd": 400,  # Average domestic ticket
        },
        "conditions": {
            "airlines": ["DL"],
            "routes": {"domestic": True, "international": False},
        },
    },
    # Chase Sapphire Reserve - Priority Pass lounge
    {
        "id": "csr_priority_pass",
        "card_id": "chase_sapphire_reserve",
        "benefit_type": "lounge_access",
        "benefit_value": {
            "lounge_network": "priority_pass",
            "guests_included": 2,
            "estimated_value_usd": 32,  # Priority Pass value
        },
        "conditions": {},  # Any airport with Priority Pass
    },
    # Chase Sapphire Reserve - $300 travel credit
    {
        "id": "csr_travel_credit",
        "card_id": "chase_sapphire_reserve",
        "benefit_type": "travel_credit",
        "benefit_value": {
            "annual_credit_usd": 300,
            "covers": ["flights", "hotels", "trains", "buses", "tolls", "parking"],
        },
        "conditions": {},  # Any travel purchase
    },
    # Amex Platinum - Airline incidental credit
    {
        "id": "amex_plat_airline_credit",
        "card_id": "amex_platinum",
        "benefit_type": "airline_incidental_credit",
        "benefit_value": {
            "annual_credit_usd": 200,
            "selected_airline": None,  # User selects one airline
            "covers": ["baggage", "seat_selection", "inflight_purchases"],
        },
        "conditions": {},
    },
    # Amex Platinum - Centurion lounge
    {
        "id": "amex_plat_centurion",
        "card_id": "amex_platinum",
        "benefit_type": "lounge_access",
        "benefit_value": {
            "lounge_network": "centurion",
            "guests_included": 2,
            "estimated_value_usd": 50,
        },
        "conditions": {},
    },
]

SAMPLE_TRANSFER_PARTNERS = [
    # Chase Ultimate Rewards partners
    {"source_program": "chase_ur", "destination_program": "UA", "transfer_ratio": 1.0},
    {"source_program": "chase_ur", "destination_program": "BA", "transfer_ratio": 1.0},
    {"source_program": "chase_ur", "destination_program": "SQ", "transfer_ratio": 1.0},
    {"source_program": "chase_ur", "destination_program": "VS", "transfer_ratio": 1.0},
    {"source_program": "chase_ur", "destination_program": "AF", "transfer_ratio": 1.0},
    {"source_program": "chase_ur", "destination_program": "IB", "transfer_ratio": 1.0},
    
    # Amex Membership Rewards partners
    {"source_program": "amex_mr", "destination_program": "DL", "transfer_ratio": 1.0},
    {"source_program": "amex_mr", "destination_program": "BA", "transfer_ratio": 1.0},
    {"source_program": "amex_mr", "destination_program": "SQ", "transfer_ratio": 1.0},
    {"source_program": "amex_mr", "destination_program": "AF", "transfer_ratio": 1.0},
    {"source_program": "amex_mr", "destination_program": "AV", "transfer_ratio": 1.0},
    
    # Citi ThankYou partners
    {"source_program": "citi_ty", "destination_program": "TK", "transfer_ratio": 1.0},
    {"source_program": "citi_ty", "destination_program": "SQ", "transfer_ratio": 1.0},
    {"source_program": "citi_ty", "destination_program": "VS", "transfer_ratio": 1.0},
    
    # Capital One partners
    {"source_program": "capitalone", "destination_program": "AF", "transfer_ratio": 1.0},
    {"source_program": "capitalone", "destination_program": "BA", "transfer_ratio": 1.0},
    {"source_program": "capitalone", "destination_program": "TK", "transfer_ratio": 1.0},
    
    # Bilt partners
    {"source_program": "bilt", "destination_program": "AA", "transfer_ratio": 1.0},
    {"source_program": "bilt", "destination_program": "UA", "transfer_ratio": 1.0},
    {"source_program": "bilt", "destination_program": "TK", "transfer_ratio": 1.0},
]
```

---

## Enhanced ILP Objective Function

### 4.1 New Objective with Card Benefits

The objective function now includes **card benefits as cost reductions**:

```
MINIMIZE:
    W₁ × (OutOfPocket - CardBenefitsValue)
  + W₂ × Time

Where:
- OutOfPocket = CashBookings + PointsSurcharges
- CardBenefitsValue = Sum of all applicable card benefits
```

### 4.2 Updated ILP Implementation

```python
# backend/src/handlers/points_maximizer_v4.py

"""
Points Maximization with Dynamic Card Benefits (v4)

Changes from v3:
1. Card benefits loaded from database
2. Benefits integrated into objective function
3. Card selection per edge is a decision variable
"""

from typing import List, Dict, Tuple, Set, Optional
import pulp as pl
from src.models.card_benefits import CardBenefitsCalculator, BenefitValue


async def plan_minimize_out_of_pocket_with_benefits(
    # Standard parameters from v3
    travelers: List[str],
    start_city: Dict[str, str],
    end_city: Dict[str, str],
    cities: List[str],
    edges: List[Tuple[str, str, str]],
    time_cost: Dict[Tuple, float],
    cash_cost: Dict[Tuple, float],
    airlines: List[str],
    award_points: Dict[str, Dict[Tuple, float]],
    cash_surcharge: Dict[str, Dict[Tuple, float]],
    allowed_award_edge: Dict[str, Dict[Tuple, int]],
    sources_by_trav: Dict[str, List[str]],
    source_balances: Dict[Tuple[str, str], float],
    allowed_sa: Set[Tuple[str, str]],
    ratio: Dict[Tuple[str, str], float],
    bonus: Dict[Tuple[str, str], float],
    inc_source: Dict[Tuple[str, str], int],
    miles_balance: Dict[Tuple[str, str], float],
    link_ok: Dict[Tuple[str, str], int],
    budget_cash: Dict[str, float],
    can_pay_for: Dict[Tuple[str, str], int],
    must_visit_cities: List[str] = None,
    
    # NEW: Card benefits parameters
    user_cards: Dict[str, List[Dict]] = None,  # {traveler: [cards]}
    edge_benefits: Dict[Tuple, Dict[str, List[BenefitValue]]] = None,  # Pre-calculated
    
    # Weights
    W1: float = 1e6,   # Out-of-pocket (primary)
    W2: float = 1.0,   # Time (secondary)
) -> Dict:
    """
    ═══════════════════════════════════════════════════════════════════════════
    ILP v4: MINIMIZE OUT-OF-POCKET MINUS CARD BENEFITS
    ═══════════════════════════════════════════════════════════════════════════
    
    OBJECTIVE:
        MINIMIZE: W₁ × (OutOfPocket - BenefitsValue) + W₂ × Time
    
    This means:
    - Lower out-of-pocket is better
    - Card benefits REDUCE effective cost
    - Time is a tiebreaker
    
    NEW DECISION VARIABLES:
        card_use[q][c][e] ∈ {0,1}: Does traveler q use card c for edge e?
    
    NEW CONSTRAINTS:
        - At most one card used per edge
        - Card benefits only apply if card is used
        - Benefits depend on payment method (cash vs points)
    """
    
    T = travelers
    A = airlines
    INF = 1e9
    
    user_cards = user_cards or {}
    edge_benefits = edge_benefits or {}
    
    # ═══════════════════════════════════════════════════════════════════════
    # HELPER FUNCTIONS
    # ═══════════════════════════════════════════════════════════════════════
    
    def get_miles(airline: str, edge: Tuple) -> float:
        return award_points.get(airline, {}).get(edge, INF)
    
    def get_surcharge(airline: str, edge: Tuple) -> float:
        return cash_surcharge.get(airline, {}).get(edge, INF)
    
    def get_benefit_value(edge: Tuple, card_id: str) -> float:
        """Get total monetary value of benefits for edge+card combination."""
        benefits = edge_benefits.get(edge, {}).get(card_id, [])
        return sum(b.monetary_value for b in benefits)
    
    def get_all_card_ids(traveler: str) -> List[str]:
        """Get all card IDs for a traveler."""
        return [c["card_id"] for c in user_cards.get(traveler, [])]
    
    # ═══════════════════════════════════════════════════════════════════════
    # CREATE MODEL
    # ═══════════════════════════════════════════════════════════════════════
    
    m = pl.LpProblem("MinimizeOutOfPocketWithBenefits", pl.LpMinimize)
    
    # ─────────────────────────────────────────────────────────────────────
    # EXISTING DECISION VARIABLES (from v3)
    # ─────────────────────────────────────────────────────────────────────
    
    # x[p][e]: Does passenger p take edge e?
    x = {
        p: {e: pl.LpVariable(f"x_{p}_{e}", cat="Binary") for e in edges}
        for p in T
    }
    
    # z[q,p][e]: Does payer q pay CASH for passenger p on edge e?
    z = {
        (q, p): {e: pl.LpVariable(f"z_{q}_{p}_{e}", cat="Binary") for e in edges}
        for q in T for p in T
    }
    
    # y[q,p][s,a][e]: Transfer from bank s to airline a
    y = {
        (q, p): {
            (s, a): {e: pl.LpVariable(f"y_{q}_{p}_{s}_{a}_{e}", cat="Binary") for e in edges}
            for s in sources_by_trav.get(q, [])
            for a in A
            if (s, a) in allowed_sa
        }
        for q in T for p in T
    }
    
    # y_native[q,p][a][e]: Use native miles from airline a
    y_native = {
        (q, p): {
            a: {e: pl.LpVariable(f"yn_{q}_{p}_{a}_{e}", cat="Binary") for e in edges}
            for a in A
        }
        for q in T for p in T
    }
    
    # t_blocks[q][s,a]: Transfer blocks
    t_blocks = {
        q: {
            (s, a): pl.LpVariable(f"t_{q}_{s}_{a}", lowBound=0, cat="Integer")
            for s in sources_by_trav.get(q, [])
            for a in A
            if (s, a) in allowed_sa
        }
        for q in T
    }
    
    # ─────────────────────────────────────────────────────────────────────
    # NEW: CARD USAGE DECISION VARIABLES
    # ─────────────────────────────────────────────────────────────────────
    
    # card_use[q][c][e]: Does traveler q use card c for edge e?
    card_use = {
        q: {
            c: {e: pl.LpVariable(f"card_{q}_{c}_{e}", cat="Binary") for e in edges}
            for c in get_all_card_ids(q)
        }
        for q in T
    }
    
    # ═══════════════════════════════════════════════════════════════════════
    # EXISTING CONSTRAINTS (from v3)
    # ═══════════════════════════════════════════════════════════════════════
    
    # Path constraints (same as v3)
    for p in T:
        m += pl.lpSum(x[p][e] for e in edges if e[0] == start_city[p]) == 1
        m += pl.lpSum(x[p][e] for e in edges if e[1] == end_city[p]) == 1
        for city in cities:
            outflow = pl.lpSum(x[p][e] for e in edges if e[0] == city)
            inflow = pl.lpSum(x[p][e] for e in edges if e[1] == city)
            if city == start_city[p]:
                m += outflow - inflow == 1
            elif city == end_city[p]:
                m += outflow - inflow == -1
            else:
                m += outflow == inflow
    
    # Must-visit constraints
    for city in (must_visit_cities or []):
        for p in T:
            if city != start_city.get(p) and city != end_city.get(p):
                m += pl.lpSum(x[p][e] for e in edges if e[1] == city) == 1
    
    # Payment exclusivity
    for p in T:
        for e in edges:
            cash_pay = pl.lpSum(z[(q, p)][e] for q in T)
            transfer_pay = pl.lpSum(
                y[(q, p)][(s, a)][e]
                for q in T for (s, a) in y[(q, p)].keys()
            )
            native_pay = pl.lpSum(y_native[(q, p)][a][e] for q in T for a in A)
            m += cash_pay + transfer_pay + native_pay == x[p][e]
    
    # Transfer and balance constraints (same as v3)
    for q in T:
        for s in sources_by_trav.get(q, []):
            for a in A:
                if (s, a) not in allowed_sa:
                    continue
                block_size = inc_source.get((s, a), 1000)
                miles_per_block = block_size * ratio.get((s, a), 1.0) * bonus.get((s, a), 1.0)
                miles_used = pl.lpSum(
                    y[(q, p)][(s, a)][e] * get_miles(a, e)
                    for p in T for e in edges if (s, a) in y[(q, p)]
                )
                m += miles_used <= t_blocks[q][(s, a)] * miles_per_block
                m += t_blocks[q][(s, a)] * block_size <= source_balances.get((q, s), 0)
    
    for q in T:
        for a in A:
            miles_used = pl.lpSum(
                y_native[(q, p)][a][e] * get_miles(a, e)
                for p in T for e in edges
            )
            m += miles_used <= miles_balance.get((q, a), 0)
    
    # Budget constraints
    for q in T:
        cash_spend = pl.lpSum(
            z[(q, p)][e] * cash_cost.get(e, 0) for p in T for e in edges
        )
        transfer_sur = pl.lpSum(
            y[(q, p)][(s, a)][e] * get_surcharge(a, e)
            for p in T for (s, a) in y[(q, p)].keys() for e in edges
        )
        native_sur = pl.lpSum(
            y_native[(q, p)][a][e] * get_surcharge(a, e)
            for p in T for a in A for e in edges
        )
        m += cash_spend + transfer_sur + native_sur <= budget_cash[q]
    
    # ═══════════════════════════════════════════════════════════════════════
    # NEW: CARD USAGE CONSTRAINTS
    # ═══════════════════════════════════════════════════════════════════════
    
    # At most one card used per edge (per traveler)
    for q in T:
        for e in edges:
            if card_use[q]:
                m += pl.lpSum(card_use[q][c][e] for c in card_use[q].keys()) <= 1
    
    # Card can only be used if traveler is paying for that edge
    for q in T:
        for p in T:
            for e in edges:
                is_paying = (
                    z[(q, p)][e]
                    + pl.lpSum(y[(q, p)][(s, a)][e] for (s, a) in y[(q, p)].keys())
                    + pl.lpSum(y_native[(q, p)][a][e] for a in A)
                )
                for c in get_all_card_ids(q):
                    # Can only use card if q is paying for p on this edge
                    m += card_use[q][c][e] <= is_paying
    
    # ═══════════════════════════════════════════════════════════════════════
    # OBJECTIVE FUNCTION: MINIMIZE (OUT-OF-POCKET - BENEFITS)
    # ═══════════════════════════════════════════════════════════════════════
    
    # Component 1: Cash bookings
    cash_total = pl.lpSum(
        z[(q, p)][e] * cash_cost.get(e, 0)
        for q in T for p in T for e in edges
    )
    
    # Component 2: Surcharges
    surcharge_total = (
        pl.lpSum(
            y[(q, p)][(s, a)][e] * get_surcharge(a, e)
            for q in T for p in T for (s, a) in y[(q, p)].keys() for e in edges
        )
        + pl.lpSum(
            y_native[(q, p)][a][e] * get_surcharge(a, e)
            for q in T for p in T for a in A for e in edges
        )
    )
    
    out_of_pocket = cash_total + surcharge_total
    
    # Component 3: Card benefits (REDUCE cost)
    card_benefits_total = pl.lpSum(
        card_use[q][c][e] * get_benefit_value(e, c)
        for q in T
        for c in get_all_card_ids(q)
        for e in edges
    )
    
    # Component 4: Time
    total_time = pl.lpSum(
        x[p][e] * time_cost.get(e, 0)
        for p in T for e in edges
    )
    
    # ═══════════════════════════════════════════════════════════════════════
    # THE OBJECTIVE
    # ═══════════════════════════════════════════════════════════════════════
    
    # Minimize: (out_of_pocket - card_benefits) + time
    # Benefits are subtracted because they reduce effective cost
    m += W1 * (out_of_pocket - card_benefits_total) + W2 * total_time
    
    # ═══════════════════════════════════════════════════════════════════════
    # SOLVE
    # ═══════════════════════════════════════════════════════════════════════
    
    m.solve(pl.PULP_CBC_CMD(msg=False))
    
    # ═══════════════════════════════════════════════════════════════════════
    # EXTRACT SOLUTION
    # ═══════════════════════════════════════════════════════════════════════
    
    solution = {
        "status": pl.LpStatus[m.status],
        "path": {p: [] for p in T},
        "edges": {p: [] for p in T},
        "pay_mode": {p: [] for p in T},
        "card_usage": {q: {} for q in T},  # NEW: Which cards were used
        "benefits_applied": [],              # NEW: List of benefits
        "totals": {
            "cash": 0.0,
            "airline_points": 0.0,
            "time": 0.0,
            "benefits_value": 0.0,           # NEW: Total benefit value
            "effective_cost": 0.0,           # NEW: cash - benefits
            "transfers": {q: {} for q in T},
            "native_used": {q: {} for q in T},
        },
    }
    
    if pl.LpStatus[m.status] != "Optimal":
        return solution
    
    # Extract paths (same as v3)
    for p in T:
        chosen = [e for e in edges if pl.value(x[p][e]) > 0.5]
        solution["edges"][p] = [[e[0], e[1], e[2]] for e in chosen]
        next_city = {e[0]: e[1] for e in chosen}
        path = [start_city[p]]
        cur = start_city[p]
        while cur in next_city and cur != end_city[p]:
            cur = next_city[cur]
            path.append(cur)
        solution["path"][p] = path
    
    # Extract payments and benefits
    total_cash = 0.0
    total_points = 0.0
    total_time_val = 0.0
    total_benefits = 0.0
    
    for p in T:
        for e in [tuple(edge) for edge in solution["edges"][p]]:
            total_time_val += time_cost.get(e, 0)
            
            # Find payment method
            for q in T:
                if pl.value(z[(q, p)][e]) > 0.5:
                    fare = cash_cost.get(e, 0)
                    total_cash += fare
                    
                    payment = {
                        "edge": [e[0], e[1], e[2]],
                        "type": "cash",
                        "payer": q,
                        "fare": fare,
                    }
                    
                    # Check for card benefits
                    for c in get_all_card_ids(q):
                        if pl.value(card_use[q][c][e]) > 0.5:
                            benefit_val = get_benefit_value(e, c)
                            total_benefits += benefit_val
                            payment["card_used"] = c
                            payment["benefits_value"] = benefit_val
                            payment["benefits"] = [
                                {
                                    "type": b.benefit_type.value,
                                    "value": b.monetary_value,
                                    "description": b.description,
                                }
                                for b in edge_benefits.get(e, {}).get(c, [])
                            ]
                            solution["card_usage"][q][c] = solution["card_usage"][q].get(c, 0) + 1
                            break
                    
                    solution["pay_mode"][p].append(payment)
                    break
                
                # Check transfer payments
                for (s, a) in y[(q, p)].keys():
                    if pl.value(y[(q, p)][(s, a)][e]) > 0.5:
                        miles = get_miles(a, e)
                        sur = get_surcharge(a, e)
                        total_cash += sur
                        total_points += miles
                        
                        payment = {
                            "edge": [e[0], e[1], e[2]],
                            "type": "points",
                            "payer": q,
                            "via": {"source": s, "airline": a},
                            "miles": miles,
                            "surcharge": sur,
                        }
                        
                        # Check for card benefits on points bookings too
                        for c in get_all_card_ids(q):
                            if pl.value(card_use[q][c][e]) > 0.5:
                                benefit_val = get_benefit_value(e, c)
                                total_benefits += benefit_val
                                payment["card_used"] = c
                                payment["benefits_value"] = benefit_val
                                payment["benefits"] = [
                                    {
                                        "type": b.benefit_type.value,
                                        "value": b.monetary_value,
                                        "description": b.description,
                                    }
                                    for b in edge_benefits.get(e, {}).get(c, [])
                                ]
                                break
                        
                        solution["pay_mode"][p].append(payment)
                        break
                
                # Check native payments
                for a in A:
                    if pl.value(y_native[(q, p)][a][e]) > 0.5:
                        miles = get_miles(a, e)
                        sur = get_surcharge(a, e)
                        total_cash += sur
                        total_points += miles
                        
                        payment = {
                            "edge": [e[0], e[1], e[2]],
                            "type": "points",
                            "payer": q,
                            "via": {"native": a},
                            "miles": miles,
                            "surcharge": sur,
                        }
                        
                        for c in get_all_card_ids(q):
                            if pl.value(card_use[q][c][e]) > 0.5:
                                benefit_val = get_benefit_value(e, c)
                                total_benefits += benefit_val
                                payment["card_used"] = c
                                payment["benefits_value"] = benefit_val
                                break
                        
                        solution["pay_mode"][p].append(payment)
                        break
    
    solution["totals"]["cash"] = total_cash
    solution["totals"]["airline_points"] = total_points
    solution["totals"]["time"] = total_time_val
    solution["totals"]["benefits_value"] = total_benefits
    solution["totals"]["effective_cost"] = total_cash - total_benefits
    
    return solution
```

---

## Database Schema

### 5.1 DynamoDB Tables (AWS)

```python
# backend/src/repos/dynamodb_schema.py

"""
DynamoDB table schemas for v4.

All transport routes, card benefits, and transfer partners
are stored in DynamoDB - nothing is hardcoded.
"""

TABLES = {
    # Existing tables
    "trips": {...},
    "destinations": {...},
    "itineraries": {...},
    "users": {...},
    "points": {...},
    
    # NEW v4 tables
    "credit_cards": {
        "TableName": "tripy-credit-cards",
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},  # "CARD#<card_id>"
        ],
        "AttributeDefinitions": [
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "GSI1PK", "AttributeType": "S"},  # "ISSUER#<issuer>"
        ],
        "GlobalSecondaryIndexes": [
            {
                "IndexName": "GSI1",
                "KeySchema": [{"AttributeName": "GSI1PK", "KeyType": "HASH"}],
            }
        ],
        # Example item:
        # {
        #     "PK": "CARD#amex_delta_gold",
        #     "GSI1PK": "ISSUER#amex",
        #     "issuer": "amex",
        #     "name": "Delta SkyMiles Gold Card",
        #     "annual_fee": 0,
        #     "points_program": "delta_skymiles",
        #     "created_at": "2024-01-01T00:00:00Z",
        # }
    },
    
    "card_benefits": {
        "TableName": "tripy-card-benefits",
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},    # "CARD#<card_id>"
            {"AttributeName": "SK", "KeyType": "RANGE"},   # "BENEFIT#<benefit_id>"
        ],
        "AttributeDefinitions": [
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
            {"AttributeName": "GSI1PK", "AttributeType": "S"},  # "TYPE#<benefit_type>"
        ],
        "GlobalSecondaryIndexes": [
            {
                "IndexName": "GSI1",
                "KeySchema": [{"AttributeName": "GSI1PK", "KeyType": "HASH"}],
            }
        ],
        # Example item:
        # {
        #     "PK": "CARD#amex_delta_gold",
        #     "SK": "BENEFIT#free_bag",
        #     "GSI1PK": "TYPE#free_checked_bag",
        #     "benefit_type": "free_checked_bag",
        #     "benefit_value": {
        #         "bags_per_person": 1,
        #         "applies_to": "booking_party",
        #         "bag_value_usd": 35
        #     },
        #     "conditions": {
        #         "airlines": ["DL"]
        #     }
        # }
    },
    
    "transfer_partners": {
        "TableName": "tripy-transfer-partners",
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},   # "SOURCE#<program>"
            {"AttributeName": "SK", "KeyType": "RANGE"},  # "DEST#<airline>"
        ],
        "AttributeDefinitions": [
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
        ],
        # Example item:
        # {
        #     "PK": "SOURCE#chase_ur",
        #     "SK": "DEST#UA",
        #     "transfer_ratio": 1.0,
        #     "bonus_ratio": 1.0,
        #     "bonus_expires_at": null,
        #     "min_transfer": 1000,
        #     "transfer_time_days": 1,
        #     "is_active": true
        # }
    },
    
    "user_cards": {
        "TableName": "tripy-user-cards",
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},   # "USER#<user_id>"
            {"AttributeName": "SK", "KeyType": "RANGE"},  # "CARD#<card_id>"
        ],
        "AttributeDefinitions": [
            {"AttributeName": "PK", "AttributeType": "S"},
            {"AttributeName": "SK", "AttributeType": "S"},
        ],
        # Example item:
        # {
        #     "PK": "USER#user123",
        #     "SK": "CARD#amex_delta_gold",
        #     "card_id": "amex_delta_gold",
        #     "is_primary": false,
        #     "added_at": "2024-01-15T00:00:00Z"
        # }
    },
    
    "regions": {
        "TableName": "tripy-regions",
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},   # "REGION#<name>"
        ],
        # Example item:
        # {
        #     "PK": "REGION#Europe",
        #     "name": "Europe",
        #     "country_codes": ["GB", "FR", "DE", "IT", "ES", "NL", "BE", ...]
        # }
    },
    
    "station_cache": {
        "TableName": "tripy-station-cache",
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},   # "PROVIDER#<provider>"
            {"AttributeName": "SK", "KeyType": "RANGE"},  # "STATION#<code>"
        ],
        "TimeToLiveSpecification": {
            "AttributeName": "ttl",
            "Enabled": True,
        },
        # Example item:
        # {
        #     "PK": "PROVIDER#trainline",
        #     "SK": "STATION#GBQQS",
        #     "code": "GBQQS",
        #     "name": "London St Pancras",
        #     "latitude": 51.5317,
        #     "longitude": -0.1262,
        #     "country": "GB",
        #     "ttl": 1735689600  # 30 days cache
        # }
    },
}
```

### 5.2 Repository Classes

```python
# backend/src/repos/card_repo.py

from typing import Dict, List, Optional
from src.repos.ddb import DynamoDB


class CardRepo:
    """Repository for credit card data."""
    
    def __init__(self):
        self.table_cards = DynamoDB.get_table("tripy-credit-cards")
        self.table_benefits = DynamoDB.get_table("tripy-card-benefits")
    
    async def get_all_cards(self) -> List[Dict]:
        """Get all credit cards in system."""
        response = self.table_cards.scan()
        return response.get("Items", [])
    
    async def get_card_by_id(self, card_id: str) -> Optional[Dict]:
        """Get single card by ID."""
        response = self.table_cards.get_item(Key={"PK": f"CARD#{card_id}"})
        return response.get("Item")
    
    async def get_cards_by_issuer(self, issuer: str) -> List[Dict]:
        """Get all cards from an issuer (e.g., 'amex', 'chase')."""
        response = self.table_cards.query(
            IndexName="GSI1",
            KeyConditionExpression="GSI1PK = :issuer",
            ExpressionAttributeValues={":issuer": f"ISSUER#{issuer}"},
        )
        return response.get("Items", [])
    
    async def get_benefits_for_card(self, card_id: str) -> List[Dict]:
        """Get all benefits for a card."""
        response = self.table_benefits.query(
            KeyConditionExpression="PK = :pk",
            ExpressionAttributeValues={":pk": f"CARD#{card_id}"},
        )
        return response.get("Items", [])
    
    async def add_card(self, card: Dict) -> None:
        """Add a new card to the system (admin only)."""
        self.table_cards.put_item(Item={
            "PK": f"CARD#{card['id']}",
            "GSI1PK": f"ISSUER#{card['issuer']}",
            **card,
        })
    
    async def add_benefit(self, card_id: str, benefit: Dict) -> None:
        """Add a benefit to a card (admin only)."""
        self.table_benefits.put_item(Item={
            "PK": f"CARD#{card_id}",
            "SK": f"BENEFIT#{benefit['id']}",
            "GSI1PK": f"TYPE#{benefit['benefit_type']}",
            **benefit,
        })


class TransferPartnerRepo:
    """Repository for transfer partner data."""
    
    def __init__(self):
        self.table = DynamoDB.get_table("tripy-transfer-partners")
    
    async def get_transfer_graph(self) -> Dict[str, Dict[str, Dict]]:
        """
        Get full transfer graph.
        
        Returns: {source_program: {airline: {ratio, bonus, ...}}}
        """
        response = self.table.scan()
        items = response.get("Items", [])
        
        graph = {}
        for item in items:
            source = item["PK"].replace("SOURCE#", "")
            dest = item["SK"].replace("DEST#", "")
            
            if source not in graph:
                graph[source] = {}
            
            graph[source][dest] = {
                "ratio": float(item.get("transfer_ratio", 1.0)),
                "bonus": float(item.get("bonus_ratio", 1.0)),
                "bonus_expires": item.get("bonus_expires_at"),
                "min_transfer": int(item.get("min_transfer", 1000)),
                "transfer_days": int(item.get("transfer_time_days", 1)),
                "active": item.get("is_active", True),
            }
        
        return graph
    
    async def get_partners_for_source(self, source: str) -> List[Dict]:
        """Get all transfer partners for a source program."""
        response = self.table.query(
            KeyConditionExpression="PK = :pk",
            ExpressionAttributeValues={":pk": f"SOURCE#{source}"},
        )
        return response.get("Items", [])
    
    async def update_bonus(
        self,
        source: str,
        airline: str,
        bonus_ratio: float,
        expires_at: str,
    ) -> None:
        """Update transfer bonus (for promotions)."""
        self.table.update_item(
            Key={"PK": f"SOURCE#{source}", "SK": f"DEST#{airline}"},
            UpdateExpression="SET bonus_ratio = :bonus, bonus_expires_at = :exp",
            ExpressionAttributeValues={":bonus": bonus_ratio, ":exp": expires_at},
        )


class UserCardRepo:
    """Repository for user's credit cards."""
    
    def __init__(self):
        self.table = DynamoDB.get_table("tripy-user-cards")
    
    async def get_user_cards(self, user_id: str) -> List[Dict]:
        """Get all cards for a user."""
        response = self.table.query(
            KeyConditionExpression="PK = :pk",
            ExpressionAttributeValues={":pk": f"USER#{user_id}"},
        )
        return response.get("Items", [])
    
    async def add_user_card(self, user_id: str, card_id: str) -> None:
        """Add a card to user's wallet."""
        self.table.put_item(Item={
            "PK": f"USER#{user_id}",
            "SK": f"CARD#{card_id}",
            "card_id": card_id,
            "is_primary": False,
            "added_at": datetime.now().isoformat(),
        })
    
    async def remove_user_card(self, user_id: str, card_id: str) -> None:
        """Remove a card from user's wallet."""
        self.table.delete_item(Key={
            "PK": f"USER#{user_id}",
            "SK": f"CARD#{card_id}",
        })
```

---

## API Integrations

### 6.1 Required API Keys

```bash
# .env (all API-based, nothing hardcoded)

# Flight APIs
AWARDTOOL_API_KEY=xxx
AMADEUS_API_KEY=xxx
AMADEUS_API_SECRET=xxx
SERPAPI_API_KEY=xxx

# Train APIs
TRAINLINE_API_KEY=xxx     # Europe
AMTRAK_API_KEY=xxx        # USA
JR_API_KEY=xxx            # Japan

# Bus APIs
FLIXBUS_API_KEY=xxx
BUSBUD_API_KEY=xxx

# Location/Geography
GOOGLE_MAPS_API_KEY=xxx   # For station resolution

# AI (fallbacks)
OPENAI_API_KEY=xxx
```

### 6.2 API Endpoints

```python
# backend/src/app.py (new endpoints)

# ═══════════════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS (for managing dynamic data)
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/admin/cards")
async def create_card(card: CardCreate, user=Depends(admin_only)):
    """Add a new credit card to the system."""
    return await card_service.create_card(card)

@app.post("/admin/cards/{card_id}/benefits")
async def add_card_benefit(
    card_id: str,
    benefit: BenefitCreate,
    user=Depends(admin_only),
):
    """Add a benefit to a card."""
    return await card_service.add_benefit(card_id, benefit)

@app.put("/admin/transfer-partners/{source}/{airline}")
async def update_transfer_partner(
    source: str,
    airline: str,
    data: TransferPartnerUpdate,
    user=Depends(admin_only),
):
    """Update transfer partner (e.g., add bonus promotion)."""
    return await transfer_service.update_partner(source, airline, data)

@app.post("/admin/regions")
async def create_region(region: RegionCreate, user=Depends(admin_only)):
    """Add a geographic region."""
    return await region_service.create_region(region)

# ═══════════════════════════════════════════════════════════════════════════
# USER ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/cards")
async def list_all_cards():
    """List all available credit cards."""
    return await card_service.list_cards()

@app.get("/cards/{card_id}")
async def get_card(card_id: str):
    """Get card details including benefits."""
    return await card_service.get_card_with_benefits(card_id)

@app.get("/users/me/cards")
async def get_my_cards(user=Depends(get_current_user)):
    """Get current user's cards."""
    return await user_card_service.get_user_cards(user.id)

@app.post("/users/me/cards/{card_id}")
async def add_my_card(card_id: str, user=Depends(get_current_user)):
    """Add a card to my wallet."""
    return await user_card_service.add_card(user.id, card_id)

@app.delete("/users/me/cards/{card_id}")
async def remove_my_card(card_id: str, user=Depends(get_current_user)):
    """Remove a card from my wallet."""
    return await user_card_service.remove_card(user.id, card_id)

@app.get("/transfer-partners")
async def get_transfer_partners():
    """Get current transfer partner graph with active bonuses."""
    return await transfer_service.get_transfer_graph()

@app.get("/transport/search")
async def search_transport(
    origin: str,
    destination: str,
    date: str,
    modes: List[str] = Query(default=["flight", "train", "bus"]),
):
    """
    Search all transport modes between two cities.
    
    Returns unified list of options across flights, trains, buses.
    """
    return await transport_service.search_all_modes(
        origin=origin,
        destination=destination,
        date=date,
        modes=modes,
    )
```

---

## Caching Strategy

### 7.1 What to Cache

| Data | Cache Location | TTL | Invalidation |
|------|----------------|-----|--------------|
| Card definitions | DynamoDB | N/A | On admin update |
| Card benefits | DynamoDB | N/A | On admin update |
| Transfer partners | DynamoDB + Memory | 1 hour | On admin update |
| Station mappings | DynamoDB | 30 days | API refresh |
| Flight prices | Redis/Memory | 15 min | Time-based |
| Train prices | Redis/Memory | 30 min | Time-based |
| Bus prices | Redis/Memory | 1 hour | Time-based |

### 7.2 Cache Implementation

```python
# backend/src/utils/cache_layer.py

import asyncio
from typing import Any, Callable, Optional
from datetime import datetime, timedelta
import redis.asyncio as redis


class CacheLayer:
    """
    Multi-tier caching for API responses.
    
    Tier 1: In-memory (fastest, smallest)
    Tier 2: Redis (fast, larger)
    Tier 3: DynamoDB (persistent, for long-term)
    """
    
    def __init__(self):
        self._memory_cache = {}
        self._redis = redis.from_url(os.getenv("REDIS_URL", "redis://localhost"))
    
    async def get_or_fetch(
        self,
        key: str,
        fetch_fn: Callable,
        ttl_seconds: int = 300,
        tier: str = "redis",
    ) -> Any:
        """
        Get from cache or fetch from source.
        
        Args:
            key: Cache key
            fetch_fn: Async function to fetch data if not cached
            ttl_seconds: Time to live
            tier: "memory", "redis", or "dynamodb"
        """
        # Check memory first
        if key in self._memory_cache:
            entry = self._memory_cache[key]
            if entry["expires"] > datetime.now():
                return entry["data"]
        
        # Check Redis
        if tier in ("redis", "dynamodb"):
            cached = await self._redis.get(key)
            if cached:
                data = json.loads(cached)
                # Also store in memory
                self._memory_cache[key] = {
                    "data": data,
                    "expires": datetime.now() + timedelta(seconds=60),
                }
                return data
        
        # Fetch from source
        data = await fetch_fn()
        
        # Store in cache
        await self._set(key, data, ttl_seconds, tier)
        
        return data
    
    async def _set(
        self,
        key: str,
        data: Any,
        ttl_seconds: int,
        tier: str,
    ):
        """Store in appropriate cache tier."""
        # Memory (short TTL)
        self._memory_cache[key] = {
            "data": data,
            "expires": datetime.now() + timedelta(seconds=min(ttl_seconds, 300)),
        }
        
        # Redis
        if tier in ("redis", "dynamodb"):
            await self._redis.setex(key, ttl_seconds, json.dumps(data))
    
    async def invalidate(self, pattern: str):
        """Invalidate cache entries matching pattern."""
        # Clear memory
        keys_to_delete = [k for k in self._memory_cache if pattern in k]
        for k in keys_to_delete:
            del self._memory_cache[k]
        
        # Clear Redis
        async for key in self._redis.scan_iter(f"*{pattern}*"):
            await self._redis.delete(key)
```

---

## Implementation Details

### 8.1 Updated `generate_optimized_itinerary` (Entry Point)

```python
# backend/src/services/itinerary_service_v4.py

async def generate_optimized_itinerary_v4(trip_id: str) -> Dict:
    """
    Main entry point for v4 itinerary optimization.
    
    Key differences from v3:
    1. Loads transfer graph from database (not hardcoded)
    2. Loads user's cards and calculates benefits
    3. Passes benefits to ILP optimizer
    """
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 1-5: Same as v3 (load trip, destinations, airports, etc.)
    # ─────────────────────────────────────────────────────────────────────
    trip = await trip_service.get_trip(trip_id)
    destinations = await destination_service.list_destinations(trip_id)
    members = await trip_member_service.list_members(trip_id)
    travelers = [m["userId"] for m in members if m.get("status") == "active"]
    
    # Resolve destinations to airport codes
    # ... (same as v3)
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 6: Load transfer graph from DATABASE (not hardcoded!)
    # ─────────────────────────────────────────────────────────────────────
    transfer_repo = TransferPartnerRepo()
    transfer_graph = await transfer_repo.get_transfer_graph()
    
    # Apply active bonuses (e.g., 25% transfer bonus to United this month)
    for source, airlines in transfer_graph.items():
        for airline, config in airlines.items():
            if config.get("bonus_expires"):
                if datetime.fromisoformat(config["bonus_expires"]) > datetime.now():
                    # Bonus is active
                    config["effective_ratio"] = config["ratio"] * config["bonus"]
                else:
                    config["effective_ratio"] = config["ratio"]
            else:
                config["effective_ratio"] = config["ratio"]
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 7: Load user cards and pre-calculate benefits
    # ─────────────────────────────────────────────────────────────────────
    card_repo = CardRepo()
    user_card_repo = UserCardRepo()
    benefits_calculator = CardBenefitsCalculator(card_repo)
    
    user_cards = {}
    for traveler in travelers:
        cards = await user_card_repo.get_user_cards(traveler)
        # Enrich with card details
        enriched = []
        for uc in cards:
            card_details = await card_repo.get_card_by_id(uc["card_id"])
            if card_details:
                enriched.append({
                    **uc,
                    "card_name": card_details.get("name"),
                    "issuer": card_details.get("issuer"),
                })
        user_cards[traveler] = enriched
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 8: Fetch transport edges (flights, trains, buses) from APIs
    # ─────────────────────────────────────────────────────────────────────
    # ... (same as v3, but uses real APIs instead of hardcoded data)
    
    edges_all = await fetch_all_transport_edges(
        pairs=pairs,
        date=start_date,
        travelers=travelers,
        combined_points=combined_points,
    )
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 9: Pre-calculate card benefits for each edge
    # ─────────────────────────────────────────────────────────────────────
    edge_benefits = {}
    
    for edge_key, edge_data in edges_all.items():
        edge_benefits[edge_key] = {}
        
        for traveler in travelers:
            for card in user_cards.get(traveler, []):
                benefits = await benefits_calculator.calculate_benefits_for_edge(
                    edge=edge_data,
                    user_cards=[card],
                    passengers=len(travelers),
                    booking_date=start_date,
                )
                if benefits:
                    edge_benefits[edge_key][card["card_id"]] = benefits
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 10: Build ILP inputs with benefits
    # ─────────────────────────────────────────────────────────────────────
    ilp_inputs = build_ilp_inputs_from_edges(
        edges_dict=edges_all,
        travelers=travelers,
        start_city_by_trav=start_city_by_trav,
        end_city_by_trav=end_city_by_trav,
        user_points_by_trav=user_points_by_trav,
        transfer_graph=transfer_graph,  # FROM DATABASE!
        must_visit_cities=middle_codes,
        default_cash_budget=per_traveler_budget,
    )
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 11: Solve with v4 optimizer (includes card benefits)
    # ─────────────────────────────────────────────────────────────────────
    solution = await plan_minimize_out_of_pocket_with_benefits(
        **ilp_inputs,
        user_cards=user_cards,
        edge_benefits=edge_benefits,
    )
    
    # ─────────────────────────────────────────────────────────────────────
    # STEP 12: Return result with benefits breakdown
    # ─────────────────────────────────────────────────────────────────────
    return {
        "status": solution.get("status"),
        "solution": solution,
        "out_of_pocket": solution["totals"]["cash"],
        "benefits_value": solution["totals"]["benefits_value"],
        "effective_cost": solution["totals"]["effective_cost"],
        "items": build_itinerary_items(trip_id, solution, edges_all),
    }
```

---

## Summary

### What's Dynamic in v4

| Component | Source | Update Frequency |
|-----------|--------|------------------|
| Flight routes & prices | AwardTool, Amadeus, SerpAPI | Real-time |
| Train routes & prices | Trainline, Amtrak, JR APIs | Real-time |
| Bus routes & prices | FlixBus, BusBud APIs | Real-time |
| Station mappings | Provider APIs + cache | 30-day refresh |
| Transfer partners | DynamoDB table | Admin-managed |
| Transfer bonuses | DynamoDB table | Admin-managed |
| Credit cards | DynamoDB table | Admin-managed |
| Card benefits | DynamoDB table | Admin-managed |
| Geographic regions | DynamoDB table | Admin-managed |

### New Objective Function

```
MINIMIZE: W₁ × (OutOfPocket - CardBenefits) + W₂ × Time

Where:
- OutOfPocket = Cash bookings + Points surcharges
- CardBenefits = Sum of benefit values (free bags, credits, etc.)
- W₁ = 1,000,000 (primary: minimize net cost)
- W₂ = 1 (secondary: minimize time)
```

### Example: Amex Delta Gold Free Bag Benefit

```
Scenario:
- 4 passengers flying Delta
- User has Amex Delta Gold card
- Each checked bag costs $35

Without card benefit:
- 4 passengers × $35/bag = $140 in bag fees

With card benefit:
- Amex Delta Gold gives free first checked bag for ENTIRE booking party
- Benefit value: 4 × $35 = $140 saved

ILP sees this as:
- Edge cost: $500 (flight) + $140 (bags) = $640
- With card: $500 (flight) + $0 (bags) = $500
- Effective savings: $140
```

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `services/flight_service.py` | Modify | Multi-provider flight search |
| `services/train_service.py` | Rewrite | API-based train search (no hardcoding) |
| `services/bus_service.py` | Rewrite | API-based bus search (no hardcoding) |
| `services/station_service.py` | Create | Dynamic station resolution |
| `models/card_benefits.py` | Create | Benefit types and calculator |
| `repos/card_repo.py` | Create | Card database operations |
| `repos/transfer_partner_repo.py` | Create | Transfer partner database |
| `handlers/points_maximizer_v4.py` | Create | ILP with card benefits |
| `services/itinerary_service_v4.py` | Create | Updated entry point |

---

*Document Version: 4.0*
*Last Updated: January 2026*
