import os
import sys
from pathlib import Path

# NOTE: This sys.path hack is needed because many modules use "from src.xxx" imports
# and some subdirectories (repos, handlers) are missing __init__.py files.
# TODO: Clean this up by:
#   1. Adding __init__.py to all subdirectories
#   2. Converting all "from src.xxx" imports to relative imports
#   3. Removing this sys.path hack
# For now, this ensures compatibility when running via: uvicorn src.app:app
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
from .handlers.group_api import (
    handle_get_points_pool,
    handle_optimize_oop,
    handle_simulate_allocation,
    handle_get_settlements,
    handle_mark_settlement_paid,
    handle_confirm_settlement,
    handle_get_settlements_status,
    OptimizeOOPRequest,
    OptimizeOOPOptions,
    SimulateAllocationRequest,
    MarkSettlementPaidRequest,
    ConfirmSettlementRequest,
)

# Import agentic optimization router
from .routes.optimize import router as optimize_router

# Import solo booking router
from .routes.solo import router as solo_router

# Get CORS origins from environment variable
# IMPORTANT: Browsers reject allow_credentials=True with allow_origins=["*"]
# When sending Authorization headers or cookies, you MUST specify exact origins
CORS_ORIGINS_ENV = os.environ.get("CORS_ORIGINS", "")
if CORS_ORIGINS_ENV:
    # Production: use explicit origins from environment
    ALLOWED_ORIGINS = [
        origin.strip() for origin in CORS_ORIGINS_ENV.split(",") if origin.strip()
    ]
    ALLOW_CREDENTIALS = True
else:
    # Development fallback: localhost only (not "*" which breaks with credentials)
    # In production, ALWAYS set CORS_ORIGINS environment variable in App Runner
    # Example: CORS_ORIGINS=https://your-frontend.com,http://localhost:3000
    ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
    ALLOW_CREDENTIALS = True

# Log CORS config at startup for debugging
logger.info(f"CORS config: origins={ALLOWED_ORIGINS}, credentials={ALLOW_CREDENTIALS}")

