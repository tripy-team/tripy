import base64
import logging
from dotenv import load_dotenv
import os
import boto3
import httpx
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
    client = OpenAI(
        api_key=os.getenv("OPENAI_ADMIN_KEY"),
        timeout=httpx.Timeout(15.0, connect=5.0),
        max_retries=0
    )
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
    client = OpenAI(
        api_key=os.getenv("OPENAI_ADMIN_KEY"),
        timeout=httpx.Timeout(10.0, connect=5.0),
        max_retries=0
    )
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
    client = OpenAI(
        api_key=os.getenv("OPENAI_ADMIN_KEY"),
        timeout=httpx.Timeout(30.0, connect=5.0),  # Image generation may take longer
        max_retries=0
    )
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
    # Add timeout to prevent 504 errors - OpenAI calls should complete within 10 seconds
    client = OpenAI(
        api_key=os.getenv("OPENAI_ADMIN_KEY"),
        timeout=httpx.Timeout(10.0, connect=5.0),  # 10s total, 5s connect
        max_retries=0  # Don't retry on timeout to fail fast
    )
    
    system_prompt = """You are a travel assistant that finds commercial airports for cities or airport codes.

Your task is to find ALL major commercial airports based on the user's query, which could be:
1. A city name (e.g., "New York", "Paris", "Tokyo")
2. A city nickname/abbreviation (e.g., "NYC", "LA", "SF")  
3. An airport code (e.g., "JFK", "CDG", "LHR")
4. A partial city name (e.g., "San Fr" for San Francisco)

Examples:
- "New York" or "NYC" → JFK, LGA, EWR
- "JFK" → JFK (John F. Kennedy International Airport)
- "London" → LHR, LGW, STN, LTN, LCY
- "Paris" or "CDG" → CDG, ORY
- "Los Angeles" or "LA" or "LAX" → LAX, BUR, SNA, LGB, ONT
- "San Francisco" or "SF" or "SFO" → SFO, OAK, SJC

IMPORTANT:
- Only return COMMERCIAL airports with scheduled passenger service
- For city queries: include ALL major airports serving the city/metro area
- For airport code queries: return that specific airport PLUS other airports in the same metro area
- Return airports as a JSON array with IATA codes, names, cities, countries
- Prioritize exact matches (if query is "JFK", put JFK first)"""

    user_prompt = f"""Find all commercial airports for: "{city_query}"

This could be a city name, city nickname (NYC, LA, SF), or an airport code (JFK, LAX).

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

Instructions:
- If the query is an airport code (e.g., "JFK"), return that airport FIRST, then other airports in the same metro area
- If the query is a city name, return ALL major commercial airports for that city/metro area
- Return up to {max_results} airports
- Only include commercial airports with scheduled service"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,  # Very low temperature for highly consistent results
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
    # Add timeout to prevent 504 errors - OpenAI calls should complete within 10 seconds
    client = OpenAI(
        api_key=os.getenv("OPENAI_ADMIN_KEY"),
        timeout=httpx.Timeout(10.0, connect=5.0),  # 10s total, 5s connect
        max_retries=0  # Don't retry on timeout to fail fast
    )

    commercial_set = None
    try:
        from .airport_filter import load_commercial_iata_set_from_web, is_commercial_airport
        commercial_set = load_commercial_iata_set_from_web()
    except Exception as e:
        logging.getLogger(__name__).warning(f"Could not load commercial airport set for search_airports_with_openai: {e}")
        commercial_set = set()
    
    system_prompt = (
        "You are a travel assistant that helps users find airports based on any type of query. "
        "Your task is to suggest airports that match the user's query. The query might be: "
        "An IATA airport code (e.g., JFK, CDG, LHR, SFO), "
        "a city name (e.g., New York, Paris, London, San Francisco), "
        "a city nickname (e.g., NYC, LA, SF, Chi), "
        "an airport name (e.g., John F. Kennedy, Charles de Gaulle, Heathrow), "
        "a partial match (e.g., JF, San Fr, Lond), "
        "or a typo or variation (e.g., Parris, Londun). "
        "For each airport, provide: The IATA airport code (3 letters, e.g., JFK, CDG, LHR) - REQUIRED, "
        "the full airport name (e.g., John F. Kennedy International Airport), "
        "the city name where the airport is located, the country name, "
        "and the region/continent (e.g., Europe, Asia, North America). "
        "Return results as a JSON array of airport objects. Prioritize and be SENSITIVE to: "
        "1. Exact IATA code matches (if query is JFK, prioritize JFK), "
        "2. City name matches (if query is Paris or CDG, return Paris airports), "
        "3. Partial matches (if query is San Fr, return San Francisco airports), "
        "4. Airport name matches, 5. Major international airports for the city/region. "
        "Be FLEXIBLE with matching - accept city nicknames, partial names, and typos."
    )

    user_prompt = (
        f"Find up to {max_results} airports that match the query: {query}. "
        f"The query could be: an airport code (e.g., JFK returns JFK), "
        f"a city name (e.g., New York returns JFK, LGA, EWR), "
        f"a city nickname (e.g., NYC returns New York airports), "
        f"a partial match (e.g., San Fr returns San Francisco airports), "
        f"or an airport name (e.g., Kennedy returns JFK). "
        f"Return a JSON array with this structure: "
        f'[{{"iata_code": "JFK", "airport_name": "John F. Kennedy International Airport", '
        f'"city": "New York", "country": "United States", "region": "North America"}}]. '
        f"CRITICAL RULES: Always include the IATA code (3-letter airport code) - REQUIRED. "
        f"Be SENSITIVE to the query type: If query matches an IATA code, prioritize that airport first; "
        f"if query is a city name or nickname, return ALL major airports for that city; "
        f"if query is partial, match cities/airports that start with that text. "
        f"Include both the airport name and the city it serves. "
        f"Order results by relevance (exact matches first, then close matches)."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.1,  # Very low temperature for highly consistent and accurate results
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
    # Add timeout to prevent 504 errors - OpenAI calls should complete within 10 seconds
    client = OpenAI(
        api_key=os.getenv("OPENAI_ADMIN_KEY"),
        timeout=httpx.Timeout(10.0, connect=5.0),  # 10s total, 5s connect
        max_retries=0  # Don't retry on timeout to fail fast
    )
    
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
    client = OpenAI(
        api_key=os.getenv("OPENAI_ADMIN_KEY"),
        timeout=httpx.Timeout(10.0, connect=5.0),
        max_retries=0
    )
    
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
    client = OpenAI(
        api_key=key,
        timeout=httpx.Timeout(10.0, connect=5.0),
        max_retries=0
    )

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
    client = OpenAI(
        api_key=os.getenv("OPENAI_ADMIN_KEY"),
        timeout=httpx.Timeout(10.0, connect=5.0),
        max_retries=0
    )

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
