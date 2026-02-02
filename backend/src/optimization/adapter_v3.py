"""
Adapter to integrate V3 solver with the existing orchestrator.

This module provides conversion functions between:
- Orchestrator data format → V3 TripPlanSpec
- V3 OptimizationResult → Orchestrator RankedItinerary

This allows the orchestrator to use the V3 solver without changing
the frontend API contract.
"""

import logging
import os
import uuid
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Tuple

from .trip_spec import TripPlanSpec, Traveler, OrderedLeg, StaySegment
from .models_v3 import (
    FlightItineraryEdge, FlightSegment, AwardOption,
    TransferPath,
    OptimizationResult, OptimizationStatus, Solution,
)
from .normalize import normalize_program, normalize_bank
from .solver_v3 import optimize_trip, Mode
from .validators import validate_connection_eligibility
from .validation_policy import STRICT_MVP_POLICY

# Import shared pricing sanitizer - CRITICAL for -1 sentinel prevention
from ..utils.pricing import (
    sanitize_cash_price, 
    sanitize_points_cost, 
    sanitize_surcharge,
    get_cash_cost_for_optimization,
    UNKNOWN_PRICE_PENALTY,
)
from ..contracts.sentinel import scrub_sentinels
from ..contracts.validate import assert_no_negative_numbers, find_negative_numbers

logger = logging.getLogger(__name__)


def _strict_contracts_enabled() -> bool:
    return (os.getenv("TRIPY_STRICT_CONTRACTS") or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _enforce_no_negative_numbers(payload, context: str):
    """
    Enforce the global sentinel contract at the optimization boundary.

    - In strict mode (TRIPY_STRICT_CONTRACTS=true): raise ValueError if any negatives exist
    - Otherwise: warn and scrub negatives to None
    """
    negatives = find_negative_numbers(payload)
    if negatives:
        if _strict_contracts_enabled():
            assert_no_negative_numbers(payload, context=context)
        logger.warning(
            "[CONTRACT] Negative numeric values detected (%s). Scrubbing to None. Sample=%s",
            context,
            negatives[:5],
        )
        return scrub_sentinels(payload)

    # Still scrub as a no-op for safety (e.g., nested raw payloads)
    return scrub_sentinels(payload)


# =============================================================================
# PLACEHOLDER FLIGHT NUMBER DETECTION
# =============================================================================

def _get_metro_airports(airport_code: str) -> list:
    """Get all airports in the same metro area as the given airport."""
    METRO_AIRPORTS = {
        "CDG": ["CDG", "ORY"], "ORY": ["CDG", "ORY"],
        "LHR": ["LHR", "LGW", "STN"], "LGW": ["LHR", "LGW", "STN"], "STN": ["LHR", "LGW", "STN"],
        "JFK": ["JFK", "EWR", "LGA"], "EWR": ["JFK", "EWR", "LGA"], "LGA": ["JFK", "EWR", "LGA"],
        "NRT": ["NRT", "HND"], "HND": ["NRT", "HND"],
        "DXB": ["DXB", "DWC"], "DWC": ["DXB", "DWC"],
        "SFO": ["SFO", "OAK", "SJC"], "OAK": ["SFO", "OAK", "SJC"], "SJC": ["SFO", "OAK", "SJC"],
        "LAX": ["LAX", "BUR", "SNA"], "BUR": ["LAX", "BUR", "SNA"], "SNA": ["LAX", "BUR", "SNA"],
        "ORD": ["ORD", "MDW"], "MDW": ["ORD", "MDW"],
        "DFW": ["DFW", "DAL"], "DAL": ["DFW", "DAL"],
        "IAD": ["IAD", "DCA", "BWI"], "DCA": ["IAD", "DCA", "BWI"], "BWI": ["IAD", "DCA", "BWI"],
    }
    code = airport_code.upper() if airport_code else ""
    return METRO_AIRPORTS.get(code, [code])


def _is_placeholder_flight_number(flight_nums: list) -> bool:
    """
    Detect if flight numbers are AwardTool placeholders (not real bookable flights).
    
    Placeholder patterns:
    - "DL100", "UA100" - airline + "100"
    - "AC & LH100" - multi-airline + "100"
    - "DL & UA100" - alliance codeshare placeholder
    
    Real flight numbers have 3-4 digit numbers (not exactly "100"):
    - "DL 2055", "UA 5678", "AF 123"
    
    Returns:
        True if any flight number looks like a placeholder
    """
    import re
    
    for fn in flight_nums:
        if not fn:
            continue
        
        fn_clean = fn.strip()
        
        # Pattern 1: Ends with "100" (common placeholder)
        if fn_clean.endswith('100'):
            # Extract the numeric part
            # Could be "DL100", "AC & LH100", "DL & UA100", etc.
            match = re.search(r'(\d+)$', fn_clean)
            if match:
                number = match.group(1)
                if number == '100':
                    # It's a placeholder - exactly "100" is used by AwardTool
                    return True
        
        # Pattern 2: Contains " & " (multi-airline placeholder format)
        # Real codeshares don't use "&" in flight numbers
        if ' & ' in fn_clean:
            return True
        
        # Pattern 3: Just a number like "100" without airline
        if fn_clean.isdigit() and fn_clean == '100':
            return True
    
    return False


# =============================================================================
# ROUTE TYPE DETECTION
# =============================================================================

# US state codes for domestic detection
US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
    "VA", "WA", "WV", "WI", "WY", "DC", "PR", "VI", "GU", "AS", "MP",
}

# Common US airport country codes
US_AIRPORT_PREFIXES = {"K", "P"}  # Most US airports start with K (continental) or P (Pacific)


def _detect_international_route(segments: List[dict], trip_data: dict) -> bool:
    """
    Detect whether this trip contains international routes.
    
    International routes get higher convenience penalties because:
    - Longer baseline travel times
    - More impactful layovers (customs, immigration, jet lag)
    - Higher stakes for connections (international rebooking is harder)
    
    Returns:
        True if any segment crosses international boundaries
    """
    # Check destinations in trip_data
    origin = trip_data.get("origin", "")
    destinations = trip_data.get("destinations", [])
    
    # Extract location strings - destinations can be strings or dicts with "name" field
    all_locations = [origin] if origin else []
    for dest in destinations:
        if isinstance(dest, str):
            all_locations.append(dest)
        elif isinstance(dest, dict):
            # Could have "name", "airport_code", or other fields
            name = dest.get("name") or dest.get("airport_code") or dest.get("code") or ""
            if name:
                all_locations.append(name)
    
    # Simple heuristic: if any airport code doesn't look like US domestic, it's international
    for loc in all_locations:
        if not loc or not isinstance(loc, str):
            continue
        
        # Get airport code (might be "SEA" or "Seattle, WA" or "Paris, FR")
        code = loc.upper().strip()
        
        # If it's a 3-letter code, check if it's a US airport
        if len(code) == 3:
            # Most US airports: start with K (continental), P (Pacific), or are well-known
            # Common exceptions: JFK, LAX, SFO, ORD, etc. don't start with K
            US_MAJOR_AIRPORTS = {
                "JFK", "LAX", "SFO", "ORD", "ATL", "DFW", "DEN", "SEA", "MIA", "BOS",
                "EWR", "IAH", "MSP", "DTW", "PHL", "LGA", "CLT", "PHX", "IAD", "SAN",
                "TPA", "FLL", "BWI", "SLC", "MCO", "DCA", "PDX", "STL", "AUS", "HNL",
                "OGG", "LIH", "KOA",  # Hawaii
            }
            
            if code not in US_MAJOR_AIRPORTS and not code.startswith("K"):
                # Check if it looks like a non-US airport
                # European hubs, Asian airports, etc.
                INTL_AIRPORT_PREFIXES = {"L", "E", "H", "R", "Z", "V", "W", "Y", "C", "M"}
                if code[0] in INTL_AIRPORT_PREFIXES:
                    logger.debug(f"[V3 Adapter] Detected international route: {code}")
                    return True
        
        # If it contains a country code that's not US
        if "," in code:
            parts = code.split(",")
            if len(parts) >= 2:
                region = parts[-1].strip()
                if len(region) == 2 and region not in US_STATES and region != "US":
                    logger.debug(f"[V3 Adapter] Detected international route via region: {region}")
                    return True
    
    # Also check segments for origin/destination
    for seg in segments:
        origin = seg.get("origin", "")
        dest = seg.get("destination", "")
        
        # Check for obvious international destinations
        intl_indicators = ["CDG", "LHR", "FRA", "AMS", "NRT", "HND", "ICN", "PEK", "HKG", "SYD", "MEL"]
        if origin in intl_indicators or dest in intl_indicators:
            logger.debug(f"[V3 Adapter] Detected international route: {origin} -> {dest}")
            return True
    
    # Default to domestic
    return False


# =============================================================================
# ORCHESTRATOR → V3 CONVERSION
# =============================================================================

