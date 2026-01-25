# Tripy Implementation Plan v2.0

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | Jan 2026 | Initial implementation plan |
| v2.0 | Jan 2026 | Added multi-modal transport (trains, buses), autocomplete documentation, chatbot enhancements |

---

## Executive Summary

This document outlines a detailed implementation plan for Tripy, an AI-powered travel planning platform that optimizes credit card points and airline miles for maximum value. **Version 2.0** adds comprehensive multi-modal transportation support (flights, trains, buses, cars), enhanced autocomplete functionality for city/airport selection, and an intelligent chatbot that fills out trip forms via natural language.

---

## Table of Contents

1. [New in v2.0](#new-in-v20)
2. [Multi-Modal Transportation](#multi-modal-transportation)
3. [Autocomplete System](#autocomplete-system)
4. [Intelligent Chatbot](#intelligent-chatbot)
5. [Architecture Overview](#architecture-overview)
6. [Phase 1: Core Backend Services](#phase-1-core-backend-services)
7. [Phase 2: External API Integration](#phase-2-external-api-integration)
8. [Phase 3: ILP Optimization Engine](#phase-3-ilp-optimization-engine)
9. [Phase 4: Group Trip Features](#phase-4-group-trip-features)
10. [Phase 5: Production Hardening](#phase-5-production-hardening)
11. [API Endpoint Specifications](#api-endpoint-specifications)
12. [Database Schema Details](#database-schema-details)
13. [Testing Strategy](#testing-strategy)

---

## New in v2.0

### Key Additions

1. **Multi-Modal Transportation**
   - Train support (high-speed rail in Europe, Amtrak in US)
   - Enhanced bus support (FlixBus, Eurolines, Greyhound)
   - Car rental optimization
   - Ferry/boat for specific routes (UK-France, Greece islands)
   - Integration with rail APIs (Trainline, Deutsche Bahn, SNCF)

2. **Enhanced Autocomplete**
   - City-to-airports mapping (NYC → JFK, LGA, EWR)
   - Multi-airport selection
   - Train station autocomplete
   - Fallback hierarchy with CSV data

3. **Intelligent Chatbot**
   - Natural language trip planning
   - Auto-fill form fields from conversation
   - Credit card and points extraction
   - Multi-turn conversation support

---

## Multi-Modal Transportation

### Overview

In many regions (especially Europe), trains are often cheaper, faster, and more convenient than flights for medium distances (200-800km). The optimizer should automatically consider all transport modes and select the optimal combination.

### Current State

**Implemented:**
- `backend/src/handlers/ground_transport.py` - Bus and car estimation via OpenAI
- Ground edges are added to the ILP graph alongside flights
- Mode indicator in pay_mode response (`"mode": "flight" | "bus" | "car"`)

**Missing:**
- Train support (critical for Europe)
- Real-time pricing APIs (currently using OpenAI estimates)
- Ferry/boat support
- Multi-modal journey combinations

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MULTI-MODAL TRANSPORT LAYER                            │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │   Flights    │ │    Trains    │ │    Buses     │ │   Car/Ferry  │       │
│  │  (AwardTool) │ │ (Trainline)  │ │ (FlixBus)    │ │  (OpenAI)    │       │
│  │  (SerpAPI)   │ │ (DB/SNCF)    │ │ (Eurolines)  │ │              │       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
│          │               │               │               │                  │
│          └───────────────┴───────────────┴───────────────┘                  │
│                                  │                                          │
│                    ┌─────────────▼─────────────┐                            │
│                    │   Transport Edge Builder   │                            │
│                    │   (Unified Edge Format)    │                            │
│                    └─────────────┬─────────────┘                            │
│                                  │                                          │
│                    ┌─────────────▼─────────────┐                            │
│                    │      ILP Optimizer         │                            │
│                    │  (Multi-Modal Selection)   │                            │
│                    └───────────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation: Train Support

#### 3.1 Train Transport Handler

**New File:** `backend/src/handlers/train_transport.py`

```python
"""
Train transport: high-speed rail and regional trains for optimal multi-modal routing.
Supports Europe (Eurostar, TGV, ICE, Thalys, etc.) and US (Amtrak).
Uses Trainline API when available, OpenAI estimates as fallback.
"""

import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from dotenv import load_dotenv

from src.utils.cache_layer import get_json, set_json

load_dotenv()
logger = logging.getLogger(__name__)

# TTL for train data cache
TTL_TRAIN = 24 * 3600  # 24 hours (train prices more stable than flights)

# Major train hubs by region (IATA-like codes for stations)
EUROPEAN_TRAIN_HUBS = {
    # UK
    "LON": ["London St Pancras", "London Euston", "London Kings Cross"],
    "LHR": ["London St Pancras"],  # Heathrow area
    "LGW": ["London Victoria"],    # Gatwick area
    
    # France
    "PAR": ["Paris Gare du Nord", "Paris Gare de Lyon", "Paris Montparnasse"],
    "CDG": ["Paris CDG TGV"],
    "ORY": ["Paris Gare de Lyon"],
    
    # Germany
    "FRA": ["Frankfurt Hbf", "Frankfurt Flughafen"],
    "MUC": ["München Hbf"],
    "BER": ["Berlin Hbf"],
    
    # Netherlands
    "AMS": ["Amsterdam Centraal", "Schiphol"],
    
    # Belgium
    "BRU": ["Bruxelles-Midi"],
    
    # Switzerland
    "ZRH": ["Zürich HB"],
    "GVA": ["Genève-Cornavin"],
    
    # Italy
    "FCO": ["Roma Termini"],
    "MXP": ["Milano Centrale"],
    
    # Spain
    "MAD": ["Madrid Atocha", "Madrid Chamartín"],
    "BCN": ["Barcelona Sants"],
}

# High-speed rail corridors (these are prime candidates for train vs flight)
HIGH_SPEED_CORRIDORS = [
    ("LON", "PAR", {"operator": "Eurostar", "duration": 140, "distance": 459}),
    ("LON", "BRU", {"operator": "Eurostar", "duration": 120, "distance": 370}),
    ("LON", "AMS", {"operator": "Eurostar", "duration": 230, "distance": 500}),
    ("PAR", "LYS", {"operator": "TGV", "duration": 120, "distance": 470}),
    ("PAR", "BRU", {"operator": "Thalys", "duration": 85, "distance": 312}),
    ("PAR", "AMS", {"operator": "Thalys", "duration": 195, "distance": 500}),
    ("PAR", "FRA", {"operator": "TGV/ICE", "duration": 230, "distance": 570}),
    ("FRA", "MUC", {"operator": "ICE", "duration": 190, "distance": 390}),
    ("FRA", "BER", {"operator": "ICE", "duration": 240, "distance": 545}),
    ("MAD", "BCN", {"operator": "AVE", "duration": 155, "distance": 620}),
    ("FCO", "MXP", {"operator": "Frecciarossa", "duration": 180, "distance": 570}),
]

# US Amtrak corridors
US_TRAIN_CORRIDORS = [
    ("NYC", "WAS", {"operator": "Acela", "duration": 165, "distance": 362}),
    ("NYC", "BOS", {"operator": "Acela", "duration": 210, "distance": 346}),
    ("NYC", "PHL", {"operator": "Acela", "duration": 70, "distance": 145}),
    ("WAS", "PHL", {"operator": "Acela", "duration": 95, "distance": 217}),
    ("LAX", "SAN", {"operator": "Pacific Surfliner", "duration": 165, "distance": 195}),
    ("CHI", "MKE", {"operator": "Hiawatha", "duration": 90, "distance": 140}),
]


def _cache_key(origin: str, destination: str) -> str:
    return f"train:{origin.upper()}:{destination.upper()}"


def _is_same_continent(origin: str, dest: str) -> bool:
    """Check if both cities are on the same continent (trains only work on land)."""
    european = set(EUROPEAN_TRAIN_HUBS.keys())
    us_codes = {"NYC", "JFK", "LGA", "EWR", "BOS", "WAS", "DCA", "IAD", "PHL", 
                "LAX", "SFO", "SAN", "SEA", "CHI", "ORD", "MKE"}
    
    o, d = origin.upper(), dest.upper()
    
    # Both in Europe
    if o in european and d in european:
        return True
    # Both in US
    if o in us_codes and d in us_codes:
        return True
    
    return False


def _get_corridor_info(origin: str, dest: str) -> Optional[Dict]:
    """Check if this is a known high-speed rail corridor."""
    o, d = origin.upper(), dest.upper()
    
    for c1, c2, info in HIGH_SPEED_CORRIDORS + US_TRAIN_CORRIDORS:
        if (o == c1 and d == c2) or (o == c2 and d == c1):
            return info
    return None


def _estimate_train_price(origin: str, dest: str, corridor_info: Optional[Dict]) -> Tuple[int, int]:
    """
    Estimate train price and duration.
    Returns (price_usd, duration_minutes).
    """
    if corridor_info:
        duration = corridor_info["duration"]
        # Price estimation based on operator and distance
        distance = corridor_info.get("distance", 400)
        operator = corridor_info.get("operator", "")
        
        # High-speed rail pricing (per km, roughly)
        if "Eurostar" in operator:
            price = int(80 + distance * 0.15)  # Eurostar is pricier
        elif "TGV" in operator or "ICE" in operator or "AVE" in operator:
            price = int(40 + distance * 0.10)
        elif "Acela" in operator:
            price = int(60 + distance * 0.12)  # US Acela
        else:
            price = int(30 + distance * 0.08)  # Regional/slower trains
        
        return (price, duration)
    
    # Generic estimate for unknown corridors
    return (80, 240)  # $80, 4 hours default


async def get_train_options_async(
    origin: str,
    destination: str,
    date: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Get train options between two cities.
    
    Returns list of dicts with:
    - mode: "train"
    - operator: str (e.g., "Eurostar", "TGV", "ICE")
    - cash_cost: float
    - time_cost: int (minutes)
    - departure_time: Optional[str]
    - arrival_time: Optional[str]
    """
    o = (origin or "").strip().upper()
    d = (destination or "").strip().upper()
    
    if not o or not d or o == d:
        return []
    
    # Check if same continent (trains don't cross oceans)
    if not _is_same_continent(o, d):
        return []
    
    # Check cache
    cache_key = _cache_key(o, d)
    cached = get_json(cache_key)
    if cached and isinstance(cached, list):
        logger.debug("train [%s]->[%s]: cache hit", o, d)
        return cached
    
    # Check if this is a known corridor
    corridor = _get_corridor_info(o, d)
    
    if corridor:
        price, duration = _estimate_train_price(o, d, corridor)
        result = [{
            "mode": "train",
            "operator": corridor.get("operator", "Rail"),
            "cash_cost": float(price),
            "time_cost": int(duration),
            "departure_time": None,
            "arrival_time": None,
            "points_cost": None,
            "points_program": None,
            "points_surcharge": None,
            "transfer_partners": [],
            "is_high_speed": True,
        }]
        set_json(cache_key, result, TTL_TRAIN)
        logger.info("train [%s]->[%s]: corridor match (%s)", o, d, corridor.get("operator"))
        return result
    
    # For non-corridor routes, use OpenAI to estimate
    try:
        result = await _estimate_train_with_openai(o, d, date)
        if result:
            set_json(cache_key, result, TTL_TRAIN)
            return result
    except Exception as e:
        logger.warning("train [%s]->[%s]: OpenAI estimate failed: %s", o, d, e)
    
    return []


async def _estimate_train_with_openai(origin: str, dest: str, date: Optional[str]) -> List[Dict]:
    """Use OpenAI to estimate train options for unknown corridors."""
    from openai import OpenAI
    import json
    
    key = os.getenv("OPENAI_ADMIN_KEY") or os.getenv("OPENAI_API_KEY")
    if not key:
        return []
    
    client = OpenAI(api_key=key)
    
    system = """You are a travel assistant specializing in train travel.
Estimate train options between two cities (given as IATA airport codes or city names).

RULES:
- Only provide train options if there's actual rail service between the cities
- Consider high-speed rail (TGV, ICE, AVE, Shinkansen, Acela) and regional trains
- For distances > 1000km, trains are usually not practical (return null)
- For different continents or across oceans, return null
- Provide realistic 2024-2025 prices in USD

Return JSON: {
  "trains": [
    {
      "operator": "string (e.g., Eurostar, TGV, ICE, Amtrak)",
      "price_usd": number,
      "duration_minutes": number,
      "is_high_speed": boolean
    }
  ] or null if no train service
}"""

    user = f"Estimate train options from {origin} to {dest}. Date: {date or 'flexible'}"
    
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={"type": "json_object"},
            temperature=0.2,
        )
        raw = r.choices[0].message.content
        data = json.loads(raw) if isinstance(raw, str) else raw
        
        trains = data.get("trains") if isinstance(data, dict) else None
        if not trains:
            return []
        
        result = []
        for t in trains:
            price = t.get("price_usd")
            duration = t.get("duration_minutes")
            if price is None or duration is None:
                continue
            result.append({
                "mode": "train",
                "operator": t.get("operator", "Rail"),
                "cash_cost": float(price),
                "time_cost": int(duration),
                "departure_time": None,
                "arrival_time": None,
                "points_cost": None,
                "points_program": None,
                "points_surcharge": None,
                "transfer_partners": [],
                "is_high_speed": t.get("is_high_speed", False),
            })
        
        return result
    except Exception as e:
        logger.debug("OpenAI train estimate failed: %s", e)
        return []


def train_options_to_edges(
    origin: str, 
    destination: str, 
    options: List[Dict[str, Any]]
) -> Dict[tuple, Dict[str, Any]]:
    """
    Convert train options to ILP edge format.
    
    Edge key: (origin, dest, "TRAIN_{operator}")
    """
    edges = {}
    for idx, opt in enumerate(options):
        operator = (opt.get("operator") or "Rail").upper().replace(" ", "_")
        key = (origin.upper(), destination.upper(), f"TRAIN_{operator}")
        
        # Avoid duplicates - keep cheapest
        if key in edges and edges[key]["cash_cost"] <= opt.get("cash_cost", 1e9):
            continue
        
        edges[key] = {
            "cash_cost": opt.get("cash_cost"),
            "time_cost": opt.get("time_cost"),
            "points_cost": None,
            "points_program": None,
            "points_surcharge": None,
            "transfer_partners": [],
            "departure_time": opt.get("departure_time"),
            "arrival_time": opt.get("arrival_time"),
            "operating_airline": None,
            "mode": "train",
            "operator": opt.get("operator"),
            "is_high_speed": opt.get("is_high_speed", False),
        }
    
    return edges
```

#### 3.2 Enhanced Ground Transport (Bus + Car)

**Update:** `backend/src/handlers/ground_transport.py`

Add ferry support and improve geographic validation:

```python
# Add ferry corridors
FERRY_ROUTES = [
    ("DOV", "CAL", {"operator": "P&O/DFDS", "duration": 90, "price": 60}),    # Dover-Calais
    ("HAR", "HOO", {"operator": "Stena Line", "duration": 195, "price": 80}),  # Harwich-Hook of Holland
    ("ATH", "SANTORINI", {"operator": "Blue Star", "duration": 480, "price": 45}),  # Greece islands
    ("HEL", "TAL", {"operator": "Tallink", "duration": 120, "price": 35}),     # Helsinki-Tallinn
]

async def get_ferry_options(origin: str, destination: str, date: str) -> List[Dict]:
    """Get ferry options for sea crossings."""
    # Check known ferry routes
    for o, d, info in FERRY_ROUTES:
        if (origin.upper() == o and destination.upper() == d) or \
           (origin.upper() == d and destination.upper() == o):
            return [{
                "mode": "ferry",
                "operator": info["operator"],
                "cash_cost": float(info["price"]),
                "time_cost": int(info["duration"]),
                "departure_time": None,
                "arrival_time": None,
                "points_cost": None,
                "points_program": None,
                "points_surcharge": None,
                "transfer_partners": [],
            }]
    return []
```

#### 3.3 Unified Transport Edge Builder

**New File:** `backend/src/handlers/transport_edge_builder.py`

```python
"""
Unified transport edge builder - combines flights, trains, buses, cars, ferries.
Produces a single edge dictionary for the ILP optimizer.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from src.handlers.flights import (
    get_flights_award_first_with_points_async,
    get_flights_serp_first_with_points_async,
    get_flights_serp_only,
)
from src.handlers.ground_transport import (
    get_bus_and_car_options,
    ground_options_to_edges,
    get_ferry_options,
)
from src.handlers.train_transport import (
    get_train_options_async,
    train_options_to_edges,
)

logger = logging.getLogger(__name__)


async def get_all_transport_edges(
    origin: str,
    destination: str,
    date: str,
    combined_points: Dict[str, int],
    filters: Dict[str, Any],
    include_trains: bool = True,
    include_buses: bool = True,
    include_ferries: bool = True,
) -> Tuple[Dict[Tuple[str, str, str], Dict[str, Any]], Dict[str, bool]]:
    """
    Fetch all transport options between two cities.
    
    Returns:
        (edges_dict, availability_flags)
        
        edges_dict: {(origin, dest, mode_id): edge_data}
        availability_flags: {"flights": bool, "trains": bool, "buses": bool, "ferries": bool}
    """
    edges = {}
    flags = {"flights": False, "trains": False, "buses": False, "cars": False, "ferries": False}
    
    # Parallel fetch all transport modes
    tasks = []
    
    # 1. Flights (award + cash)
    tasks.append(("flights", _fetch_flights(origin, destination, date, combined_points, filters)))
    
    # 2. Trains
    if include_trains:
        tasks.append(("trains", get_train_options_async(origin, destination, date)))
    
    # 3. Buses and Cars
    if include_buses:
        tasks.append(("ground", asyncio.to_thread(get_bus_and_car_options, origin, destination, date)))
    
    # 4. Ferries
    if include_ferries:
        tasks.append(("ferries", get_ferry_options(origin, destination, date)))
    
    # Run all tasks in parallel
    results = await asyncio.gather(
        *[task[1] for task in tasks],
        return_exceptions=True,
    )
    
    # Process results
    for i, (mode_type, _) in enumerate(tasks):
        result = results[i]
        
        if isinstance(result, Exception):
            logger.warning(f"Transport fetch failed for {mode_type}: {result}")
            continue
        
        if mode_type == "flights" and result:
            edges.update(result)
            flags["flights"] = True
        
        elif mode_type == "trains" and result:
            train_edges = train_options_to_edges(origin, destination, result)
            edges.update(train_edges)
            flags["trains"] = bool(train_edges)
        
        elif mode_type == "ground" and result:
            ground_edges = ground_options_to_edges(origin, destination, result)
            edges.update(ground_edges)
            flags["buses"] = any(e[2] == "BUS" for e in ground_edges)
            flags["cars"] = any(e[2] == "CAR" for e in ground_edges)
        
        elif mode_type == "ferries" and result:
            # Convert ferry options to edges
            for opt in result:
                key = (origin.upper(), destination.upper(), f"FERRY_{opt.get('operator', 'FERRY')}")
                edges[key] = {
                    "cash_cost": opt.get("cash_cost"),
                    "time_cost": opt.get("time_cost"),
                    "points_cost": None,
                    "points_program": None,
                    "points_surcharge": None,
                    "mode": "ferry",
                }
            flags["ferries"] = bool(result)
    
    return edges, flags


async def _fetch_flights(
    origin: str,
    destination: str,
    date: str,
    combined_points: Dict[str, int],
    filters: Dict[str, Any],
) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    """Fetch flight edges with fallback hierarchy."""
    edges = await get_flights_award_first_with_points_async(
        origin, destination, combined_points, filters
    )
    
    if not edges:
        edges = await get_flights_serp_first_with_points_async(
            origin, destination, combined_points, filters
        )
    
    if not edges:
        edges = await asyncio.to_thread(
            get_flights_serp_only, origin, destination, date, filters
        )
    
    return edges or {}
```

#### 3.4 ILP Integration

**Update:** `backend/src/services/itinerary_service.py`

Replace the current `_fetch_edges_for_route` with the unified builder:

```python
from src.handlers.transport_edge_builder import get_all_transport_edges

async def _fetch_edges_for_route(
    origin: str,
    dest: str,
    leg_date: str,
    combined_points: Dict[str, int],
    travelers: List[str],
    start_dest_code: str,
) -> Tuple[Dict[Tuple[str, str, str], Dict[str, Any]], bool]:
    """
    Fetch all transport edges for a single origin->dest pair.
    Now includes trains, buses, cars, and ferries alongside flights.
    """
    filters = {
        "outbound_date": leg_date,
        "travel_class": "economy",
        "bags": 1,
        "pax": len(travelers),
        "award_programs": get_award_programs_for_api(),
    }
    
    # Use unified transport edge builder
    edges, flags = await get_all_transport_edges(
        origin=origin,
        destination=dest,
        date=leg_date,
        combined_points=combined_points,
        filters=filters,
        include_trains=True,
        include_buses=True,
        include_ferries=True,
    )
    
    had_any_option = any(flags.values())
    
    # Log what we found
    modes_found = [k for k, v in flags.items() if v]
    if modes_found:
        logger.info(f"Transport options {origin}->{dest}: {', '.join(modes_found)}")
    else:
        logger.warning(f"No transport options found for {origin}->{dest}")
    
    return (edges, had_any_option)
```

#### 3.5 Frontend Transport Mode Display

The frontend should display the transport mode for each segment. Update the booking/results pages to show:

```tsx
// Transport mode icons and labels
const TRANSPORT_MODES = {
  flight: { icon: Plane, label: "Flight", color: "blue" },
  train: { icon: Train, label: "Train", color: "green" },
  bus: { icon: Bus, label: "Bus", color: "orange" },
  car: { icon: Car, label: "Car", color: "purple" },
  ferry: { icon: Ship, label: "Ferry", color: "cyan" },
};

function TransportSegment({ segment }) {
  const mode = segment.mode || "flight";
  const { icon: Icon, label, color } = TRANSPORT_MODES[mode];
  
  return (
    <div className={`flex items-center gap-2 text-${color}-600`}>
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      {segment.operator && <span className="text-sm text-gray-500">({segment.operator})</span>}
    </div>
  );
}
```

---

## Autocomplete System

### Overview

The autocomplete system enables users to search for cities and airports with intelligent matching, multi-airport selection, and fallback support.

### Current Implementation

#### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `AirportAutocomplete` | `frontend/src/components/ui/AirportAutocomplete.tsx` | Airport/city search for start/end |
| `DestinationAutocomplete` | `frontend/src/components/ui/DestinationAutocomplete.tsx` | City search for visiting destinations |
| `CityAutocomplete` | `frontend/src/components/city-autocomplete.tsx` | Generic city search |

#### API Endpoints

| Endpoint | Backend | Purpose |
|----------|---------|---------|
| `/api/airports/autocomplete` | FastAPI | Airport search with city grouping |
| `/api/destinations/autocomplete` | FastAPI → SerpAPI | Destination search with fuzzy fallback |
| `/api/locations/autocomplete` | FastAPI → OpenAI | Unified location search |
| `/api/locations/{city_id}/airports` | FastAPI | Get airports for a city |

#### Features

1. **City-to-Airports Mapping**
   - "NYC" → JFK, LGA, EWR
   - "London" → LHR, LGW, STN, LTN, LCY
   - "Paris" → CDG, ORY

2. **Multi-Airport Selection**
   - User can select all airports for a city: `"New York (JFK,LGA,EWR)"`
   - Or individual airport: `"JFK"`

3. **Fallback Hierarchy**
   ```
   1. SerpAPI Google Flights Autocomplete (live)
   2. Backend CSV Data (airports.csv, countries.csv)
   3. Frontend Static Data (autocomplete-fallback-data.ts)
   ```

### Code Flow

```
User types "NYC" in AirportAutocomplete
         │
         ▼
┌────────────────────────────────────────┐
│  Debounce (80ms)                       │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  GET /api/airports/autocomplete?q=NYC  │
│  (Next.js route → FastAPI backend)     │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  airport_service.search_airports()     │
│  - Searches airports.csv               │
│  - Matches city, IATA, airport name    │
│  - Returns grouped by city             │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Response: [                           │
│    { iata: "JFK", city: "New York" },  │
│    { iata: "LGA", city: "New York" },  │
│    { iata: "EWR", city: "Newark" },    │
│  ]                                     │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  Frontend groups by city:              │
│  - "New York (3 airports)" → JFK, LGA  │
│  - "Newark" → EWR                      │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  User selects:                         │
│  - "New York" → "New York (JFK,LGA)"   │
│  - or "JFK" → "JFK"                    │
└────────────────────────────────────────┘
```

### Enhancements for v2.0

#### Train Station Autocomplete

Add train station search alongside airports:

```python
# backend/src/services/station_service.py

MAJOR_TRAIN_STATIONS = {
    "LON": [
        {"code": "STP", "name": "London St Pancras", "type": "station"},
        {"code": "EUS", "name": "London Euston", "type": "station"},
        {"code": "KGX", "name": "London Kings Cross", "type": "station"},
    ],
    "PAR": [
        {"code": "PLY", "name": "Paris Gare de Lyon", "type": "station"},
        {"code": "PNO", "name": "Paris Gare du Nord", "type": "station"},
        {"code": "PMO", "name": "Paris Montparnasse", "type": "station"},
    ],
    # ... more stations
}

def search_stations(query: str, max_results: int = 10) -> List[Dict]:
    """Search train stations by city name or station name."""
    results = []
    q = query.lower().strip()
    
    for city_code, stations in MAJOR_TRAIN_STATIONS.items():
        for station in stations:
            if q in station["name"].lower() or q in city_code.lower():
                results.append({
                    "station_code": station["code"],
                    "station_name": station["name"],
                    "city_code": city_code,
                    "type": "train_station",
                })
    
    return results[:max_results]
```

#### Combined Location Search

Update the unified autocomplete to include train stations:

```python
@app.get("/api/locations/autocomplete")
async def locations_autocomplete(q: str, limit: int = 10):
    """
    Unified search: cities, airports, and train stations.
    """
    results = []
    
    # 1. Search airports
    airports = search_airports(q, max_results=limit)
    for a in airports:
        results.append({
            "type": "airport",
            "code": a["iata_code"],
            "name": a["airport_name"],
            "city": a["city"],
            "transport_modes": ["flight"],
        })
    
    # 2. Search train stations
    stations = search_stations(q, max_results=limit)
    for s in stations:
        results.append({
            "type": "train_station",
            "code": s["station_code"],
            "name": s["station_name"],
            "city_code": s["city_code"],
            "transport_modes": ["train"],
        })
    
    # 3. Search cities (no specific airport/station)
    cities = search_cities(q, max_results=limit)
    for c in cities:
        results.append({
            "type": "city",
            "name": c["name"],
            "country": c["country"],
            "transport_modes": ["flight", "train", "bus", "car"],
        })
    
    # Deduplicate and limit
    return {"suggestions": results[:limit]}
```

---

## Intelligent Chatbot

### Overview

The chatbot (`TripChatbotInline`) allows users to describe their trip in natural language and automatically fills out the trip setup form.

### Current Implementation

**Location:** `frontend/src/components/trip-chatbot-inline.tsx`

**Flow:**
```
User: "I want to go from Seattle to Tokyo and Kyoto, March 10-18, budget $3000"
         │
         ▼
┌────────────────────────────────────────┐
│  tripExtraction.extract(text)          │
│  POST /extract-trip-info               │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  OpenAI extracts:                      │
│  - cities: ["Tokyo", "Kyoto"]          │
│  - startDestination: "Seattle"         │
│  - startDate: "2025-03-10"             │
│  - endDate: "2025-03-18"               │
│  - maxBudget: 3000                     │
└────────────────────────────────────────┘
         │
         ▼
┌────────────────────────────────────────┐
│  onExtract(info) callback              │
│  - Sets form fields                    │
│  - Triggers autocomplete lookups       │
└────────────────────────────────────────┘
```

### Backend Implementation

**Location:** `backend/src/handlers/openAI.py`

```python
def extract_trip_info_with_openai(text: str) -> ExtractedTripInfo:
    """
    Extract structured trip information from natural language.
    
    Extracts:
    - cities: List of destination cities
    - startDestination: Origin city/airport
    - endDestination: Return city/airport (if different)
    - startDate: Start date (YYYY-MM-DD)
    - endDate: End date (YYYY-MM-DD)
    - duration: Trip length in days (if dates not specified)
    - isFlexible: Whether dates are flexible
    - minBudget/maxBudget: Budget range
    - creditCards: List of {program, points} if mentioned
    - flightClass: economy/business/first
    - hotelClass: 3/4/5 star
    """
```

### Enhancements for v2.0

#### Enhanced Extraction Capabilities

```python
# backend/src/handlers/openAI.py - Enhanced version

EXTRACTION_SYSTEM_PROMPT = """You are a travel planning assistant. Extract trip details from natural language.

EXTRACT these fields (return null if not mentioned):
1. cities: Array of destination cities to visit (NOT start/end)
2. startDestination: Starting point (home airport/city)
3. endDestination: Return point (if different from start, for one-way)
4. startDate: Start date in YYYY-MM-DD format
5. endDate: End date in YYYY-MM-DD format
6. duration: Number of days (if dates not specified)
7. isFlexible: true if dates are flexible
8. minBudget: Minimum budget in USD
9. maxBudget: Maximum budget in USD
10. creditCards: Array of {program: string, points: number}
    - Recognize: Chase, Amex, Citi, Capital One, Bilt, United, Delta, American, etc.
11. flightClass: "economy" | "premium_economy" | "business" | "first"
12. hotelClass: "3" | "4" | "5" (star rating)
13. transportPreference: "flight_only" | "train_preferred" | "any" (NEW)
14. travelersCount: Number of travelers (NEW)

CREDIT CARD RECOGNITION:
- "100k Chase points" → {program: "Chase Ultimate Rewards", points: 100000}
- "50k United miles" → {program: "United MileagePlus", points: 50000}
- "200k Amex MR" → {program: "Amex Membership Rewards", points: 200000}

TRANSPORT PREFERENCE:
- "by train" or "prefer train" → "train_preferred"
- "no flights" → "train_preferred" or "ground_only"
- Default → "any"

Return valid JSON."""


def extract_trip_info_with_openai(text: str) -> ExtractedTripInfo:
    """Enhanced trip extraction with transport preferences and traveler count."""
    client = _openai_client()
    
    response = client.chat.completions.create(
        model="gpt-4o",  # Use GPT-4 for better extraction
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        response_format={"type": "json_object"},
        temperature=0.1,  # Low temperature for consistent extraction
    )
    
    raw = response.choices[0].message.content
    data = json.loads(raw) if isinstance(raw, str) else raw
    
    return ExtractedTripInfo(
        cities=data.get("cities") or [],
        startDestination=data.get("startDestination"),
        endDestination=data.get("endDestination"),
        startDate=data.get("startDate"),
        endDate=data.get("endDate"),
        duration=data.get("duration"),
        isFlexible=data.get("isFlexible"),
        minBudget=data.get("minBudget"),
        maxBudget=data.get("maxBudget"),
        creditCards=data.get("creditCards"),
        flightClass=data.get("flightClass"),
        hotelClass=data.get("hotelClass"),
        transportPreference=data.get("transportPreference"),  # NEW
        travelersCount=data.get("travelersCount"),  # NEW
    )
```

#### Multi-Turn Conversation Support

Enhance the chatbot to handle follow-up questions:

```typescript
// frontend/src/components/trip-chatbot-inline.tsx - Enhanced

interface ConversationContext {
  extractedInfo: ExtractedTripInfo;
  missingFields: string[];
  lastIntent: 'initial' | 'clarification' | 'modification';
}

const FOLLOW_UP_PROMPTS: Record<string, string> = {
  cities: "Which cities would you like to visit?",
  startDestination: "Where will you be departing from?",
  dates: "When would you like to travel? (e.g., 'March 10-18' or 'flexible 7 days')",
  budget: "What's your budget for this trip?",
  creditCards: "Do you have any credit card points you'd like to use?",
};

function getNextPrompt(context: ConversationContext): string | null {
  const required = ['cities', 'startDestination', 'dates'];
  
  for (const field of required) {
    if (context.missingFields.includes(field)) {
      return FOLLOW_UP_PROMPTS[field];
    }
  }
  
  return null;
}
```

#### Smart Suggestions

Add proactive suggestions based on extracted info:

```typescript
function generateSmartSuggestions(info: ExtractedTripInfo): string[] {
  const suggestions: string[] = [];
  
  // Suggest trains for European routes
  if (isEuropeanRoute(info.startDestination, info.cities)) {
    suggestions.push("💡 For travel within Europe, trains are often faster and cheaper than flights for distances under 500km.");
  }
  
  // Suggest budget adjustments
  if (info.maxBudget && info.cities.length > 2 && info.maxBudget < 2000) {
    suggestions.push("💡 Your budget might be tight for multiple cities. Consider reducing destinations or increasing budget.");
  }
  
  // Suggest points usage
  if (info.creditCards && info.creditCards.length > 0) {
    const totalPoints = info.creditCards.reduce((sum, c) => sum + c.points, 0);
    suggestions.push(`💡 You have ${totalPoints.toLocaleString()} points available. I'll optimize for maximum value!`);
  }
  
  return suggestions;
}
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js 15)                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         CHATBOT INTERFACE                            │   │
│  │  TripChatbotInline → tripExtraction.extract() → Form Auto-fill      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      AUTOCOMPLETE COMPONENTS                         │   │
│  │  AirportAutocomplete │ DestinationAutocomplete │ CityAutocomplete   │   │
│  │  (City grouping, multi-select, train stations)                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │  Dashboard  │ │  Trip Setup │ │  Results    │ │  Booking/Transfer   │   │
│  │             │ │ Solo/Group  │ │  Compare    │ │    Instructions     │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND (FastAPI + Lambda)                         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    MULTI-MODAL TRANSPORT LAYER                       │   │
│  │                                                                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │   │
│  │  │ Flights  │ │ Trains   │ │ Buses    │ │ Cars     │ │ Ferries  │   │   │
│  │  │(AwardTool│ │(Trainline│ │(FlixBus) │ │(OpenAI)  │ │(Static)  │   │   │
│  │  │ SerpAPI) │ │ OpenAI)  │ │          │ │          │ │          │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │   │
│  │                              │                                        │   │
│  │                    Transport Edge Builder                            │   │
│  └──────────────────────────────┼───────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────┼───────────────────────────────────────┐   │
│  │                     OPTIMIZATION ENGINE                               │   │
│  │                                                                       │   │
│  │  ┌──────────────────────────────────────────────────────────────┐    │   │
│  │  │              ILP Optimizer (PuLP/CBC)                         │    │   │
│  │  │  • Multi-modal path selection (flight vs train vs bus)       │    │   │
│  │  │  • Points value maximization                                  │    │   │
│  │  │  • Dynamic city ordering                                      │    │   │
│  │  │  • Transfer partner optimization                              │    │   │
│  │  └──────────────────────────────────────────────────────────────┘    │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     NLP / CHATBOT LAYER                               │ │
│  │                                                                       │ │
│  │  extract_trip_info_with_openai() → ExtractedTripInfo                 │ │
│  │  suggest_routes_for_remote_cities() → AI route suggestions           │ │
│  │  get_itinerary_smart_tips() → Transfer tips, holiday advice          │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1-5: Core Services

*See IMPLEMENTATION_PLAN_v1.md for detailed Phase 1-5 documentation. The following sections remain unchanged:*

- Phase 1: Core Backend Services (Auth, Trip, Destination, Points)
- Phase 2: External API Integration (AwardTool, SerpAPI, Amadeus, OpenAI)
- Phase 3: ILP Optimization Engine (now enhanced with multi-modal support)
- Phase 4: Group Trip Features (Voting, Cost Splitting)
- Phase 5: Production Hardening (Caching, Rate Limiting, Error Handling)

---

## API Endpoint Specifications

### New Endpoints in v2.0

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/trains/search` | POST | Yes | Search train options |
| `/api/stations/autocomplete` | GET | No | Train station search |
| `/api/transport/multi-modal` | POST | Yes | Combined transport search |

### Updated Endpoints

| Endpoint | Changes |
|----------|---------|
| `/itinerary/generate` | Now includes train/bus/ferry options |
| `/api/locations/autocomplete` | Now includes train stations |

---

## Database Schema Details

### New/Updated Tables

#### tripy-transport-cache
```
Primary Key: cache_key (String)
Sort Key: "CACHE"

Attributes:
- cache_key: String (e.g., "train:LON:PAR")
- data: String (JSON)
- ttl: Number (Unix timestamp for DynamoDB TTL)
- created_at: String (ISO timestamp)
```

---

## Testing Strategy

### Multi-Modal Transport Tests

```python
# test_multi_modal_transport.py

@pytest.mark.asyncio
async def test_train_preferred_over_short_flight():
    """Test that trains are selected for Paris-London when cheaper."""
    edges, flags = await get_all_transport_edges(
        origin="PAR",
        destination="LON",
        date="2025-06-15",
        combined_points={},
        filters={},
    )
    
    assert flags["trains"] == True
    train_edges = [e for e in edges if "TRAIN" in e[2]]
    flight_edges = [e for e in edges if "TRAIN" not in e[2] and e[2] != "BUS" and e[2] != "CAR"]
    
    # Verify Eurostar is available
    assert any("EUROSTAR" in e[2] for e in train_edges)

@pytest.mark.asyncio
async def test_no_train_for_transatlantic():
    """Test that trains are not offered for NYC-London."""
    edges, flags = await get_all_transport_edges(
        origin="JFK",
        destination="LHR",
        date="2025-06-15",
        combined_points={},
        filters={},
    )
    
    assert flags["trains"] == False
    train_edges = [e for e in edges if "TRAIN" in e[2]]
    assert len(train_edges) == 0

def test_chatbot_extracts_train_preference():
    """Test that chatbot extracts transport preferences."""
    text = "I want to go from Paris to Amsterdam by train, April 5-10"
    info = extract_trip_info_with_openai(text)
    
    assert info.transportPreference == "train_preferred"
    assert info.cities == ["Amsterdam"]
    assert info.startDestination == "Paris"
```

### Autocomplete Tests

```python
# test_autocomplete.py

def test_city_groups_multiple_airports():
    """Test that NYC returns JFK, LGA, EWR grouped."""
    results = search_airports("NYC", max_results=10)
    
    nyc_airports = [r for r in results if "New York" in r.get("city", "")]
    assert len(nyc_airports) >= 3
    iata_codes = [r["iata_code"] for r in nyc_airports]
    assert "JFK" in iata_codes
    assert "LGA" in iata_codes

def test_station_autocomplete():
    """Test train station search."""
    results = search_stations("Paris", max_results=5)
    
    assert len(results) >= 2
    station_names = [r["station_name"] for r in results]
    assert any("Nord" in name for name in station_names)
    assert any("Lyon" in name for name in station_names)
```

---

## Summary

### v2.0 Key Additions

1. **Multi-Modal Transport**
   - ✅ Train support with high-speed rail corridors
   - ✅ Enhanced bus/car estimation
   - ✅ Ferry support for sea crossings
   - ✅ Unified transport edge builder
   - ✅ ILP optimization across all modes

2. **Autocomplete System**
   - ✅ City-to-airports grouping
   - ✅ Multi-airport selection
   - ✅ Train station search (new)
   - ✅ Fallback hierarchy

3. **Intelligent Chatbot**
   - ✅ Natural language trip extraction
   - ✅ Credit card/points recognition
   - ✅ Transport preference extraction (new)
   - ✅ Multi-turn conversation support (new)

### Implementation Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| High | Train support for Europe | Medium | High |
| High | Enhanced chatbot extraction | Low | High |
| Medium | Train station autocomplete | Low | Medium |
| Medium | Ferry support | Low | Medium |
| Low | Multi-turn chatbot | Medium | Medium |

---

*Document Version: 2.0*
*Last Updated: January 2026*
