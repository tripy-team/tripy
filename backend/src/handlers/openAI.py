import base64
import logging
from dotenv import load_dotenv
import os
import boto3
from pydantic import BaseModel
from enum import Enum
from datetime import date
from typing import Optional, List, Dict, Any, Tuple

# Optional dependency - OpenAI
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None
# from backend.bin.flights import create_flight_filters  # Module doesn't exist
def create_flight_filters():
    """Stub function - returns default filters"""
    return {
        "outbound_date": "2026-06-01",
        "return_date": "2026-06-15",
    }


class Suggestions(BaseModel):
    country: str
    city: str
    places: List[Tuple[str, str]] = []


class Seasons(Enum):
    WINTER = "winter"
    SPRING = "spring"
    SUMMER = "summer"
    FALL = "fall"


def ai_flight_suggestions():
    if OpenAI is None:
        raise ImportError("openai package is not installed. Install it with: pip install openai")
    load_dotenv()
    filters = create_flight_filters()
    outbound_date = filters["outbound_date"]
    return_date = filters["return_date"]
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))
    response = client.chat.completions.create(
        model="gpt-5",
        messages=[
            {
                "roles": "system",
                "content": f"You are a helpful travel agent, looking to suggest places to visit during with outbound date {outbound_date} and return date {return_date}",
            },
            {
                "role": "user",
                "content": f"what cities and their corresponding countries are best to travel with outbound date {outbound_date} and return date {return_date}",
            },
        ],
        response_format=Suggestions,
    )
    print(response.choices[0].message.content)
    return response


def get_season_between_dates(start_date, end_date):
    if OpenAI is None:
        raise ImportError("openai package is not installed. Install it with: pip install openai")
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))
    what_season_response = client.chat.completions.create(
        model="gpt-5",
        messages=[
            {
                "roles": "system",
                "content": f"You are a helpful Earth's four seasons categorizer",
            },
            {
                "role": "user",
                "content": f"what season is during {start_date} and return date {end_date}",
            },
        ],
        response_format=Seasons,
    )
    return what_season_response.value


def ai_image_generator(city, country, destination_start_date, destination_end_date):
    if OpenAI is None:
        raise ImportError("openai package is not installed. Install it with: pip install openai")
    load_dotenv()
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))
    image_bucket_client = session.client("s3")

    destination_season = get_season_between_dates(
        destination_start_date, destination_end_date
    )
    picture_name = f"{city}-{country}-{destination_season}.png"
    bucket_response = image_bucket_client.list_objects_v2(
        Bucket=os.getenv("IMAGE_S3_BUCKET_NAME")
    )
    while bucket_response["IsTruncated"]:
        if any(
            content.get("Key") == f"{picture_name}"
            for content in bucket_response["Contents"]
        ):
            return
        else:
            bucket_response = image_bucket_client.list_objects_v2(
                Bucket=os.getenv("IMAGE_S3_BUCKET_NAME"),
                ContinuationToken=bucket_response["NextContinuationToken"],
            )

    response = client.images.generate(
        model="gpt-image-1",
        input=f"Generate an image of {city}, {country} that is typical in {destination_season}",
    )
    b64 = response["data"][0]["b64_json"]
    img_bytes = base64.b64decode(b64)
    key = f"{picture_name}"
    image_bucket_client.put_object(
        Bucket=os.getenv("IMAGE_S3_BUCKET_NAME"),
        Key=key,
        Body=img_bytes,
        ContentType="image/png",
    )


def get_how_long_I_should_stay_at_a_destination():
    pass


class ExtractedTripInfo(BaseModel):
    """Structured response for trip information extraction"""
    cities: List[str] = []
    startDestination: Optional[str] = None
    endDestination: Optional[str] = None
    startDate: Optional[str] = None  # ISO format YYYY-MM-DD
    endDate: Optional[str] = None  # ISO format YYYY-MM-DD
    duration: Optional[int] = None  # Number of days
    isFlexible: Optional[bool] = False
    minBudget: Optional[int] = None
    maxBudget: Optional[int] = None
    creditCards: Optional[List[dict]] = None  # List of {program: str, points: int}
    flightClass: Optional[str] = None
    hotelClass: Optional[str] = None


class CitySuggestion(BaseModel):
    """Structured response for city suggestions"""
    city: str
    country: str
    airport_code: Optional[str] = None
    region: Optional[str] = None


class CitySuggestionsResponse(BaseModel):
    """Response containing list of city suggestions"""
    cities: List[CitySuggestion]