def convert_trip_to_spec(
    trip_data: dict,
    segments: List[dict],
    user_points: Dict[str, int],
    user_id: str = "user",
) -> TripPlanSpec:
    """
    Convert orchestrator trip data to V3 TripPlanSpec.
    
    Args:
        trip_data: Trip data from database
        segments: List of segment dicts from _build_trip_segments
        user_points: User's points balances {program: balance}
        user_id: User identifier
    
    Returns:
        TripPlanSpec for V3 solver
    """
    
    # Separate points and banks
    points_balances = {}
    bank_balances = {}
    
    for prog, balance in user_points.items():
        normalized = normalize_program(prog)
        bank_normalized = normalize_bank(prog)
        
        logger.info(f"[V3 Adapter] Points: {prog} -> normalized={normalized}, bank={bank_normalized}")
        
        # Check if it's a bank (transferable) or airline/hotel program
        if bank_normalized in {"chase", "amex", "citi", "capital_one", "bilt"}:
            bank_balances[bank_normalized] = balance
            logger.info(f"[V3 Adapter] Added to bank_balances: {bank_normalized}={balance:,}")
        else:
            points_balances[normalized] = balance
            logger.info(f"[V3 Adapter] Added to points_balances: {normalized}={balance:,}")
    
    logger.info(f"[V3 Adapter] Final bank_balances: {bank_balances}")
    logger.info(f"[V3 Adapter] Final points_balances: {points_balances}")
    
    # Create single traveler (solo trip)
    traveler = Traveler(
        traveler_id=user_id,
        name="Traveler",
        home_airport=_get_home_airport(trip_data, segments),
        points_balances=points_balances,
        bank_balances=bank_balances,
    )
    
    # Build ordered legs and stay segments
    legs, stay_segments = _build_legs_and_segments(segments)
    
    return TripPlanSpec(
        trip_id=trip_data.get("trip_id", str(uuid.uuid4())),
        travelers=[traveler],
        legs=legs,
        stay_segments=stay_segments,
    )


def _get_home_airport(trip_data: dict, segments: List[dict]) -> str:
    """Extract home airport from trip data or segments."""
    
    # Try trip_data origin
    if trip_data.get("origin"):
        return trip_data["origin"]
    
    # Try first flight segment
    for seg in segments:
        if seg.get("type") == "flight" and seg.get("origin"):
            return seg["origin"]
    
    return "JFK"  # Default


def _build_legs_and_segments(
    segments: List[dict],
) -> Tuple[List[OrderedLeg], List[StaySegment]]:
    """
    Convert orchestrator segments to V3 legs (flights only).
    
    MULTI-AIRPORT SUPPORT: Segments now represent city-pairs (not airport-pairs).
    Multiple airports in a city are OR alternatives, meaning the optimizer
    picks ONE flight from any valid airport combination.
    
    E.g., for Paris, segment might have:
    - origin_city: "Seattle"
    - dest_city: "Paris"  
    - allowed_destination_airports: ["CDG", "ORY"]
    
    The optimizer will pick ONE flight to either CDG or ORY, not both.
    """
    
    legs = []
    stays = []  # Empty - no hotels
    
    leg_id = 0
    
    for seg in segments:
        if seg.get("type") == "flight":
            # Parse date
            date_str = seg.get("date", "")
            try:
                leg_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except:
                leg_date = date.today()
            
            # MULTI-AIRPORT SUPPORT: Extract allowed airports from segment
            allowed_origins = seg.get("allowed_origin_airports")
            allowed_dests = seg.get("allowed_destination_airports")
            
            # Convert to list if not already (handles both None and list cases)
            if allowed_origins and not isinstance(allowed_origins, list):
                allowed_origins = [allowed_origins]
            if allowed_dests and not isinstance(allowed_dests, list):
                allowed_dests = [allowed_dests]
            
            # Use city names if available, fallback to airport codes
            origin_city = seg.get("origin_city") or seg.get("origin", "")
            dest_city = seg.get("dest_city") or seg.get("destination", "")
            
            logger.info(f"[V3 Adapter] Building leg {leg_id}: {origin_city} → {dest_city}")
            logger.info(f"[V3 Adapter]   Allowed origins: {allowed_origins or ['any']}")
            logger.info(f"[V3 Adapter]   Allowed dests: {allowed_dests or ['any']}")
            
            legs.append(OrderedLeg(
                leg_id=leg_id,
                origin_city=origin_city,
                destination_city=dest_city,
                earliest_departure=leg_date,
                latest_departure=leg_date,  # Single day for now
                traveler_ids=["user"],
                allowed_origin_airports=allowed_origins,
                allowed_destination_airports=allowed_dests,
            ))
            leg_id += 1
    
    logger.info(f"[V3 Adapter] Built {len(legs)} legs (one per city-pair)")
    return legs, stays


def convert_search_results_to_flights(
    search_results: dict,
    segments: List[dict],
) -> List[FlightItineraryEdge]:
    """
    Convert orchestrator search results to V3 FlightItineraryEdge list.
    
    Args:
        search_results: Dict of {segment_key: FlightSearchResult}
        segments: Original segment list
    
    Returns:
        List of FlightItineraryEdge for V3 solver
    """
    
    flights = []
    leg_id = 0
    
    for i, seg in enumerate(segments):
        if seg.get("type") != "flight":
            continue
        
        key = f"flight_{i}"
        result = search_results.get(key)
        
        if not result:
            logger.warning(f"[V3 Adapter] {key}: No search result found")
            leg_id += 1
            continue
        
        if not hasattr(result, "options"):
            logger.warning(f"[V3 Adapter] {key}: Result has no 'options' attribute, type={type(result).__name__}")
            leg_id += 1
            continue
        
        options_list = result.options or []
        logger.info(f"[V3 Adapter] {key}: Processing {len(options_list)} flight options")
        
        # Log source breakdown for debugging
        sources = {}
        for opt in options_list:
            src = getattr(opt, 'source', 'unknown')
            sources[src] = sources.get(src, 0) + 1
        logger.info(f"[V3 Adapter] {key}: Source breakdown: {sources}")
        
        for j, opt in enumerate(options_list):
            # Log flight option details for debugging
            if j < 3:  # Log first 3
                logger.debug(f"[V3 Adapter] {key}_opt_{j}: airline={getattr(opt, 'airline', '?')}, "
                            f"points={getattr(opt, 'award_points', None)}, "
                            f"cash={getattr(opt, 'cash_price', None)}, "
                            f"available={getattr(opt, 'award_available', False)}, "
                            f"source={getattr(opt, 'source', '?')}")
            
            edge = _convert_flight_option(opt, leg_id, j, seg)
            if edge:
                flights.append(edge)
        
        leg_id += 1
    
    # Compute and log summary statistics
    flights_with_awards = sum(1 for f in flights if f.award_options)
    flights_cash_only = len(flights) - flights_with_awards
    total_award_options = sum(len(f.award_options) for f in flights)
    
    logger.info("=" * 80)
    logger.info(f"[V3 Adapter] FLIGHT CONVERSION SUMMARY")
    logger.info(f"  Total flights: {len(flights)} from {leg_id} legs")
    logger.info(f"  Flights WITH award options: {flights_with_awards}")
    logger.info(f"  Flights CASH-ONLY (no awards): {flights_cash_only}")
    logger.info(f"  Total award options created: {total_award_options}")
    
    if flights_cash_only > 0 and flights_with_awards == 0:
        logger.warning(
            f"  ⚠️ NO flights have award options! This means the solver can ONLY pick cash. "
            f"Check if AwardTool returned availability."
        )
    elif total_award_options > 0:
        # Log a few sample award options
        for f in flights[:5]:
            if f.award_options:
                opt = f.award_options[0]
                logger.info(
                    f"  Sample: {f.origin}→{f.destination} leg{f.leg_id}: "
                    f"cash=${f.cash_cost:.0f}, award={opt.miles_required:,}pts + ${opt.surcharge} ({opt.program})"
                )
    logger.info("=" * 80)
    
    return flights


