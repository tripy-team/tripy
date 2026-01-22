import base64
import logging
from dotenv import load_dotenv
import os
import boto3
from openai import OpenAI
from pydantic import BaseModel
from enum import Enum
from datetime import date
from typing import Optional, List, Dict, Any
from backend.bin.flights import create_flight_filters


class Suggestions(BaseModel):
    country: str
    city: str
    places = [(city, country)]


class Seasons(Enum):
    WINTER = "winter"
    SPRING = "spring"
    SUMMER = "summer"
    FALL = "fall"


def ai_flight_suggestions():
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


def search_airports_with_openai(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search for airports using OpenAI. This can handle airport codes, airport names, city names, and variations.
    Returns a list of airport suggestions with IATA codes, names, and city information.
    """
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


def search_cities_with_openai(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """
    Search for cities using OpenAI. This can handle typos, partial names, and variations.
    Returns a list of city suggestions with airport codes when available.
    """
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

Return results as a JSON array of city objects. Prioritize:
1. Exact matches
2. Popular tourist destinations
3. Major cities with airports
4. Cities that sound similar to the query"""

    user_prompt = f"""Find up to {max_results} cities that match the query: "{query}"

Return a JSON array with this structure:
[
  {{
    "city": "City Name",
    "country": "Country Name",
    "airport_code": "IATA_CODE",
    "region": "Region/Continent"
  }}
]

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
        
        # Handle both array and object with cities key
        cities_list = parsed_data.get("cities", []) if isinstance(parsed_data, dict) else parsed_data
        
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
        
        return results[:max_results]
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.error(f"Error searching cities with OpenAI: {str(e)}")
        # Return empty list on error
        return []


def extract_trip_info_with_openai(text: str) -> ExtractedTripInfo:
    """
    Extract trip information from natural language using OpenAI.
    Uses structured output to ensure accurate extraction and avoid extracting months as cities.
    """
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