def find_commercial_airports_for_city(city_query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Find commercial airports for a city using OpenAI.
    For example, "nyc" or "New York" returns JFK, LGA, EWR.
    Only returns commercial airports (with scheduled service).
    """
    if OpenAI is None:
        raise ImportError("openai package is not installed. Install it with: pip install openai")
    
    # Load commercial airport set for filtering
    try:
        from .airport_filter import load_commercial_iata_set_from_web, is_commercial_airport
        commercial_set = load_commercial_iata_set_from_web()
    except Exception as e:
        logging.getLogger(__name__).warning(f"Could not load commercial airport set: {e}")
        commercial_set = set()
    
    load_dotenv()
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))
    
    system_prompt = """You are a travel assistant that finds commercial airports for cities.

Your task is to find ALL major commercial airports that serve a given city or metropolitan area.
For example:
- "New York" or "NYC" should return: JFK, LGA, EWR
- "London" should return: LHR, LGW, STN, LTN
- "Paris" should return: CDG, ORY
- "Los Angeles" or "LA" should return: LAX, BUR, SNA, LGB, ONT

IMPORTANT:
- Only return COMMERCIAL airports with scheduled passenger service
- Include ALL major airports serving the city/metro area
- Return airports as a JSON array with IATA codes, names, cities, countries
- Use the exact city name from the query when possible"""

    user_prompt = f"""Find all commercial airports that serve the city/metro area: "{city_query}"

Return a JSON object with this structure:
{{
  "city": "New York",
  "airports": [
    {{
      "iata_code": "JFK",
      "airport_name": "John F. Kennedy International Airport",
      "city": "New York",
      "state": "NY",
      "country": "United States",
      "region": "North America"
    }},
    {{
      "iata_code": "LGA",
      "airport_name": "LaGuardia Airport",
      "city": "New York",
      "state": "NY",
      "country": "United States",
      "region": "North America"
    }}
  ]
}}

Return ALL major commercial airports for this city/metro area (up to {max_results})."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.2,  # Low temperature for consistent results
        )
        
        import json
        content = response.choices[0].message.content
        parsed_data = json.loads(content)
        
        airports_list = parsed_data.get("airports", [])
        city_name = parsed_data.get("city", city_query)
        
        # Filter to only commercial airports and format results
        results = []
        for airport_data in airports_list:
            iata_code = airport_data.get("iata_code", "").upper().strip()
            
            # Skip if no valid IATA code
            if not iata_code or len(iata_code) != 3:
                continue
            
            # Filter for commercial airports only
            if commercial_set and not is_commercial_airport(iata_code, commercial_set):
                continue
            
            airport_name = airport_data.get("airport_name", "")
            city = airport_data.get("city", city_name)
            state = airport_data.get("state", "")
            country = airport_data.get("country", "")
            region = airport_data.get("region", "")
            
            # Format display name
            display_name = f"{iata_code} - {airport_name}" if airport_name else iata_code
            if city:
                display_name += f" ({city})"
            
            results.append({
                "airport_id": f"{iata_code},{city},{country}",
                "iata_code": iata_code,
                "airport_name": airport_name,
                "city": city,
                "state": state,
                "country": country,
                "region": region,
                "display_name": display_name,
            })
        
        return results[:max_results]
    except Exception as e:
        logging.getLogger(__name__).error(f"Error finding airports for city '{city_query}': {e}", exc_info=True)
        return []


