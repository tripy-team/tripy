# Solo Trip Algorithm Implementation Plan

## Guaranteed Accurate Itineraries - No Placeholders, No Fallbacks

This implementation plan ensures that every solo trip itinerary contains **real, bookable flight data** with full support for **connecting flights** and **multi-leg itineraries**. Users always receive accurate information, even if it means showing them a higher cost than expected.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Architecture Overview](#architecture-overview)
3. [Phase 1: Input Validation & Preprocessing](#phase-1-input-validation--preprocessing)
4. [Phase 2: Comprehensive Flight Data Collection](#phase-2-comprehensive-flight-data-collection)
5. [Phase 3: Connecting Flight Support](#phase-3-connecting-flight-support)
6. [Phase 4: Route Graph Construction](#phase-4-route-graph-construction)
7. [Phase 5: ILP Optimization Engine](#phase-5-ilp-optimization-engine)
8. [Phase 6: Result Processing & User Communication](#phase-6-result-processing--user-communication)
9. [Phase 7: Booking Instructions Generation](#phase-7-booking-instructions-generation)
10. [Error Handling Strategy (No Fallbacks)](#error-handling-strategy-no-fallbacks)
11. [Data Models](#data-models)
12. [API Contracts](#api-contracts)
13. [Testing Requirements](#testing-requirements)
14. [Implementation Checklist](#implementation-checklist)

---

## Design Philosophy

### Core Principles

1. **Accuracy Over Comfort**: Users receive real prices, even if higher than expected
2. **No Placeholders**: Every returned itinerary contains actual flight data
3. **No Fallbacks**: System never generates estimated/simple itineraries
4. **Full Connecting Flight Support**: Multi-leg flights are first-class citizens
5. **Connection Validation**: All connections validated against real minimum connection times
6. **Fail Explicitly**: If no real data exists, explain why rather than fabricate

### What We're Eliminating Completely

| Removed Feature | Reason |
|-----------------|--------|
| `generate_simple_itineraries()` | Generates fake cost estimates |
| `_generate_minimal_fallback_itinerary()` | Returns placeholders |
| Formula-based costs (`days * $200`) | Not real prices |
| "Explorer", "Budget", "Quick" variants | Not based on real flights |
| Default infinite costs (`$10,000,000`) | Masks missing data |
| Budget relaxation retry loops | Still may return incomplete data |

### What We're Building

| Feature | Description |
|---------|-------------|
| **Real-Only Flight Search** | Every flight option comes from API calls |
| **Multi-Leg Flight Support** | Connections are validated and bookable |
| **Connection Time Validation** | Ensures passengers can make connections |
| **Explicit Failure Communication** | Clear reasons when routes aren't possible |
| **Accurate Cost Breakdown** | Every dollar traceable to real pricing |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         SOLO TRIP PIPELINE - NO FALLBACKS                           │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│  ┌────────────┐   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐    │
│  │  Phase 1   │──▶│    Phase 2     │──▶│    Phase 3     │──▶│    Phase 4     │    │
│  │ Validation │   │  Flight Fetch  │   │  Connections   │   │  Route Graph   │    │
│  └────────────┘   └────────────────┘   └────────────────┘   └────────────────┘    │
│        │                  │                   │                     │             │
│        ▼                  ▼                   ▼                     ▼             │
│  ┌────────────┐   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐    │
│  │ Strict     │   │ Direct +       │   │ Validate MCT   │   │ All edges      │    │
│  │ validation │   │ Connecting     │   │ Build valid    │   │ have real      │    │
│  │ NO bypass  │   │ flights        │   │ connections    │   │ pricing        │    │
│  └────────────┘   └────────────────┘   └────────────────┘   └────────────────┘    │
│                                                                                     │
│  ┌────────────┐   ┌────────────────┐   ┌────────────────┐                         │
│  │  Phase 5   │──▶│    Phase 6     │──▶│    Phase 7     │                         │
│  │    ILP     │   │    Results     │   │    Booking     │                         │
│  └────────────┘   └────────────────┘   └────────────────┘                         │
│        │                  │                   │                                    │
│        ▼                  ▼                   ▼                                    │
│  ┌────────────┐   ┌────────────────┐   ┌────────────────┐                         │
│  │ Optimize   │   │ Show TRUE      │   │ Step-by-step   │                         │
│  │ with REAL  │   │ costs ONLY     │   │ real booking   │                         │
│  │ data only  │   │ No estimates   │   │ instructions   │                         │
│  └────────────┘   └────────────────┘   └────────────────┘                         │
│                                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                         ERROR PATH (NO FALLBACK)                            │   │
│  │  If ANY phase fails → Return explicit error with actionable guidance        │   │
│  │  NEVER generate placeholder itinerary                                        │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Input Validation & Preprocessing

### 1.1 Strict Input Validation (No Bypass)

```python
class StrictTripInputValidator:
    """
    Validates all user inputs with zero tolerance for missing/invalid data.
    NO bypass mechanisms - invalid input = explicit rejection.
    """
    
    def validate(self, trip_data: TripInput) -> ValidationResult:
        """
        Validates trip input. Returns errors or raises exceptions.
        NEVER returns partial validation - all or nothing.
        """
        errors = []
        
        # ============================================================
        # REQUIRED FIELDS - STRICT VALIDATION
        # ============================================================
        
        # Start destination: REQUIRED, must be valid IATA code
        if not trip_data.start_destination:
            errors.append(ValidationError(
                field="start_destination",
                message="Start destination is required. Enter a valid airport code (e.g., JFK, LAX).",
                code="MISSING_START_DESTINATION",
                severity="blocking"
            ))
        elif not self._is_valid_iata_code(trip_data.start_destination):
            errors.append(ValidationError(
                field="start_destination",
                message=f"'{trip_data.start_destination}' is not a valid airport code.",
                code="INVALID_START_AIRPORT",
                severity="blocking",
                suggestions=self._suggest_airports(trip_data.start_destination)
            ))
        
        # End destination: REQUIRED, must be valid IATA code
        if not trip_data.end_destination:
            errors.append(ValidationError(
                field="end_destination",
                message="End destination is required. Enter a valid airport code.",
                code="MISSING_END_DESTINATION",
                severity="blocking"
            ))
        elif not self._is_valid_iata_code(trip_data.end_destination):
            errors.append(ValidationError(
                field="end_destination",
                message=f"'{trip_data.end_destination}' is not a valid airport code.",
                code="INVALID_END_AIRPORT",
                severity="blocking",
                suggestions=self._suggest_airports(trip_data.end_destination)
            ))
        
        # Destinations: REQUIRED, at least one
        if not trip_data.destinations or len(trip_data.destinations) == 0:
            errors.append(ValidationError(
                field="destinations",
                message="At least one destination city is required.",
                code="NO_DESTINATIONS",
                severity="blocking"
            ))
        else:
            # Validate each destination
            for i, dest in enumerate(trip_data.destinations):
                dest_errors = self._validate_destination(dest, index=i)
                errors.extend(dest_errors)
        
        # Dates: REQUIRED
        date_errors = self._validate_dates_strictly(trip_data)
        errors.extend(date_errors)
        
        # ============================================================
        # BLOCKING ERRORS = IMMEDIATE REJECTION
        # ============================================================
        
        blocking_errors = [e for e in errors if e.severity == "blocking"]
        if blocking_errors:
            return ValidationResult(
                valid=False,
                errors=blocking_errors,
                can_proceed=False,
                message="Cannot proceed with invalid input. Please correct the errors above."
            )
        
        return ValidationResult(valid=True, errors=[], can_proceed=True)
    
    def _validate_dates_strictly(self, trip_data: TripInput) -> List[ValidationError]:
        """
        Strict date validation. NO default dates.
        """
        errors = []
        
        if trip_data.flexible_dates:
            # Flexible mode: duration required
            if not trip_data.duration_days or trip_data.duration_days < 1:
                errors.append(ValidationError(
                    field="duration_days",
                    message="Trip duration is required for flexible dates (minimum 1 day).",
                    code="MISSING_DURATION",
                    severity="blocking"
                ))
            elif trip_data.duration_days > 30:
                errors.append(ValidationError(
                    field="duration_days",
                    message="Trip duration cannot exceed 30 days.",
                    code="DURATION_TOO_LONG",
                    severity="blocking"
                ))
            
            # Search window validation
            if trip_data.earliest_date and trip_data.earliest_date < date.today():
                errors.append(ValidationError(
                    field="earliest_date",
                    message="Earliest date cannot be in the past.",
                    code="PAST_DATE",
                    severity="blocking"
                ))
        else:
            # Fixed dates mode: both dates required
            if not trip_data.start_date:
                errors.append(ValidationError(
                    field="start_date",
                    message="Start date is required.",
                    code="MISSING_START_DATE",
                    severity="blocking"
                ))
            elif trip_data.start_date < date.today():
                errors.append(ValidationError(
                    field="start_date",
                    message="Start date cannot be in the past.",
                    code="PAST_START_DATE",
                    severity="blocking"
                ))
            
            if not trip_data.one_way:
                if not trip_data.end_date:
                    errors.append(ValidationError(
                        field="end_date",
                        message="End date is required for round trips.",
                        code="MISSING_END_DATE",
                        severity="blocking"
                    ))
                elif trip_data.start_date and trip_data.end_date < trip_data.start_date:
                    errors.append(ValidationError(
                        field="end_date",
                        message="End date must be after start date.",
                        code="INVALID_DATE_RANGE",
                        severity="blocking"
                    ))
        
        return errors
    
    def _is_valid_iata_code(self, code: str) -> bool:
        """
        Validates IATA airport code against known database.
        Uses authoritative source, not pattern matching.
        """
        # Load from airports database
        return code.upper() in self.airports_db
    
    def _validate_destination(self, dest: Destination, index: int) -> List[ValidationError]:
        """Validates a single destination."""
        errors = []
        
        if not dest.airport_code:
            errors.append(ValidationError(
                field=f"destinations[{index}].airport_code",
                message=f"Destination {index + 1} requires an airport code.",
                code="MISSING_DESTINATION_AIRPORT",
                severity="blocking"
            ))
        elif not self._is_valid_iata_code(dest.airport_code):
            errors.append(ValidationError(
                field=f"destinations[{index}].airport_code",
                message=f"'{dest.airport_code}' is not a valid airport code.",
                code="INVALID_DESTINATION_AIRPORT",
                severity="blocking",
                suggestions=self._suggest_airports(dest.airport_code)
            ))
        
        return errors
```

### 1.2 Airport Code Resolution (Explicit, No Guessing)

```python
class ExplicitAirportResolver:
    """
    Resolves airport codes explicitly.
    NEVER guesses or uses AI fallback for missing data.
    """
    
    def __init__(self, airports_db: AirportsDatabase):
        self.airports_db = airports_db
        
        # Comprehensive airport database with metadata
        # Pre-loaded from authoritative source (OurAirports, IATA)
        self.airports: Dict[str, AirportInfo] = airports_db.load_all()
        
        # City to airports mapping (many-to-many)
        self.city_airports: Dict[str, List[str]] = airports_db.load_city_mappings()
    
    def resolve(self, location: str) -> AirportResolution:
        """
        Resolves a location to airport code(s).
        Returns explicit success/failure - no fallbacks.
        """
        location = location.strip().upper()
        
        # Strategy 1: Direct IATA code
        if location in self.airports:
            airport = self.airports[location]
            return AirportResolution(
                success=True,
                primary_code=location,
                airport_info=airport,
                all_airports=[airport],
                resolution_method="direct_iata"
            )
        
        # Strategy 2: City name lookup
        city_match = self._match_city(location)
        if city_match:
            return AirportResolution(
                success=True,
                primary_code=city_match.primary_airport,
                airport_info=self.airports[city_match.primary_airport],
                all_airports=[self.airports[code] for code in city_match.all_airports],
                resolution_method="city_lookup"
            )
        
        # Strategy 3: Metropolitan area lookup
        metro_match = self._match_metropolitan_area(location)
        if metro_match:
            return AirportResolution(
                success=True,
                primary_code=metro_match.primary_airport,
                airport_info=self.airports[metro_match.primary_airport],
                all_airports=[self.airports[code] for code in metro_match.all_airports],
                resolution_method="metro_area"
            )
        
        # EXPLICIT FAILURE - No guessing, no AI fallback
        return AirportResolution(
            success=False,
            error=AirportResolutionError(
                input=location,
                message=f"Could not find airport for '{location}'.",
                suggestions=self._get_did_you_mean(location),
                nearby_airports=self._get_nearby_airports_by_text(location)
            )
        )
    
    def get_airports_for_metro_area(self, code: str) -> List[AirportInfo]:
        """
        Returns all airports in a metropolitan area.
        Example: "NYC" returns [JFK, LGA, EWR]
        """
        metro_mapping = {
            "NYC": ["JFK", "LGA", "EWR"],
            "LON": ["LHR", "LGW", "STN", "LTN", "LCY"],
            "TYO": ["NRT", "HND"],
            "PAR": ["CDG", "ORY"],
            "CHI": ["ORD", "MDW"],
            "WAS": ["IAD", "DCA", "BWI"],
            "SFO": ["SFO", "OAK", "SJC"],
            "LAX": ["LAX", "BUR", "SNA", "ONT", "LGB"],
            # ... comprehensive mapping
        }
        
        if code in metro_mapping:
            return [self.airports[c] for c in metro_mapping[code] if c in self.airports]
        return []
```

---

## Phase 2: Comprehensive Flight Data Collection

### 2.1 Flight Search Architecture

```python
class ComprehensiveFlightSearcher:
    """
    Searches for ALL flight options - direct AND connecting.
    No fallbacks - if no flights found, return explicit failure.
    """
    
    # Configuration
    MAX_CONCURRENT_API_CALLS = 10
    API_TIMEOUT_SECONDS = 30
    MAX_CONNECTION_LEGS = 2  # Maximum 2-stop itineraries
    
    def __init__(
        self,
        serp_client: SerpAPIClient,
        awardtool_client: AwardToolClient,
        cache: FlightCache
    ):
        self.serp_client = serp_client
        self.awardtool_client = awardtool_client
        self.cache = cache
    
    async def search_all_options(
        self,
        origin: str,
        destination: str,
        date: date,
        cabin_class: CabinClass,
        include_connections: bool = True
    ) -> FlightSearchResult:
        """
        Searches for ALL flight options between origin and destination.
        Returns both direct and connecting flight options.
        
        NEVER returns estimated or placeholder data.
        """
        
        # Parallel search for both cash and award flights
        tasks = [
            self._search_cash_flights(origin, destination, date, cabin_class),
            self._search_award_flights(origin, destination, date, cabin_class),
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        cash_result, award_result = results
        
        # Process results
        all_options: List[FlightOption] = []
        search_errors: List[SearchError] = []
        
        # Process cash flights
        if isinstance(cash_result, Exception):
            search_errors.append(SearchError(
                source="serp",
                error=str(cash_result),
                recoverable=self._is_recoverable_error(cash_result)
            ))
        else:
            all_options.extend(cash_result.options)
        
        # Process award flights
        if isinstance(award_result, Exception):
            search_errors.append(SearchError(
                source="awardtool",
                error=str(award_result),
                recoverable=self._is_recoverable_error(award_result)
            ))
        else:
            all_options.extend(award_result.options)
        
        # If no options found from any source, this is a failure
        if not all_options:
            return FlightSearchResult(
                success=False,
                options=[],
                search_errors=search_errors,
                failure_reason=self._determine_failure_reason(
                    origin, destination, date, search_errors
                )
            )
        
        return FlightSearchResult(
            success=True,
            options=all_options,
            search_errors=search_errors,  # May have partial errors
            direct_options=[o for o in all_options if o.is_direct],
            connecting_options=[o for o in all_options if not o.is_direct],
            failure_reason=None
        )
```

### 2.2 Cash Flight Search (SERP API) - Full Detail

```python
class CashFlightSearcher:
    """
    Searches for cash flights using SERP API (Google Flights).
    Extracts FULL multi-leg itinerary data.
    """
    
    async def search(
        self,
        origin: str,
        destination: str,
        date: date,
        cabin_class: CabinClass
    ) -> CashSearchResult:
        """
        Searches SERP API and extracts complete flight data.
        Returns both direct and connecting flights with full leg details.
        """
        
        # Build API request
        params = {
            "engine": "google_flights",
            "departure_id": origin,
            "arrival_id": destination,
            "outbound_date": date.isoformat(),
            "travel_class": self._map_cabin_class(cabin_class),
            "currency": "USD",
            "hl": "en",
            "gl": "us",
            "type": "2"  # One-way
        }
        
        response = await self.client.get("/search.json", params=params)
        
        if not response.ok:
            raise FlightSearchAPIError(
                source="serp",
                status_code=response.status_code,
                message=f"SERP API returned {response.status_code}"
            )
        
        data = response.json()
        
        # Extract all flight options
        options = []
        
        # Process best_flights and other_flights
        for category in ["best_flights", "other_flights"]:
            flight_list = data.get(category, [])
            
            for flight_data in flight_list:
                option = self._parse_flight_option(
                    flight_data,
                    origin=origin,
                    destination=destination,
                    search_date=date
                )
                if option:
                    options.append(option)
        
        return CashSearchResult(
            success=True,
            options=options,
            search_timestamp=datetime.utcnow(),
            cache_until=datetime.utcnow() + timedelta(minutes=90)
        )
    
    def _parse_flight_option(
        self,
        flight_data: Dict,
        origin: str,
        destination: str,
        search_date: date
    ) -> Optional[CashFlightOption]:
        """
        Parses a single flight option from SERP response.
        Extracts ALL legs for connecting flights.
        """
        
        # Extract price - REQUIRED
        price = flight_data.get("price")
        if price is None:
            return None  # Cannot use flight without price
        
        # Extract legs
        legs_data = flight_data.get("flights", [])
        if not legs_data:
            return None  # No flight details
        
        legs = []
        for i, leg_data in enumerate(legs_data):
            leg = self._parse_leg(leg_data, leg_index=i)
            if leg:
                legs.append(leg)
        
        if not legs:
            return None  # No valid legs
        
        # Determine if direct or connecting
        is_direct = len(legs) == 1
        
        # Calculate total duration
        total_duration = sum(leg.duration_minutes for leg in legs)
        
        # Add layover times
        layovers = self._calculate_layovers(legs)
        total_duration += sum(l.duration_minutes for l in layovers)
        
        return CashFlightOption(
            option_id=self._generate_option_id(legs),
            option_type="cash",
            
            # Route info
            origin=origin,
            destination=destination,
            
            # Pricing - REAL DATA ONLY
            cash_price_usd=float(price),
            currency="USD",
            
            # Flight structure
            is_direct=is_direct,
            num_stops=len(legs) - 1,
            legs=legs,
            layovers=layovers,
            
            # Timing
            total_duration_minutes=total_duration,
            departure_datetime=legs[0].departure_datetime,
            arrival_datetime=legs[-1].arrival_datetime,
            
            # Booking
            booking_token=flight_data.get("booking_token"),
            airline_codes=[leg.airline_code for leg in legs],
            
            # Metadata
            data_source="serp",
            fetched_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(minutes=90)
        )
    
    def _parse_leg(self, leg_data: Dict, leg_index: int) -> Optional[FlightLeg]:
        """
        Parses a single flight leg with COMPLETE details.
        """
        
        # Extract airports
        dep_airport = leg_data.get("departure_airport", {})
        arr_airport = leg_data.get("arrival_airport", {})
        
        dep_code = dep_airport.get("id")
        arr_code = arr_airport.get("id")
        
        if not dep_code or not arr_code:
            return None
        
        # Extract times - CRITICAL for connection validation
        dep_time_str = dep_airport.get("time")  # Format: "14:30"
        arr_time_str = arr_airport.get("time")
        
        if not dep_time_str or not arr_time_str:
            return None
        
        # Parse datetime
        dep_datetime = self._parse_datetime(
            leg_data.get("departure_airport", {}).get("date"),
            dep_time_str
        )
        arr_datetime = self._parse_datetime(
            leg_data.get("arrival_airport", {}).get("date"),
            arr_time_str
        )
        
        # Extract duration
        duration = leg_data.get("duration")
        if duration is None:
            # Calculate from times if not provided
            duration = int((arr_datetime - dep_datetime).total_seconds() / 60)
        
        # Extract airline and flight number
        airline = leg_data.get("airline", "Unknown")
        airline_code = leg_data.get("airline_logo", "").split("/")[-1].split(".")[0].upper()
        if not airline_code or len(airline_code) != 2:
            airline_code = self._lookup_airline_code(airline)
        
        flight_number = leg_data.get("flight_number", "")
        
        return FlightLeg(
            leg_index=leg_index,
            
            # Airports
            departure_airport=dep_code,
            arrival_airport=arr_code,
            departure_terminal=dep_airport.get("terminal"),
            arrival_terminal=arr_airport.get("terminal"),
            
            # Times - EXACT, not estimated
            departure_datetime=dep_datetime,
            arrival_datetime=arr_datetime,
            duration_minutes=duration,
            
            # Flight info
            airline_name=airline,
            airline_code=airline_code,
            flight_number=flight_number,
            
            # Aircraft (if available)
            aircraft_type=leg_data.get("airplane"),
            
            # Additional
            overnight=leg_data.get("overnight", False),
            often_delayed_by_30_min=leg_data.get("often_delayed_by_over_30_min", False)
        )
    
    def _calculate_layovers(self, legs: List[FlightLeg]) -> List[Layover]:
        """
        Calculates layover information between consecutive legs.
        CRITICAL for connection validation.
        """
        layovers = []
        
        for i in range(len(legs) - 1):
            current_leg = legs[i]
            next_leg = legs[i + 1]
            
            # Calculate layover duration
            layover_start = current_leg.arrival_datetime
            layover_end = next_leg.departure_datetime
            layover_minutes = int((layover_end - layover_start).total_seconds() / 60)
            
            # Determine if terminal change
            terminal_change = (
                current_leg.arrival_terminal != next_leg.departure_terminal
                and current_leg.arrival_terminal is not None
                and next_leg.departure_terminal is not None
            )
            
            # Determine if airline change
            airline_change = current_leg.airline_code != next_leg.airline_code
            
            layovers.append(Layover(
                layover_index=i,
                airport=current_leg.arrival_airport,
                duration_minutes=layover_minutes,
                arrival_terminal=current_leg.arrival_terminal,
                departure_terminal=next_leg.departure_terminal,
                terminal_change=terminal_change,
                airline_change=airline_change,
                arrival_time=layover_start,
                departure_time=layover_end
            ))
        
        return layovers
```

### 2.3 Award Flight Search (AwardTool API) - Full Detail

```python
class AwardFlightSearcher:
    """
    Searches for award flights using AwardTool API.
    Extracts complete multi-leg data with points costs.
    """
    
    # Programs to search by region
    PROGRAMS_BY_REGION = {
        "north_america": ["united", "american", "delta", "alaska", "jetblue"],
        "europe": ["british_airways", "air_france", "lufthansa", "virgin_atlantic"],
        "asia": ["ana", "jal", "singapore", "cathay", "eva"],
        "middle_east": ["emirates", "qatar", "etihad"],
        # ... more regions
    }
    
    async def search(
        self,
        origin: str,
        destination: str,
        date: date,
        cabin_class: CabinClass
    ) -> AwardSearchResult:
        """
        Searches AwardTool API for award availability.
        Returns complete multi-leg award options.
        """
        
        # Determine which programs to search based on route
        programs = self._get_programs_for_route(origin, destination)
        
        # AwardTool API limitation: max 5 programs per request
        all_options = []
        search_errors = []
        
        for program_batch in self._batch(programs, batch_size=5):
            try:
                batch_options = await self._search_programs(
                    origin=origin,
                    destination=destination,
                    date=date,
                    cabin_class=cabin_class,
                    programs=program_batch
                )
                all_options.extend(batch_options)
            except Exception as e:
                search_errors.append(SearchError(
                    source="awardtool",
                    programs=program_batch,
                    error=str(e)
                ))
        
        return AwardSearchResult(
            success=len(all_options) > 0,
            options=all_options,
            search_errors=search_errors,
            programs_searched=programs
        )
    
    async def _search_programs(
        self,
        origin: str,
        destination: str,
        date: date,
        cabin_class: CabinClass,
        programs: List[str]
    ) -> List[AwardFlightOption]:
        """
        Searches specific programs for award availability.
        """
        
        request_body = {
            "origin": origin,
            "destination": destination,
            "date": date.isoformat(),
            "cabin": self._map_cabin_class(cabin_class),
            "programs": programs,
            "num_passengers": 1
        }
        
        response = await self.client.post(
            "/search_real_time",
            json=request_body,
            timeout=self.API_TIMEOUT
        )
        
        if not response.ok:
            raise AwardToolAPIError(
                status_code=response.status_code,
                message=f"AwardTool API error: {response.text}"
            )
        
        data = response.json()
        
        options = []
        for award_data in data.get("data", []):
            option = self._parse_award_option(
                award_data,
                origin=origin,
                destination=destination,
                date=date
            )
            if option:
                options.append(option)
        
        return options
    
    def _parse_award_option(
        self,
        award_data: Dict,
        origin: str,
        destination: str,
        date: date
    ) -> Optional[AwardFlightOption]:
        """
        Parses an award flight option with COMPLETE leg details.
        """
        
        # Extract points cost - REQUIRED
        points_cost = award_data.get("award_points")
        if points_cost is None:
            return None
        
        # Extract program
        program = award_data.get("program")
        if not program:
            return None
        
        # Extract surcharge (taxes/fees)
        surcharge = award_data.get("taxes_fees", 0)
        
        # Extract fare details
        fare = award_data.get("fare", {})
        
        # Extract all legs (products)
        products = fare.get("products", [])
        if not products:
            return None
        
        legs = []
        for i, product in enumerate(products):
            leg = self._parse_award_leg(product, leg_index=i)
            if leg:
                legs.append(leg)
        
        if not legs:
            return None
        
        # Determine direct vs connecting
        is_direct = len(legs) == 1
        
        # Calculate layovers
        layovers = self._calculate_layovers(legs)
        
        # Total duration
        total_duration = fare.get("travel_minutes_total")
        if total_duration is None:
            total_duration = sum(leg.duration_minutes for leg in legs)
            total_duration += sum(l.duration_minutes for l in layovers)
        
        # Extract transfer options (which banks can transfer to this program)
        transfer_options = award_data.get("transfer_options", [])
        
        # Seats available
        seats_available = award_data.get("seats_remaining")
        
        return AwardFlightOption(
            option_id=self._generate_option_id(legs, program),
            option_type="award",
            
            # Route
            origin=origin,
            destination=destination,
            
            # Pricing - REAL DATA
            points_cost=int(points_cost),
            points_program=program,
            surcharge_usd=float(surcharge),
            
            # Flight structure
            is_direct=is_direct,
            num_stops=len(legs) - 1,
            legs=legs,
            layovers=layovers,
            
            # Timing
            total_duration_minutes=total_duration,
            departure_datetime=legs[0].departure_datetime,
            arrival_datetime=legs[-1].arrival_datetime,
            
            # Transfer info
            transfer_partners=self._parse_transfer_partners(transfer_options),
            
            # Availability
            seats_available=seats_available,
            cabin_class=fare.get("cabin"),
            
            # Booking
            booking_link=award_data.get("deep_link"),
            
            # Metadata
            data_source="awardtool",
            fetched_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(hours=6)
        )
    
    def _parse_award_leg(self, product: Dict, leg_index: int) -> Optional[FlightLeg]:
        """
        Parses an award flight leg from AwardTool product data.
        """
        
        # Extract airports
        origin = product.get("origin")
        destination = product.get("destination")
        
        if not origin or not destination:
            return None
        
        # Extract times
        dep_time = product.get("departure_time")
        arr_time = product.get("arrival_time")
        dep_date = product.get("departure_date")
        arr_date = product.get("arrival_date")
        
        if not dep_time or not arr_time:
            return None
        
        # Parse datetimes
        dep_datetime = self._parse_datetime(dep_date, dep_time)
        arr_datetime = self._parse_datetime(arr_date or dep_date, arr_time)
        
        # Handle overnight flights
        if arr_datetime < dep_datetime:
            arr_datetime += timedelta(days=1)
        
        # Duration
        duration = product.get("travel_minutes")
        if duration is None:
            duration = int((arr_datetime - dep_datetime).total_seconds() / 60)
        
        return FlightLeg(
            leg_index=leg_index,
            
            departure_airport=origin,
            arrival_airport=destination,
            departure_terminal=product.get("departure_terminal"),
            arrival_terminal=product.get("arrival_terminal"),
            
            departure_datetime=dep_datetime,
            arrival_datetime=arr_datetime,
            duration_minutes=duration,
            
            airline_name=product.get("airline"),
            airline_code=product.get("airline_code"),
            flight_number=product.get("flight_number"),
            
            aircraft_type=product.get("aircraft"),
            cabin=product.get("cabin")
        )
    
    def _parse_transfer_partners(
        self,
        transfer_options: List[Dict]
    ) -> List[TransferPartner]:
        """
        Parses transfer partner information.
        """
        partners = []
        
        for option in transfer_options:
            bank = option.get("bank")
            ratio = option.get("ratio", 1.0)
            instant = option.get("instant_transfer", False)
            min_transfer = option.get("minimum_transfer", 1000)
            
            if bank:
                partners.append(TransferPartner(
                    bank_program=bank,
                    transfer_ratio=ratio,
                    is_instant=instant,
                    minimum_transfer=min_transfer,
                    transfer_time_hours=0 if instant else 48
                ))
        
        return partners
```

---

## Phase 3: Connecting Flight Support

### 3.1 Connection Validator

```python
class ConnectionValidator:
    """
    Validates that connecting flights are actually feasible.
    Uses real minimum connection times (MCT) data.
    """
    
    def __init__(self, mct_database: MCTDatabase):
        """
        Initialize with MCT (Minimum Connection Time) database.
        MCT data sourced from OAG or equivalent authoritative source.
        """
        self.mct_db = mct_database
        
        # Default MCTs when specific data not available
        self.DEFAULT_MCT = {
            "domestic_domestic": 45,      # D-D: 45 min
            "domestic_international": 90,  # D-I: 90 min
            "international_domestic": 90,  # I-D: 90 min
            "international_international": 60,  # I-I: 60 min
            "terminal_change_addon": 15,   # Add 15 min for terminal change
            "airline_change_addon": 15,    # Add 15 min for airline change
        }
    
    def validate_connection(
        self,
        arriving_leg: FlightLeg,
        departing_leg: FlightLeg
    ) -> ConnectionValidation:
        """
        Validates a single connection between two legs.
        Returns detailed validation result with warnings/errors.
        """
        
        # Connection airport
        connection_airport = arriving_leg.arrival_airport
        
        if connection_airport != departing_leg.departure_airport:
            return ConnectionValidation(
                valid=False,
                error="Connection airports don't match",
                arriving_leg=arriving_leg,
                departing_leg=departing_leg
            )
        
        # Calculate actual layover time
        layover_minutes = int(
            (departing_leg.departure_datetime - arriving_leg.arrival_datetime).total_seconds() / 60
        )
        
        # Get minimum connection time
        mct = self._get_mct(
            airport=connection_airport,
            arriving_flight=arriving_leg,
            departing_flight=departing_leg
        )
        
        # Validate
        if layover_minutes < mct.minimum_minutes:
            return ConnectionValidation(
                valid=False,
                error=f"Connection time ({layover_minutes} min) is less than minimum ({mct.minimum_minutes} min)",
                layover_minutes=layover_minutes,
                minimum_required_minutes=mct.minimum_minutes,
                mct_reason=mct.reason,
                arriving_leg=arriving_leg,
                departing_leg=departing_leg
            )
        
        # Check for tight connection warning
        buffer_minutes = layover_minutes - mct.minimum_minutes
        
        warnings = []
        if buffer_minutes < 15:
            warnings.append(ConnectionWarning(
                type="tight_connection",
                message=f"Only {buffer_minutes} min buffer beyond minimum. Consider longer layover."
            ))
        
        if layover_minutes > 360:  # 6 hours
            warnings.append(ConnectionWarning(
                type="long_layover",
                message=f"Long layover of {layover_minutes // 60}h {layover_minutes % 60}m at {connection_airport}"
            ))
        
        return ConnectionValidation(
            valid=True,
            layover_minutes=layover_minutes,
            minimum_required_minutes=mct.minimum_minutes,
            buffer_minutes=buffer_minutes,
            warnings=warnings,
            arriving_leg=arriving_leg,
            departing_leg=departing_leg,
            connection_airport=connection_airport,
            terminal_change=arriving_leg.arrival_terminal != departing_leg.departure_terminal
        )
    
    def _get_mct(
        self,
        airport: str,
        arriving_flight: FlightLeg,
        departing_flight: FlightLeg
    ) -> MCTResult:
        """
        Gets the Minimum Connection Time for a specific connection.
        """
        
        # Determine flight types
        arriving_is_international = self._is_international(arriving_flight)
        departing_is_international = self._is_international(departing_flight)
        
        # Try to get specific MCT from database
        specific_mct = self.mct_db.get_mct(
            airport=airport,
            arriving_carrier=arriving_flight.airline_code,
            departing_carrier=departing_flight.airline_code,
            arriving_terminal=arriving_flight.arrival_terminal,
            departing_terminal=departing_flight.departure_terminal,
            connection_type=self._get_connection_type(
                arriving_is_international,
                departing_is_international
            )
        )
        
        if specific_mct:
            return specific_mct
        
        # Fall back to defaults
        base_mct = self._get_default_mct(
            arriving_is_international,
            departing_is_international
        )
        
        # Add time for terminal change
        if (arriving_flight.arrival_terminal and 
            departing_flight.departure_terminal and
            arriving_flight.arrival_terminal != departing_flight.departure_terminal):
            base_mct += self.DEFAULT_MCT["terminal_change_addon"]
        
        # Add time for airline change
        if arriving_flight.airline_code != departing_flight.airline_code:
            base_mct += self.DEFAULT_MCT["airline_change_addon"]
        
        return MCTResult(
            minimum_minutes=base_mct,
            reason="default_calculation",
            source="system_default"
        )
    
    def _get_default_mct(
        self,
        arriving_international: bool,
        departing_international: bool
    ) -> int:
        """Gets default MCT based on connection type."""
        
        if not arriving_international and not departing_international:
            return self.DEFAULT_MCT["domestic_domestic"]
        elif not arriving_international and departing_international:
            return self.DEFAULT_MCT["domestic_international"]
        elif arriving_international and not departing_international:
            return self.DEFAULT_MCT["international_domestic"]
        else:
            return self.DEFAULT_MCT["international_international"]
    
    def validate_itinerary_connections(
        self,
        legs: List[FlightLeg]
    ) -> ItineraryConnectionValidation:
        """
        Validates ALL connections in a multi-leg itinerary.
        """
        
        if len(legs) <= 1:
            return ItineraryConnectionValidation(
                all_valid=True,
                connections=[],
                is_direct=True
            )
        
        connections = []
        all_valid = True
        
        for i in range(len(legs) - 1):
            validation = self.validate_connection(
                arriving_leg=legs[i],
                departing_leg=legs[i + 1]
            )
            connections.append(validation)
            
            if not validation.valid:
                all_valid = False
        
        return ItineraryConnectionValidation(
            all_valid=all_valid,
            connections=connections,
            is_direct=False,
            total_layover_minutes=sum(c.layover_minutes for c in connections if c.valid),
            warnings=[w for c in connections for w in (c.warnings or [])]
        )
```

### 3.2 Connection-Aware Flight Option

```python
@dataclass
class ConnectingFlightOption:
    """
    Represents a complete flight option with full connection details.
    Both direct and connecting flights use this model.
    """
    
    # Identification
    option_id: str
    option_type: Literal["cash", "award"]
    
    # Route
    origin: str  # First departure airport
    destination: str  # Final arrival airport
    
    # Structure
    is_direct: bool
    num_stops: int  # 0 for direct, 1+ for connections
    
    # Legs - ORDERED list of all flight legs
    legs: List[FlightLeg]
    
    # Layovers - Connection details between legs
    layovers: List[Layover]
    
    # Connection validation
    connections_valid: bool
    connection_validations: List[ConnectionValidation]
    
    # Timing
    total_duration_minutes: int  # Including layovers
    flight_time_minutes: int     # Excluding layovers
    layover_time_minutes: int    # Total time on ground
    departure_datetime: datetime
    arrival_datetime: datetime
    
    # Pricing
    cash_price_usd: Optional[float]
    points_cost: Optional[int]
    points_program: Optional[str]
    surcharge_usd: Optional[float]
    
    # Booking
    booking_link: Optional[str]
    requires_separate_bookings: bool  # True if legs from different airlines
    
    # Airlines involved
    airlines: List[str]
    marketing_carriers: List[str]
    operating_carriers: List[str]
    
    # Transfer info (for award)
    transfer_partners: List[TransferPartner]
    
    # Availability
    seats_available: Optional[int]
    
    # Metadata
    data_source: str
    fetched_at: datetime
    expires_at: datetime
    
    @property
    def is_valid(self) -> bool:
        """Option is valid only if all connections are valid."""
        return self.connections_valid
    
    @property
    def requires_overnight(self) -> bool:
        """Check if any leg or layover is overnight."""
        return any(leg.overnight for leg in self.legs) or any(
            l.duration_minutes > 480 for l in self.layovers  # 8+ hour layover
        )
    
    @property
    def connection_airports(self) -> List[str]:
        """List of airports where connections occur."""
        return [l.airport for l in self.layovers]
    
    def get_booking_instructions(self) -> List[BookingStep]:
        """
        Generates booking instructions for this option.
        Handles both single-booking and separate-booking scenarios.
        """
        if not self.requires_separate_bookings:
            # Single booking for entire itinerary
            return [BookingStep(
                step=1,
                action="Book complete itinerary",
                link=self.booking_link,
                price=self.cash_price_usd or self.surcharge_usd,
                points=self.points_cost,
                legs=self.legs
            )]
        else:
            # Separate bookings needed
            steps = []
            for i, leg in enumerate(self.legs):
                steps.append(BookingStep(
                    step=i + 1,
                    action=f"Book {leg.departure_airport} → {leg.arrival_airport}",
                    airline=leg.airline_name,
                    flight_number=leg.flight_number,
                    # Note: would need per-leg pricing from API
                ))
            return steps
```

### 3.3 Building Valid Itinerary from Legs

```python
class ItineraryBuilder:
    """
    Builds complete itineraries from flight options.
    Ensures all connections are validated.
    """
    
    def __init__(self, connection_validator: ConnectionValidator):
        self.connection_validator = connection_validator
    
    def build_from_flight_option(
        self,
        option: Union[CashFlightOption, AwardFlightOption]
    ) -> ConnectingFlightOption:
        """
        Builds a ConnectingFlightOption with validated connections.
        """
        
        # Validate all connections
        connection_validation = self.connection_validator.validate_itinerary_connections(
            option.legs
        )
        
        return ConnectingFlightOption(
            option_id=option.option_id,
            option_type=option.option_type,
            
            origin=option.legs[0].departure_airport,
            destination=option.legs[-1].arrival_airport,
            
            is_direct=len(option.legs) == 1,
            num_stops=len(option.legs) - 1,
            
            legs=option.legs,
            layovers=option.layovers,
            
            connections_valid=connection_validation.all_valid,
            connection_validations=connection_validation.connections,
            
            total_duration_minutes=option.total_duration_minutes,
            flight_time_minutes=sum(leg.duration_minutes for leg in option.legs),
            layover_time_minutes=sum(l.duration_minutes for l in option.layovers),
            
            departure_datetime=option.departure_datetime,
            arrival_datetime=option.arrival_datetime,
            
            cash_price_usd=getattr(option, 'cash_price_usd', None),
            points_cost=getattr(option, 'points_cost', None),
            points_program=getattr(option, 'points_program', None),
            surcharge_usd=getattr(option, 'surcharge_usd', None),
            
            booking_link=option.booking_link,
            requires_separate_bookings=self._requires_separate_bookings(option.legs),
            
            airlines=list(set(leg.airline_name for leg in option.legs)),
            marketing_carriers=list(set(leg.airline_code for leg in option.legs)),
            operating_carriers=list(set(
                leg.operating_carrier or leg.airline_code for leg in option.legs
            )),
            
            transfer_partners=getattr(option, 'transfer_partners', []),
            seats_available=getattr(option, 'seats_available', None),
            
            data_source=option.data_source,
            fetched_at=option.fetched_at,
            expires_at=option.expires_at
        )
    
    def _requires_separate_bookings(self, legs: List[FlightLeg]) -> bool:
        """
        Determines if legs need to be booked separately.
        """
        if len(legs) <= 1:
            return False
        
        # Check if all legs are on the same airline or codeshare
        airline_codes = set(leg.airline_code for leg in legs)
        
        # If more than 2 different airlines, likely separate bookings
        if len(airline_codes) > 2:
            return True
        
        # Check for known alliances/partnerships
        # This would use a partnership database
        return not self._are_partner_airlines(airline_codes)
```

---

## Phase 4: Route Graph Construction

### 4.1 Building the Route Graph with Connections

```python
class RouteGraphBuilder:
    """
    Constructs a route graph that properly represents both
    direct and connecting flights as edges.
    """
    
    def __init__(
        self,
        connection_validator: ConnectionValidator,
        itinerary_builder: ItineraryBuilder
    ):
        self.connection_validator = connection_validator
        self.itinerary_builder = itinerary_builder
    
    def build(
        self,
        trip_data: TripInput,
        flight_search_results: Dict[str, FlightSearchResult]
    ) -> RouteGraph:
        """
        Builds complete route graph from flight search results.
        
        Graph structure:
        - Nodes: airports (origin, destinations, end)
        - Edges: flight options (direct OR connecting, each as single edge)
        """
        
        graph = RouteGraph()
        
        # Add nodes
        self._add_nodes(graph, trip_data)
        
        # Add edges from flight search results
        for segment_key, search_result in flight_search_results.items():
            origin, destination = segment_key.split("->")
            
            for option in search_result.options:
                # Build complete option with validation
                complete_option = self.itinerary_builder.build_from_flight_option(option)
                
                # Only add valid options (connections validated)
                if complete_option.is_valid:
                    edge = self._create_edge(
                        origin=origin,
                        destination=destination,
                        option=complete_option
                    )
                    graph.add_edge(edge)
                else:
                    # Log invalid options for debugging
                    self._log_invalid_option(complete_option)
        
        # Validate graph completeness
        self._validate_graph_completeness(graph, trip_data)
        
        return graph
    
    def _create_edge(
        self,
        origin: str,
        destination: str,
        option: ConnectingFlightOption
    ) -> RouteEdge:
        """
        Creates a route edge from a flight option.
        The edge represents the ENTIRE journey from origin to destination,
        whether direct or connecting.
        """
        
        return RouteEdge(
            edge_id=f"{origin}_{destination}_{option.option_id}",
            
            # Endpoints
            from_node=origin,
            to_node=destination,
            
            # Option details
            flight_option=option,
            option_type=option.option_type,
            
            # Pricing (REAL DATA ONLY)
            cash_cost=option.cash_price_usd,
            points_cost=option.points_cost,
            points_program=option.points_program,
            surcharge=option.surcharge_usd,
            
            # Timing
            total_duration_minutes=option.total_duration_minutes,
            departure_datetime=option.departure_datetime,
            arrival_datetime=option.arrival_datetime,
            
            # Structure
            is_direct=option.is_direct,
            num_stops=option.num_stops,
            connection_airports=option.connection_airports,
            
            # Legs for detailed booking
            legs=option.legs,
            layovers=option.layovers,
            
            # Booking
            booking_link=option.booking_link,
            requires_separate_bookings=option.requires_separate_bookings,
            
            # Transfer info
            transfer_partners=option.transfer_partners,
            
            # Availability
            seats_available=option.seats_available,
            
            # Data quality
            data_source=option.data_source,
            data_fetched_at=option.fetched_at,
            data_expires_at=option.expires_at
        )
    
    def _validate_graph_completeness(
        self,
        graph: RouteGraph,
        trip_data: TripInput
    ) -> None:
        """
        Validates that the graph has all required edges.
        Raises explicit error if any segment is missing.
        NO FALLBACK - missing data = failure.
        """
        
        required_segments = self._get_required_segments(trip_data)
        
        missing_segments = []
        for origin, destination in required_segments:
            edges = graph.get_edges(origin, destination)
            if not edges:
                missing_segments.append((origin, destination))
        
        if missing_segments:
            raise MissingFlightDataError(
                message="No flight options found for required route segments",
                missing_segments=missing_segments,
                trip_data=trip_data
            )
    
    def _get_required_segments(
        self,
        trip_data: TripInput
    ) -> List[Tuple[str, str]]:
        """
        Determines which O-D pairs are required for this trip.
        For multi-city trips, generates all necessary pairs.
        """
        
        # Get ordered list of all stops
        stops = [trip_data.start_destination]
        stops.extend(d.airport_code for d in trip_data.destinations)
        stops.append(trip_data.end_destination)
        
        # Generate required pairs
        # For flexibility, we need edges between ALL pairs (not just consecutive)
        # This allows the optimizer to find the best ordering
        
        segments = []
        for i, origin in enumerate(stops[:-1]):
            for destination in stops[i+1:]:
                segments.append((origin, destination))
        
        return segments
```

### 4.2 Route Enumeration with Connection Awareness

```python
class RouteEnumerator:
    """
    Enumerates valid routes through the graph.
    Considers connection validity and total journey time.
    """
    
    def enumerate_routes(
        self,
        graph: RouteGraph,
        trip_data: TripInput,
        max_routes: int = 100
    ) -> List[RouteOption]:
        """
        Enumerates all valid routes visiting all required destinations.
        
        NO FALLBACK - if no valid routes exist, raises explicit error.
        """
        
        # Get must-visit cities
        must_visit = [d.airport_code for d in trip_data.destinations if d.must_include]
        optional = [d.airport_code for d in trip_data.destinations if not d.must_include]
        
        start = trip_data.start_destination
        end = trip_data.end_destination
        
        # Generate candidate routes
        candidates = self._generate_candidate_routes(
            start=start,
            end=end,
            must_visit=must_visit,
            optional=optional,
            graph=graph
        )
        
        # Validate each candidate
        valid_routes = []
        invalid_routes = []
        
        for candidate in candidates:
            validation = self._validate_route(candidate, graph, trip_data)
            
            if validation.is_valid:
                route = RouteOption(
                    route_id=self._generate_route_id(candidate),
                    stops=candidate,
                    validation=validation,
                    estimated_duration=validation.total_duration_minutes,
                    estimated_cost=validation.estimated_cost
                )
                valid_routes.append(route)
            else:
                invalid_routes.append((candidate, validation))
        
        # If no valid routes, raise explicit error
        if not valid_routes:
            raise NoValidRouteError(
                message="No valid route found visiting all required destinations",
                must_visit=must_visit,
                start=start,
                end=end,
                invalid_routes=invalid_routes,
                reasons=self._summarize_invalid_reasons(invalid_routes)
            )
        
        # Sort by estimated cost and return top N
        valid_routes.sort(key=lambda r: r.estimated_cost)
        return valid_routes[:max_routes]
    
    def _generate_candidate_routes(
        self,
        start: str,
        end: str,
        must_visit: List[str],
        optional: List[str],
        graph: RouteGraph
    ) -> List[List[str]]:
        """
        Generates candidate routes (orderings of destinations).
        """
        
        candidates = []
        
        # Generate permutations of must-visit cities
        if len(must_visit) <= 7:
            # Enumerate all permutations for small number
            for perm in itertools.permutations(must_visit):
                route = [start] + list(perm) + [end]
                candidates.append(route)
        else:
            # Use heuristics for larger numbers
            candidates = self._generate_heuristic_routes(
                start, end, must_visit, graph
            )
        
        # Optionally include some optional cities if edges exist
        # (This is an enhancement - basic implementation just uses must-visit)
        
        return candidates
    
    def _validate_route(
        self,
        route: List[str],
        graph: RouteGraph,
        trip_data: TripInput
    ) -> RouteValidation:
        """
        Validates a complete route.
        Checks that all segments have valid flight options.
        """
        
        segment_validations = []
        total_duration = 0
        total_cash_cost = 0
        
        for i in range(len(route) - 1):
            origin = route[i]
            destination = route[i + 1]
            
            edges = graph.get_edges(origin, destination)
            
            if not edges:
                segment_validations.append(SegmentValidation(
                    origin=origin,
                    destination=destination,
                    valid=False,
                    error="No flight options available"
                ))
                continue
            
            # Find best option for this segment (by cost)
            best_edge = min(edges, key=lambda e: self._get_edge_cost(e))
            
            segment_validations.append(SegmentValidation(
                origin=origin,
                destination=destination,
                valid=True,
                best_option=best_edge,
                all_options=edges
            ))
            
            total_duration += best_edge.total_duration_minutes
            total_cash_cost += self._get_edge_cost(best_edge)
        
        # Route is valid only if ALL segments are valid
        all_valid = all(sv.valid for sv in segment_validations)
        
        return RouteValidation(
            is_valid=all_valid,
            segments=segment_validations,
            total_duration_minutes=total_duration,
            estimated_cost=total_cash_cost,
            invalid_segments=[sv for sv in segment_validations if not sv.valid]
        )
```

---

## Phase 5: ILP Optimization Engine

### 5.1 Complete ILP Model with Connections

```python
class ItineraryOptimizer:
    """
    ILP optimizer that handles both direct and connecting flights.
    Uses REAL pricing data only - no estimates.
    """
    
    def __init__(self):
        self.solver_timeout = 60  # seconds
    
    def optimize(
        self,
        graph: RouteGraph,
        routes: List[RouteOption],
        user_points: Dict[str, int],
        user_budget: Optional[float]
    ) -> OptimizationResult:
        """
        Finds optimal itinerary minimizing out-of-pocket cost.
        
        Returns:
        - Optimal itinerary if feasible
        - Minimum cost itinerary if budget exceeded (with clear indication)
        - Explicit failure if optimization impossible
        """
        
        # Create ILP problem
        problem = pulp.LpProblem("Trip_Optimization", pulp.LpMinimize)
        
        # Build variables
        variables = self._create_variables(graph, routes, user_points)
        
        # Build objective: minimize OOP
        objective = self._build_objective(variables, graph)
        problem += objective
        
        # Add constraints
        self._add_route_selection_constraints(problem, variables, routes)
        self._add_edge_selection_constraints(problem, variables, graph)
        self._add_payment_constraints(problem, variables, graph)
        self._add_points_constraints(problem, variables, user_points)
        self._add_transfer_constraints(problem, variables)
        self._add_connection_time_constraints(problem, variables, graph)
        
        # First solve WITHOUT budget constraint to find minimum cost
        solver = pulp.PULP_CBC_CMD(msg=0, timeLimit=self.solver_timeout)
        status = problem.solve(solver)
        
        if status != pulp.LpStatusOptimal:
            raise OptimizationFailedError(
                message="Could not find optimal solution",
                status=pulp.LpStatus[status]
            )
        
        minimum_cost = pulp.value(problem.objective)
        minimum_cost_solution = self._extract_solution(variables, graph)
        
        # If user specified budget, check feasibility
        if user_budget is not None:
            if minimum_cost <= user_budget:
                # Within budget - return optimal solution
                return OptimizationResult(
                    success=True,
                    itinerary=minimum_cost_solution,
                    total_oop=minimum_cost,
                    within_budget=True,
                    user_budget=user_budget
                )
            else:
                # Budget exceeded - return minimum cost with clear indication
                return OptimizationResult(
                    success=True,  # We DID find a solution
                    itinerary=minimum_cost_solution,
                    total_oop=minimum_cost,
                    within_budget=False,
                    user_budget=user_budget,
                    budget_exceeded_by=minimum_cost - user_budget,
                    message=f"Minimum cost is ${minimum_cost:.2f}, "
                            f"which exceeds your budget of ${user_budget:.2f} "
                            f"by ${minimum_cost - user_budget:.2f}."
                )
        
        # No budget specified - return optimal solution
        return OptimizationResult(
            success=True,
            itinerary=minimum_cost_solution,
            total_oop=minimum_cost,
            within_budget=True,
            user_budget=None
        )
    
    def _create_variables(
        self,
        graph: RouteGraph,
        routes: List[RouteOption],
        user_points: Dict[str, int]
    ) -> OptimizationVariables:
        """Creates all ILP variables."""
        
        variables = OptimizationVariables()
        
        # Route selection: r[route_id] = 1 if this route is selected
        for route in routes:
            var_name = f"route_{route.route_id}"
            variables.route_selection[var_name] = pulp.LpVariable(
                var_name, cat='Binary'
            )
        
        # Edge selection: x[edge_id] = 1 if this edge (flight option) is selected
        for edge in graph.all_edges:
            var_name = f"edge_{edge.edge_id}"
            variables.edge_selection[var_name] = pulp.LpVariable(
                var_name, cat='Binary'
            )
        
        # Payment method: pay[edge_id][method] = 1 if paying with this method
        for edge in graph.all_edges:
            # Cash payment option
            var_name = f"pay_{edge.edge_id}_cash"
            variables.payment_method[var_name] = pulp.LpVariable(
                var_name, cat='Binary'
            )
            
            # Points payment options (one per available program)
            if edge.points_cost and edge.points_program:
                var_name = f"pay_{edge.edge_id}_{edge.points_program}"
                variables.payment_method[var_name] = pulp.LpVariable(
                    var_name, cat='Binary'
                )
        
        # Points transfer: t[bank][airline] = amount transferred (in 1000s)
        for bank, balance in user_points.items():
            if bank in TRANSFER_GRAPH:
                for airline, ratio, _ in TRANSFER_GRAPH[bank]:
                    var_name = f"transfer_{bank}_{airline}"
                    variables.transfers[var_name] = pulp.LpVariable(
                        var_name,
                        lowBound=0,
                        upBound=balance // 1000,  # Transfer in 1000-point blocks
                        cat='Integer'
                    )
        
        return variables
    
    def _build_objective(
        self,
        variables: OptimizationVariables,
        graph: RouteGraph
    ) -> pulp.LpAffineExpression:
        """
        Build objective function: minimize out-of-pocket cost.
        OOP = cash payments + surcharges on award bookings
        """
        
        objective = 0
        
        for edge in graph.all_edges:
            edge_var = variables.edge_selection[f"edge_{edge.edge_id}"]
            
            # Cash payment contribution
            cash_var = variables.payment_method.get(f"pay_{edge.edge_id}_cash")
            if cash_var and edge.cash_cost:
                objective += edge.cash_cost * cash_var
            
            # Points payment contribution (surcharge only)
            if edge.points_program and edge.surcharge:
                points_var = variables.payment_method.get(
                    f"pay_{edge.edge_id}_{edge.points_program}"
                )
                if points_var:
                    objective += edge.surcharge * points_var
        
        return objective
    
    def _add_connection_time_constraints(
        self,
        problem: pulp.LpProblem,
        variables: OptimizationVariables,
        graph: RouteGraph
    ) -> None:
        """
        Add constraints ensuring valid connection times when combining edges.
        
        For multi-leg itineraries, ensures that:
        1. Arrival time of edge N + layover < Departure time of edge N+1
        2. Connection times meet MCT requirements
        """
        
        # For each pair of edges that could be consecutive in a route
        for route in graph.routes:
            for i in range(len(route.stops) - 2):
                # Current segment and next segment
                current_dest = route.stops[i + 1]
                
                # Get edges arriving at current_dest
                arriving_edges = graph.get_edges_to(current_dest)
                
                # Get edges departing from current_dest
                departing_edges = graph.get_edges_from(current_dest)
                
                # For each pair, add constraint
                for arr_edge in arriving_edges:
                    for dep_edge in departing_edges:
                        # Only constrain if both could be selected
                        arr_var = variables.edge_selection.get(f"edge_{arr_edge.edge_id}")
                        dep_var = variables.edge_selection.get(f"edge_{dep_edge.edge_id}")
                        
                        if arr_var and dep_var:
                            # Calculate minimum required gap
                            min_gap = self._get_minimum_connection_time(
                                arr_edge, dep_edge, current_dest
                            )
                            
                            # Actual gap
                            actual_gap = (
                                dep_edge.departure_datetime - arr_edge.arrival_datetime
                            ).total_seconds() / 60
                            
                            # If gap is insufficient, these edges can't both be selected
                            if actual_gap < min_gap:
                                problem += (
                                    arr_var + dep_var <= 1,
                                    f"invalid_connection_{arr_edge.edge_id}_{dep_edge.edge_id}"
                                )
```

### 5.2 Solution Extraction with Full Connection Details

```python
def _extract_solution(
    self,
    variables: OptimizationVariables,
    graph: RouteGraph
) -> Itinerary:
    """
    Extracts complete itinerary from solved ILP.
    Includes full leg and connection details.
    """
    
    # Find selected edges
    selected_edges = []
    for var_name, var in variables.edge_selection.items():
        if var.value() > 0.5:  # Binary variable selected
            edge_id = var_name.replace("edge_", "")
            edge = graph.get_edge_by_id(edge_id)
            selected_edges.append(edge)
    
    # Order edges by departure time
    selected_edges.sort(key=lambda e: e.departure_datetime)
    
    # Build flight segments with full details
    flight_segments = []
    for edge in selected_edges:
        segment = FlightSegment(
            segment_id=edge.edge_id,
            origin=edge.from_node,
            destination=edge.to_node,
            
            # Full leg details
            legs=edge.legs,
            layovers=edge.layovers,
            
            is_direct=edge.is_direct,
            num_stops=edge.num_stops,
            connection_airports=edge.connection_airports,
            
            departure_datetime=edge.departure_datetime,
            arrival_datetime=edge.arrival_datetime,
            total_duration_minutes=edge.total_duration_minutes,
            
            # Payment details
            payment_method=self._get_payment_method(edge, variables),
            cash_cost=edge.cash_cost if self._paying_cash(edge, variables) else None,
            points_cost=edge.points_cost if not self._paying_cash(edge, variables) else None,
            points_program=edge.points_program if not self._paying_cash(edge, variables) else None,
            surcharge=edge.surcharge if not self._paying_cash(edge, variables) else None,
            
            # Booking
            booking_link=edge.booking_link,
            requires_separate_bookings=edge.requires_separate_bookings
        )
        flight_segments.append(segment)
    
    # Build transfer plan
    transfer_plan = self._extract_transfer_plan(variables)
    
    # Calculate totals
    total_cash = sum(s.cash_cost or 0 for s in flight_segments)
    total_surcharges = sum(s.surcharge or 0 for s in flight_segments)
    total_oop = total_cash + total_surcharges
    
    points_used = {}
    for segment in flight_segments:
        if segment.points_program and segment.points_cost:
            program = segment.points_program
            points_used[program] = points_used.get(program, 0) + segment.points_cost
    
    return Itinerary(
        itinerary_id=self._generate_itinerary_id(),
        
        flight_segments=flight_segments,
        transfer_plan=transfer_plan,
        
        # Totals
        total_oop=total_oop,
        total_cash=total_cash,
        total_surcharges=total_surcharges,
        points_used=points_used,
        
        # Route summary
        origin=flight_segments[0].origin,
        destination=flight_segments[-1].destination,
        stops=[s.destination for s in flight_segments[:-1]],
        
        # Timing
        departure_datetime=flight_segments[0].departure_datetime,
        arrival_datetime=flight_segments[-1].arrival_datetime,
        total_duration_minutes=sum(s.total_duration_minutes for s in flight_segments),
        
        # Metadata
        generated_at=datetime.utcnow(),
        data_freshness=min(
            edge.data_fetched_at for edge in selected_edges
        ),
        expires_at=min(
            edge.data_expires_at for edge in selected_edges
        )
    )
```

---

## Phase 6: Result Processing & User Communication

### 6.1 Result Formatting (No Estimates)

```python
class ResultFormatter:
    """
    Formats results for display.
    ONLY uses real data - never estimates.
    """
    
    def format(
        self,
        optimization_result: OptimizationResult
    ) -> FormattedResult:
        """Formats optimization result for API response."""
        
        itinerary = optimization_result.itinerary
        
        # Build detailed flight information
        flights = []
        for segment in itinerary.flight_segments:
            flight_info = FlightInfo(
                segment_id=segment.segment_id,
                origin=segment.origin,
                destination=segment.destination,
                
                # Structure
                is_direct=segment.is_direct,
                num_stops=segment.num_stops,
                
                # Detailed legs for connecting flights
                legs=[
                    LegInfo(
                        leg_number=i + 1,
                        departure_airport=leg.departure_airport,
                        arrival_airport=leg.arrival_airport,
                        departure_time=leg.departure_datetime.isoformat(),
                        arrival_time=leg.arrival_datetime.isoformat(),
                        duration_minutes=leg.duration_minutes,
                        airline=leg.airline_name,
                        flight_number=leg.flight_number,
                        aircraft=leg.aircraft_type,
                        cabin=leg.cabin
                    )
                    for i, leg in enumerate(segment.legs)
                ],
                
                # Layover details for connecting flights
                layovers=[
                    LayoverInfo(
                        airport=layover.airport,
                        duration_minutes=layover.duration_minutes,
                        arrival_time=layover.arrival_time.isoformat(),
                        departure_time=layover.departure_time.isoformat(),
                        terminal_change=layover.terminal_change
                    )
                    for layover in segment.layovers
                ] if segment.layovers else None,
                
                # Timing
                departure_datetime=segment.departure_datetime.isoformat(),
                arrival_datetime=segment.arrival_datetime.isoformat(),
                total_duration_minutes=segment.total_duration_minutes,
                
                # Cost - REAL DATA ONLY
                payment_type=segment.payment_method,
                cash_cost=segment.cash_cost,
                points_cost=segment.points_cost,
                points_program=segment.points_program,
                surcharge=segment.surcharge,
                
                # Booking
                booking_link=segment.booking_link,
                requires_separate_bookings=segment.requires_separate_bookings
            )
            flights.append(flight_info)
        
        # Budget status
        if optimization_result.within_budget:
            budget_status = BudgetStatus(
                within_budget=True,
                total_cost=optimization_result.total_oop,
                user_budget=optimization_result.user_budget,
                savings=optimization_result.user_budget - optimization_result.total_oop
                    if optimization_result.user_budget else None
            )
        else:
            budget_status = BudgetStatus(
                within_budget=False,
                total_cost=optimization_result.total_oop,
                user_budget=optimization_result.user_budget,
                exceeded_by=optimization_result.budget_exceeded_by,
                message=optimization_result.message
            )
        
        return FormattedResult(
            itinerary_id=itinerary.itinerary_id,
            flights=flights,
            transfer_plan=self._format_transfer_plan(itinerary.transfer_plan),
            
            # Cost breakdown - ALL REAL
            cost_breakdown=CostBreakdown(
                total_oop=optimization_result.total_oop,
                cash_for_flights=itinerary.total_cash,
                surcharges=itinerary.total_surcharges,
                points_used=itinerary.points_used
            ),
            
            budget_status=budget_status,
            
            # Data quality
            data_freshness=itinerary.data_freshness.isoformat(),
            expires_at=itinerary.expires_at.isoformat(),
            
            # Booking instructions
            booking_instructions=self._generate_booking_instructions(itinerary)
        )
```

---

## Phase 7: Booking Instructions Generation

### 7.1 Complete Booking Instructions with Connections

```python
class BookingInstructionGenerator:
    """
    Generates step-by-step booking instructions.
    Handles both direct and connecting flights.
    """
    
    def generate(self, itinerary: Itinerary) -> BookingInstructions:
        """
        Generates complete booking instructions for the itinerary.
        """
        
        steps = []
        step_number = 1
        
        # Step 1+: Point transfers (if needed)
        if itinerary.transfer_plan.transfers:
            for transfer in itinerary.transfer_plan.transfers:
                steps.append(BookingStep(
                    step_number=step_number,
                    step_type="transfer",
                    title=f"Transfer {transfer.bank_points:,} points from {transfer.from_bank} to {transfer.to_airline}",
                    description=f"Transfer at {transfer.ratio}:1 ratio",
                    details=[
                        f"Points to transfer: {transfer.bank_points:,}",
                        f"Points you'll receive: {transfer.airline_points:,}",
                        f"Transfer time: {'Instant' if transfer.is_instant else '1-2 business days'}",
                    ],
                    link=self._get_transfer_link(transfer.from_bank),
                    timing="Do this first" if not transfer.is_instant else "Can do anytime",
                    warning="Wait for transfer to complete before booking" if not transfer.is_instant else None
                ))
                step_number += 1
        
        # Steps for each flight segment
        for segment in itinerary.flight_segments:
            if segment.is_direct:
                # Direct flight - single booking step
                steps.append(self._create_direct_flight_step(
                    segment=segment,
                    step_number=step_number
                ))
                step_number += 1
            else:
                # Connecting flight - may be single or multiple bookings
                if segment.requires_separate_bookings:
                    # Multiple bookings needed
                    for leg in segment.legs:
                        steps.append(self._create_leg_booking_step(
                            leg=leg,
                            segment=segment,
                            step_number=step_number
                        ))
                        step_number += 1
                else:
                    # Single booking for entire connection
                    steps.append(self._create_connecting_flight_step(
                        segment=segment,
                        step_number=step_number
                    ))
                    step_number += 1
        
        return BookingInstructions(
            steps=steps,
            total_steps=len(steps),
            estimated_time_minutes=len(steps) * 5,
            summary=self._generate_summary(itinerary, steps)
        )
    
    def _create_direct_flight_step(
        self,
        segment: FlightSegment,
        step_number: int
    ) -> BookingStep:
        """Creates booking step for a direct flight."""
        
        leg = segment.legs[0]
        
        if segment.payment_method == "cash":
            return BookingStep(
                step_number=step_number,
                step_type="book_flight",
                title=f"Book {segment.origin} → {segment.destination} (Direct)",
                description=f"{leg.airline_name} {leg.flight_number}",
                details=[
                    f"Date: {leg.departure_datetime.strftime('%B %d, %Y')}",
                    f"Departure: {leg.departure_datetime.strftime('%I:%M %p')} from {segment.origin}",
                    f"Arrival: {leg.arrival_datetime.strftime('%I:%M %p')} at {segment.destination}",
                    f"Duration: {self._format_duration(leg.duration_minutes)}",
                    f"Price: ${segment.cash_cost:.2f}",
                ],
                link=segment.booking_link,
                link_text="Book Now"
            )
        else:
            return BookingStep(
                step_number=step_number,
                step_type="book_award",
                title=f"Book {segment.origin} → {segment.destination} with {segment.points_program} miles",
                description=f"{leg.airline_name} {leg.flight_number}",
                details=[
                    f"Date: {leg.departure_datetime.strftime('%B %d, %Y')}",
                    f"Departure: {leg.departure_datetime.strftime('%I:%M %p')} from {segment.origin}",
                    f"Arrival: {leg.arrival_datetime.strftime('%I:%M %p')} at {segment.destination}",
                    f"Duration: {self._format_duration(leg.duration_minutes)}",
                    f"Points: {segment.points_cost:,} {segment.points_program} miles",
                    f"Taxes/Fees: ${segment.surcharge:.2f}",
                ],
                link=segment.booking_link,
                link_text=f"Book on {segment.points_program}"
            )
    
    def _create_connecting_flight_step(
        self,
        segment: FlightSegment,
        step_number: int
    ) -> BookingStep:
        """Creates booking step for a connecting flight (single booking)."""
        
        # Build route description
        route_parts = [segment.origin]
        for layover in segment.layovers:
            route_parts.append(layover.airport)
        route_parts.append(segment.destination)
        route_str = " → ".join(route_parts)
        
        details = [
            f"Route: {route_str}",
            f"Stops: {segment.num_stops}",
            "",
            "Flight Details:"
        ]
        
        for i, leg in enumerate(segment.legs):
            details.append(f"  Leg {i+1}: {leg.airline_name} {leg.flight_number}")
            details.append(f"    {leg.departure_airport} {leg.departure_datetime.strftime('%I:%M %p')} → "
                          f"{leg.arrival_airport} {leg.arrival_datetime.strftime('%I:%M %p')}")
            
            # Add layover info if not last leg
            if i < len(segment.layovers):
                layover = segment.layovers[i]
                details.append(f"    Layover at {layover.airport}: {self._format_duration(layover.duration_minutes)}")
        
        details.append("")
        details.append(f"Total Duration: {self._format_duration(segment.total_duration_minutes)}")
        
        if segment.payment_method == "cash":
            details.append(f"Price: ${segment.cash_cost:.2f}")
        else:
            details.append(f"Points: {segment.points_cost:,} {segment.points_program} miles")
            details.append(f"Taxes/Fees: ${segment.surcharge:.2f}")
        
        return BookingStep(
            step_number=step_number,
            step_type="book_connecting",
            title=f"Book {segment.origin} → {segment.destination} ({segment.num_stops}-stop)",
            description=route_str,
            details=details,
            link=segment.booking_link,
            link_text="Book Complete Itinerary"
        )
    
    def _format_duration(self, minutes: int) -> str:
        """Formats duration in human-readable form."""
        hours = minutes // 60
        mins = minutes % 60
        if hours > 0:
            return f"{hours}h {mins}m"
        return f"{mins}m"
```

---

## Error Handling Strategy (No Fallbacks)

### 8.1 Explicit Error Types

```python
class TripError(Exception):
    """Base class for all trip-related errors."""
    
    def __init__(self, message: str, code: str, user_actions: List[UserAction] = None):
        self.message = message
        self.code = code
        self.user_actions = user_actions or []
        super().__init__(message)


class ValidationError(TripError):
    """Input validation failed."""
    pass


class NoFlightsFoundError(TripError):
    """No flights available for route/date."""
    
    def __init__(
        self,
        message: str,
        origin: str,
        destination: str,
        date: date,
        strategies_tried: List[str]
    ):
        super().__init__(
            message=message,
            code="NO_FLIGHTS_FOUND",
            user_actions=[
                UserAction(
                    type="change_dates",
                    title="Try Different Dates",
                    description="Flight availability varies by date"
                ),
                UserAction(
                    type="change_airports",
                    title="Try Nearby Airports",
                    description="Consider alternate airports"
                )
            ]
        )
        self.origin = origin
        self.destination = destination
        self.date = date
        self.strategies_tried = strategies_tried


class InvalidConnectionError(TripError):
    """Connection time is insufficient."""
    
    def __init__(
        self,
        message: str,
        arriving_flight: FlightLeg,
        departing_flight: FlightLeg,
        actual_minutes: int,
        required_minutes: int
    ):
        super().__init__(
            message=message,
            code="INVALID_CONNECTION",
            user_actions=[
                UserAction(
                    type="different_flights",
                    title="Choose Different Flights",
                    description=f"Need at least {required_minutes} minutes for this connection"
                )
            ]
        )
        self.arriving_flight = arriving_flight
        self.departing_flight = departing_flight
        self.actual_minutes = actual_minutes
        self.required_minutes = required_minutes


class NoValidRouteError(TripError):
    """No valid route exists for the given constraints."""
    
    def __init__(
        self,
        message: str,
        start: str,
        end: str,
        must_visit: List[str],
        reasons: List[str]
    ):
        super().__init__(
            message=message,
            code="NO_VALID_ROUTE",
            user_actions=[
                UserAction(
                    type="modify_destinations",
                    title="Modify Destinations",
                    description="Some destinations may not be reachable"
                ),
                UserAction(
                    type="change_dates",
                    title="Try Different Dates",
                    description="More flights may be available on other dates"
                )
            ]
        )
        self.start = start
        self.end = end
        self.must_visit = must_visit
        self.reasons = reasons


class BudgetExceededError(TripError):
    """Trip costs more than user's budget."""
    
    def __init__(
        self,
        message: str,
        minimum_cost: float,
        user_budget: float,
        itinerary: Itinerary
    ):
        super().__init__(
            message=message,
            code="BUDGET_EXCEEDED",
            user_actions=[
                UserAction(
                    type="increase_budget",
                    title="Increase Budget",
                    description=f"Minimum cost is ${minimum_cost:.2f}",
                    parameters={"suggested_budget": minimum_cost}
                ),
                UserAction(
                    type="view_anyway",
                    title="View Itinerary Anyway",
                    description="See the full itinerary and cost breakdown"
                )
            ]
        )
        self.minimum_cost = minimum_cost
        self.user_budget = user_budget
        self.itinerary = itinerary
```

### 8.2 Error Response (Never Fallback)

```python
class ErrorHandler:
    """
    Handles errors explicitly.
    NEVER generates fallback/placeholder itineraries.
    """
    
    def handle(self, error: Exception) -> ErrorResponse:
        """Converts exception to user-friendly error response."""
        
        if isinstance(error, ValidationError):
            return ErrorResponse(
                success=False,
                error_code=error.code,
                message=error.message,
                user_actions=error.user_actions,
                can_retry=False
            )
        
        if isinstance(error, NoFlightsFoundError):
            return ErrorResponse(
                success=False,
                error_code=error.code,
                message=error.message,
                details={
                    "origin": error.origin,
                    "destination": error.destination,
                    "date": error.date.isoformat(),
                    "strategies_tried": error.strategies_tried
                },
                user_actions=error.user_actions,
                can_retry=True  # User can modify inputs and retry
            )
        
        if isinstance(error, InvalidConnectionError):
            return ErrorResponse(
                success=False,
                error_code=error.code,
                message=error.message,
                details={
                    "actual_connection_time": error.actual_minutes,
                    "minimum_required": error.required_minutes,
                    "connection_airport": error.arriving_flight.arrival_airport
                },
                user_actions=error.user_actions,
                can_retry=True
            )
        
        if isinstance(error, NoValidRouteError):
            return ErrorResponse(
                success=False,
                error_code=error.code,
                message=error.message,
                details={
                    "start": error.start,
                    "end": error.end,
                    "must_visit": error.must_visit,
                    "reasons": error.reasons
                },
                user_actions=error.user_actions,
                can_retry=True
            )
        
        # Note: BudgetExceededError is NOT a failure - we return the itinerary
        # with clear indication that it exceeds budget
        
        # Unknown error - still explicit, never fallback
        return ErrorResponse(
            success=False,
            error_code="UNKNOWN_ERROR",
            message="An unexpected error occurred. Please try again.",
            can_retry=True
        )
```

---

## Data Models

### 9.1 Complete Data Models

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Literal
from datetime import date, datetime
from enum import Enum


class CabinClass(Enum):
    BASIC_ECONOMY = "basic_economy"
    ECONOMY = "economy"
    PREMIUM_ECONOMY = "premium_economy"
    BUSINESS = "business"
    FIRST = "first"


@dataclass
class FlightLeg:
    """Single flight leg - one takeoff and landing."""
    leg_index: int
    
    # Airports
    departure_airport: str
    arrival_airport: str
    departure_terminal: Optional[str]
    arrival_terminal: Optional[str]
    
    # Times - EXACT, not estimated
    departure_datetime: datetime
    arrival_datetime: datetime
    duration_minutes: int
    
    # Flight info
    airline_name: str
    airline_code: str
    flight_number: str
    operating_carrier: Optional[str] = None
    
    # Aircraft
    aircraft_type: Optional[str] = None
    cabin: Optional[str] = None
    
    # Flags
    overnight: bool = False
    often_delayed: bool = False


@dataclass
class Layover:
    """Layover between two legs."""
    layover_index: int
    airport: str
    duration_minutes: int
    
    arrival_time: datetime
    departure_time: datetime
    
    arrival_terminal: Optional[str]
    departure_terminal: Optional[str]
    
    terminal_change: bool
    airline_change: bool


@dataclass
class TransferPartner:
    """Bank transfer partner information."""
    bank_program: str
    transfer_ratio: float
    is_instant: bool
    minimum_transfer: int
    transfer_time_hours: int


@dataclass
class ConnectingFlightOption:
    """Complete flight option with all legs and connections."""
    option_id: str
    option_type: Literal["cash", "award"]
    
    # Route
    origin: str
    destination: str
    
    # Structure
    is_direct: bool
    num_stops: int
    legs: List[FlightLeg]
    layovers: List[Layover]
    
    # Connection validation
    connections_valid: bool
    connection_validations: List['ConnectionValidation']
    
    # Timing
    total_duration_minutes: int
    flight_time_minutes: int
    layover_time_minutes: int
    departure_datetime: datetime
    arrival_datetime: datetime
    
    # Pricing (REAL DATA ONLY)
    cash_price_usd: Optional[float]
    points_cost: Optional[int]
    points_program: Optional[str]
    surcharge_usd: Optional[float]
    
    # Booking
    booking_link: Optional[str]
    requires_separate_bookings: bool
    
    # Airlines
    airlines: List[str]
    marketing_carriers: List[str]
    operating_carriers: List[str]
    
    # Transfer info
    transfer_partners: List[TransferPartner]
    
    # Availability
    seats_available: Optional[int]
    
    # Metadata
    data_source: str
    fetched_at: datetime
    expires_at: datetime


@dataclass
class FlightSegment:
    """A segment of the itinerary (origin to destination)."""
    segment_id: str
    origin: str
    destination: str
    
    # Full structure
    legs: List[FlightLeg]
    layovers: List[Layover]
    is_direct: bool
    num_stops: int
    connection_airports: List[str]
    
    # Timing
    departure_datetime: datetime
    arrival_datetime: datetime
    total_duration_minutes: int
    
    # Payment
    payment_method: Literal["cash", "points"]
    cash_cost: Optional[float]
    points_cost: Optional[int]
    points_program: Optional[str]
    surcharge: Optional[float]
    
    # Booking
    booking_link: Optional[str]
    requires_separate_bookings: bool


@dataclass
class Itinerary:
    """Complete optimized itinerary."""
    itinerary_id: str
    
    # Segments
    flight_segments: List[FlightSegment]
    transfer_plan: 'TransferPlan'
    
    # Totals (ALL REAL)
    total_oop: float
    total_cash: float
    total_surcharges: float
    points_used: Dict[str, int]
    
    # Route
    origin: str
    destination: str
    stops: List[str]
    
    # Timing
    departure_datetime: datetime
    arrival_datetime: datetime
    total_duration_minutes: int
    
    # Metadata
    generated_at: datetime
    data_freshness: datetime
    expires_at: datetime


@dataclass
class TransferPlan:
    """Plan for transferring points."""
    transfers: List['PointsTransfer']
    total_bank_points_used: Dict[str, int]
    total_airline_points_received: Dict[str, int]
    has_delayed_transfers: bool


@dataclass
class PointsTransfer:
    """Single points transfer."""
    from_bank: str
    to_airline: str
    bank_points: int
    airline_points: int
    ratio: float
    is_instant: bool
    transfer_time_hours: int


@dataclass
class ConnectionValidation:
    """Validation result for a single connection."""
    valid: bool
    layover_minutes: Optional[int]
    minimum_required_minutes: Optional[int]
    buffer_minutes: Optional[int]
    warnings: List['ConnectionWarning']
    error: Optional[str]
    
    arriving_leg: FlightLeg
    departing_leg: FlightLeg
    connection_airport: Optional[str]
    terminal_change: bool = False


@dataclass
class ConnectionWarning:
    """Warning about a connection."""
    type: str
    message: str


@dataclass
class OptimizationResult:
    """Result of ILP optimization."""
    success: bool
    itinerary: Optional[Itinerary]
    total_oop: Optional[float]
    within_budget: bool
    user_budget: Optional[float]
    budget_exceeded_by: Optional[float] = None
    message: Optional[str] = None
```

---

## Implementation Checklist

### Phase 1: Remove All Fallback Mechanisms

- [ ] **1.1** Delete `generate_simple_itineraries()` function completely
- [ ] **1.2** Delete `_generate_minimal_fallback_itinerary()` function completely
- [ ] **1.3** Remove all formula-based cost estimation code
- [ ] **1.4** Remove default infinite costs (`$10,000,000`)
- [ ] **1.5** Remove budget relaxation retry loops (2x, 3x, 5x, 10x)
- [ ] **1.6** Update all callers to handle explicit errors
- [ ] **1.7** Add tests ensuring fallbacks are never used

### Phase 2: Implement Strict Validation

- [ ] **2.1** Implement `StrictTripInputValidator`
- [ ] **2.2** Validate all airport codes against authoritative database
- [ ] **2.3** Strict date validation (no defaults)
- [ ] **2.4** Validate all destinations before proceeding

### Phase 3: Implement Comprehensive Flight Search

- [ ] **3.1** Implement `ComprehensiveFlightSearcher`
- [ ] **3.2** Implement SERP flight search with full leg extraction
- [ ] **3.3** Implement AwardTool flight search with full leg extraction
- [ ] **3.4** Extract complete layover information
- [ ] **3.5** Add caching with appropriate TTLs

### Phase 4: Implement Connection Validation

- [ ] **4.1** Create MCT (Minimum Connection Time) database
- [ ] **4.2** Implement `ConnectionValidator`
- [ ] **4.3** Validate all connections against MCT
- [ ] **4.4** Handle terminal changes in MCT calculation
- [ ] **4.5** Handle airline changes in MCT calculation
- [ ] **4.6** Add connection warnings (tight, long layover)

### Phase 5: Implement Route Graph with Connections

- [ ] **5.1** Implement `RouteGraphBuilder`
- [ ] **5.2** Create edges for both direct and connecting flights
- [ ] **5.3** Validate graph completeness (no missing segments)
- [ ] **5.4** Implement route enumeration
- [ ] **5.5** Filter invalid routes (invalid connections)

### Phase 6: Implement ILP Optimizer

- [ ] **6.1** Implement ILP model with connection constraints
- [ ] **6.2** Add connection time constraints
- [ ] **6.3** Implement solution extraction with full leg details
- [ ] **6.4** Handle budget exceeded case (return real minimum)
- [ ] **6.5** Calculate transfer plan

### Phase 7: Implement Result Processing

- [ ] **7.1** Implement `ResultFormatter` with full leg details
- [ ] **7.2** Generate detailed layover information
- [ ] **7.3** Generate booking instructions for connections
- [ ] **7.4** Handle separate booking requirements

### Phase 8: Implement Error Handling

- [ ] **8.1** Implement all error types
- [ ] **8.2** Implement `ErrorHandler` with actionable guidance
- [ ] **8.3** Ensure no fallback paths exist
- [ ] **8.4** Test all error scenarios

### Phase 9: Testing

- [ ] **9.1** Unit tests for connection validation
- [ ] **9.2** Unit tests for leg extraction
- [ ] **9.3** Unit tests for MCT calculation
- [ ] **9.4** Integration tests for full flow
- [ ] **9.5** Test connecting flight scenarios
- [ ] **9.6** Test invalid connection detection
- [ ] **9.7** Test budget exceeded scenarios
- [ ] **9.8** Verify no fallbacks in any scenario

---

## Summary

This implementation ensures:

1. **Full Connecting Flight Support**: Multi-leg itineraries are first-class citizens with complete validation
2. **No Fallbacks**: System never generates placeholder or estimated itineraries
3. **Connection Validation**: All connections validated against real MCT data
4. **Complete Leg Details**: Every leg has departure/arrival times, terminals, airlines
5. **Layover Information**: Full layover details including duration and terminal changes
6. **Explicit Failures**: When routes aren't possible, users get clear explanations
7. **Accurate Costs**: All pricing from real API data, never estimated

Users will always receive either:
- A complete, bookable itinerary with real pricing and validated connections
- A clear explanation of why no itinerary is possible with actionable alternatives

---

*Last Updated: January 2026*
