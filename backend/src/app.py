import boto3
import os
from dotenv import load_dotenv

# Load environment variables from .env file early
load_dotenv()

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

# Import services
from services import (
    trip_service,
    destination_service,
    points_service,
    itinerary_service,
    route_service,
    user_service,
    city_service,
)
from utils.analytics import (
    track_user_login,
    track_trip_created,
    track_destination_added,
    track_itinerary_generated,
)


ALLOWED_ORIGINS = [
    "https://testing.d2p22adloz2lev.amplifyapp.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request models
class CreateTripRequest(BaseModel):
    title: str
    start_date: str
    end_date: str
    user_id: Optional[str] = "default_user"  # For MVP, use default


class TripIdRequest(BaseModel):
    trip_id: str


class AddDestinationRequest(BaseModel):
    trip_id: str
    name: str
    must_include: bool = False
    excluded: bool = False
    user_id: Optional[str] = "default_user"


class UpsertPointsRequest(BaseModel):
    trip_id: str
    program: str
    balance: int
    user_id: Optional[str] = "default_user"


class GenerateItineraryRequest(BaseModel):
    trip_id: str


class LoginRequest(BaseModel):
    email: str
    user_id: Optional[str] = None  # If not provided, will use email as user_id for MVP


class CitySearchRequest(BaseModel):
    query: str
    max_results: Optional[int] = 10


@app.get("/healthz")
def health():
    return {"ok": True}


@app.post("/ingest")
async def ingest(req: Request):
    data = await req.json()
    print("payload:", data)
    return data


# Auth endpoints
@app.post("/auth/login")
async def login(request: LoginRequest):
    """Login endpoint - creates or updates user record"""
    try:
        # For MVP, use email as user_id if not provided
        user_id = request.user_id or request.email

        # Ensure user exists in database
        user = user_service.ensure_user_exists(user_id, request.email)

        # Track login event for analytics
        track_user_login(user_id, request.email)

        return {
            "user_id": user_id,
            "email": request.email,
            "user": user,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Trip endpoints
@app.post("/trips")
async def create_trip(request: CreateTripRequest):
    """Create a new trip"""
    try:
        trip = trip_service.create_trip(
            request.user_id, request.title, request.start_date, request.end_date
        )
        # Track trip creation for analytics
        track_trip_created(
            request.user_id,
            trip["tripId"],
            request.title,
            request.start_date,
            request.end_date,
        )
        return trip
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/get")
async def get_trip(request: TripIdRequest):
    """Get trip by ID"""
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        return trip
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/invite")
async def get_invite_code(request: TripIdRequest):
    """Get invite code for a trip"""
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        return {"inviteCode": trip.get("inviteCode")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Destination endpoints
@app.post("/destinations/add")
async def add_destination(request: AddDestinationRequest):
    """Add a destination to a trip"""
    try:
        destination = destination_service.add_destination(
            request.trip_id,
            request.user_id,
            request.name,
            request.must_include,
            request.excluded,
        )
        # Track destination addition for analytics
        track_destination_added(request.user_id, request.trip_id, request.name)
        return destination
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/destinations/list")
async def list_destinations(request: TripIdRequest):
    """List all destinations for a trip"""
    try:
        destinations = destination_service.list_destinations(request.trip_id)
        scores = destination_service.scores(request.trip_id)
        return {"destinations": destinations, "scores": scores.get("scores", {})}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Points endpoints
@app.post("/points/upsert")
async def upsert_points(request: UpsertPointsRequest):
    """Add or update points for a user's program in a trip"""
    try:
        points = points_service.upsert_points(
            request.trip_id, request.user_id, request.program, request.balance
        )
        return points
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/points/summary")
async def get_points_summary(request: TripIdRequest):
    """Get points summary for a trip"""
    try:
        summary = points_service.trip_points_summary(request.trip_id)
        return summary
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Itinerary endpoints
@app.post("/itinerary/generate")
async def generate_itinerary(request: GenerateItineraryRequest):
    """Generate itineraries for a trip"""
    try:
        # Get trip to get user_id
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        user_id = trip.get("createdBy", "default_user")

        # Get destinations
        destinations = destination_service.list_destinations(request.trip_id)
        routes = route_service.generate_routes(destinations)
        saved = itinerary_service.save_itinerary(
            request.trip_id, routes[0] if routes else []
        )

        # Track itinerary generation for analytics
        track_itinerary_generated(user_id, request.trip_id, len(routes))

        return {"routes": routes, "saved": saved}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/itinerary/get")
async def get_itinerary(request: TripIdRequest):
    """Get itinerary for a trip"""
    try:
        items = itinerary_service.get_itinerary(request.trip_id)
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# City search endpoints
@app.post("/cities/search")
async def search_cities(request: CitySearchRequest):
    """Search for cities/airports using Amadeus API"""
    try:
        results = city_service.search_cities(request.query, request.max_results or 10)
        return {"cities": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/cities/search")
async def search_cities_get(query: str, max_results: Optional[int] = 10):
    """Search for cities/airports using Amadeus API (GET endpoint)"""
    try:
        results = city_service.search_cities(query, max_results or 10)
        return {"cities": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def start():
    # Environment variables are already loaded at module level
    # boto3 will automatically use AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
    # from environment variables if they are set
    pass


# a lot of lambdas
