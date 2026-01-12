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
    auth_service,
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
    password: str


class SignUpRequest(BaseModel):
    email: str
    password: str
    firstName: Optional[str] = None
    lastName: Optional[str] = None


class ConfirmSignUpRequest(BaseModel):
    email: str
    confirmation_code: str


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
    """Login endpoint - authenticates with Cognito and creates/updates user record in DB"""
    try:
        # Authenticate with Cognito
        auth_result = auth_service.authenticate_user(request.email, request.password)

        # Get user info from Cognito token
        cognito_user = auth_service.get_user_from_token(auth_result["AccessToken"])
        user_id = cognito_user["sub"]  # Use Cognito sub as user_id

        # Ensure user exists in database (create if not exists, update if exists)
        db_user = user_service.ensure_user_exists(user_id, request.email)

        # Update user record with Cognito info if needed
        if not db_user.get("email") or db_user.get("email") != request.email:
            user_service.update_profile(user_id, {"email": request.email})

        # Track login event for analytics
        track_user_login(user_id, request.email)

        return {
            "user_id": user_id,
            "email": request.email,
            "user": db_user,
            "tokens": {
                "access_token": auth_result["AccessToken"],
                "id_token": auth_result["IdToken"],
                "refresh_token": auth_result["RefreshToken"],
                "expires_in": auth_result["ExpiresIn"],
            },
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))


@app.post("/auth/signup")
async def signup(request: SignUpRequest):
    """Sign up endpoint - creates user in Cognito and database"""
    try:
        # Sign up user in Cognito
        signup_result = auth_service.sign_up_user(
            request.email,
            request.password,
            attributes=(
                {
                    "given_name": request.firstName or "",
                    "family_name": request.lastName or "",
                }
                if request.firstName or request.lastName
                else None
            ),
        )

        user_id = signup_result["UserSub"]

        # Create user record in database
        user = user_service.ensure_user_exists(
            user_id,
            request.email,
        )

        # Update user name if provided
        if request.firstName or request.lastName:
            name = f"{request.firstName or ''} {request.lastName or ''}".strip()
            user_service.update_profile(user_id, {"name": name})
            user["name"] = name

        return {
            "user_id": user_id,
            "email": request.email,
            "user": user,
            "confirmation_required": not signup_result["UserConfirmed"],
            "code_delivery_details": signup_result.get("CodeDeliveryDetails"),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/auth/confirm")
async def confirm_signup(request: ConfirmSignUpRequest):
    """Confirm sign up endpoint - confirms user email with verification code"""
    try:
        auth_service.confirm_sign_up(request.email, request.confirmation_code)
        return {"message": "User confirmed successfully"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


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