app = FastAPI(title="Tripy API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include agentic optimization routes
app.include_router(optimize_router)

# Include solo booking routes
app.include_router(solo_router)

# Preload commercial airports and airport data at startup for fast autocomplete
@app.on_event("startup")
async def startup_preload_caches():
    """Preload caches at startup for fast autocomplete responses."""
    from .handlers.airport_filter import preload_commercial_airports
    from .services.airport_service import preload_airport_data
    
    # Start preloading in background
    preload_commercial_airports()
    preload_airport_data()
    logger.info("Started background preload of airport caches")


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
    is_start: bool = False
    is_end: bool = False


class UpsertPointsRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    program: str = Field(..., min_length=1, max_length=100)
    balance: int = Field(..., ge=0, description="Points balance must be non-negative")


class GenerateItineraryRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    optimization_mode: str = Field(
        default="money_saving",
        description=(
            "Optimization strategy: "
            "'cpp_focused' (only use points when cpp > 1.0), "
            "'money_saving' (use points whenever cpp > 0), "
            "'balanced' (optimize cpp adjusted by time/stops)"
        )
    )


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    default_home_airport: Optional[str] = None
    timezone: Optional[str] = None
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


class HotelCalendarRequest(BaseModel):
    hotel_id: str = Field(..., min_length=1, max_length=100, description="AwardTool hotel ID (e.g., hyatt_madel)")
    check_in: Optional[str] = Field(None, description="Optional start date filter YYYY-MM-DD")
    check_out: Optional[str] = Field(None, description="Optional end date filter YYYY-MM-DD")


class HotelBestNightsRequest(BaseModel):
    hotel_id: str = Field(..., min_length=1, max_length=100, description="AwardTool hotel ID")
    num_nights: int = Field(..., ge=1, le=30, description="Number of nights needed")
    start_date: Optional[str] = Field(None, description="Earliest possible check-in YYYY-MM-DD")
    end_date: Optional[str] = Field(None, description="Latest possible check-out YYYY-MM-DD")
    optimize_for: str = Field("points", description="Optimization: 'points', 'cpp', or 'cash'")


class HotelSearchWithCalendarRequest(BaseModel):
    destination: str = Field(..., min_length=1, max_length=200, description="City or destination name")
    check_in: str = Field(..., description="Check-in date YYYY-MM-DD")
    check_out: str = Field(..., description="Check-out date YYYY-MM-DD")
    programs: Optional[List[str]] = Field(None, description="Hotel programs e.g. HH, IHG, MAR, HYATT")
    guests: int = Field(1, ge=1, le=10, description="Number of guests")
    hotel_class: Optional[str] = Field(None, description="Star rating filter e.g. 3, 4, 5")
    top_hotels: int = Field(5, ge=1, le=10, description="Number of top hotels to enrich with calendar")


# === NEW: Transfer Strategy Optimizer Models ===

class TransferStrategyRequest(BaseModel):
    """Request for optimizing point transfers across flights and hotels."""
    trip_id: Optional[str] = Field(None, description="Trip ID to optimize (if using saved trip)")
    # OR provide expenses directly:
    flights: Optional[List[Dict[str, Any]]] = Field(None, description="Flight options with cash and points costs")
    hotels: Optional[List[Dict[str, Any]]] = Field(None, description="Hotel options with cash and points costs")
    available_points: Dict[str, int] = Field(..., description="User's point balances by program (e.g., {'amex': 100000, 'chase': 50000, 'UA': 25000})")
    include_hotels: bool = Field(True, description="Include hotels in optimization")
    max_cash_budget: Optional[float] = Field(None, ge=0, description="Maximum cash to spend")
    min_points_usage_pct: float = Field(0.0, ge=0, le=1, description="Force minimum point utilization (0-1)")


class SimulateTransferRequest(BaseModel):
    """Simulate optimal point allocation for given expenses (what-if scenario)."""
    available_points: Dict[str, int] = Field(..., description="User's point balances")
    expenses: List[Dict[str, Any]] = Field(..., description="List of expenses with cash and points options")


@app.get("/")
def root_health():
    """Root health check endpoint for AppRunner"""
    return {"status": "ok", "service": "tripy-api"}


@app.get("/healthz")
def healthz():
    """Health check endpoint (Kubernetes style)"""
    return {"status": "ok"}


@app.get("/health")
def health():
    """Health check endpoint"""
    return {"status": "ok", "service": "tripy-api"}


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


@app.post("/trips/delete")
async def delete_trip(
    request: TripIdRequest, user_id: str = Depends(get_current_user_id)
):
    """Delete a trip (owner only)"""
    try:
        success = trip_service.delete_trip(request.trip_id, user_id)
        return {"ok": success}
    except ValueError as e:
        logger.warning(f"Trip deletion error: {str(e)}")
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error deleting trip: {str(e)}")
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
            is_start=request.is_start,
            is_end=request.is_end,
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
    request: GenerateItineraryRequest,
    user_id: str = Depends(get_current_user_id),
    req: Request = None,
):
    """Generate optimized itineraries for a trip using v2 pipeline (default) or v1. Falls back to simple generator when optimization fails."""
    try:
        # Get trip to verify access
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user has access to this trip
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Generate optimized itinerary using points maximization
        result = await itinerary_service.generate_optimized_itinerary(
            request.trip_id, 
            optimization_mode=request.optimization_mode
        )

        # Track itinerary generation for analytics
        route_count = len(result.get("items", []))
        track_itinerary_generated(user_id, request.trip_id, route_count)

        response = {
            "status": result.get("status", "Unknown"),
            "solution": result.get("solution", {}),
            "items": result.get("items", []),
        }
        
        if result.get("relaxed_constraints"):
            response["relaxed_constraints"] = True
            response["relaxed_message"] = result.get("relaxed_message")
        
        return response
    except ValueError as e:
        # NO FALLBACKS - Return explicit error with actionable guidance
        logger.warning(f"Optimization failed: {e}")
        error_response = {
            "status": "error",
            "error_code": "OPTIMIZATION_FAILED",
            "message": str(e),
            "user_actions": [
                {
                    "action_type": "change_dates",
                    "title": "Try Different Dates",
                    "description": "Flight availability varies by date",
                    "button_text": "Change Dates"
                },
                {
                    "action_type": "increase_budget",
                    "title": "Increase Budget",
                    "description": "Your budget may be too low for this route",
                    "button_text": "Update Budget"
                },
                {
                    "action_type": "modify_destinations",
                    "title": "Modify Destinations",
                    "description": "Some routes may not have available flights",
                    "button_text": "Edit Destinations"
                }
            ]
        }
        return error_response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating itinerary: {str(e)}")
        # NO FALLBACKS - Return explicit error with actionable guidance
        error_response = {
            "status": "error",
            "error_code": "UNEXPECTED_ERROR",
            "message": f"An unexpected error occurred: {str(e)}",
            "user_actions": [
                {
                    "action_type": "retry",
                    "title": "Try Again",
                    "description": "The issue may be temporary",
                    "button_text": "Retry"
                },
                {
                    "action_type": "simplify_trip",
                    "title": "Simplify Trip",
                    "description": "Try fewer destinations or more flexible dates",
                    "button_text": "Edit Trip"
                }
            ]
        }
        return error_response


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