def search_airports_with_openai(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search for airports using OpenAI. This can handle airport codes, airport names, city names, and variations.
    Returns a list of airport suggestions with IATA codes, names, and city information.
    Excludes non-commercial airports (e.g. FXL) via is_commercial_airport.
    """
    if OpenAI is None:
        raise ImportError("openai package is not installed. Install it with: pip install openai")
    load_dotenv()
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))

    commercial_set = None
    try:
        from .airport_filter import load_commercial_iata_set_from_web, is_commercial_airport
        commercial_set = load_commercial_iata_set_from_web()
    except Exception as e:
        logging.getLogger(__name__).warning(f"Could not load commercial airport set for search_airports_with_openai: {e}")
        commercial_set = set()
    
    system_prompt = """You are a travel assistant that helps users find airports around the world.
    
Your task is to suggest airports that match the user's query. The query might be:
- An airport code (e.g., "JFK", "CDG", "LHR")
- An airport name (e.g., "John F. Kennedy", "Charles de Gaulle")
- A city name (e.g., "New York", "Paris", "London")
- A partial airport code (e.g., "JF", "CD")
- A typo or variation (e.g., "JFK Airport", "Paris CDG")

For each airport, provide:
- The IATA airport code (3 letters, e.g., JFK, CDG, LHR) - REQUIRED
- The full airport name (e.g., "John F. Kennedy International Airport")
- The city name where the airport is located
- The country name
- The region/continent (e.g., Europe, Asia, North America)

Return results as a JSON array of airport objects. Prioritize:
1. Exact airport code matches
2. Airports matching the query text
3. Major international airports
4. Airports in cities matching the query"""

    user_prompt = f"""Find up to {max_results} airports that match the query: "{query}"

Return a JSON array with this structure:
[
  {{
    "iata_code": "JFK",
    "airport_name": "John F. Kennedy International Airport",
    "city": "New York",
    "country": "United States",
    "region": "North America"
  }}
]

IMPORTANT:
- Always include the IATA code (3-letter airport code)
- If the query is an airport code (3 letters), return that specific airport
- If the query is a city name, return the main airports for that city
- If the query is an airport name, return matching airports
- Include both the airport name and the city it serves"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.3,  # Lower temperature for more consistent results
        )
        
        import json
        content = response.choices[0].message.content
        parsed_data = json.loads(content)
        
        # Handle both array and object with airports key
        airports_list = parsed_data.get("airports", []) if isinstance(parsed_data, dict) else parsed_data
        
        # Convert to the format expected by the frontend
        results = []
        for airport_data in airports_list:
            iata_code = airport_data.get("iata_code", "").upper().strip()
            airport_name = airport_data.get("airport_name", "")
            city = airport_data.get("city", "")
            country = airport_data.get("country", "")
            region = airport_data.get("region", "")
            
            # Skip if no IATA code
            if not iata_code or len(iata_code) != 3:
                continue

            # Exclude non-commercial airports (e.g. FXL) using is_commercial_airport
            if commercial_set and not is_commercial_airport(iata_code, commercial_set):
                continue
            
            # Format display name
            display_name = f"{iata_code} - {airport_name}" if airport_name else iata_code
            if city:
                display_name += f" ({city})"
            
            results.append({
                "airport_id": f"{iata_code},{city},{country}",
                "iata_code": iata_code,
                "airport_name": airport_name,
                "city": city,
                "country": country,
                "region": region,
                "display_name": display_name,
            })
        
        return results[:max_results]
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.error(f"Error searching airports with OpenAI: {str(e)}")
        # Return empty list on error
        return []


