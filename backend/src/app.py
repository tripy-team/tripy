import os
import sys
from pathlib import Path

# Ensure backend root is on sys.path so "from src.xxx" and "src.utils.award_programs" resolve.
# __file__ = .../backend/src/app.py -> parent.parent = .../backend
_backend = Path(__file__).resolve().parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

import logging
from datetime import datetime
from json import JSONDecodeError

import httpx
from dotenv import load_dotenv

# Load environment variables from .env file early
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, Request, HTTPException, Depends, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator, EmailStr
from typing import Optional, List, Dict, Any

# Import services
from .services import (
    trip_service,
    destination_service,
    points_service,
    itinerary_service,
    route_service,
    user_service,
    city_service,
    auth_service,
    trip_member_service,
    image_service,
)
from .utils.analytics import (
    track_user_login,
    track_trip_created,
    track_destination_added,
    track_itinerary_generated,
)
from .utils.jwt_auth import get_current_user_id
from .utils.loyalty_programs import validate_program
from .handlers.openAI import (
    extract_trip_info_with_openai,
    search_cities_with_openai,
    search_airports_with_openai,
)

# Get CORS origins from environment variable
CORS_ORIGINS_ENV = os.environ.get("CORS_ORIGINS", "")
if CORS_ORIGINS_ENV:
    # If CORS_ORIGINS is set, use it (split by comma)
    ALLOWED_ORIGINS = [
        origin.strip() for origin in CORS_ORIGINS_ENV.split(",") if origin.strip()
    ]
else:
    # Fallback: Allow all origins for development
    # In production, ALWAYS set CORS_ORIGINS environment variable in App Runner
    # For security, restrict to specific domains in production
    ALLOWED_ORIGINS = ["*"]  # Allow all origins - set CORS_ORIGINS in production

app = FastAPI(title="Tripy API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Request models with validation
class CreateTripRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    start_date: str = Field(..., description="Start date in ISO format (YYYY-MM-DD)")
    end_date: str = Field(..., description="End date in ISO format (YYYY-MM-DD)")
    include_hotels: Optional[bool] = True  # Include hotel out-of-pocket in cost calculations
    max_budget: Optional[int] = Field(None, ge=0, description="Maximum budget in dollars for itinerary generation")
    duration_days: Optional[int] = Field(None, ge=1, le=365, description="Trip length in days when dates are flexible (start/end empty)")

    @validator("start_date", "end_date")
    def validate_date(cls, v):
        if not v or not str(v).strip():
            return v
        try:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
            return v
        except ValueError:
            raise ValueError("Date must be in ISO format (YYYY-MM-DD)")

    @validator("end_date")
    def validate_end_after_start(cls, v, values):
        start = values.get("start_date") or ""
        if not str(start).strip() or not str(v).strip():
            return v
        if "start_date" in values:
            try:
                start_dt = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
                if end_dt < start_dt:
                    raise ValueError("End date must be after start date")
            except ValueError:
                pass  # Date format validation will catch this
        return v


class CityAutocompleteResponse(BaseModel):
    city_id: str
    name: str
    region: Optional[str] = None
    country: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None


class NearbyAirportResponse(BaseModel):
    iata: str
    name: str
    lat: Optional[float] = None
    lng: Optional[float] = None
    distance_km: Optional[float] = None


class TripIdRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)


class AddDestinationRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1, max_length=200)
    must_include: bool = False
    excluded: bool = False


class UpsertPointsRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    program: str = Field(..., min_length=1, max_length=100)
    balance: int = Field(..., ge=0, description="Points balance must be non-negative")


class GenerateItineraryRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    default_home_airport: Optional[str] = None
    timezone: Optional[str] = None
    min_budget: Optional[int] = Field(None, ge=0)
    max_budget: Optional[int] = Field(None, ge=0)
    credit_cards: Optional[List[Dict[str, Any]]] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class SignUpRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    firstName: Optional[str] = Field(None, max_length=100)
    lastName: Optional[str] = Field(None, max_length=100)