def _convert_flight_option(
    opt,
    leg_id: int,
    option_idx: int,
    segment: dict,
) -> Optional[FlightItineraryEdge]:
    """
    Convert a FlightOption to FlightItineraryEdge.
    
    V4 changes:
    - Extract ALL segments, not just the first one
    - Extract raw provider data (offer_id, pricing_source, etc.)
    - Use num_stops_hint to prevent missing segments from looking direct
    - Let finalize_itinerary derive protection attributes
    """
    from .derivation import finalize_itinerary
    
    try:
        edge_id = f"flight_{leg_id}_{option_idx}"
        
        # Parse times - use segment's date as fallback (NOT datetime.now())
        # Get the segment's travel date as fallback
        segment_date = segment.get("date") or segment.get("departure_date") or segment.get("depart_date")
        if not segment_date:
            logger.debug(f"[V3 Adapter] Segment {leg_id}_{option_idx}: no date in segment, keys: {list(segment.keys())}")
        
        if segment_date:
            try:
                fallback_dt = datetime.strptime(segment_date, "%Y-%m-%d")
                # Set a reasonable default time (e.g., 10:00 AM)
                fallback_dt = fallback_dt.replace(hour=10, minute=0, second=0)
                logger.debug(f"[V3 Adapter] Using segment date {segment_date} as fallback for {leg_id}_{option_idx}")
            except Exception as e:
                logger.warning(f"[V3 Adapter] Failed to parse segment date '{segment_date}': {e}")
                fallback_dt = datetime.now() + timedelta(days=7)  # Default to a week from now
        else:
            fallback_dt = datetime.now() + timedelta(days=7)  # Default to a week from now
        
        try:
            if opt.departure_time:
                dep_dt = datetime.fromisoformat(opt.departure_time)
            else:
                dep_dt = fallback_dt
                logger.debug(f"[V3 Adapter] {leg_id}_{option_idx}: No departure_time, using fallback {fallback_dt}")
            arr_dt = datetime.fromisoformat(opt.arrival_time) if opt.arrival_time else dep_dt + timedelta(hours=4)
        except Exception as e:
            logger.warning(f"[V3 Adapter] Failed to parse times for {leg_id}_{option_idx}: {e}")
            dep_dt = fallback_dt
            arr_dt = dep_dt + timedelta(hours=4)  # Default 4 hour flight
        
        # ═══════════════════════════════════════════════════════════════════
        # BUILD ALL SEGMENTS (not just first one!)
        # CRITICAL: Preserve per-leg data for connections and codeshares
        # ═══════════════════════════════════════════════════════════════════
        
        flight_segments = []
        
        # Check if provider gives us detailed segment info
        # FlightOption.segments is now a list of FlightLeg Pydantic models
        if hasattr(opt, 'segments') and opt.segments and len(opt.segments) > 0:
            # Provider gave us segment details - use them
            for i, seg_data in enumerate(opt.segments):
                # Handle both Pydantic model (FlightLeg) and dict formats
                if hasattr(seg_data, 'departure_time'):
                    # Pydantic FlightLeg model
                    seg_dep_str = seg_data.departure_time
                    seg_arr_str = seg_data.arrival_time
                    seg_origin = seg_data.origin
                    seg_dest = seg_data.destination
                    seg_fn = seg_data.flight_number
                    seg_marketing = seg_data.marketing_carrier
                    seg_operating = seg_data.operating_carrier or seg_data.marketing_carrier
                    # Try cabin_class first, then cabin for backwards compatibility
                    seg_cabin = getattr(seg_data, 'cabin_class', None) or getattr(seg_data, 'cabin', None) or opt.cabin_class
                else:
                    # Dict format (legacy/fallback)
                    seg_dep_str = seg_data.get('departure_time', '')
                    seg_arr_str = seg_data.get('arrival_time', '')
                    seg_origin = seg_data.get('origin', '')
                    seg_dest = seg_data.get('destination', '')
                    seg_fn = seg_data.get('flight_number', f"{opt.airline}{100 + i}")
                    seg_marketing = seg_data.get('marketing_carrier', opt.airline or "UA")
                    seg_operating = seg_data.get('operating_carrier', opt.operating_airline or seg_marketing)
                    seg_cabin = seg_data.get('cabin', opt.cabin_class)
                
                # Parse segment times
                try:
                    seg_dep = datetime.fromisoformat(seg_dep_str.replace("Z", "+00:00")) if seg_dep_str else dep_dt
                except:
                    seg_dep = dep_dt
                try:
                    seg_arr = datetime.fromisoformat(seg_arr_str.replace("Z", "+00:00")) if seg_arr_str else arr_dt
                except:
                    seg_arr = arr_dt
                
                flight_seg = FlightSegment(
                    segment_id=f"seg_{i}",
                    flight_number=seg_fn or f"{opt.airline}{100 + i}",
                    operating_carrier=seg_operating or opt.airline or "UA",
                    marketing_carrier=seg_marketing or opt.airline or "UA",
                    origin=seg_origin,
                    destination=seg_dest,
                    departure=seg_dep,
                    arrival=seg_arr,
                    cabin=seg_cabin,
                )
                flight_segments.append(flight_seg)
            
            logger.debug(f"[V3 Adapter] {edge_id}: Built {len(flight_segments)} segments from FlightOption.segments")
        else:
            # No segment details - check if this is a multi-stop flight
            stops_hint = getattr(opt, '_stops_hint', None) or getattr(opt, 'stops', 0)
            
            if stops_hint and stops_hint > 0:
                # INVARIANT VIOLATION: Multi-stop flight without segment details
                # Log warning but still create edge (with incomplete data flag)
                logger.warning(
                    f"[V3 Adapter] {edge_id}: Data error - {stops_hint} stops claimed but no segments provided. "
                    f"Connection display will be incorrect."
                )
            
            # Create single segment from top-level data (may be incomplete for connections)
            flight_seg = FlightSegment(
                segment_id="seg_0",
                flight_number=opt.flight_numbers[0] if opt.flight_numbers else f"{opt.airline}100",
                operating_carrier=opt.operating_airline or opt.airline or "UA",
                marketing_carrier=opt.airline or "UA",
                origin=opt.origin or segment.get("origin", ""),
                destination=opt.destination or segment.get("destination", ""),
                departure=dep_dt,
                arrival=arr_dt,
                cabin=opt.cabin_class,
            )
            flight_segments.append(flight_seg)
        
        # ═══════════════════════════════════════════════════════════════════
        # EXTRACT RAW PROVIDER DATA
        # ═══════════════════════════════════════════════════════════════════
        
        # Get num_stops from provider (CRITICAL: prevents missing segments from looking direct)
        num_stops_hint = getattr(opt, 'num_stops', None)
        if num_stops_hint is None and hasattr(opt, 'stops'):
            num_stops_hint = opt.stops
        
        # Get pricing artifacts
        offer_id = getattr(opt, 'offer_id', None) or getattr(opt, 'id', None)
        pricing_id = getattr(opt, 'pricing_id', None)
        fare_id = getattr(opt, 'fare_id', None)
        
        # Get pricing source
        pricing_source = getattr(opt, 'source', None) or getattr(opt, 'pricing_source', None)
        if not pricing_source:
            # Try to infer from other fields
            if hasattr(opt, 'provider'):
                pricing_source = opt.provider
        
        # ═══════════════════════════════════════════════════════════════════
        # SANITIZE NUMERIC VALUES (prevent -1 sentinel values from leaking)
        # ═══════════════════════════════════════════════════════════════════
        # CRITICAL: AwardTool uses -1 as sentinel for "unknown". This MUST NOT
        # leak into FlightItineraryEdge.cash_cost as it corrupts optimization totals.
        # We use the shared sanitizer from utils.pricing as the source of truth.
        
        # Build route context for logging
        route_context = f"{opt.origin or segment.get('origin', '?')}->{opt.destination or segment.get('destination', '?')} {edge_id}"
        
        # SANITIZE CASH PRICE - CRITICAL!
        # Use shared sanitizer which returns None for invalid, then convert for optimization
        sanitized_cash_price_raw = sanitize_cash_price(opt.cash_price, context=route_context)
        
        # Track if cash price is unknown (for display purposes)
        cash_cost_unknown = (sanitized_cash_price_raw is None)
        
        # CRITICAL FIX: When cash price is unknown (None), use a LARGE PENALTY
        # This ensures the optimizer does NOT treat unknown prices as "free" ($0)
        # and will prefer using points instead of "free" cash bookings
        sanitized_cash_price = get_cash_cost_for_optimization(
            sanitized_cash_price_raw, 
            use_penalty_for_unknown=True  # Use large penalty for unknown (CRITICAL!)
        )
        
        # Log when we're applying the penalty
        if cash_cost_unknown:
            logger.info(
                f"[ADAPTER] cash_price unknown for {route_context}. "
                f"Using penalty value {UNKNOWN_PRICE_PENALTY} to prevent treating as free."
            )
        
        # SANITIZE AWARD POINTS
        sanitized_award_points = sanitize_points_cost(opt.award_points, context=route_context)
        if sanitized_award_points is None:
            sanitized_award_points = 0
        
        # SANITIZE SURCHARGE
        sanitized_surcharge = sanitize_surcharge(opt.award_surcharge, context=route_context)
        
        # Duration - use simple non-negative check with default
        def _sanitize_duration(v, default=180):
            if v is None:
                return default
            try:
                val = int(v)
                return val if val >= 0 else default
            except (ValueError, TypeError):
                return default
        
        sanitized_duration = _sanitize_duration(opt.duration_minutes, 180)
        
        # ═══════════════════════════════════════════════════════════════════
        # BUILD AWARD OPTIONS
        # ═══════════════════════════════════════════════════════════════════
        
        award_options = []
        
        # DETAILED logging for award option creation
        logger.info(
            f"[ADAPTER] {route_context}: cash=${sanitized_cash_price}, "
            f"award_available={opt.award_available}, award_points={opt.award_points}, "
            f"sanitized_points={sanitized_award_points}, surcharge=${sanitized_surcharge}, "
            f"program={opt.award_program}"
        )
        
        if opt.award_available and sanitized_award_points > 0:
            program = normalize_program(opt.award_program or "UA")
            
            # Calculate CPP for logging
            cash_saved = max(1.0, sanitized_cash_price - sanitized_surcharge)
            cpp = (cash_saved * 100) / sanitized_award_points if sanitized_award_points > 0 else 0
            
            award_options.append(AwardOption(
                option_id=f"{edge_id}_{program}",
                program=program,
                miles_required=sanitized_award_points,
                surcharge=sanitized_surcharge,
                cabin_or_room_type=opt.cabin_class or "economy",
                cash_equivalent=sanitized_cash_price,
            ))
            logger.info(
                f"[ADAPTER] ✅ {route_context}: AWARD CREATED - {sanitized_award_points:,} {program} pts + "
                f"${sanitized_surcharge} surcharge (CPP={cpp:.2f}¢, saves ${cash_saved:.0f} vs ${sanitized_cash_price} cash)"
            )
        elif opt.award_points:
            logger.warning(
                f"[ADAPTER] ⚠️ {route_context}: Has award_points={opt.award_points} but "
                f"award_available={opt.award_available} is False/None, sanitized_points={sanitized_award_points}. "
                f"Award option NOT created - check AwardTool response."
            )
        else:
            logger.info(
                f"[ADAPTER] ℹ️ {route_context}: NO AWARD - cash-only option at ${sanitized_cash_price}"
            )
        
        # ═══════════════════════════════════════════════════════════════════
        # CREATE EDGE (let derivation handle protection attributes)
        # ═══════════════════════════════════════════════════════════════════
        
        edge = FlightItineraryEdge(
            edge_id=edge_id,
            leg_id=leg_id,
            origin=opt.origin or segment.get("origin", ""),
            destination=opt.destination or segment.get("destination", ""),
            segments=flight_segments,
            departure_datetime=dep_dt,
            arrival_datetime=arr_dt,
            total_time_minutes=sanitized_duration,
            cash_cost=sanitized_cash_price,
            cash_cost_unknown=cash_cost_unknown,  # Track if original price was unknown
            award_options=award_options,
            # V4: Raw data for derivation pipeline
            pricing_source=pricing_source,
            offer_id=offer_id,
            pricing_id=pricing_id,
            fare_id=fare_id,
            num_stops_hint=num_stops_hint,
            validating_carrier=getattr(opt, 'validating_carrier', None),
            # V4: Do NOT pre-set ticketing_type - let derivation handle it
        )
        
        edge.compute_date_fields()
        
        # CRITICAL FIX: SerpAPI/Google Flights results are always single-ticket airline itineraries
        # They should be marked as AIRLINE_PROTECTED so they don't get filtered out
        source = getattr(opt, 'source', None)
        if source == "serpapi":
            from .models_v3 import ConnectionProtection, TicketingType, SelfTransferRequired
            edge.ticketing_type = TicketingType.SINGLE_TICKET
            edge.connection_protection = ConnectionProtection.AIRLINE_PROTECTED
            edge.self_transfer_required = SelfTransferRequired.NO
            flight_nums = opt.flight_numbers if hasattr(opt, 'flight_numbers') and opt.flight_numbers else []
            logger.info(f"[V3 Adapter] {edge_id}: SerpAPI cash flight AIRLINE_PROTECTED, "
                       f"price=${sanitized_cash_price}, flights={flight_nums[:2]}")
        
        # V4: Run derivation pipeline
        edge = finalize_itinerary(edge)
        
        return edge
    
    except Exception as e:
        logger.warning(f"Failed to convert flight option: {e}")
        return None