def suggest_routes_for_remote_or_small_cities(
    origin: str,
    destination: str,
    city_names: Optional[List[str]] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    failed_routes: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Use OpenAI to suggest practical routes when the user is traveling to/from
    small cities or remote places where we don't have flight search data.

    Returns a list of route suggestions, each with:
      - title: short label for the route
      - steps: list of { from_place, to_place, method, note }
      - summary: brief explanation
    """
    if OpenAI is None:
        logging.getLogger(__name__).warning("OpenAI not available; cannot suggest routes for remote/small cities")
        return []

    import json as _json
    load_dotenv()
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))
    if not os.getenv("OPENAI_ADMIN_KEY"):
        logging.getLogger(__name__).warning("OPENAI_ADMIN_KEY not set; cannot suggest routes")
        return []

    cities_str = ", ".join(city_names) if city_names else "none"
    dates_str = f"{start_date or 'unknown'} to {end_date or 'unknown'}" if (start_date or end_date) else "not specified"
    failed_str = "; ".join(failed_routes) if failed_routes else "none"

    system_prompt = """You are a travel expert helping users reach small cities, towns, or remote destinations where direct flight search may not return results.

CRITICAL GEOGRAPHIC RULES:
- NEVER suggest driving across oceans, seas, or between continents (e.g., can't drive from North America to Asia, Europe to Africa across Mediterranean, etc.)
- NEVER suggest driving internationally unless there's a land border connection (e.g., US-Canada, US-Mexico, EU Schengen area)
- For island nations (Japan, UK, Iceland, New Zealand, etc.), ONLY suggest: fly to major airport → domestic flight/ferry/train
- For intercontinental travel, ALWAYS suggest: fly to major international hub in destination country → connect onward
- Only suggest driving if: same country/region, reasonable distance (<300 miles for small cities), and practical roads exist

Your task: suggest 2–4 practical, GEOGRAPHICALLY FEASIBLE route options to get from origin to destination.

For small/regional airports within the SAME COUNTRY/REGION:
- Drive/bus/train to nearby major airport hub (if <200 miles), then fly
- Connect through major domestic hubs (e.g., US: ATL/ORD/JFK/DFW; Europe: LHR/CDG/FRA; Asia: HND/ICN/SIN)
- Alternative nearby airports with better service

For INTERNATIONAL travel to remote destinations:
- Fly to major international airport in destination country → domestic connection
- Fly to nearest international hub → ferry/train/bus to final destination
- Multi-city routing through major hubs (e.g., NYC → Tokyo → regional Japan airport)

For each suggestion provide:
- title: short, specific with city/airport names (e.g., "Fly to Tokyo (HND) then train to Takayama", "Via Charlotte (CLT) hub")
- steps: array of legs with from_place (specific city/airport), to_place (specific city/airport), method ("fly", "train", "bus", "ferry", "drive"), and note with estimated time/distance
- summary: specific explanation with actual airports, distances, and logistics (e.g., "Fly from JFK to Haneda Airport (HND), then take JR train from Tokyo (3 hours) to Takayama. This avoids multiple connections and uses Japan's efficient rail system.")

Use real IATA airport codes, real city names, and actual transportation infrastructure. Be specific, realistic, and geographically accurate."""

    user_prompt = f"""A traveler wants to go from **{origin}** to **{destination}**.
- Other cities they want to visit (in order): {cities_str}
- Travel dates: {dates_str}
- Our flight search could not find bookable options for these route(s): {failed_str}

IMPORTANT: Consider the geography:
- If origin and destination are on different continents or separated by ocean: suggest flying to major international airport, then onward connection
- If destination is an island nation: suggest flying to main airport, then ferry/train/domestic flight
- If both are in same country and <300 miles apart: driving/bus may be reasonable
- Otherwise: suggest realistic flight connections through major hubs

Suggest 2–4 GEOGRAPHICALLY REALISTIC route options with specific airports, cities, and transportation methods.

Return a JSON object with a key "suggestions" containing an array of objects, each with:
- "title": specific route with airport codes/cities (e.g., "NYC (JFK) → Tokyo (HND) → Train to Takayama")
- "steps": array of {{ "from_place": "specific city/airport", "to_place": "specific city/airport", "method": "fly/train/bus/ferry/drive", "note": "details like '3hr train' or '45min flight'" }}
- "summary": detailed explanation with real airports, estimated times, why this route works (e.g., "Fly from JFK to Tokyo Haneda (13hrs), then take JR Hida Limited Express train from Tokyo Station to Takayama (4.5hrs). This uses Japan's efficient rail network and avoids multiple flight connections.")"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
        )
        content = response.choices[0].message.content
        parsed = _json.loads(content)
        raw = parsed.get("suggestions") or parsed.get("routes") or []
        if not isinstance(raw, list):
            raw = [raw] if raw else []

        suggestions = []
        for s in raw[:4]:
            if not isinstance(s, dict):
                continue
            title = s.get("title") or s.get("name") or "Route option"
            steps = s.get("steps") or s.get("legs") or []
            if not isinstance(steps, list):
                steps = []
            steps_clean = []
            for st in steps:
                if isinstance(st, dict) and (st.get("from_place") or st.get("to_place")):
                    steps_clean.append({
                        "from_place": st.get("from_place", ""),
                        "to_place": st.get("to_place", ""),
                        "method": st.get("method", "fly"),
                        "note": st.get("note") or "",
                    })
            summary = s.get("summary") or s.get("description") or ""
            suggestions.append({"title": title, "steps": steps_clean, "summary": summary})

        return suggestions
    except Exception as e:
        logging.getLogger(__name__).error(
            "Error getting OpenAI route suggestions for %s -> %s: %s", origin, destination, e, exc_info=True
        )
        return []


def get_itinerary_smart_tips(
    origin: str,
    destination: str,
    city_names: Optional[List[str]] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    points_programs: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Use OpenAI to generate itinerary advice: where to transfer points, sample
    money-saving itineraries, holiday/seasonal advice, and practical tips
    (transfer timing, attraction closing hours, etc.).

    Returns:
      - transfer_tips: [ { from_program, to_program, best_for, note } ]
      - sample_itineraries: [ { title, description, savings_estimate, when_to_book } ]
      - holiday_advice: [ { period, advice, avoid_or_prefer } ]
      - practical_tips: [ { category, tip } ]  (e.g. transfer_timing, attraction_hours, banking)
    """
    if OpenAI is None:
        logging.getLogger(__name__).warning("OpenAI not available; cannot generate itinerary smart tips")
        return _empty_smart_tips()

    import json as _json
    load_dotenv()
    key = os.getenv("OPENAI_ADMIN_KEY")
    if not key:
        return _empty_smart_tips()
    client = OpenAI(api_key=key)

    cities_str = ", ".join(city_names) if city_names else "none"
    dates_str = f"{start_date or '?'} to {end_date or '?'}" if (start_date or end_date) else "not specified"
    programs_str = ", ".join(points_programs) if points_programs else "not specified (give general Chase Ultimate Rewards, Amex MR, Citi TYP, Capital One, etc.)"

    system_prompt = """You are an expert travel and points advisor. For a user's trip, provide SPECIFIC, ACTIONABLE advice (not vague suggestions).

1. transfer_tips: Where to transfer which points for best value. Each: 
   - from_program (specific: "Chase Ultimate Rewards", "Amex Membership Rewards", "Citi ThankYou Points", "Capital One Miles", "Bilt Points")
   - to_program (specific airline/hotel: "United MileagePlus", "Delta SkyMiles", "Air France/KLM Flying Blue", "Virgin Atlantic", "Hyatt World of Hyatt")
   - best_for (specific route/region: "US to Europe", "NYC to Tokyo", "Domestic US", "Asia-Pacific")
   - note (specific transfer ratio and timing: "1:1 instant transfer", "1:1 transfer in 24-48hrs", "frequent 30% bonus promos", "sweet spot: 70k RT business class to Europe")
   If user's programs unknown, suggest 2-3 most common/valuable strategies for their specific route.

2. sample_itineraries: 2-4 SPECIFIC money-saving strategies with CONCRETE examples. Each:
   - title: specific strategy name (e.g., "Midweek Departure Strategy", "Hidden City Routing", "Positioning Flight Savings")
   - description: CONCRETE example with real numbers (e.g., "Fly out Tuesday morning (6am-9am) return Wednesday evening instead of Friday-Sunday. Example: NYC-Paris drops from $850 to $520 on Tuesdays in May.")
   - savings_estimate: specific percentage or dollar amount (e.g., "Save $200-400 per ticket", "30-50% less than weekend travel")
   - when_to_book: specific booking windows (e.g., "Book 8-12 weeks out for Europe summer", "Tuesday 3pm ET for domestic fare drops", "21 days before departure for international")

3. holiday_advice: If dates overlap expensive periods (Christmas: Dec 20-Jan 2, New Year: Dec 28-Jan 3, Thanksgiving: Wed-Sun around 4th Thu Nov, Spring Break: Mar 8-22, Easter week, Labor Day weekend, July 4 week), warn with specifics:
   - period: exact dates (e.g., "December 20-27, 2026")
   - advice: specific impact (e.g., "Expect 200-300% price increases; award seats often 2x points; book 4-6 months ahead")
   - avoid_or_prefer: "avoid_these_dates" / "book_early_required" / "consider_shoulder_dates" with specific alternatives

4. practical_tips: 3-6 SPECIFIC practical items with real details:
   - transfer_timing: SPECIFIC transfer speeds (e.g., "Chase UR to United: instant (appears in 5-10 minutes)", "Amex MR to Delta: 24-72 hours average", "Capital One to Air France: 1-3 business days", "Citi TYP to Turkish: 48 hours", "Bilt to Hyatt: instant")
   - attraction_hours: SPECIFIC closing days for major attractions in their destination (e.g., "Paris: Louvre closed Tuesdays, Versailles closed Mondays", "Tokyo: teamLab Borderless closed 2nd/4th Tuesday", "NYC: MoMA closed Tuesdays")
   - banking: SPECIFIC cutoff times (e.g., "Chase: 5pm ET for same-day transfer to United", "Amex: 11pm ET same-day to Delta/Hilton", "Citi: 9pm ET for international partners")
   - Other relevant: visa timing (e.g., "ESTA approval typically instant but apply 72hrs before", "Japan eVisa: 3-5 business days"), lounge hours, currency exchange, SIM cards

Return ONLY valid JSON with keys: transfer_tips, sample_itineraries, holiday_advice, practical_tips. Each value is an array of objects with the specific fields above. BE SPECIFIC, not vague."""

    user_prompt = f"""Trip: **{origin}** → **{destination}**
- Other cities (in order): {cities_str}
- Dates: {dates_str}
- User's points programs: {programs_str}

Return JSON: {{ "transfer_tips": [...], "sample_itineraries": [...], "holiday_advice": [...], "practical_tips": [...] }}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        content = response.choices[0].message.content
        parsed = _json.loads(content)
        out = _empty_smart_tips()
        for key in out:
            val = parsed.get(key)
            if isinstance(val, list):
                out[key] = [x for x in val if isinstance(x, dict)][:8]
        return out
    except Exception as e:
        logging.getLogger(__name__).error(
            "Error getting itinerary smart tips for %s -> %s: %s", origin, destination, e, exc_info=True
        )
        return _empty_smart_tips()


def _empty_smart_tips() -> Dict[str, Any]:
    return {
        "transfer_tips": [],
        "sample_itineraries": [],
        "holiday_advice": [],
        "practical_tips": [],
    }


def _search_static_cities(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search static cities.json file first (no API calls, no tokens).
    Returns a list of city suggestions.
    """
    try:
        import json
        from pathlib import Path
        
        # Try to find cities.json
        project_root = Path(__file__).parent.parent.parent
        cities_file = project_root / "scripts" / "cities.json"
        
        if not cities_file.exists():
            return []
        
        with open(cities_file, "r", encoding="utf-8") as f:
            cities_data = json.load(f)
        
        query_lower = query.lower().strip()
        if not query_lower:
            return []
        
        results = []
        for city_entry in cities_data:
            if not isinstance(city_entry, dict):
                continue
            
            city_name = city_entry.get("city", "").lower()
            country = city_entry.get("country", "").lower()
            region = city_entry.get("region", "").lower()
            
            # Match if query appears in city name, country, or region
            if (query_lower in city_name or 
                query_lower in country or 
                query_lower in region or
                city_name.startswith(query_lower)):
                
                results.append({
                    "city_id": f"{city_entry.get('city', '')},{city_entry.get('country', '')}",
                    "name": city_entry.get("city", ""),
                    "country": city_entry.get("country", ""),
                    "region": city_entry.get("region", ""),
                    "airport_code": "",  # Static data doesn't have airport codes
                })
                
                if len(results) >= max_results:
                    break
        
        return results
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.warning(f"Error searching static cities: {str(e)}")
        return []


def search_cities_with_openai(query: str, max_results: int = 10, use_cache: bool = True) -> List[Dict[str, Any]]:
    """
    Search for cities using a hybrid approach to save tokens:
    1. First try static cities.json (no tokens)
    2. Then try city_service (Amadeus/fallback, no tokens)
    3. Only use OpenAI if needed (for typos, unusual queries, or insufficient results)
    
    Returns a list of city suggestions with airport codes when available.
    """
    from ..utils.cache_layer import get_json, set_json
    
    # Step 1: Try static cities first (no tokens, instant)
    static_results = _search_static_cities(query, max_results)
    if len(static_results) >= max_results:
        return static_results
    
    # Step 2: Try city_service (Amadeus or fallback, no tokens)
    try:
        from ..services import city_service
        service_results = city_service.search_cities_for_autocomplete(query, max_results=max_results)
        
        # Merge with static results, avoiding duplicates
        seen_ids = {r["city_id"] for r in static_results}
        for result in service_results:
            if result.get("city_id") not in seen_ids:
                static_results.append({
                    "city_id": result.get("city_id", ""),
                    "name": result.get("name", ""),
                    "country": result.get("country", ""),
                    "region": result.get("region", ""),
                    "airport_code": "",  # city_service doesn't return airport_code in this format
                })
                seen_ids.add(result.get("city_id", ""))
                if len(static_results) >= max_results:
                    break
        
        # If we have enough results, return early (saves tokens!)
        if len(static_results) >= max_results:
            return static_results[:max_results]
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.warning(f"Error in city_service search: {str(e)}")
    
    # Step 3: Only use OpenAI if we don't have enough results
    # This handles typos, unusual queries, or when static data is insufficient
    
    # Check cache first (saves tokens for repeated queries)
    cache_key = f"city_search:{query.lower().strip()}:{max_results}"
    if use_cache:
        cached = get_json(cache_key)
        if cached is not None:
            return cached
    
    if OpenAI is None:
        # If OpenAI not available, return what we have so far
        logger = logging.getLogger(__name__)
        logger.warning("OpenAI not available, returning partial results")
        return static_results[:max_results]
    
    load_dotenv()
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))
    
    system_prompt = """You are a travel assistant that helps users find cities and airports around the world.
    
Your task is to suggest cities that match the user's query. The query might be:
- A city name (e.g., "Paris", "New York")
- A partial city name (e.g., "Par", "NY")
- A typo or variation (e.g., "Parris", "NYC")
- An airport code (e.g., "JFK", "CDG")
- A country name (e.g., "France", "Japan")

For each city, provide:
- The official city name
- The country name
- The primary airport code (IATA code) if the city has commercial air service (e.g., JFK, CDG, LHR). For small towns, villages, or places without commercial airports, omit airport_code or leave it empty—they are still valid destinations reachable by bus or car.
- The region/continent (e.g., Europe, Asia, North America)

Return results as a JSON object with a "cities" key containing an array of city objects. Prioritize:
1. Exact matches
2. Popular tourist destinations
3. Major cities with airports
4. Small towns and any populated place that matches (even without an airport)
5. Cities that sound similar to the query"""

    user_prompt = f"""Find up to {max_results} cities that match the query: "{query}"

Return a JSON object with a "cities" key containing an array with this structure:
{{
  "cities": [
    {{
      "city": "City Name",
      "country": "Country Name",
      "airport_code": "IATA_CODE",
      "region": "Region/Continent"
    }}
  ]
}}

Include airport codes for major cities. If the query is an airport code, return the city that airport serves."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.3,  # Lower temperature for more consistent results
        )
        
        import json
        content = response.choices[0].message.content
        parsed_data = json.loads(content)
        
        # Extract cities array from the JSON object
        cities_list = parsed_data.get("cities", [])
        if not isinstance(cities_list, list):
            cities_list = []
        
        # Convert to the format expected by the frontend
        results = []
        for city_data in cities_list:
            city_name = city_data.get("city", "")
            country = city_data.get("country", "")
            airport_code = city_data.get("airport_code", "")
            region = city_data.get("region", "")
            
            # Format city name with airport code if available
            display_name = city_name
            if airport_code:
                display_name = f"{city_name} ({airport_code})"
            
            results.append({
                "city_id": f"{city_name},{country}",
                "name": city_name,
                "country": country,
                "region": region,
                "airport_code": airport_code,
            })
        
        results = results[:max_results]
        
        # Merge OpenAI results with static results, avoiding duplicates
        seen_ids = {r["city_id"] for r in static_results}
        for result in results:
            if result.get("city_id") not in seen_ids:
                static_results.append(result)
                if len(static_results) >= max_results:
                    break
        
        final_results = static_results[:max_results]
        
        # Cache the OpenAI results for 24 hours (saves tokens on repeated queries)
        if use_cache:
            set_json(cache_key, final_results, ttl=86400)  # 24 hours
        
        return final_results
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.error(f"Error searching cities with OpenAI: {str(e)}")
        # Return static results even if OpenAI fails
        return static_results if static_results else []


def extract_trip_info_with_openai(text: str) -> ExtractedTripInfo:
    """
    Extract trip information from natural language using OpenAI.
    Uses structured output to ensure accurate extraction and avoid extracting months as cities.
    """
    if OpenAI is None:
        raise ImportError("openai package is not installed. Install it with: pip install openai")
    load_dotenv()
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))
    
    system_prompt = """You are a travel information extraction assistant. Extract trip details from user messages.

CRITICAL RULES:
1. DO NOT extract month names (January, February, March, April, May, June, July, August, September, October, November, December) as cities
2. DO NOT extract day names (Monday, Tuesday, etc.) as cities
3. Only extract actual city/location names (e.g., Paris, London, Tokyo, New York)
4. Extract dates in ISO format (YYYY-MM-DD)
5. Extract budget amounts as integers (remove currency symbols and commas)
6. Extract credit card programs and points accurately
7. If a date range is mentioned (e.g., "in March" or "March 15-22"), extract startDate and endDate
8. If only a duration is mentioned (e.g., "7 days"), extract duration
9. If user says dates are flexible, set isFlexible to true

Return a structured JSON object with the extracted information."""

    user_prompt = f"""Extract trip information from the following message:

"{text}"

Extract:
- cities: List of city/location names (NOT months or days)
- startDestination: Starting city if mentioned (e.g., "from Paris to London")
- endDestination: Ending city if mentioned
- startDate: Start date in ISO format (YYYY-MM-DD) if mentioned
- endDate: End date in ISO format (YYYY-MM-DD) if mentioned
- duration: Number of days if mentioned (e.g., "7 days" = 7)
- isFlexible: true if user mentions flexible dates
- minBudget: Minimum budget amount as integer
- maxBudget: Maximum budget amount as integer
- creditCards: List of objects with "program" (string) and "points" (integer)
- flightClass: "basic_economy", "economy", "premium", "business", or "first"
- hotelClass: "3", "4", or "5" for star rating

Return only valid information. Leave fields null/empty if not mentioned."""

    try:
        # Use JSON mode for structured output
        response = client.chat.completions.create(
            model="gpt-4o-mini",  # Using a more reasonable model
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt + "\n\nReturn the response as a valid JSON object matching the ExtractedTripInfo structure."}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,  # Low temperature for more consistent extraction
        )
        
        import json
        content = response.choices[0].message.content
        parsed_data = json.loads(content)
        
        # Convert to ExtractedTripInfo model
        extracted = ExtractedTripInfo(**parsed_data)
        return extracted
    except Exception as e:
        # Fallback: return empty structure on error
        logger = logging.getLogger(__name__)
        logger.error(f"Error extracting trip info with OpenAI: {str(e)}")
        return ExtractedTripInfo()