# Hotel calendar endpoints - get availability calendar for specific hotels
@app.post("/hotels/calendar")
async def get_hotel_calendar_endpoint(
    request: HotelCalendarRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Get availability calendar for a specific hotel.
    
    Returns points rates, cash prices, and CPP values for each available date.
    Useful for finding the best redemption dates.
    
    Example hotel_ids: hyatt_madel, marriott_lonpk, hilton_london_tower
    """
    try:
        from .handlers.hotels import get_hotel_calendar_async

        result = await get_hotel_calendar_async(
            hotel_id=request.hotel_id,
            check_in=request.check_in,
            check_out=request.check_out,
        )
        
        if result.get("error"):
            raise HTTPException(status_code=400, detail=result.get("error"))
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_hotel_calendar: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/hotels/best-nights")
async def get_best_hotel_nights_endpoint(
    request: HotelBestNightsRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Find the best consecutive nights for a hotel stay.
    
    Optimizes for:
    - 'points': Minimize total points needed
    - 'cpp': Maximize cents-per-point value
    - 'cash': Minimize cash price
    
    Returns ranked options with total points, cash, and CPP for each stay.
    """
    try:
        from .handlers.hotels import get_best_hotel_nights

        result = await get_best_hotel_nights(
            hotel_id=request.hotel_id,
            num_nights=request.num_nights,
            start_date=request.start_date,
            end_date=request.end_date,
            optimize_for=request.optimize_for,
        )
        
        if result.get("error"):
            raise HTTPException(status_code=400, detail=result.get("error"))
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_best_hotel_nights: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/hotels/search-with-calendar")
async def search_hotels_with_calendar_endpoint(
    request: HotelSearchWithCalendarRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Search for hotels AND enrich top results with calendar data.
    
    Combines hotel search with calendar API for accurate pricing:
    - Searches for hotels in destination
    - Fetches calendar data for top hotels
    - Returns total points, cash, and CPP for the exact stay dates
    - Provides recommendations: best by points, value (CPP), and cash
    
    This is more accurate than the basic search which may show nightly rates.
    """
    try:
        from .handlers.hotels import search_hotels_with_calendar

        result = await search_hotels_with_calendar(
            destination=request.destination,
            check_in=request.check_in,
            check_out=request.check_out,
            programs=request.programs,
            guests=request.guests,
            hotel_class=request.hotel_class,
            top_hotels=request.top_hotels,
        )
        
        if result.get("error") and not result.get("hotels"):
            raise HTTPException(status_code=400, detail=result.get("error"))
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"search_hotels_with_calendar: {e}", exc_info=True)
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
        # Use CSV-based airport search with timeout protection
        import asyncio
        try:
            # Wrap synchronous call with timeout to prevent hanging
            airports = await asyncio.wait_for(
                asyncio.to_thread(search_airports, q, max_results=limit),
                timeout=8.0  # 8 second timeout (less than App Runner's 30s)
            )
            logger.info(f"Returning {len(airports)} airports for query '{q}'")
            return {"airports": airports}
        except asyncio.TimeoutError:
            logger.warning(f"Airport search timed out for query '{q}', returning empty results")
            return {"airports": []}
    except Exception as e:
        logger.error(f"Error in airports_autocomplete for q='{q}': {e}", exc_info=True)
        # Return empty results instead of failing completely
        return {"airports": []}


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
        
        import asyncio
        try:
            # Wrap with timeout to prevent hanging
            suggestions = await asyncio.wait_for(
                asyncio.to_thread(
                    autocomplete_destinations,
                    q, gl=gl, hl=hl, exclude_regions=exclude_regions, commercial_only=commercial_only
                ),
                timeout=8.0  # 8 second timeout
            )
            
            if not suggestions and fuzzy_fallback:
                # Try fuzzy fallback with shorter timeout
                try:
                    suggestions = await asyncio.wait_for(
                        asyncio.to_thread(fuzzy_search_destinations, q, max_results=limit, commercial_only=commercial_only),
                        timeout=2.0  # 2 second timeout for fallback
                    )
                except asyncio.TimeoutError:
                    logger.warning(f"Fuzzy search timed out for query '{q}'")
                    suggestions = []
            
            return {"suggestions": (suggestions or [])[:limit]}
        except asyncio.TimeoutError:
            logger.warning(f"Destination autocomplete timed out for query '{q}', returning empty results")
            return {"suggestions": []}
    except Exception as e:
        logger.error(f"destinations_autocomplete q='{q}': {e}", exc_info=True)
        # Return empty results instead of failing completely
        return {"suggestions": []}


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


# === NEW: Transfer Strategy Endpoints ===

@app.post("/api/transfer-strategy/optimize")
async def optimize_transfer_strategy(
    body: TransferStrategyRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Optimize point transfer strategy to minimize out-of-pocket costs.
    
    This endpoint analyzes all flights and hotels for a trip and determines:
    1. Which items to pay with cash vs points
    2. Which bank points to transfer to which programs
    3. Step-by-step transfer instructions
    
    Key difference from /optimize-out-of-pocket:
    - Considers ALL expenses (flights + hotels) together
    - Provides explicit transfer instructions
    - Prioritizes minimizing cash over CPP value
    
    Returns:
    - total_out_of_pocket: Total cash you'll pay
    - savings: Cash saved vs all-cash booking
    - payment_plan: How to pay for each item
    - transfer_plan: Which points to transfer where
    - booking_order: Step-by-step instructions
    """
    try:
        from .handlers.trip_cost_optimizer import (
            optimize_trip_out_of_pocket,
            build_oop_optimized_response,
        )
        
        flights = body.flights or []
        hotels = body.hotels if body.include_hotels else []
        
        # If trip_id provided, fetch trip data
        if body.trip_id:
            # TODO: Fetch trip's flights and hotels from itinerary service
            pass
        
        solution = await optimize_trip_out_of_pocket(
            flight_edges=flights,
            hotel_options=hotels,
            user_points=body.available_points,
            include_hotels=body.include_hotels,
            max_cash_budget=body.max_cash_budget,
            min_points_usage_pct=body.min_points_usage_pct,
        )
        
        return build_oop_optimized_response(solution)
        
    except Exception as e:
        logger.error(f"optimize_transfer_strategy: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transfer-strategy/simulate")
async def simulate_transfer_strategy(body: SimulateTransferRequest):
    """
    Simulate optimal point allocation for given expenses (no trip required).
    
    Useful for "what if" scenarios to see how points would be allocated
    before creating a trip.
    
    Example request:
    {
        "available_points": {"amex": 1000000, "chase": 150000},
        "expenses": [
            {"type": "flight", "description": "JFK to CDG", "cash_cost": 800, 
             "points_options": [{"program_code": "AF", "points_required": 60000, "surcharge": 150}]},
            {"type": "hotel", "description": "Paris Hyatt 5 nights", "cash_cost": 1200,
             "points_options": [{"program_code": "HYATT", "points_required": 100000, "surcharge": 0}]}
        ]
    }
    
    Returns optimal payment and transfer strategy.
    """
    try:
        from .handlers.min_oop_optimizer import (
            minimize_out_of_pocket,
            TripCostItem,
            PointsOption,
            solution_to_dict,
        )
        from .handlers.transfer_strategy import EXTENDED_TRANSFER_GRAPH
        
        # Convert expenses to TripCostItems
        items = []
        for i, exp in enumerate(body.expenses):
            points_opts = []
            for opt in exp.get("points_options", []):
                points_opts.append(PointsOption(
                    program_code=opt.get("program_code", ""),
                    program_type=opt.get("program_type", "airline" if exp.get("type") == "flight" else "hotel"),
                    points_required=int(opt.get("points_required", 0)),
                    surcharge=float(opt.get("surcharge", 0)),
                ))
            
            items.append(TripCostItem(
                item_id=f"{exp.get('type', 'item')}_{i}",
                item_type=exp.get("type", "flight"),
                description=exp.get("description", f"Item {i+1}"),
                cash_cost=float(exp.get("cash_cost", 0)),
                points_options=points_opts,
            ))
        
        solution = minimize_out_of_pocket(
            items=items,
            available_points=body.available_points,
            transfer_graph=EXTENDED_TRANSFER_GRAPH,
        )
        
        result = solution_to_dict(solution)
        
        # Add summary
        result["summary"] = {
            "total_out_of_pocket": f"${solution.total_out_of_pocket:,.2f}",
            "all_cash_would_cost": f"${solution.all_cash_cost:,.2f}",
            "you_save": f"${solution.savings:,.2f}",
            "savings_percentage": f"{solution.savings_percentage:.1f}%",
        }
        
        return result
        
    except Exception as e:
        logger.error(f"simulate_transfer_strategy: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/transfer-partners")
async def get_transfer_partners(
    program: Optional[str] = Query(None, description="Bank program code (e.g., amex, chase)"),
    program_type: Optional[str] = Query(None, description="Filter by 'airline' or 'hotel'"),
):
    """
    Get available transfer partners for bank programs.
    
    If program is provided, returns partners for that specific bank.
    Otherwise, returns all transfer partners organized by bank.
    """
    try:
        from .handlers.transfer_strategy import (
            EXTENDED_TRANSFER_GRAPH,
            BANK_METADATA,
            get_transfer_partners as get_partners,
        )
        
        if program:
            partners = get_partners(program.lower(), program_type)
            bank_info = BANK_METADATA.get(program.lower(), {})
            return {
                "bank": program.lower(),
                "bank_name": bank_info.get("name", program),
                "partners": [
                    {
                        "code": p,
                        "name": EXTENDED_TRANSFER_GRAPH.get(program.lower(), {}).get(p, {}).get("name", p),
                        "type": EXTENDED_TRANSFER_GRAPH.get(program.lower(), {}).get(p, {}).get("type", "airline"),
                        "ratio": EXTENDED_TRANSFER_GRAPH.get(program.lower(), {}).get(p, {}).get("ratio", 1.0),
                    }
                    for p in partners
                    if not program_type or EXTENDED_TRANSFER_GRAPH.get(program.lower(), {}).get(p, {}).get("type") == program_type
                ],
            }
        
        # Return all banks and their partners
        result = {}
        for bank, partners in EXTENDED_TRANSFER_GRAPH.items():
            bank_info = BANK_METADATA.get(bank, {})
            partner_list = []
            for code, info in partners.items():
                if program_type and info.get("type") != program_type:
                    continue
                partner_list.append({
                    "code": code,
                    "name": info.get("name", code),
                    "type": info.get("type", "airline"),
                    "ratio": info.get("ratio", 1.0),
                })
            result[bank] = {
                "bank_name": bank_info.get("name", bank),
                "portal_url": bank_info.get("portal_url", ""),
                "partners": partner_list,
            }
        
        return {"transfer_graph": result}
        
    except Exception as e:
        logger.error(f"get_transfer_partners: {e}", exc_info=True)
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


@app.post("/users/me/savings/calculate")
async def calculate_user_savings(user_id: str = Depends(get_current_user_id)):
    """
    Calculate and update total savings from all user's trips.
    This will recalculate savings based on all trip itineraries and update the user profile.
    """
    try:
        result = user_service.calculate_and_update_user_savings(user_id)
        return result
    except Exception as e:
        logger.error(f"Error calculating user savings: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/users/me/savings")
async def get_user_savings(user_id: str = Depends(get_current_user_id)):
    """
    Get current total savings for the user.
    Returns the cached value from the user profile.
    """
    try:
        user = user_service.ensure_user_exists(user_id)
        return {
            "total_savings": user.get("total_savings", 0),
            "user_id": user_id
        }
    except Exception as e:
        logger.error(f"Error getting user savings: {str(e)}")
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


# =============================================================================
# GROUP TRAVEL OOP OPTIMIZATION ENDPOINTS
# =============================================================================

@app.get("/group/{trip_id}/points-pool")
async def get_group_points_pool(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get aggregated points pool for a group trip.
    
    Returns combined points across all members, transfer potential,
    and estimated values.
    """
    try:
        # Get trip members
        members_data = trip_member_service.get_trip_members(trip_id)
        
        if not members_data:
            raise HTTPException(
                status_code=404,
                detail=f"No members found for trip {trip_id}"
            )
        
        # Get each member's points
        for member in members_data:
            member_id = member.get("user_id")
            if member_id:
                points = points_service.get_user_points_for_trip(trip_id, member_id)
                member["points"] = {p.get("program"): p.get("balance") for p in points if p.get("balance")}
        
        result = await handle_get_points_pool(trip_id, members_data)
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting group points pool: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/group/{trip_id}/optimize-oop")
async def optimize_group_oop(
    trip_id: str,
    request: Optional[OptimizeOOPRequest] = None,
    user_id: str = Depends(get_current_user_id),
):
    """
    Run group OOP optimization.
    
    This is the main endpoint for optimizing a group trip's out-of-pocket costs.
    It searches for flights and hotels, runs the ILP optimizer, calculates
    fair cost allocation, and generates settlement instructions.
    """
    try:
        if request is None:
            request = OptimizeOOPRequest()
        
        # Get trip details
        trip = trip_service.get_trip(trip_id, user_id)
        if not trip:
            raise HTTPException(status_code=404, detail=f"Trip {trip_id} not found")
        
        # Get trip members
        members_data = trip_member_service.get_trip_members(trip_id)
        if not members_data:
            raise HTTPException(
                status_code=400,
                detail="No members found for trip. Add members before optimizing."
            )
        
        # Get each member's points
        for member in members_data:
            member_id = member.get("user_id")
            if member_id:
                points = points_service.get_user_points_for_trip(trip_id, member_id)
                member["points"] = {p.get("program"): p.get("balance") for p in points if p.get("balance")}
        
        # Get destinations
        destinations = destination_service.get_destinations(trip_id)
        if not destinations:
            raise HTTPException(
                status_code=400,
                detail="No destinations found for trip. Add destinations before optimizing."
            )
        
        # TODO: Search for actual flight and hotel options
        # For now, use placeholder booking items
        # In production, this would call AwardTool API and SerpAPI
        booking_items_data = []
        
        # Placeholder: Create sample booking items from destinations
        # This should be replaced with actual flight/hotel search
        for i, dest in enumerate(destinations):
            dest_name = dest.get("name", "Unknown")
            
            # Sample flight item
            booking_items_data.append({
                "item_id": f"flight_{i}",
                "type": "flight",
                "member_id": members_data[0].get("user_id"),  # First member as example
                "description": f"Flight to {dest_name}",
                "cash_cost": 500.0,  # Placeholder
                "points_options": [
                    {"program_code": "UA", "points_required": 30000, "surcharge": 50},
                    {"program_code": "AA", "points_required": 35000, "surcharge": 45},
                ],
            })
        
        result = await handle_optimize_oop(
            trip_id=trip_id,
            members_data=members_data,
            booking_items_data=booking_items_data,
            options=request.options,
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error optimizing group OOP: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/group/{trip_id}/simulate-allocation")
async def simulate_group_allocation(
    trip_id: str,
    request: SimulateAllocationRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Simulate cost allocation without full optimization.
    
    Provides a quick preview of expected settlements based on
    members' points contributions.
    """
    try:
        # Get trip members
        members_data = trip_member_service.get_trip_members(trip_id)
        if not members_data:
            raise HTTPException(status_code=404, detail="No members found for trip")
        
        # Get each member's points
        for member in members_data:
            member_id = member.get("user_id")
            if member_id:
                points = points_service.get_user_points_for_trip(trip_id, member_id)
                member["points"] = {p.get("program"): p.get("balance") for p in points if p.get("balance")}
        
        result = await handle_simulate_allocation(trip_id, members_data, request)
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error simulating allocation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/group/{trip_id}/settlements")
async def get_group_settlements(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get settlements for a group trip.
    
    Returns all settlement entries with payment instructions.
    """
    try:
        # Get trip members
        members_data = trip_member_service.get_trip_members(trip_id)
        
        # TODO: Get settlements from database
        # For now, return empty list
        settlements_data = []
        
        result = await handle_get_settlements(trip_id, settlements_data, members_data)
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting settlements: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/group/{trip_id}/settlements/{settlement_id}/mark-paid")
async def mark_settlement_paid(
    trip_id: str,
    settlement_id: str,
    request: MarkSettlementPaidRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Mark a settlement as paid by the debtor.
    """
    try:
        result = await handle_mark_settlement_paid(
            trip_id, settlement_id, request, user_id
        )
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error marking settlement paid: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/group/{trip_id}/settlements/{settlement_id}/confirm")
async def confirm_settlement(
    trip_id: str,
    settlement_id: str,
    request: ConfirmSettlementRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Confirm settlement receipt by the creditor.
    """
    try:
        result = await handle_confirm_settlement(
            trip_id, settlement_id, request, user_id
        )
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error confirming settlement: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/group/{trip_id}/settlements/status")
async def get_settlements_status(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get overall settlement status for a trip.
    
    Returns summary of all settlements and their completion status.
    """
    try:
        # TODO: Get settlements from database
        settlements_data = []
        
        result = await handle_get_settlements_status(trip_id, settlements_data)
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting settlements status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# === FLIGHT VERIFICATION ENDPOINTS ===

class FlightVerificationRequest(BaseModel):
    """Request to verify a flight exists on Google Flights."""
    origin: str
    destination: str
    date: str  # YYYY-MM-DD
    flight_numbers: list[str]
    departure_time: Optional[str] = None
    airline: Optional[str] = None


class FlightSearchRefreshRequest(BaseModel):
    """Request to search for flights with fresh data (bypassing cache)."""
    origin: str
    destination: str
    date: str  # YYYY-MM-DD
    cabin_class: str = "Economy"


@app.post("/api/flights/verify")
async def verify_flight(body: FlightVerificationRequest):
    """
    Verify a flight exists on Google Flights.
    
    Cross-references the given flight number(s) against fresh SerpAPI data
    to confirm the flight actually exists and departure times match.
    
    Returns:
        - verified: Whether the flight was found
        - status: "verified", "not_found", "time_mismatch", or "error"
        - message: Human-readable status message
        - google_flights: Matching flight data if found
        - fetched_at: When verification was performed
    """
    try:
        from .services.flight_verification import verify_flight_exists
        
        result = await verify_flight_exists(
            origin=body.origin,
            destination=body.destination,
            date=body.date,
            flight_numbers=body.flight_numbers,
            departure_time=body.departure_time,
            airline=body.airline,
        )
        
        return result
        
    except Exception as e:
        logger.error(f"verify_flight: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/flights/search-fresh")
async def search_flights_fresh(body: FlightSearchRefreshRequest):
    """
    Search for flights with fresh data, bypassing any cache.
    
    Use this endpoint to get the most up-to-date flight availability
    and prices directly from Google Flights via SerpAPI.
    
    Returns:
        - flights: List of available flights
        - fetched_at: When data was fetched
        - count: Number of flights found
    """
    try:
        from .services.flight_verification import get_verified_flights
        
        result = await get_verified_flights(
            origin=body.origin,
            destination=body.destination,
            date=body.date,
            cabin_class=body.cabin_class,
        )
        
        return result
        
    except Exception as e:
        logger.error(f"search_flights_fresh: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/flights/google-url")
async def get_google_flights_url(
    origin: str,
    destination: str,
    date: str,
):
    """
    Get a Google Flights URL for the given route and date.
    
    Use this to direct users to verify flights on Google Flights directly.
    """
    from .services.flight_verification import build_google_flights_url
    
    return {
        "url": build_google_flights_url(origin, destination, date),
        "origin": origin,
        "destination": destination,
        "date": date,
    }