class ConfirmSignUpRequest(BaseModel):
    email: EmailStr
    confirmation_code: str = Field(..., min_length=6, max_length=6)


class RefreshTokenRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ConfirmForgotPasswordRequest(BaseModel):
    email: EmailStr
    confirmation_code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=128)


class CitySearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=100)
    max_results: Optional[int] = Field(10, ge=1, le=50)


class JoinTripRequest(BaseModel):
    invite_code: str = Field(..., min_length=1)


class ExtractTripInfoRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Natural language text describing the trip")


class OptimizeOutOfPocketRequest(BaseModel):
    origin: str = Field(..., min_length=1, description="Origin airport IATA (e.g. JFK)")
    destination: str = Field(..., min_length=1, description="Destination airport IATA (e.g. CDG)")
    outbound_date: str = Field(..., description="Outbound date YYYY-MM-DD")
    return_date: str = Field(..., description="Return date YYYY-MM-DD")
    programs: Optional[List[str]] = Field(None, description="Award programs e.g. UA, DL, AA")
    cabins: Optional[List[str]] = Field(None, description="Cabins e.g. Economy, Business")
    pax: int = Field(1, ge=1, le=9, description="Number of passengers")
    commercial_only: bool = Field(False, description="If True, origin and destination must be commercial airports")


class HotelSearchRequest(BaseModel):
    destination: str = Field(..., min_length=1, max_length=200, description="City or location name")
    check_in: str = Field(..., description="Check-in date YYYY-MM-DD")
    check_out: str = Field(..., description="Check-out date YYYY-MM-DD")
    programs: Optional[List[str]] = Field(None, description="Hotel programs e.g. HH, IHG, MAR, HYATT")
    guests: int = Field(1, ge=1, le=10, description="Number of guests")
    hotel_class: Optional[str] = Field(None, description="Star rating filter e.g. 3, 4, 5")


class OptimizeOutOfPocketHotelsRequest(BaseModel):
    destination: str = Field(..., min_length=1, max_length=200, description="City or location name")
    check_in: str = Field(..., description="Check-in date YYYY-MM-DD")
    check_out: str = Field(..., description="Check-out date YYYY-MM-DD")
    programs: Optional[List[str]] = Field(None, description="Hotel programs e.g. HH, IHG, MAR, HYATT")
    guests: int = Field(1, ge=1, le=10, description="Number of guests")
    hotel_class: Optional[str] = Field(None, description="Star rating filter e.g. 3, 4, 5")


@app.get("/healthz")
def health():
    """Health check endpoint"""
    return {"status": "ok"}


@app.post("/ingest")
async def ingest(req: Request):
    """Ingest endpoint with proper JSON error handling"""
    try:
        data = await req.json()
        logger.info(f"Ingest payload received: {type(data)}")
        return data
    except JSONDecodeError as e:
        logger.error(f"Invalid JSON in ingest request: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid JSON in request body")
    except Exception as e:
        logger.error(f"Error processing ingest request: {str(e)}")
        raise HTTPException(status_code=500, detail="Error processing request")


@app.post("/extract-trip-info")
async def extract_trip_info(request: ExtractTripInfoRequest):
    """Extract trip information from natural language using OpenAI"""
    try:
        extracted = extract_trip_info_with_openai(request.text)
        # FastAPI automatically serializes Pydantic models to JSON
        # Use model_dump() for explicit conversion (Pydantic v2)
        try:
            return extracted.model_dump()
        except AttributeError:
            # Fallback for Pydantic v1 compatibility
            return extracted.dict()
    except Exception as e:
        logger.error(f"Error extracting trip info: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error extracting trip information: {str(e)}")