def _parse_card_benefits_response(parsed: dict) -> Dict[str, Any]:
    airlines = parsed.get("free_bag_airlines")
    if not isinstance(airlines, list):
        airlines = []
    out = []
    for a in airlines:
        s = str(a).strip().upper()
        if len(s) >= 2:
            out.append(s[:2])
    return {
        "free_bag_airlines": out,
        "applies_to_reservation": bool(parsed.get("applies_to_reservation", False)),
    }


def extract_card_benefits_from_snippets(
    card_product: str, snippets: List[Dict[str, str]]
) -> Optional[Dict[str, Any]]:
    """
    Use OpenAI to extract structured card benefits from web search snippets.
    Returns {"free_bag_airlines": ["DL",...], "applies_to_reservation": bool} or None.
    Prefer this over get_card_benefits_openai when you have fresh SerpAPI snippets for up-to-date benefits.
    """
    if OpenAI is None or not snippets:
        return None
    load_dotenv()
    key = os.getenv("OPENAI_ADMIN_KEY")
    if not key:
        return None
    client = OpenAI(api_key=key)

    block = "\n\n".join(
        f"[{i+1}] {s.get('title', '')}\n{s.get('snippet', '')}" for i, s in enumerate(snippets[:8])
    )

    system_prompt = """You are an expert on US travel credit card benefits. You are given a card name and web search snippets about that card. Extract ONLY information explicitly stated:

1. free_bag_airlines: array of IATA 2-letter codes for airlines where the snippets state this card gives a free first or checked bag (e.g. DL=Delta, UA=United, AA=American, WN=Southwest, B6=JetBlue, AS=Alaska, NK=Spirit, F9=Frontier, HA=Hawaiian). If the snippets do NOT clearly state free bags on a specific airline, use [].
2. applies_to_reservation: true only if the snippets explicitly say the free bag applies to everyone on the reservation / all travelers on the same booking when the cardholder pays; false otherwise.

Be conservative: only include an airline if a snippet clearly states this card grants a free checked bag on that airline. Do not infer from similar cards. Ignore lounge access, priority boarding, and other perks. Return valid JSON only."""

    user_prompt = f"""Card: "{card_product}"

Search snippets:
{block}

Return JSON: {{ "free_bag_airlines": ["XX", ...], "applies_to_reservation": true or false }}"""

    try:
        import json

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
        )
        content = response.choices[0].message.content
        parsed = json.loads(content)
        return _parse_card_benefits_response(parsed)
    except Exception as e:
        logging.getLogger(__name__).debug(
            "extract_card_benefits_from_snippets failed for %s: %s", card_product, e
        )
        return None