def build_transfer_paths(user_points: Dict[str, int]) -> List[TransferPath]:
    """
    Build transfer paths based on user's bank balances.
    """
    
    from .constants import DEFAULT_TRANSFER_GRAPH
    
    paths = []
    
    for bank, targets in DEFAULT_TRANSFER_GRAPH.items():
        # Check if user has this bank
        normalized_bank = normalize_bank(bank)
        
        has_bank = False
        for prog in user_points.keys():
            if normalize_bank(prog) == normalized_bank:
                has_bank = True
                break
        
        if not has_bank:
            continue
        
        # Add transfer paths to each target
        for target, ratio in targets.items():
            normalized_target = normalize_program(target)
            paths.append(TransferPath(
                path_id=f"{normalized_bank}_to_{normalized_target}",
                from_bank=normalized_bank,
                to_program=normalized_target,
                min_increment=1000,
                ratio=ratio,
                current_bonus=1.0,
            ))
    
    return paths


# =============================================================================
# V3 → ORCHESTRATOR CONVERSION
# =============================================================================

def convert_result_to_itineraries(
    result: OptimizationResult,
    spec: TripPlanSpec,
    flights: List[FlightItineraryEdge],
    search_results: dict,
    segments: List[dict],
    budget: float,
) -> List:
    """
    Convert V3 OptimizationResult to orchestrator RankedItinerary list.
    
    Returns list of RankedItinerary objects (or dicts that match the format).
    """
    
    from ..agents.models import (
        RankedItinerary, OOPMetrics,
        FlightSegment as AgentFlightSegment,
        FlightLeg,
        CashPayment, PointsPayment, TransferInstruction,
    )
    
    if result.status not in {OptimizationStatus.OPTIMAL, OptimizationStatus.FEASIBLE_SUBOPTIMAL}:
        logger.warning(f"V3 solver returned {result.status}: {result.infeasibility_reason}")
        return []
    
    solution = result.solution
    if not solution:
        return []
    
    # Build flight lookup
    flight_by_id = {f.edge_id: f for f in flights}
    
    # Build itinerary segments
    itinerary_segments = []
    route = []
    total_cash_price = 0.0
    total_oop = 0.0
    total_points_used = 0
    points_breakdown = {}
    transfers = []
    
    # Build lookup of SerpAPI flights by leg for enriching award flights with real details
    # Award flights often lack precise flight numbers/times - we can get those from SerpAPI
    # 
    # CRITICAL: Only use REAL SerpAPI flights, not AwardTool flights with placeholder numbers
    # Real flight numbers look like: "DL 2055", "UA 5678", "AF 123" (airline + space + 3-4 digits)
    # Placeholder numbers look like: "DL100", "UA100" (airline + exactly "100")
    import re
    real_flight_pattern = re.compile(r'^[A-Z]{2}\s*\d{3,4}$')  # e.g., "DL 2055", "UA5678"
    
    serpapi_flights_by_leg = {}
    for f in flights:
        source = getattr(f, 'pricing_source', None)
        
        # Check if it's a real SerpAPI flight (not AwardTool)
        is_serpapi = source == "serpapi"
        
        # Also check for real flight numbers (not placeholders like "DL100", "AC & LH100")
        if not is_serpapi and f.segments and f.segments[0].flight_number:
            fn = f.segments[0].flight_number
            # Real flight numbers have space between airline and number, OR 3-4 digit numbers
            # Placeholders are like "DL100", "AC & LH100" - use robust detection
            has_space = ' ' in fn and ' & ' not in fn  # Real space, not "&" placeholder
            is_placeholder = _is_placeholder_flight_number([fn])
            if has_space and not is_placeholder:
                is_serpapi = True
        
        if is_serpapi:
            leg = f.leg_id
            if leg not in serpapi_flights_by_leg:
                serpapi_flights_by_leg[leg] = []
            serpapi_flights_by_leg[leg].append(f)
            # Log the flight number for debugging
            fn = f.segments[0].flight_number if f.segments else "?"
            logger.debug(f"[V3 Adapter] SerpAPI flight for leg {leg}: {fn}")
    
    logger.info(f"[V3 Adapter] SerpAPI flights available for enrichment: {dict((k, len(v)) for k, v in serpapi_flights_by_leg.items())}")
    
    # Process flights
    for leg_id, edge_id in solution.selected_flights.items():
        flight = flight_by_id.get(edge_id)
        if not flight:
            continue
        
        payment_choice = solution.flight_payments.get(edge_id)
        
        if payment_choice and payment_choice.method == "points":
            # Points payment
            opt = next((o for o in flight.award_options if o.option_id == payment_choice.award_option_id), None)
            cpp = opt.cpp if opt else 0
            cash_saved = (flight.cash_cost - payment_choice.cash_amount) if opt else 0
            
            # Ensure program is never None
            program = (opt.program if opt and opt.program else None) or "unknown"
            
            payment = PointsPayment(
                program=program,
                points_used=payment_choice.points_amount,
                surcharge=payment_choice.cash_amount,
                cpp_achieved=cpp,
                cash_saved=cash_saved,
                reason=f"Saves ${cash_saved:.0f} at {cpp:.1f}¢/pt" if cpp else None,
            )
            
            total_oop += payment_choice.cash_amount
            total_points_used += payment_choice.points_amount
            prog = opt.program if opt else "unknown"
            points_breakdown[prog] = points_breakdown.get(prog, 0) + payment_choice.points_amount
            
            # Check for transfer
            if payment_choice.funding_source_id and "transfer" in payment_choice.funding_source_id:
                parts = payment_choice.funding_source_id.split("_")
                if len(parts) >= 4:
                    from_bank = parts[2]
                    to_prog = parts[3]
                    transfers.append(TransferInstruction(
                        from_program=from_bank,
                        to_program=to_prog,
                        points_to_transfer=payment_choice.points_amount,
                        ratio=1.0,
                        portal_url=f"https://{from_bank}.com/transfer",
                        transfer_time="Instant",
                        steps=[f"Transfer {payment_choice.points_amount:,} from {from_bank} to {to_prog}"],
                    ))
        else:
            # Cash payment - use actual cash cost, not penalty
            # For display purposes, use 0 if cash price was unknown
            actual_cash = 0.0 if flight.cash_cost_unknown else flight.cash_cost
            
            # Determine reason for cash vs points
            cash_reason = "Best value for this segment"
            if not flight.award_options:
                cash_reason = "No award availability for this flight"
            elif flight.cash_cost_unknown:
                cash_reason = "Award flight - cash price unavailable for comparison"
            elif all(opt.cpp and opt.cpp < 1.0 for opt in flight.award_options if opt.cpp):
                cash_reason = "Points redemption value too low (<1¢/pt) - cash is better"
            elif actual_cash and actual_cash < 500:  # Cheap flight
                cash_reason = f"Cash price ${actual_cash:.0f} is competitive - points better for expensive flights"
            
            payment = CashPayment(
                amount=actual_cash,
                reason=cash_reason,
            )
            total_oop += actual_cash
        
        # Use actual price for totals (0 for unknown, not the $999,999 penalty)
        actual_cash_price = 0.0 if flight.cash_cost_unknown else flight.cash_cost
        total_cash_price += actual_cash_price
        
        # Build segment - extract from first leg (for multi-leg, aggregate flight numbers)
        first_seg = flight.segments[0] if flight.segments else None
        airline_code = first_seg.marketing_carrier if first_seg else "UA"
        # Operating airline (codeshare) - use operating_carrier if different from marketing
        operating_airline = None
        if first_seg and first_seg.operating_carrier != first_seg.marketing_carrier:
            operating_airline = first_seg.operating_carrier
        
        # Get ALL flight numbers for connecting flights
        if flight.segments and len(flight.segments) > 1:
            all_flight_nums = [seg.flight_number for seg in flight.segments if seg.flight_number]
            flight_num = " → ".join(all_flight_nums) if all_flight_nums else None
        else:
            flight_num = first_seg.flight_number if first_seg else None
        
        cabin = first_seg.cabin if first_seg else "Economy"
        dep_time = flight.departure_datetime.isoformat() if flight.departure_datetime else None
        arr_time = flight.arrival_datetime.isoformat() if flight.arrival_datetime else None
        duration = flight.total_time_minutes
        
        # ENRICHMENT: If flight lacks details (common with award flights), enrich from SerpAPI
        # Award flights from AwardTool often have placeholder numbers or T00:00:00 times
        # Placeholder flight numbers: "DL100", "UA100", "AC & LH100", etc.
        # Note: Don't treat connecting flights (with " → ") as placeholders
        is_placeholder_flight_num = (
            flight_num and 
            " → " not in flight_num and  # Not a connecting flight
            _is_placeholder_flight_number([flight_num])
        )
        needs_enrichment = (
            not flight_num or len(flight_num) <= 3 or  # No flight number or just "100"
            is_placeholder_flight_num or  # Placeholder like "DL100", "AC & LH100"
            (dep_time and "T00:00:00" in dep_time)  # Placeholder midnight time
        )
        
        # Store original airline for award flights - we shouldn't change it
        original_airline_code = airline_code
        
        # Get the award program for this payment (if points) - MUST be defined before enrichment block
        award_program = None
        if payment_choice and payment_choice.method == "points":
            opt = next((o for o in flight.award_options if o.option_id == payment_choice.award_option_id), None)
            award_program = opt.program if opt else None
        
        # IMPORTANT: Only enrich with SerpAPI data if we find a MATCHING airline
        # Don't mix data from different airlines - this causes booking confusion
        if needs_enrichment and leg_id in serpapi_flights_by_leg:
            # Find best matching SerpAPI flight for this route - MUST match airline
            serpapi_options = serpapi_flights_by_leg[leg_id]
            best_match = None
            
            # Define airline code mappings and alliances
            AIRLINE_ALIASES = {
                "DL": ["DL", "Delta", "AF", "KL", "VS", "AM"],  # SkyTeam partners
                "AA": ["AA", "American", "BA", "IB", "JL", "QF"],  # OneWorld partners
                "UA": ["UA", "United", "LH", "SQ", "NH", "AC"],  # Star Alliance partners
            }
            
            # Build list of acceptable airline codes
            acceptable_airlines = []
            search_code = (award_program or airline_code or "").upper()[:2]
            if search_code in AIRLINE_ALIASES:
                acceptable_airlines = [a.upper() for a in AIRLINE_ALIASES[search_code]]
            else:
                acceptable_airlines = [search_code, original_airline_code.upper()[:2]]
            
            # Try to match by airline (only within same alliance)
            for sf in serpapi_options:
                sf_seg = sf.segments[0] if sf.segments else None
                if sf_seg:
                    sf_airline = (sf_seg.marketing_carrier or "").upper()[:2]
                    if sf_airline in acceptable_airlines:
                        best_match = sf
                        logger.info(f"[V3 Adapter] Found matching airline {sf_airline} for {search_code}")
                        break
            
            # DO NOT fall back to non-matching airlines - this causes incorrect data
            # If no match, we'll show partial data with a note
            
            if best_match:
                best_seg = best_match.segments[0] if best_match.segments else None
                if best_seg:
                    # Get ALL flight numbers for connecting flights
                    all_flight_nums = []
                    for seg in best_match.segments:
                        if seg.flight_number:
                            all_flight_nums.append(seg.flight_number)
                    
                    # Join flight numbers with arrow for display (e.g., "TN 7 → AS 585")
                    combined_flight_nums = " → ".join(all_flight_nums) if all_flight_nums else best_seg.flight_number
                    
                    logger.info(
                        f"[V3 Adapter] Enriching leg {leg_id} ({flight.origin}->{flight.destination}) "
                        f"with matching SerpAPI flight: {combined_flight_nums}, "
                        f"dep={best_match.departure_datetime}, arr={best_match.arrival_datetime}"
                    )
                    # Enrich with SerpAPI data - but KEEP original airline for award flights
                    if not flight_num or len(flight_num) <= 3 or is_placeholder_flight_num:
                        flight_num = combined_flight_nums
                        # Only update airline for cash payments, not award bookings
                        if not (payment_choice and payment_choice.method == "points"):
                            airline_code = best_seg.marketing_carrier or airline_code
                            if best_seg.operating_carrier and best_seg.operating_carrier != best_seg.marketing_carrier:
                                operating_airline = best_seg.operating_carrier
                    if (not dep_time or "T00:00:00" in dep_time) and best_match.departure_datetime:
                        dep_time = best_match.departure_datetime.isoformat()
                    if (not arr_time or "T00:00:00" in arr_time) and best_match.arrival_datetime:
                        arr_time = best_match.arrival_datetime.isoformat()
                    if not duration and best_match.total_time_minutes:
                        duration = best_match.total_time_minutes
            else:
                # No matching airline found - log and show what we have
                logger.warning(
                    f"[V3 Adapter] No matching SerpAPI flight for {flight.origin}->{flight.destination} "
                    f"with airline {search_code}. Award flights may need manual lookup."
                )
        
        # For display purposes, use 0 if cash price was unknown (not the penalty value)
        display_cash_price = 0.0 if flight.cash_cost_unknown else flight.cash_cost
        
        # Build detailed flight legs for booking information
        flight_legs = []
        layovers = []
        
        # Use enriched flight if available, otherwise use original
        source_flight = best_match if (needs_enrichment and 'best_match' in dir() and best_match) else flight
        
        if source_flight and source_flight.segments:
            prev_arrival = None
            for i, seg_data in enumerate(source_flight.segments):
                # Determine if this is a codeshare
                marketing = seg_data.marketing_carrier or airline_code
                operating = seg_data.operating_carrier
                is_codeshare = operating and operating != marketing
                codeshare_info = None
                if is_codeshare:
                    codeshare_info = f"Operated by {operating}"
                
                # Parse times
                seg_dep_time = None
                seg_arr_time = None
                if hasattr(seg_data, 'departure_time') and seg_data.departure_time:
                    seg_dep_time = seg_data.departure_time if isinstance(seg_data.departure_time, str) else seg_data.departure_time.isoformat()
                if hasattr(seg_data, 'arrival_time') and seg_data.arrival_time:
                    seg_arr_time = seg_data.arrival_time if isinstance(seg_data.arrival_time, str) else seg_data.arrival_time.isoformat()
                
                # Calculate layover from previous leg
                if prev_arrival and seg_dep_time:
                    try:
                        prev_arr_dt = datetime.fromisoformat(prev_arrival.replace('Z', '+00:00'))
                        seg_dep_dt = datetime.fromisoformat(seg_dep_time.replace('Z', '+00:00'))
                        layover_mins = int((seg_dep_dt - prev_arr_dt).total_seconds() / 60)
                        if layover_mins > 0:
                            layovers.append({
                                "airport": seg_data.origin if hasattr(seg_data, 'origin') else "",
                                "duration_minutes": layover_mins,
                                "duration_display": f"{layover_mins // 60}h {layover_mins % 60}m" if layover_mins >= 60 else f"{layover_mins}m"
                            })
                    except:
                        pass
                
                leg = FlightLeg(
                    flight_number=seg_data.flight_number or f"{marketing}???",
                    marketing_carrier=marketing,
                    operating_carrier=operating if is_codeshare else None,
                    origin=seg_data.origin if hasattr(seg_data, 'origin') else flight.origin,
                    destination=seg_data.destination if hasattr(seg_data, 'destination') else flight.destination,
                    departure_time=seg_dep_time or dep_time or "",
                    arrival_time=seg_arr_time or arr_time or "",
                    duration_minutes=seg_data.duration_minutes if hasattr(seg_data, 'duration_minutes') and seg_data.duration_minutes else 0,
                    cabin_class=seg_data.cabin if hasattr(seg_data, 'cabin') and seg_data.cabin else cabin,
                    is_codeshare=is_codeshare,
                    codeshare_info=codeshare_info,
                )
                flight_legs.append(leg)
                prev_arrival = seg_arr_time
        
        # If no detailed segments, create a single leg from available data
        if not flight_legs:
            is_codeshare = operating_airline and operating_airline != airline_code
            flight_legs.append(FlightLeg(
                flight_number=flight_num or f"{airline_code}???",
                marketing_carrier=airline_code,
                operating_carrier=operating_airline if is_codeshare else None,
                origin=flight.origin,
                destination=flight.destination,
                departure_time=dep_time or "",
                arrival_time=arr_time or "",
                duration_minutes=duration or 0,
                cabin_class=cabin,
                is_codeshare=is_codeshare,
                codeshare_info=f"Operated by {operating_airline}" if is_codeshare else None,
            ))
        
        stops = len(flight_legs) - 1
        
        # Generate Google Flights verification URL
        # Format: https://www.google.com/travel/flights?q=flights%20from%20SEA%20to%20CDG%20on%202026-02-11
        dep_date_only = ""
        if dep_time:
            try:
                dep_date_only = dep_time.split("T")[0]
            except:
                dep_date_only = ""
        
        google_flights_url = (
            f"https://www.google.com/travel/flights?q=flights%20from%20{flight.origin}%20to%20{flight.destination}"
            f"%20on%20{dep_date_only}" if dep_date_only else None
        )
        
        # Determine data source and verification note
        source = getattr(flight, 'pricing_source', None) or getattr(flight, 'source', 'unknown')
        is_award_booking = payment_choice and payment_choice.method == "points"
        
        if is_award_booking:
            verification_note = (
                "Award flight - book through airline's loyalty program. "
                "Verify availability on airline website before transferring points."
            )
            data_source = f"award_program ({award_program or 'unknown'})"
        else:
            verification_note = "Verify flight times on Google Flights before booking."
            data_source = "google_flights" if source == "serpapi" else source
        
        # Determine verification status
        # SerpAPI flights are considered verified since they come fresh from Google Flights
        # AwardTool flights need manual verification
        is_verified = source == "serpapi"
        verification_status = "verified" if is_verified else "unverified"
        
        # Get fetched_at timestamp if available from the source flight
        fetched_at = None
        if hasattr(flight, 'fetched_at') and flight.fetched_at:
            fetched_at = flight.fetched_at
        else:
            # Use current time for award flights (they should be verified manually)
            from datetime import datetime, timezone
            fetched_at = datetime.now(timezone.utc).isoformat()
        
        logger.info(f"[V3 Adapter] Flight segment: {flight.origin}->{flight.destination}, airline={airline_code}, "
                    f"stops={stops}, legs={len(flight_legs)}, cash_price={display_cash_price} (unknown={flight.cash_cost_unknown}), "
                    f"payment_type={payment.__class__.__name__}, departure={dep_time}, flight_num={flight_num}, source={data_source}, "
                    f"verified={is_verified}")
        
        seg = AgentFlightSegment(
            id=str(uuid.uuid4()),
            origin=flight.origin,
            destination=flight.destination,
            departure_time=dep_time,
            arrival_time=arr_time,  # Use enriched arrival time
            duration_minutes=duration,  # Use enriched duration
            airline=airline_code,
            flight_number=flight_num,
            cabin_class=cabin,
            operating_airline=operating_airline,  # Codeshare info
            stops=stops,
            legs=flight_legs,
            layovers=layovers,
            # Use display price (0 for unknown), not the optimization penalty
            cash_price=display_cash_price,
            payment=payment,
            # Verification info
            google_flights_url=google_flights_url,
            verification_note=verification_note,
            data_source=data_source,
            fetched_at=fetched_at,
            is_verified=is_verified,
            verification_status=verification_status,
        )
        itinerary_segments.append(seg)
        
        if flight.origin not in route:
            route.append(flight.origin)
        route.append(flight.destination)
    
    # Build metrics (ensure non-negative - can't calculate proper savings if cash price unknown)
    cash_saved = max(0.0, total_cash_price - total_oop)
    savings_pct = (cash_saved / total_cash_price * 100) if total_cash_price > 0 else 0.0
    
    # Calculate average CPP
    cpp_values = []
    for seg in itinerary_segments:
        if hasattr(seg, "payment") and hasattr(seg.payment, "cpp_achieved") and seg.payment.cpp_achieved:
            cpp_values.append(seg.payment.cpp_achieved)
    avg_cpp = sum(cpp_values) / len(cpp_values) if cpp_values else 0
    
    # Budget verification
    is_within_budget = total_oop <= budget
    logger.info("=" * 80)
    logger.info(f"[V3 Adapter] BUDGET VERIFICATION:")
    logger.info(f"  Total out-of-pocket: ${total_oop:.2f}")
    logger.info(f"  Budget limit: ${budget:.2f}")
    logger.info(f"  Within budget: {is_within_budget} ({'✅' if is_within_budget else '❌'})")
    if not is_within_budget:
        logger.error(f"  ⚠️ BUDGET EXCEEDED by ${total_oop - budget:.2f}!")
    logger.info("=" * 80)
    
    itinerary = RankedItinerary(
        id=str(uuid.uuid4()),
        rank=1,
        name="V3 Optimized Itinerary",
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
        within_budget=is_within_budget,
        within_points=True,
        summary=f"Save ${cash_saved:.0f} ({savings_pct:.0f}% off) by using {total_points_used:,} points",
    )
    
    # Debug log transfers
    logger.info(f"[V3 Adapter] Built itinerary with {len(transfers)} transfers, {len(itinerary_segments)} segments")
    if transfers:
        for t in transfers:
            logger.info(f"[V3 Adapter] Transfer: {t.from_program} -> {t.to_program}: {t.points_to_transfer:,} pts")
    else:
        logger.info(f"[V3 Adapter] No transfers - payments: {points_breakdown}")
    
    return [itinerary]