# Auth endpoints (no authentication required)
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
        logger.warning(f"Login validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
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
        logger.warning(f"Signup validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Signup error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/auth/confirm")
async def confirm_signup(request: ConfirmSignUpRequest):
    """Confirm sign up endpoint - confirms user email with verification code"""
    try:
        auth_service.confirm_sign_up(request.email, request.confirmation_code)
        return {"message": "User confirmed successfully"}
    except ValueError as e:
        logger.warning(f"Confirm signup validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Confirm signup error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/auth/refresh")
async def refresh_token(request: RefreshTokenRequest):
    """Refresh access and ID tokens using refresh token"""
    try:
        auth_result = auth_service.refresh_tokens(request.refresh_token)
        return {
            "tokens": {
                "access_token": auth_result["AccessToken"],
                "id_token": auth_result["IdToken"],
                "expires_in": auth_result["ExpiresIn"],
            },
        }
    except ValueError as e:
        logger.warning(f"Token refresh validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Token refresh error: {str(e)}")
        raise HTTPException(status_code=401, detail=str(e))


@app.post("/auth/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    """Initiate password reset - sends verification code to user's email"""
    try:
        result = auth_service.forgot_password(request.email)
        return {
            "message": "If an account exists with this email, a password reset code has been sent.",
            "code_delivery_details": result.get("CodeDeliveryDetails"),
        }
    except ValueError as e:
        logger.warning(f"Forgot password validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Forgot password error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/auth/confirm-forgot-password")
async def confirm_forgot_password(request: ConfirmForgotPasswordRequest):
    """Confirm password reset with verification code"""
    try:
        auth_service.confirm_forgot_password(
            request.email, request.confirmation_code, request.new_password
        )
        return {"message": "Password reset successfully"}
    except ValueError as e:
        logger.warning(f"Confirm forgot password validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Confirm forgot password error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


# Trip endpoints (require authentication)
@app.post("/trips")
async def create_trip(
    request: CreateTripRequest, user_id: str = Depends(get_current_user_id)
):
    """Create a new trip"""
    try:
        trip = trip_service.create_trip(
            user_id,
            request.title,
            request.start_date,
            request.end_date,
            include_hotels=request.include_hotels,
            max_budget=request.max_budget,
            duration_days=request.duration_days,
        )
        # Track trip creation for analytics
        track_trip_created(
            user_id,
            trip["tripId"],
            request.title,
            request.start_date,
            request.end_date,
        )
        return trip
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating trip: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/get")
async def get_trip(request: TripIdRequest, user_id: str = Depends(get_current_user_id)):
    """Get trip by ID"""
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user has access to this trip
        # TODO: Add trip member check for group trips
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Enrich with destinations and member count for display (e.g. trip configuration summary)
        # Start/end are origin/return (like flight booking); only "visiting" destinations are shown.
        from .services.destination_service import list_destinations, get_display_destinations_for_trip
        from .services.trip_member_service import list_members

        destinations = list_destinations(request.trip_id)
        trip["destinations"], trip["firstDestination"] = get_display_destinations_for_trip(destinations or [])

        members = list_members(request.trip_id)
        trip["memberCount"] = len(members) if members else 1

        return trip
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting trip: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trips")
async def list_trips(user_id: str = Depends(get_current_user_id)):
    """List all trips for the current user"""
    try:
        trips = trip_service.list_trips_for_user(user_id)
        return {"trips": trips}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing trips: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/invite")
async def get_invite_code(
    request: TripIdRequest, user_id: str = Depends(get_current_user_id)
):
    """Get invite code for a trip"""
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user has access to this trip
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        invite_code = trip.get("inviteCode")
        if not invite_code:
            # Generate invite code if it doesn't exist (backward compatibility)
            invite_code = trip_service.regenerate_invite_code(request.trip_id, user_id)[
                "inviteCode"
            ]

        return {"inviteCode": invite_code}
    except HTTPException:
        raise
    except ValueError as e:
        logger.warning(f"Invite code validation error: {str(e)}")
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting invite code: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/invite/regenerate")
async def regenerate_invite_code_endpoint(
    request: TripIdRequest, user_id: str = Depends(get_current_user_id)
):
    """Regenerate invite code for a trip (admin only)"""
    try:
        result = trip_service.regenerate_invite_code(request.trip_id, user_id)
        return result
    except ValueError as e:
        logger.warning(f"Invite code regeneration error: {str(e)}")
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error regenerating invite code: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trips/by-invite/{invite_code}")
async def get_trip_by_invite(invite_code: str):
    """Get trip information by invite code (public endpoint for joining)"""
    try:
        trip = trip_service.get_trip_by_invite(invite_code)
        if not trip:
            raise HTTPException(status_code=404, detail="Invalid invite code")

        # Get member count and destinations for display
        # Start/end are origin/return (like flight booking); only "visiting" destinations are shown.
        from .services.destination_service import list_destinations, get_display_destinations_for_trip
        from .services.trip_member_service import list_members

        members = list_members(trip["tripId"])
        trip["memberCount"] = len(members) if members else 1

        destinations = list_destinations(trip["tripId"])
        trip["destinations"], trip["firstDestination"] = get_display_destinations_for_trip(destinations or [])

        return trip
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting trip by invite code: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/join")
async def join_trip(
    request: JoinTripRequest, user_id: str = Depends(get_current_user_id)
):
    """Join a trip using an invite code"""
    try:
        result = trip_member_service.join_trip(user_id, request.invite_code)
        if result.get("error"):
            raise HTTPException(status_code=404, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error joining trip: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/members")
async def list_trip_members(
    request: TripIdRequest, user_id: str = Depends(get_current_user_id)
):
    """List all members of a trip"""
    try:
        # Verify user has access to this trip
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Check if user is a member of the trip
        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member and trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        return {"members": members}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing trip members: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Destination endpoints (require authentication)
@app.post("/destinations/add")
async def add_destination(
    request: AddDestinationRequest, user_id: str = Depends(get_current_user_id)
):
    """Add a destination to a trip"""
    try:
        # Verify user has access to this trip
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        destination = destination_service.add_destination(
            request.trip_id,
            user_id,
            request.name,
            request.must_include,
            request.excluded,
        )

        # Trigger city image curation in the background for this destination.
        # This will return any existing curated URLs or a "coming soon" placeholder
        # and will kick off the background curation workflow if the city is new.
        try:
            # We don't care about the return value here, only that the side‑effect runs.
            image_service.get_city_image_urls(
                request.name,
                size="800",
                trigger_background=True,
            )
        except Exception as img_err:
            logger.warning(
                f"Failed to trigger image curation for destination '{request.name}': {img_err}"
            )
        # Track destination addition for analytics
        track_destination_added(user_id, request.trip_id, request.name)
        return destination
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding destination: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/destinations/list")
async def list_destinations(
    request: TripIdRequest, user_id: str = Depends(get_current_user_id)
):
    """List all destinations for a trip"""
    try:
        # Verify user has access to this trip
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        destinations = destination_service.list_destinations(request.trip_id)
        scores = destination_service.scores(request.trip_id)
        return {"destinations": destinations, "scores": scores.get("scores", {})}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing destinations: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Points endpoints (require authentication)
@app.post("/points/upsert")
async def upsert_points(
    request: UpsertPointsRequest, user_id: str = Depends(get_current_user_id)
):
    """Add or update points for a user's program in a trip"""
    try:
        # Verify user has access to this trip
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Validate program is in the enum
        validated_program = validate_program(request.program)
        if not validated_program:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid loyalty program: {request.program}. Please select from the supported programs list.",
            )

        points = points_service.upsert_points(
            request.trip_id, user_id, validated_program, request.balance
        )
        return points
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error upserting points: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/points/summary")
async def get_points_summary(
    request: TripIdRequest, user_id: str = Depends(get_current_user_id)
):
    """Get points summary for a trip"""
    try:
        # Verify user has access to this trip
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        summary = points_service.trip_points_summary(request.trip_id)
        return summary
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting points summary: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/points/valuations")
async def get_points_valuations(user_id: str = Depends(get_current_user_id)):
    """Get market-rate cents per point (TPG valuations) for all known programs."""
    try:
        get_valuations_fn = getattr(points_service, "get_valuations", None)
        vals = get_valuations_fn() if callable(get_valuations_fn) else {}
        return vals
    except Exception as e:
        logger.error(f"Error getting points valuations: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Itinerary endpoints (require authentication)
@app.post("/itinerary/generate")
async def generate_itinerary(
    request: GenerateItineraryRequest, user_id: str = Depends(get_current_user_id)
):
    """Generate optimized itineraries for a trip using points maximization. Falls back to simple generator (1-5 budget/points-aware routes) when optimization fails."""
    try:
        # Get trip to verify access
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user has access to this trip
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Generate optimized itinerary using points maximization
        result = await itinerary_service.generate_optimized_itinerary(request.trip_id)

        # Track itinerary generation for analytics
        if result.get("ai_suggested_routes"):
            route_count = len(result.get("suggestions", []))
        else:
            route_count = len(result.get("solution", {}).get("path", {}))
        track_itinerary_generated(user_id, request.trip_id, route_count)

        out = {
            "status": result.get("status", "Unknown"),
            "solution": result.get("solution", {}),
            "items": result.get("items", []),
        }
        if result.get("ai_suggested_routes"):
            out["ai_suggested_routes"] = True
            out["suggestions"] = result.get("suggestions", [])
        if result.get("out_of_pocket") is not None:
            out["out_of_pocket"] = result.get("out_of_pocket")
        if result.get("out_of_pocket_hotels") is not None:
            out["out_of_pocket_hotels"] = result.get("out_of_pocket_hotels")
        if result.get("relaxed_constraints"):
            out["relaxed_constraints"] = True
            out["relaxed_message"] = result.get("relaxed_message", "")
        return out
    except ValueError as e:
        # Fallback to simple itineraries (1-5 routes within budget/points) when optimization fails
        logger.warning(f"Optimization failed ({e}), falling back to simple itineraries")
        try:
            items = itinerary_service.generate_simple_itineraries(request.trip_id)
            track_itinerary_generated(user_id, request.trip_id, len(items))
            return {"status": "simple", "solution": {}, "items": items}
        except Exception as fallback_err:
            logger.error(f"Simple itinerary fallback failed: {fallback_err}")
            raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating itinerary: {str(e)}")
        # Fallback to simple itineraries on any error
        try:
            items = itinerary_service.generate_simple_itineraries(request.trip_id)
            track_itinerary_generated(user_id, request.trip_id, len(items))
            return {"status": "simple", "solution": {}, "items": items}
        except Exception as fallback_err:
            logger.error(f"Simple itinerary fallback failed: {fallback_err}")
            raise HTTPException(status_code=500, detail=str(e))


@app.post("/itinerary/get")
async def get_itinerary(
    request: TripIdRequest, user_id: str = Depends(get_current_user_id)
):
    """Get itinerary for a trip"""
    try:
        # Verify user has access to this trip
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        items = itinerary_service.get_itinerary(request.trip_id)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting itinerary: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Hotel search (AwardTool Hotel API; requires authentication)
@app.post("/hotels/search")
async def search_hotels_endpoint(
    request: HotelSearchRequest, user_id: str = Depends(get_current_user_id)
):
    """Search for award and cash hotel rates via AwardTool Hotel API"""
    try:
        from .handlers.hotels import search_hotels_async

        hotels = await search_hotels_async(
            destination=request.destination,
            check_in=request.check_in,
            check_out=request.check_out,
            programs=request.programs,
            guests=request.guests,
            hotel_class=request.hotel_class,
        )
        return {"hotels": hotels}
    except httpx.HTTPStatusError as e:
        logger.warning(f"Hotel search API error: {e.response.status_code} {e.response.text[:200]}")
        raise HTTPException(
            status_code=502,
            detail=f"Hotel search provider error: {e.response.status_code}. Check AWARDTOOL_API_KEY and AwardTool Hotel API availability.",
        )
    except Exception as e:
        logger.error(f"Error searching hotels: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/hotels/optimize-out-of-pocket")
async def optimize_out_of_pocket_hotels(
    body: OptimizeOutOfPocketHotelsRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Minimize hotel out-of-pocket: AwardTool (cash + points + surcharge) and SerpAPI Google Hotels (cash).
    Returns: { best_by_cash, best_by_points, best_overall, options, destination, check_in, check_out }
    """
    try:
        from .services.serp_api_functions import optimize_hotels_out_of_pocket

        return optimize_hotels_out_of_pocket(
            destination=body.destination,
            check_in=body.check_in,
            check_out=body.check_out,
            programs=body.programs,
            guests=body.guests,
            hotel_class=body.hotel_class,
        )
    except Exception as e:
        logger.error(f"optimize_out_of_pocket_hotels: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# City search endpoints (public, no authentication required)
@app.post("/cities/search")
async def search_cities(request: CitySearchRequest):
    """Search for cities/airports using Amadeus API"""
    try:
        logger.info(
            f"City search request - query: '{request.query}', max_results: {request.max_results or 10}"
        )
        results = city_service.search_cities(request.query, request.max_results or 10)
        logger.info(
            f"City search returned {len(results)} results for query '{request.query}'"
        )
        return {"cities": results}
    except Exception as e:
        logger.error(
            f"Error searching cities for query '{request.query}': {str(e)}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/cities/search")
async def search_cities_get(query: str, max_results: Optional[int] = 10):
    """Search for cities/airports using Amadeus API (GET endpoint)"""
    try:
        if not query or len(query) < 1:
            raise HTTPException(status_code=400, detail="Query parameter is required")
        if max_results and (max_results < 1 or max_results > 50):
            raise HTTPException(
                status_code=400, detail="max_results must be between 1 and 50"
            )

        logger.info(
            f"City search GET request - query: '{query}', max_results: {max_results or 10}"
        )
        results = city_service.search_cities(query, max_results or 10)
        logger.info(
            f"City search GET returned {len(results)} results for query '{query}'"
        )
        return {"cities": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching cities: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/locations/autocomplete")
async def locations_autocomplete(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=20),
):
    """
    Unified destination autocomplete: any city (with/without airport) plus airports.
    [{ city_id, name, region, country, airport_code, transport_modes }]
    transport_modes: ["flight","bus","car"] or ["bus","car"] for ground-only.
    """
    try:
        cities = search_cities_with_openai(q, max_results=limit)
        for c in cities:
            if "transport_modes" not in c:
                c["transport_modes"] = ["flight", "bus", "car"] if c.get("airport_code") else ["bus", "car"]
        return {"cities": cities}
    except Exception as e:
        logger.error(f"Error in locations_autocomplete for q='{q}': {e}", exc_info=True)
        # Fallback to city_service if OpenAI fails
        try:
            cities = city_service.search_cities_for_autocomplete(q, max_results=limit)
            for c in cities:
                if "transport_modes" not in c:
                    c["transport_modes"] = ["flight", "bus", "car"] if c.get("airport_code") else ["bus", "car"]
            return {"cities": cities}
        except Exception as fallback_error:
            logger.error(f"Fallback city search also failed: {fallback_error}", exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to search locations")


@app.get("/api/airports/autocomplete")
async def airports_autocomplete(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=20),
):
    """
    Return airport suggestions for autocomplete using CSV data:
    [{ airport_id, iata_code, airport_name, city, country, region, display_name }]
    """
    try:
        from .services.airport_service import search_airports
        
        logger.info(f"Airport autocomplete request: q='{q}', limit={limit}")
        # Use CSV-based airport search
        airports = search_airports(q, max_results=limit)
        logger.info(f"Returning {len(airports)} airports for query '{q}'")
        return {"airports": airports}
    except Exception as e:
        logger.error(f"Error in airports_autocomplete for q='{q}': {e}", exc_info=True)
        # Fallback to OpenAI if CSV search fails
        try:
            logger.warning(f"Falling back to OpenAI search for query '{q}'")
            airports = search_airports_with_openai(q, max_results=limit)
            return {"airports": airports}
        except Exception as fallback_error:
            logger.error(f"Fallback OpenAI search also failed: {fallback_error}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to search airports: {str(e)}")


@app.get("/api/destinations/autocomplete")
async def destinations_autocomplete(
    q: str = Query(..., min_length=1),
    gl: str = Query("us", description="Country code for SerpAPI"),
    hl: str = Query("en", description="Language code"),
    exclude_regions: bool = Query(False, description="Exclude region-level suggestions"),
    fuzzy_fallback: bool = Query(True, description="Use fuzzy search on CSV when SerpAPI returns nothing"),
    commercial_only: bool = Query(False, description="If True, only commercial airports (scheduled service)"),
    limit: int = Query(10, ge=1, le=20),
):
    """
    Destination autocomplete: SerpAPI google_flights_autocomplete, with optional fuzzy fallback over CSV.
    If commercial_only=True, filters to commercial airports only.
    Returns: { suggestions: [{ name, type, description, id, airports: [{ id, name, city, city_id, distance }] }] }
    """
    try:
        from .services.serp_api_functions import autocomplete_destinations
        from .services.airport_service import fuzzy_search_destinations

        suggestions = autocomplete_destinations(q, gl=gl, hl=hl, exclude_regions=exclude_regions, commercial_only=commercial_only)
        if not suggestions and fuzzy_fallback:
            suggestions = fuzzy_search_destinations(q, max_results=limit, commercial_only=commercial_only)
        return {"suggestions": (suggestions or [])[:limit]}
    except Exception as e:
        logger.error(f"destinations_autocomplete q='{q}': {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/itinerary/optimize-out-of-pocket")
async def optimize_out_of_pocket(body: OptimizeOutOfPocketRequest):
    """
    Round-trip itinerary optimized for lowest out-of-pocket: min(cash price, award surcharge).
    Uses SerpAPI Google Flights (cash) and AwardTool (points + surcharge).
    Returns: { best_by_cash, best_by_surcharge, best_overall, options, origin, destination, outbound_date, return_date }
    """
    try:
        from .services.serp_api_functions import optimize_itinerary_out_of_pocket

        result = optimize_itinerary_out_of_pocket(
            origin=body.origin,
            destination=body.destination,
            outbound_date=body.outbound_date,
            return_date=body.return_date,
            programs=body.programs,
            cabins=body.cabins,
            pax=body.pax,
            commercial_only=body.commercial_only,
        )
        return result
    except Exception as e:
        logger.error(f"optimize_out_of_pocket: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/locations/{city_id}/airports")
async def locations_airports(
    city_id: str,
    limit: int = Query(3, ge=1, le=10),
):
    """
    Return nearby airports for a city:
    [{ iata, name, lat, lng, distance_km }]
    """
    try:
        airports = city_service.get_nearby_airports(city_id, limit=limit)
        return {"airports": airports}
    except Exception as e:
        logger.error(
            f"Error in locations_airports for city_id='{city_id}': {e}", exc_info=True
        )
        raise HTTPException(status_code=500, detail="Failed to fetch nearby airports")


# Image endpoints (public, no authentication required for viewing)
class CityImageRequest(BaseModel):
    city: str = Field(..., min_length=1, max_length=200)


@app.get("/images/city/{city_name}")
async def get_city_images(
    city_name: str,
    size: Optional[str] = "800",
    background_tasks: BackgroundTasks = None,
):
    """
    Get curated image URLs for a city.

    If city doesn't exist:
    - Returns "coming soon" placeholder image
    - Triggers background task to curate images
    - Adds city to cities.json

    Returns 3-5 pre-selected images from S3/CloudFront, along with city metadata.
    """
    try:
        # Check if city exists first
        from src.repos import city_image_repo

        city_data = city_image_repo.get_city_images(city_name.lower().strip())
        city_exists = city_data is not None

        # Get images (will return coming soon if not exists)
        urls = image_service.get_city_image_urls(
            city_name, size or "800", trigger_background=True
        )

        if not urls:
            raise HTTPException(
                status_code=404, detail=f"No images found for city: {city_name}"
            )

        # Check if this is a "coming soon" placeholder
        is_coming_soon = any("coming_soon" in url.lower() for url in urls)

        response = {
            "city": city_name,
            "images": urls,
            "count": len(urls),
            "is_coming_soon": is_coming_soon,
            "status": "coming_soon" if is_coming_soon else "curated",
        }

        # Add metadata if available
        if city_data:
            if "country" in city_data:
                response["country"] = city_data["country"]
            if "region" in city_data:
                response["region"] = city_data["region"]

        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting city images: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/images/city/{city_name}/hero")
async def get_city_hero_image(
    city_name: str,
    size: Optional[str] = "800",
    background_tasks: BackgroundTasks = None,
):
    """
    Get the primary/hero image for a city.

    If city doesn't exist, returns "coming soon" placeholder and triggers background curation.
    """
    try:
        # Get images (will return coming soon if not exists)
        urls = image_service.get_city_image_urls(
            city_name, size or "800", trigger_background=True
        )
        url = urls[0] if urls else None

        if not url:
            raise HTTPException(
                status_code=404, detail=f"No hero image found for city: {city_name}"
            )

        is_coming_soon = "coming_soon" in url.lower()

        return {
            "city": city_name,
            "url": url,
            "size": size,
            "is_coming_soon": is_coming_soon,
            "status": "coming_soon" if is_coming_soon else "curated",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting city hero image: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/users/me")
async def get_user_profile(user_id: str = Depends(get_current_user_id)):
    """Get current user's profile"""
    try:
        user = user_service.ensure_user_exists(user_id)
        return user
    except Exception as e:
        logger.error(f"Error getting user profile: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/users/profile")
async def update_user_profile(
    request: UpdateProfileRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Update user profile"""
    try:
        updates = {}
        if request.name is not None:
            updates["name"] = request.name
        if request.default_home_airport is not None:
            updates["default_home_airport"] = request.default_home_airport
        if request.timezone is not None:
            updates["timezone"] = request.timezone
        if request.min_budget is not None:
            updates["min_budget"] = request.min_budget
        if request.max_budget is not None:
            updates["max_budget"] = request.max_budget
        if request.credit_cards is not None:
            # Validate all programs are in the enum
            validated_cards = []
            for card in request.credit_cards:
                program = card.get("program", "")
                validated_program = validate_program(program)
                if not validated_program:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid loyalty program: {program}. Please select from the supported programs list.",
                    )
                # Use validated program name
                validated_card = card.copy()
                validated_card["program"] = validated_program
                validated_cards.append(validated_card)
            updates["credit_cards"] = validated_cards

        if updates:
            user_service.update_profile(user_id, updates)

        return {"ok": True}
    except Exception as e:
        logger.error(f"Error updating user profile: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/images/city/{city_name}/srcset")
async def get_city_image_srcset(city_name: str):
    """
    Get responsive image srcset for a city.

    If city doesn't exist, returns "coming soon" placeholder and triggers background curation.

    Returns src, srcset, and sizes attributes for responsive images.
    """
    try:
        srcset_data = image_service.get_city_image_srcset(city_name)
        if not srcset_data:
            raise HTTPException(
                status_code=404, detail=f"No images found for city: {city_name}"
            )

        # Check if this is a "coming soon" placeholder
        is_coming_soon = "coming_soon" in srcset_data.get("src", "").lower()

        response = {"city": city_name, **srcset_data}
        if is_coming_soon:
            response["is_coming_soon"] = True
            response["status"] = "coming_soon"
        else:
            response["is_coming_soon"] = False
            response["status"] = "curated"

        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting city image srcset: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
