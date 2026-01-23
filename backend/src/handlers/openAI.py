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
    """
    if OpenAI is None:
        raise ImportError("openai package is not installed. Install it with: pip install openai")
    load_dotenv()
    client = OpenAI(api_key=os.getenv("OPENAI_ADMIN_KEY"))
    
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
- The primary airport code (IATA code) if available (e.g., JFK, CDG, LHR)
- The region/continent (e.g., Europe, Asia, North America)

Return results as a JSON object with a "cities" key containing an array of city objects. Prioritize:
1. Exact matches
2. Popular tourist destinations
3. Major cities with airports
4. Cities that sound similar to the query"""

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