# =============================================================================
# MAIN ADAPTER FUNCTION
# =============================================================================

async def run_v3_optimization(
    segments: List[dict],
    search_results: dict,
    user_points: Dict[str, int],
    budget: float,
    trip_data: dict,
    mode: str = "oop",
    force_refresh: bool = False,
    validate_flights: bool = True,
    risk_mode: str = "balanced",
    include_basic_economy: bool = False,
    flexibility_priority: str = "medium",
) -> List:
    """
    Run V3 optimization using orchestrator data.
    
    This is the main entry point that:
    1. Converts orchestrator data to V3 format
    2. Cross-validates flights with Google Flights (SerpAPI)
    3. Runs the V3 solver
    4. Converts results back to orchestrator format
    5. Evaluates policy rules and attaches warnings/blocks
    
    Args:
        segments: List of segment dicts from orchestrator
        search_results: Search results from flight/hotel agents
        user_points: User's points balances
        budget: Cash budget
        trip_data: Trip data dict
        mode: Optimization mode ("oop", "cpp", "balanced")
        force_refresh: If True, bypass cache and fetch fresh SerpAPI data
        validate_flights: If True, cross-validate all flights with SerpAPI
        risk_mode: Policy risk mode ("safe", "balanced", "aggressive")
        include_basic_economy: Whether to include basic economy fares
        flexibility_priority: User's flexibility priority ("low", "medium", "high")
    
    Returns:
        List of RankedItinerary objects with policy evaluations attached
    """
    from datetime import timezone
    from ..services.flight_validation import (
        extract_flight_numbers_from_serpapi,
        validate_flight_exists,
        get_verification_summary,
    )
    from ..services.serp_api_functions import get_google_flights
    
    logger.info(f"[V3 Adapter] Starting V3 optimization, mode={mode}, validate_flights={validate_flights}, force_refresh={force_refresh}")
    
    # Convert to V3 format
    spec = convert_trip_to_spec(trip_data, segments, user_points)
    
    errors = spec.validate()
    if errors:
        logger.error(f"[V3 Adapter] Invalid spec: {errors}")
        return []
    
    flights = convert_search_results_to_flights(search_results, segments)
    
    # ═══════════════════════════════════════════════════════════════════
    # CROSS-VALIDATE FLIGHTS WITH SERPAPI
    # ═══════════════════════════════════════════════════════════════════
    if validate_flights:
        logger.info(f"[V3 Adapter] Cross-validating {len(flights)} flights against Google Flights...")
        
        # Group flights by leg for validation
        flights_by_leg = {}
        for f in flights:
            leg = f.leg_id
            if leg not in flights_by_leg:
                flights_by_leg[leg] = []
            flights_by_leg[leg].append(f)
        
        # Fetch fresh SerpAPI data for each leg and validate
        validation_timestamp = datetime.now(timezone.utc).isoformat()
        validated_flights = []
        
        # Collect award options from AwardTool flights to attach to matching SerpAPI flights
        # Key: (leg_id, airline code), Value: list of AwardOption objects
        # We key by leg_id to ensure SEA→CDG award options don't attach to CDG→SEA flights
        award_options_by_leg_airline = {}
        
        for leg_id, leg_flights in flights_by_leg.items():
            if not leg_flights:
                continue
            
            # Get route info from first flight
            first_flight = leg_flights[0]
            origin = first_flight.segments[0].origin if first_flight.segments else ""
            dest = first_flight.segments[-1].destination if first_flight.segments else ""
            dep_date = first_flight.segments[0].departure.strftime("%Y-%m-%d") if first_flight.segments else ""
            
            if not origin or not dest or not dep_date:
                logger.warning(f"[V3 Adapter] Leg {leg_id}: Missing route info, skipping validation")
                validated_flights.extend(leg_flights)
                continue
            
            logger.info(f"[V3 Adapter] Leg {leg_id}: Validating {len(leg_flights)} flights for {origin}->{dest} on {dep_date}")
            
            try:
                # Fetch fresh SerpAPI data
                serp_flights = get_google_flights(
                    origin=origin,
                    destination=dest,
                    outbound_date=dep_date,
                    return_date=None,
                    travel_class=1,  # Economy
                )
                
                if serp_flights:
                    logger.info(f"[V3 Adapter] Leg {leg_id}: Got {len(serp_flights)} Google Flights for validation")
                    
                    # Build lookup of valid flights
                    serp_lookup = extract_flight_numbers_from_serpapi(serp_flights)
                    logger.info(f"[V3 Adapter] Leg {leg_id}: Valid flight numbers: {list(serp_lookup.keys())[:15]}...")
                    
                    # Validate each flight
                    verified_count = 0
                    for flight in leg_flights:
                        # Get flight number(s) to validate
                        flight_nums = []
                        for seg in flight.segments:
                            if seg.flight_number:
                                flight_nums.append(seg.flight_number)
                        
                        # Check if any flight number is verified
                        is_verified = False
                        matched_data = None
                        for fn in flight_nums:
                            valid, match, status = validate_flight_exists(
                                fn, origin, dest, dep_date, serp_lookup
                            )
                            if valid:
                                is_verified = True
                                matched_data = match
                                break
                        
                        # Mark flight with verification status
                        flight.is_verified = is_verified
                        flight.verification_status = "verified" if is_verified else "unverified"
                        flight.verified_at = validation_timestamp
                        
                        if is_verified:
                            verified_count += 1
                            validated_flights.append(flight)
                        else:
                            # Include unverified flights - they may still be valid
                            pricing_source = getattr(flight, 'pricing_source', '')
                            if pricing_source == "serpapi":
                                logger.debug(f"[V3 Adapter] Leg {leg_id}: Including unverified SerpAPI flight: {flight_nums}")
                                validated_flights.append(flight)
                            else:
                                # CRITICAL FIX: Do NOT include AwardTool flights with placeholder numbers
                                # These can't be booked - they don't represent real flights
                                # Instead, we'll attach their award availability to matching SerpAPI flights below
                                has_award_options = hasattr(flight, 'award_options') and len(flight.award_options) > 0
                                is_placeholder = _is_placeholder_flight_number(flight_nums)
                                if has_award_options and not is_placeholder:
                                    logger.info(f"[V3 Adapter] Leg {leg_id}: Including AwardTool flight with real flight numbers: {flight_nums}")
                                    flight.verification_status = "unverified_awardtool"
                                    validated_flights.append(flight)
                                elif has_award_options:
                                    # Collect award options to attach to matching SerpAPI flights
                                    logger.info(f"[V3 Adapter] Leg {leg_id}: SKIPPING AwardTool flight with placeholder numbers (will attach award to real flights): {flight_nums}")
                                    # Store award options keyed by (leg_id, airline_code) for later matching
                                    # Map program names to airline codes for matching
                                    PROGRAM_TO_AIRLINE = {
                                        "DELTA": "DL", "SKYMILES": "DL",
                                        "UNITED": "UA", "MILEAGEPLUS": "UA",
                                        "AMERICAN": "AA", "AADVANTAGE": "AA",
                                        "AIR FRANCE": "AF", "FLYING BLUE": "AF", "FLYINGBLUE": "AF",
                                        "KLM": "KL",
                                        "BRITISH AIRWAYS": "BA", "AVIOS": "BA", "EXECUTIVE CLUB": "BA",
                                        "LUFTHANSA": "LH", "MILES & MORE": "LH",
                                        "AIR CANADA": "AC", "AEROPLAN": "AC",
                                        "ALASKA": "AS", "MILEAGE PLAN": "AS",
                                        "VIRGIN ATLANTIC": "VS", "FLYING CLUB": "VS",
                                        "EMIRATES": "EK", "SKYWARDS": "EK",
                                        "SINGAPORE": "SQ", "KRISFLYER": "SQ",
                                        "ANA": "NH", "ANAHP": "NH", "ANA MILEAGE CLUB": "NH",
                                        "TURKISH": "TK", "MILES&SMILES": "TK",
                                    }
                                    for opt in flight.award_options:
                                        program = (opt.program or "").upper().strip()
                                        airline_code = PROGRAM_TO_AIRLINE.get(program, program[:2])
                                        key = (leg_id, airline_code)
                                        if key not in award_options_by_leg_airline:
                                            award_options_by_leg_airline[key] = []
                                        award_options_by_leg_airline[key].append(opt)
                                        logger.debug(f"[V3 Adapter] Collected award option: program={program} -> airline={airline_code}, key={key}")
                                else:
                                    logger.debug(f"[V3 Adapter] Leg {leg_id}: EXCLUDING flight without award options: {flight_nums}")
                    
                    logger.info(f"[V3 Adapter] Leg {leg_id}: {verified_count}/{len(leg_flights)} flights verified, {len([f for f in leg_flights if f in validated_flights])} included")
                else:
                    logger.warning(f"[V3 Adapter] Leg {leg_id}: No SerpAPI data available - filtering placeholders and collecting award options")
                    # CRITICAL: Even without SerpAPI data, we must filter out placeholder flights
                    # and collect their award options for attachment to real flights
                    for flight in leg_flights:
                        flight.is_verified = False
                        flight.verification_status = "no_serpapi_data"
                        flight.verified_at = validation_timestamp
                        
                        # Get flight numbers for placeholder check
                        flight_nums = []
                        for seg in flight.segments:
                            if seg.flight_number:
                                flight_nums.append(seg.flight_number)
                        
                        has_award_options = hasattr(flight, 'award_options') and len(flight.award_options) > 0
                        is_placeholder = _is_placeholder_flight_number(flight_nums)
                        
                        if is_placeholder:
                            if has_award_options:
                                # Collect award options for later attachment to real flights
                                logger.info(f"[V3 Adapter] Leg {leg_id}: SKIPPING placeholder (no SerpAPI), collecting award options: {flight_nums}")
                                PROGRAM_TO_AIRLINE = {
                                    "DELTA": "DL", "SKYMILES": "DL",
                                    "UNITED": "UA", "MILEAGEPLUS": "UA",
                                    "AMERICAN": "AA", "AADVANTAGE": "AA",
                                    "AIR FRANCE": "AF", "FLYING BLUE": "AF", "FLYINGBLUE": "AF",
                                    "KLM": "KL",
                                    "BRITISH AIRWAYS": "BA", "AVIOS": "BA", "EXECUTIVE CLUB": "BA",
                                    "LUFTHANSA": "LH", "MILES & MORE": "LH",
                                    "AIR CANADA": "AC", "AEROPLAN": "AC",
                                    "ALASKA": "AS", "MILEAGE PLAN": "AS",
                                    "VIRGIN ATLANTIC": "VS", "FLYING CLUB": "VS",
                                    "EMIRATES": "EK", "SKYWARDS": "EK",
                                    "SINGAPORE": "SQ", "KRISFLYER": "SQ",
                                    "ANA": "NH",
                                    "TURKISH": "TK",
                                }
                                for opt in flight.award_options:
                                    program = (opt.program or "").upper().strip()
                                    airline_code = PROGRAM_TO_AIRLINE.get(program, program[:2])
                                    key = (leg_id, airline_code)
                                    if key not in award_options_by_leg_airline:
                                        award_options_by_leg_airline[key] = []
                                    award_options_by_leg_airline[key].append(opt)
                            else:
                                logger.debug(f"[V3 Adapter] Leg {leg_id}: EXCLUDING placeholder without award options: {flight_nums}")
                        else:
                            # Real flight number - include it
                            validated_flights.append(flight)
                            logger.info(f"[V3 Adapter] Leg {leg_id}: Including flight with real number (no SerpAPI): {flight_nums}")
                    
            except Exception as e:
                logger.error(f"[V3 Adapter] Leg {leg_id}: Validation failed: {e}")
                # On error, still filter placeholders but include real flights
                for flight in leg_flights:
                    flight.is_verified = False
                    flight.verification_status = "validation_error"
                    flight.verified_at = validation_timestamp
                    
                    # Get flight numbers for placeholder check
                    flight_nums = []
                    for seg in flight.segments:
                        if seg.flight_number:
                            flight_nums.append(seg.flight_number)
                    
                    is_placeholder = _is_placeholder_flight_number(flight_nums)
                    if not is_placeholder:
                        validated_flights.append(flight)
        
        # CRITICAL: Attach collected award options to matching SerpAPI flights
        # This ensures award availability from AwardTool is shown for REAL flights, not placeholder flights
        if award_options_by_leg_airline:
            programs_with_options = set(prog for (leg, prog) in award_options_by_leg_airline.keys())
            logger.info(f"[V3 Adapter] Attaching award options to SerpAPI flights. Programs with options: {list(programs_with_options)}")
            
            # Define airline alliances for matching
            AIRLINE_ALLIANCES = {
                # SkyTeam
                "DL": ["DL", "AF", "KL", "VS", "AM", "KE"],
                "AF": ["DL", "AF", "KL", "VS", "AM", "KE"],
                "KL": ["DL", "AF", "KL", "VS", "AM", "KE"],
                # Star Alliance
                "UA": ["UA", "LH", "SQ", "NH", "AC", "TK"],
                "LH": ["UA", "LH", "SQ", "NH", "AC", "TK"],
                "SQ": ["UA", "LH", "SQ", "NH", "AC", "TK"],
                # Oneworld
                "AA": ["AA", "BA", "IB", "QF", "JL", "AS"],
                "BA": ["AA", "BA", "IB", "QF", "JL", "AS"],
            }
            
            # Log available keys for debugging
            logger.info(f"[V3 Adapter] Award options keys available: {list(award_options_by_leg_airline.keys())}")
            
            flights_enriched = 0
            for flight in validated_flights:
                if flight.award_options:
                    continue  # Already has award options
                
                # Get airline code and leg_id from flight
                airline = flight.segments[0].marketing_carrier if flight.segments else ""
                if not airline:
                    continue
                
                airline = airline.upper()[:2]
                leg_id = flight.leg_id
                
                # Find matching award options (same leg, same airline or alliance partners)
                matching_airlines = AIRLINE_ALLIANCES.get(airline, [airline])
                logger.debug(f"[V3 Adapter] Looking for award options for {airline} flight on leg {leg_id}, checking: {matching_airlines}")
                
                best_option = None
                best_points = float('inf')
                
                for match_airline in matching_airlines:
                    key = (leg_id, match_airline)
                    if key in award_options_by_leg_airline:
                        logger.info(f"[V3 Adapter] Found award options for key {key}: {len(award_options_by_leg_airline[key])} options")
                        for opt in award_options_by_leg_airline[key]:
                            if opt.miles_required and opt.miles_required < best_points:
                                best_option = opt
                                best_points = opt.miles_required
                
                if best_option:
                    # Create a new award option with the correct ID for this flight
                    from copy import deepcopy
                    new_opt = deepcopy(best_option)
                    new_opt.option_id = f"{flight.edge_id}_{best_option.program}"
                    flight.award_options = [new_opt]
                    flights_enriched += 1
                    logger.debug(f"[V3 Adapter] Attached {best_option.program} award ({best_points:,} pts) to {airline} flight {flight.edge_id} on leg {leg_id}")
            
            logger.info(f"[V3 Adapter] Enriched {flights_enriched} SerpAPI flights with award options")
        
        # Use validated flights
        original_count = len(flights)
        flights = validated_flights
        logger.info(f"[V3 Adapter] Cross-validation complete: {len(flights)}/{original_count} flights passed validation")
        
        # ═══════════════════════════════════════════════════════════════════
        # CHECK FOR MISSING LEGS - Inform user which routes have no flights
        # ═══════════════════════════════════════════════════════════════════
        flights_by_leg_post_validation = {}
        for f in flights:
            leg = f.leg_id
            if leg not in flights_by_leg_post_validation:
                flights_by_leg_post_validation[leg] = []
            flights_by_leg_post_validation[leg].append(f)
        
        # Find legs that had flights but now have none
        missing_legs = []
        for leg_id in flights_by_leg.keys():
            if leg_id not in flights_by_leg_post_validation or len(flights_by_leg_post_validation[leg_id]) == 0:
                # Find the route for this leg from original flights
                sample_flight = flights_by_leg[leg_id][0] if flights_by_leg[leg_id] else None
                if sample_flight:
                    origin = sample_flight.origin
                    dest = sample_flight.destination
                    missing_legs.append((leg_id, origin, dest))
                    logger.warning(f"[V3 Adapter] Leg {leg_id} ({origin}→{dest}): NO VALID FLIGHTS after validation!")
        
        if missing_legs:
            logger.error(f"[V3 Adapter] {len(missing_legs)} legs have no valid flights:")
            for leg_id, origin, dest in missing_legs:
                logger.error(f"[V3 Adapter]   - Leg {leg_id}: {origin} → {dest}")
                # Suggest alternatives
                origin_alts = _get_metro_airports(origin)
                dest_alts = _get_metro_airports(dest)
                if len(origin_alts) > 1 or len(dest_alts) > 1:
                    logger.info(f"[V3 Adapter]     💡 Try alternate airports: {origin_alts} → {dest_alts}")
    
    transfers = build_transfer_paths(user_points)
    
    logger.info(f"[V3 Adapter] Converted: {len(flights)} flights, {len(transfers)} transfer paths")
    if transfers:
        for tp in transfers[:5]:  # Log first 5
            logger.info(f"[V3 Adapter] Transfer path: {tp.from_bank} -> {tp.to_program}")
    
    if not flights:
        logger.warning("[V3 Adapter] No flights to optimize - all routes have no valid flights")
        return []
    
    # Detect if this is an international route (affects convenience penalties)
    is_international = _detect_international_route(segments, trip_data)
    logger.info(f"[V3 Adapter] Route type: {'international' if is_international else 'domestic'}")
    
    # Run V3 solver (flights only)
    # Pass budget to solver - when set, FORCES points usage to stay within budget
    result = optimize_trip(
        spec=spec,
        flights=flights,
        transfers=transfers,
        # mode is ignored - always minimizes cash out-of-pocket
        determinism_mode=False,
        is_international=is_international,
        cash_budget=budget if budget and budget > 0 else None,
    )
    
    logger.info(f"[V3 Adapter] Budget constraint: ${budget if budget else 'None'}")
    
    logger.info(f"[V3 Adapter] V3 solver status: {result.status}")
    
    if result.warnings:
        for w in result.warnings[:5]:
            logger.warning(f"[V3 Adapter] {w}")
    
    # Convert back to orchestrator format
    itineraries = convert_result_to_itineraries(
        result=result,
        spec=spec,
        flights=flights,
        search_results=search_results,
        segments=segments,
        budget=budget,
    )
    
    # ═══════════════════════════════════════════════════════════════════
    # APPLY POLICY EVALUATION
    # ═══════════════════════════════════════════════════════════════════
    if itineraries:
        logger.info(f"[V3 Adapter] Applying policy evaluation (mode={risk_mode}) to {len(itineraries)} itineraries")
        
        try:
            from ..policy.engine import evaluate_itinerary, apply_policy_to_results
            from ..policy.modes import parse_risk_mode
            
            policy_context = {
                "include_basic_economy": include_basic_economy,
                "flexibility_priority": flexibility_priority,
            }
            
            parsed_mode = parse_risk_mode(risk_mode)
            
            for itin in itineraries:
                # Convert itinerary to dict for policy evaluation
                itin_dict = {
                    "flight_segments": [],
                    "transfers": [],
                }
                
                # Collect flight segments
                for seg in itin.segments:
                    seg_dict = seg.model_dump() if hasattr(seg, 'model_dump') else seg.__dict__
                    
                    # Add flight-specific fields for policy evaluation
                    flight_dict = {
                        "segments": seg_dict.get("legs", []),
                        "ticketing_type": "single_ticket" if seg_dict.get("stops", 0) == 0 or seg_dict.get("is_verified") else "unknown",
                        "connection_type": "protected" if seg_dict.get("is_verified") else "unknown",
                        "fare_brand": seg_dict.get("cabin_class"),
                        "booking_type": "one_way",  # Each segment is one-way in our model
                        **seg_dict,
                    }
                    itin_dict["flight_segments"].append(flight_dict)
                
                # Add transfers if present
                for transfer in itin.transfers:
                    transfer_dict = transfer.model_dump() if hasattr(transfer, 'model_dump') else transfer.__dict__
                    itin_dict["transfers"].append({
                        "from": transfer_dict.get("from_program"),
                        "to": transfer_dict.get("to_program"),
                        "points": transfer_dict.get("points_to_transfer", 0),
                    })
                
                # Evaluate policy
                evaluation = evaluate_itinerary(itin_dict, parsed_mode, policy_context)
                
                # Attach evaluation to itinerary
                from ..agents.models import PolicyEvaluationModel, PolicyMessageModel
                
                policy_eval = PolicyEvaluationModel(
                    blocks=[PolicyMessageModel(**m.model_dump()) for m in evaluation.blocks],
                    warnings=[PolicyMessageModel(**m.model_dump()) for m in evaluation.warnings],
                    info=[PolicyMessageModel(**m.model_dump()) for m in evaluation.info],
                    requires_ack=evaluation.requires_ack,
                    is_blocked=evaluation.is_blocked,
                    risk_score=evaluation.risk_score,
                    explanations=evaluation.explanations,
                )
                
                itin.policy_evaluation = policy_eval
                itin.disabled = evaluation.is_blocked
                if evaluation.is_blocked and evaluation.blocks:
                    itin.disable_reason = evaluation.blocks[0].title
                
                # Log individual policy decision
                from ..policy.engine import log_policy_decision
                log_policy_decision(
                    item_id=itin.id,
                    evaluation=evaluation,
                    mode=parsed_mode,
                    item_type="itinerary",
                )
            
            # Log summary
            blocked_count = sum(1 for i in itineraries if i.disabled)
            warning_count = sum(1 for i in itineraries if i.policy_evaluation and i.policy_evaluation.warnings)
            
            from ..policy.engine import log_policy_summary
            log_policy_summary(
                total=len(itineraries),
                blocked=blocked_count,
                with_warnings=warning_count,
                mode=risk_mode,
            )
            
        except ImportError as e:
            logger.warning(f"[V3 Adapter] Policy module not available: {e}. Skipping policy evaluation.")
        except Exception as e:
            logger.error(f"[V3 Adapter] Policy evaluation failed: {e}", exc_info=True)
    
    logger.info(f"[V3 Adapter] Returning {len(itineraries)} itineraries")

    # ═══════════════════════════════════════════════════════════════════
    # ENFORCE SENTINEL CONTRACT AT OPTIMIZER BOUNDARY
    # ═══════════════════════════════════════════════════════════════════
    # Convert models -> jsonable dicts, enforce, then re-validate into models so
    # negative numeric values cannot leak to API callers.
    try:
        from pydantic import BaseModel
        from ..agents.models import RankedItinerary

        def _to_jsonable(x):
            if isinstance(x, BaseModel):
                return x.model_dump()
            if isinstance(x, dict):
                return {k: _to_jsonable(v) for k, v in x.items()}
            if isinstance(x, list):
                return [_to_jsonable(v) for v in x]
            if isinstance(x, tuple):
                return [_to_jsonable(v) for v in x]
            return x

        json_payload = _to_jsonable(itineraries)
        scrubbed = _enforce_no_negative_numbers(json_payload, context="adapter_v3 output")

        # Rebuild itineraries as Pydantic models (if strict mode didn't raise).
        if isinstance(scrubbed, list):
            itineraries = [RankedItinerary.model_validate(x) for x in scrubbed]
        else:
            itineraries = []
    except Exception as e:
        # If contract enforcement itself fails, prefer to fail closed in strict mode.
        if _strict_contracts_enabled():
            raise
        logger.warning("[CONTRACT] Failed enforcing adapter_v3 contract: %s", e, exc_info=True)
    
    return itineraries
