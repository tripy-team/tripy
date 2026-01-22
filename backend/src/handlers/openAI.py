import base64
import logging
from dotenv import load_dotenv
import os
import boto3
from openai import OpenAI
from pydantic import BaseModel
from enum import Enum
from datetime import date
from typing import Optional, List
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