def get_card_benefits_openai(card_product: str) -> Optional[Dict[str, Any]]:
    """
    Use OpenAI to infer travel benefits for a credit card from model knowledge.
    Returns {"free_bag_airlines": ["DL","AA",...], "applies_to_reservation": bool} or None.
    Prefer extract_card_benefits_from_snippets with SerpAPI results for up-to-date benefits;
    use this as fallback when SerpAPI is unavailable or returns no snippets.
    """
    if OpenAI is None:
        return None
    load_dotenv()
    if not os.getenv("OPENAI_ADMIN_KEY"):
        return None
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))

    system_prompt = """You are an expert on US travel credit card benefits. Given a card name, return:
1. free_bag_airlines: array of IATA 2-letter codes for airlines where this card gives a free first checked bag (e.g. ["DL"] for Delta, ["UA"] for United, ["AA"] for American). If the card does NOT give free bags on any specific airline, use [].
2. applies_to_reservation: true if the free bag benefit applies to everyone on the same reservation when the cardholder pays; false if only the cardholder. Most US co‑branded airline cards (Delta Gold, United Explorer, etc.) apply to the whole reservation.

Only include airlines where the card explicitly grants a free checked bag benefit. Do not include lounge access, priority boarding, or other perks in free_bag_airlines. Return only valid JSON."""

    user_prompt = f"""Card: "{card_product}"

Return JSON: {{ "free_bag_airlines": ["XX", ...], "applies_to_reservation": true or false }}"""

    try:
        import json

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        content = response.choices[0].message.content
        parsed = json.loads(content)
        return _parse_card_benefits_response(parsed)
    except Exception as e:
        logging.getLogger(__name__).debug("get_card_benefits_openai failed for %s: %s", card_product, e)
        return None
