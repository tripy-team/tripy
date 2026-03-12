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
    email_service,
)
from .utils.analytics import (
    track_user_login,
    track_trip_created,
    track_destination_added,
    track_itinerary_generated,
)
from .utils.jwt_auth import get_current_user_id, get_user_or_anon_id, is_anonymous
from .utils.loyalty_programs import validate_program
from .handlers.openAI import (
    extract_trip_info_with_openai,
    search_cities_with_openai,
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

# Import monitoring router
from .routes.monitoring import router as monitoring_router

# Import payment router
from .routes.payment import router as payment_router

# Import group planning router
from .routes.group_planning import router as group_planning_router


# Get CORS origins from environment variable
# IMPORTANT: Browsers reject allow_credentials=True with allow_origins=["*"]
# When sending Authorization headers or cookies, you MUST specify exact origins.
# We normalize aggressively here because cloud consoles often store values with
# quotes/semicolons/trailing slashes, which would otherwise never match Origin.
def _parse_cors_origins(raw_value: str) -> List[str]:
    if not raw_value:
        return []

    normalized = raw_value.strip()
    if (normalized.startswith('"') and normalized.endswith('"')) or (
        normalized.startswith("'") and normalized.endswith("'")
    ):
        normalized = normalized[1:-1]

    origins: List[str] = []
    for item in normalized.replace(";", ",").split(","):
        origin = item.strip().strip('"').strip("'").rstrip("/")
        if origin:
            origins.append(origin)
    return origins


CORS_ORIGINS_ENV = os.environ.get("CORS_ORIGINS", "")
PARSED_CORS_ORIGINS = _parse_cors_origins(CORS_ORIGINS_ENV)
if PARSED_CORS_ORIGINS:
    # Production: use explicit origins from environment
    ALLOWED_ORIGINS = PARSED_CORS_ORIGINS
    ALLOW_CREDENTIALS = True
else:
    # Development fallback: localhost only (not "*" which breaks with credentials)
    # In production, ALWAYS set CORS_ORIGINS environment variable in App Runner
    # Example: CORS_ORIGINS=https://your-frontend.com,http://localhost:3000
    ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://traveltripy.com",
        "https://www.traveltripy.com",
        "https://xezfenhu6t.us-east-1.awsapprunner.com",
    ]
    ALLOW_CREDENTIALS = True

# Log CORS config at startup for debugging
logger.info(f"CORS config: origins={ALLOWED_ORIGINS}, credentials={ALLOW_CREDENTIALS}")

app = FastAPI(title="Tripy API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Allow Amplify preview/custom branch domains without listing each one.
    allow_origin_regex=r"https://.*\.amplifyapp\.com",
    allow_credentials=ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Anon-Session-Id"],
)

# ============================================================================
# Rate Limiting (Phase 16, Task 15)
# ============================================================================
# In-memory rate limiter. Per IP + anon_session_id, 30 req/min for sensitive endpoints.
# Replace with Redis in production.

import time
from collections import defaultdict

_rate_limit_store: Dict[str, list] = defaultdict(list)
RATE_LIMIT_MAX = 30  # requests per window
RATE_LIMIT_WINDOW_S = 60  # seconds

# Rate-limit write/mutation endpoints only — NOT read endpoints like
# /solo/trips/{id}/selection, /solo/trips/{id}/status, etc.
# Using exact-match paths to avoid accidentally catching sub-paths.
RATE_LIMITED_PATHS_EXACT = {"/solo/optimize", "/points/estimate", "/solo/share"}
# Prefix paths that should ONLY match the prefix itself (e.g. POST /solo/trips)
# Sub-paths like /solo/trips/{id}/selection are excluded via the allowlist below.
RATE_LIMITED_PATHS_PREFIX = {"/solo/trips"}
# Sub-paths under prefix paths that should NOT be rate-limited (read endpoints)
RATE_LIMIT_EXCLUDE_SUFFIXES = {
    "/selection",
    "/status",
    "/monitoring",
    "/points",
    "/optimization-cache",
    "/select",
    "/transfer-strategy",
    "/booking-details",
    "/updates",
    "/share",
}


def _should_rate_limit(path: str) -> bool:
    """Determine if a path should be rate-limited."""
    # Exact match
    if path in RATE_LIMITED_PATHS_EXACT:
        return True
    # Prefix match, but exclude read sub-paths
    for prefix in RATE_LIMITED_PATHS_PREFIX:
        if path.startswith(prefix):
            # Only rate-limit the base path itself (e.g. POST /solo/trips)
            if path == prefix or path == prefix + "/":
                return True
            # For sub-paths, check if they end with an excluded suffix
            path_after_id = path.split(
                "/", 4
            )  # e.g. ['', 'solo', 'trips', '{id}', 'selection']
            if len(path_after_id) >= 5:
                suffix = "/" + path_after_id[4]
                if any(suffix.startswith(excl) for excl in RATE_LIMIT_EXCLUDE_SUFFIXES):
                    return False
            # Rate-limit unknown sub-paths
            return True
    return False


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Rate limit sensitive anonymous endpoints: 30 req/min per IP+anon."""
    path = request.url.path

    # Only rate-limit specific paths
    should_limit = _should_rate_limit(path)

    if should_limit:
        # Build key: IP + anon_session_id
        client_ip = request.client.host if request.client else "unknown"
        anon_id = request.headers.get("X-Anon-Session-Id", "")
        key = f"{client_ip}:{anon_id}"

        now = time.time()
        # Clean old entries
        _rate_limit_store[key] = [
            t for t in _rate_limit_store[key] if now - t < RATE_LIMIT_WINDOW_S
        ]

        if len(_rate_limit_store[key]) >= RATE_LIMIT_MAX:
            from starlette.responses import JSONResponse

            # Include CORS headers so the browser doesn't block the 429 response
            origin = request.headers.get("origin", "")
            cors_headers = {"Retry-After": str(RATE_LIMIT_WINDOW_S)}
            if origin and origin in ALLOWED_ORIGINS:
                cors_headers.update(
                    {
                        "Access-Control-Allow-Origin": origin,
                        "Access-Control-Allow-Credentials": "true",
                    }
                )
            return JSONResponse(
                status_code=429,
                content={
                    "detail": "Too many requests. Please wait a moment and try again."
                },
                headers=cors_headers,
            )

        _rate_limit_store[key].append(now)

        # Periodically clean stale keys (every ~100 requests)
        if len(_rate_limit_store) > 1000:
            stale_keys = [
                k
                for k, v in _rate_limit_store.items()
                if not v or now - v[-1] > RATE_LIMIT_WINDOW_S * 2
            ]
            for k in stale_keys:
                del _rate_limit_store[k]

    return await call_next(request)


# Anonymous session middleware — attaches anon_session_id to response headers
# so the frontend can persist it across page refreshes
@app.middleware("http")
async def anon_session_middleware(request: Request, call_next):
    """
    If no Authorization header is present, check for X-Anon-Session-Id header.
    Echo the anon session ID back in the response so the frontend can persist it.
    """
    response = await call_next(request)

    # If the request had an anon session header, echo it back
    anon_id = request.headers.get("X-Anon-Session-Id")
    if anon_id:
        response.headers["X-Anon-Session-Id"] = anon_id

    return response


# Include agentic optimization routes
app.include_router(optimize_router)

# Include solo booking routes
app.include_router(solo_router)

# Include monitoring routes
app.include_router(monitoring_router)

# Include payment routes
app.include_router(payment_router)

# Include group planning routes
app.include_router(group_planning_router)


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

    # Scrape transfer bonuses from NerdWallet on startup
    try:
        from .services.transfer_bonus_scraper import refresh_bonuses

        bonuses = await refresh_bonuses()
        logger.info(
            "Transfer bonus scraper: loaded %d bonuses on startup", len(bonuses)
        )
    except Exception as e:
        logger.warning("Transfer bonus scraper failed on startup (non-fatal): %s", e)

    # Schedule daily refresh of transfer bonuses
    async def _daily_bonus_refresh():
        import asyncio

        while True:
            await asyncio.sleep(24 * 60 * 60)  # 24 hours
            try:
                from .services.transfer_bonus_scraper import refresh_bonuses as _refresh

                await _refresh()
                logger.info("Daily transfer bonus refresh completed")
            except Exception as exc:
                logger.warning("Daily transfer bonus refresh failed: %s", exc)

    import asyncio

    asyncio.create_task(_daily_bonus_refresh())


# Import group trip models
from .models.group_trip import (
    PoolingScope,
    MemberLifecycleState,
    DelegationScope,
    UpdatePoolingScopeRequest,
    CreatePassengerRequest,
    # Settlement (Task 17)
    SettlementPolicy,
    PointsValuationMode,
    PointsValuationConfig,
    TripSettlementConfig,
    UpdateSettlementConfigRequest,
    SETTLEMENT_POLICY_DESCRIPTIONS,
    POINTS_VALUATION_DESCRIPTIONS,
)

# Import passenger service
from .services import passenger_service


# Request models with validation
class CreateTripRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    start_date: str = Field(..., description="Start date in ISO format (YYYY-MM-DD)")
    end_date: str = Field(..., description="End date in ISO format (YYYY-MM-DD)")
    max_budget: Optional[int] = Field(
        None, ge=0, description="Maximum budget in dollars for itinerary generation"
    )
    duration_days: Optional[int] = Field(
        None,
        ge=1,
        le=365,
        description="Trip length in days when dates are flexible (start/end empty)",
    )
    pooling_scope: Optional[str] = Field(
        None,
        description="How points can be pooled: individual_only, household_only, full_group, sponsors_only",
    )
    # Organizer party size (travelers in organizer's booking)
    adults: Optional[int] = Field(
        1, ge=1, description="Number of adults in organizer's booking"
    )
    children: Optional[int] = Field(
        0, ge=0, description="Number of children in organizer's booking"
    )
    leg_dates: Optional[List[str]] = Field(
        None,
        description="Multi-city leg dates: departure date for each flight segment",
    )

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
    departure_date: Optional[str] = Field(
        None, description="Departure date FROM this destination (YYYY-MM-DD)"
    )


class RemoveDestinationRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    destination_id: str = Field(..., min_length=1)


class UpdateDestinationRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    destination_id: str = Field(..., min_length=1)
    arrival_date: Optional[str] = Field(
        None, description="Arrival date AT this destination (YYYY-MM-DD)"
    )
    departure_date: Optional[str] = Field(
        None, description="Departure date FROM this destination (YYYY-MM-DD)"
    )
    must_include: Optional[bool] = None
    excluded: Optional[bool] = None
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
        ),
    )


class GenerateStreamRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    request_id: str = Field(default="")
    optimization_mode: str = Field(default="money_saving")


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


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)
    new_password: str = Field(..., min_length=8, max_length=128)


class CitySearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=100)
    max_results: Optional[int] = Field(10, ge=1, le=50)


class JoinTripRequest(BaseModel):
    invite_code: str = Field(..., min_length=1)
    # Optional member preferences (trust layer / pooling workflow)
    willing_to_share_points: Optional[bool] = Field(
        True, description="Allow optimizer to use my points for group bookings"
    )
    points_usage: Optional[str] = Field(
        "freely",
        description="How Tripy may use my points: freely | ask_before | do_not_use (view only)",
    )
    # Flight preferences (for "Same as Friend?" feature)
    departure_airport: Optional[str] = Field(
        None, description="Member's departure airport code (e.g. JFK)"
    )
    arrival_airport: Optional[str] = Field(
        None, description="Member's preferred arrival airport code (e.g. CDG)"
    )
    is_round_trip: Optional[bool] = Field(
        True, description="Whether member wants round trip"
    )
    flight_class: Optional[str] = Field("economy", description="Cabin class preference")
    # Budget
    max_cash_budget: Optional[float] = Field(
        None, description="Member's maximum budget in USD"
    )
    # Party size (travelers in this member's booking)
    adults: Optional[int] = Field(
        1, ge=1, description="Number of adults in this member's booking"
    )
    children: Optional[int] = Field(
        0, ge=0, description="Number of children in this member's booking"
    )
    # Settlement constraints (Issue 2: Settlement-aware budgets)
    max_settlement_owed: Optional[float] = Field(
        None, ge=0, description="Max USD willing to owe others in settlement"
    )
    include_settlement_in_budget: Optional[bool] = Field(
        False, description="If True, cash + settlement must be <= budget"
    )

    @validator("max_settlement_owed", pre=True, always=True)
    def validate_settlement(cls, v):
        """Allow None or positive values"""
        if v is not None and v < 0:
            raise ValueError("max_settlement_owed must be non-negative")
        return v


class UpdateMemberPreferencesRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    willing_to_share_points: Optional[bool] = None
    points_usage: Optional[str] = Field(
        None, description="freely | ask_before | do_not_use"
    )


class ExtractTripInfoRequest(BaseModel):
    text: str = Field(
        ..., min_length=1, description="Natural language text describing the trip"
    )


class OptimizeOutOfPocketRequest(BaseModel):
    origin: str = Field(..., min_length=1, description="Origin airport IATA (e.g. JFK)")
    destination: str = Field(
        ..., min_length=1, description="Destination airport IATA (e.g. CDG)"
    )
    outbound_date: str = Field(..., description="Outbound date YYYY-MM-DD")
    return_date: str = Field(..., description="Return date YYYY-MM-DD")
    programs: Optional[List[str]] = Field(
        None, description="Award programs e.g. UA, DL, AA"
    )
    cabins: Optional[List[str]] = Field(
        None, description="Cabins e.g. Economy, Business"
    )
    pax: int = Field(1, ge=1, le=9, description="Number of passengers")
    commercial_only: bool = Field(
        False, description="If True, origin and destination must be commercial airports"
    )


# === Transfer Strategy Optimizer Models ===


class TransferStrategyRequest(BaseModel):
    """Request for optimizing point transfers for flights."""

    trip_id: Optional[str] = Field(
        None, description="Trip ID to optimize (if using saved trip)"
    )
    # OR provide expenses directly:
    flights: Optional[List[Dict[str, Any]]] = Field(
        None, description="Flight options with cash and points costs"
    )
    available_points: Dict[str, int] = Field(
        ...,
        description="User's point balances by program (e.g., {'amex': 100000, 'chase': 50000, 'UA': 25000})",
    )
    max_cash_budget: Optional[float] = Field(
        None, ge=0, description="Maximum cash to spend"
    )
    min_points_usage_pct: float = Field(
        0.0, ge=0, le=1, description="Force minimum point utilization (0-1)"
    )


class SimulateTransferRequest(BaseModel):
    """Simulate optimal point allocation for given expenses (what-if scenario)."""

    available_points: Dict[str, int] = Field(..., description="User's point balances")
    expenses: List[Dict[str, Any]] = Field(
        ..., description="List of expenses with cash and points options"
    )


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
        raise HTTPException(
            status_code=500, detail=f"Error extracting trip information: {str(e)}"
        )


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
    """Initiate password reset - sends a reset link to the user's email"""
    try:
        auth_service.forgot_password(request.email)
        return {
            "message": "If an account exists with this email, a password reset link has been sent.",
        }
    except ValueError as e:
        logger.warning(f"Forgot password validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Forgot password error: {str(e)}")
        return {
            "message": "If an account exists with this email, a password reset link has been sent.",
        }


@app.post("/auth/reset-password")
async def reset_password(request: ResetPasswordRequest):
    """Reset password using the Cognito code delivered via the reset link"""
    try:
        auth_service.confirm_forgot_password(
            request.email, request.code, request.new_password
        )
        return {"message": "Password reset successfully"}
    except ValueError as e:
        logger.warning(f"Reset password validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Reset password error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


# Trip endpoints (require authentication)
@app.post("/trips")
async def create_trip(
    request: CreateTripRequest, user_id: str = Depends(get_current_user_id)
):
    """Create a new trip (flight-only mode)"""
    try:
        trip = trip_service.create_trip(
            user_id,
            request.title,
            request.start_date,
            request.end_date,
            include_hotels=False,  # Flight-only mode
            max_budget=request.max_budget,
            duration_days=request.duration_days,
            pooling_scope=request.pooling_scope,
            adults=request.adults if request.adults is not None else 1,
            children=request.children if request.children is not None else 0,
            leg_dates=request.leg_dates,
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

        # Verify user has access to this trip (owner OR member)
        from .services.trip_member_service import get_member

        is_owner = trip.get("createdBy") == user_id
        is_member = get_member(request.trip_id, user_id) is not None
        if not is_owner and not is_member:
            raise HTTPException(status_code=403, detail="Access denied")

        # Enrich with destinations and member count for display (e.g. trip configuration summary)
        # Start/end are origin/return (like flight booking); only "visiting" destinations are shown.
        from .services.destination_service import (
            list_destinations,
            get_display_destinations_for_trip,
        )
        from .services.trip_member_service import list_members

        destinations = list_destinations(request.trip_id)
        trip["destinations"], trip["firstDestination"] = (
            get_display_destinations_for_trip(destinations or [])
        )

        members = list_members(request.trip_id)
        trip["memberCount"] = len(members) if members else 1

        return trip
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting trip: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trips")
async def list_trips(
    user_id: str = Depends(get_current_user_id),
    limit: Optional[int] = None,
    offset: int = 0,
    include_details: bool = False,
):
    """
    List trips for the current user with optional pagination.

    Args:
        limit: Maximum number of trips to return (default: all trips)
        offset: Number of trips to skip (for pagination)
        include_details: If true, fetch destinations and member counts (slower)

    Returns:
        trips: List of trip objects
        total: Total number of trips (for pagination)
        has_more: Whether there are more trips to fetch
    """
    try:
        # Get total count first (fast operation)
        total_count = trip_service.get_trips_count_for_user(user_id)

        # Get trips with pagination
        trips = trip_service.list_trips_for_user(
            user_id, limit=limit, offset=offset, include_details=include_details
        )

        # Calculate if there are more trips
        has_more = (offset + len(trips)) < total_count if limit else False

        return {
            "trips": trips,
            "total": total_count,
            "has_more": has_more,
            "limit": limit,
            "offset": offset,
        }
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
        from .services.destination_service import (
            list_destinations,
            get_display_destinations_for_trip,
        )
        from .services.trip_member_service import list_members
        from .repos import user_repo

        members = list_members(trip["tripId"])
        # Filter to include members with valid user IDs and proper roles
        # Always include owner/admin/organizer regardless of status (for "Same as Friend?" feature)
        valid_roles = {"owner", "admin", "organizer", "member"}
        owner_roles = {"owner", "admin", "organizer"}
        active_members = [
            m
            for m in (members or [])
            if (m.get("userId") or m.get("user_id"))  # Must have a user ID
            and m.get("role", "member") in valid_roles  # Must have a valid role
            and (
                m.get("status") == "active" or m.get("role", "member") in owner_roles
            )  # Active OR is owner
        ]
        trip["memberCount"] = len(active_members) if active_members else 1

        # Include member details for the join page (name, role, and flight preferences for "Same as Friend?" feature)
        # Look up user profiles to get actual names

        member_list = []
        for m in active_members:
            user_id = m.get("userId") or m.get("user_id")
            member_name = m.get("name", "")
            member_role = m.get("role", "member")

            # If name is not in member record, look up the user profile
            if not member_name and user_id:
                user_profile = user_repo.get_user_by_id(user_id)
                if user_profile:
                    # Try different name fields that might exist in the user profile
                    member_name = (
                        user_profile.get("name") or user_profile.get("fullName") or ""
                    )
                    if not member_name:
                        first_name = (
                            user_profile.get("firstName")
                            or user_profile.get("first_name")
                            or ""
                        )
                        last_name = (
                            user_profile.get("lastName")
                            or user_profile.get("last_name")
                            or ""
                        )
                        if first_name or last_name:
                            member_name = f"{first_name} {last_name}".strip()

            # Always include owner/organizer (for "Same as Friend?" feature)
            # For other members, skip only if they have no name at all
            is_owner = member_role in {"owner", "admin", "organizer"}
            if not is_owner and not member_name.strip():
                continue

            # Use a friendly label if name is empty (for owner)
            if not member_name.strip():
                member_name = "Trip Organizer"

            member_list.append(
                {
                    "userId": user_id,
                    "name": member_name,
                    "role": member_role,
                    # Include flight preferences for "Same as Friend?" feature
                    "departure_airport": m.get("departure_airport"),
                    "arrival_airport": m.get("arrival_airport"),
                    "is_round_trip": m.get("is_round_trip", True),
                    "flight_class": m.get("flight_class", "economy"),
                }
            )

        trip["members"] = member_list

        destinations = list_destinations(trip["tripId"])
        trip["destinations"], trip["firstDestination"] = (
            get_display_destinations_for_trip(destinations or [])
        )

        # Include trip's start/end airports for "Same as Friend?" feature (used for organizer who doesn't have member preferences)
        trip["startAirport"] = None
        trip["endAirport"] = None
        for dest in destinations or []:
            if dest.get("isStart") or dest.get("is_start"):
                trip["startAirport"] = dest.get("name")
            if dest.get("isEnd") or dest.get("is_end"):
                trip["endAirport"] = dest.get("name")

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
    """Join a trip using an invite code. Optional: willing_to_share_points, points_usage (freely|ask_before|do_not_use), flight preferences, budget, party size, settlement preferences."""
    try:
        result = trip_member_service.join_trip(
            user_id,
            request.invite_code,
            willing_to_share_points=request.willing_to_share_points,
            points_usage=request.points_usage or "freely",
            departure_airport=request.departure_airport,
            arrival_airport=request.arrival_airport,
            is_round_trip=(
                request.is_round_trip if request.is_round_trip is not None else True
            ),
            flight_class=request.flight_class or "economy",
            max_cash_budget=request.max_cash_budget,
            adults=request.adults if request.adults is not None else 1,
            children=request.children if request.children is not None else 0,
            max_settlement_owed=request.max_settlement_owed,
            include_settlement_in_budget=(
                request.include_settlement_in_budget
                if request.include_settlement_in_budget is not None
                else False
            ),
        )
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
    """List all members of a trip with enriched user profile data (names)"""
    try:
        from .repos import user_repo

        # Verify user has access to this trip
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Check if user is a member of the trip
        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member and trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        # Enrich member data with user profile names
        enriched_members = []
        for m in members:
            member_user_id = m.get("userId") or m.get("user_id", "")
            member_name = m.get("name", "")

            # If name is not in member record, look up the user profile
            if not member_name and member_user_id:
                user_profile = user_repo.get_user_by_id(member_user_id)
                if user_profile:
                    # Try different name fields that might exist in the user profile
                    member_name = (
                        user_profile.get("name") or user_profile.get("fullName") or ""
                    )
                    if not member_name:
                        first_name = (
                            user_profile.get("firstName")
                            or user_profile.get("first_name")
                            or ""
                        )
                        last_name = (
                            user_profile.get("lastName")
                            or user_profile.get("last_name")
                            or ""
                        )
                        if first_name or last_name:
                            member_name = f"{first_name} {last_name}".strip()

                    # If still no name, try email as a fallback (extract name from email)
                    if not member_name:
                        email = user_profile.get("email", "")
                        if email and "@" in email:
                            # Extract name part from email (before @)
                            email_name = email.split("@")[0]
                            # Clean up the email name (replace dots/underscores with spaces, capitalize)
                            email_name = (
                                email_name.replace(".", " ")
                                .replace("_", " ")
                                .replace("-", " ")
                            )
                            member_name = " ".join(
                                word.capitalize() for word in email_name.split()
                            )

            # Build enriched member object
            enriched_member = {**m}
            if member_name:
                enriched_member["name"] = member_name

            enriched_members.append(enriched_member)

        return {"members": enriched_members}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing trip members: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/members/update-preferences")
async def update_member_preferences(
    request: UpdateMemberPreferencesRequest, user_id: str = Depends(get_current_user_id)
):
    """Update current user's preferences for a trip (pooling: willing_to_share_points, points_usage)."""
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member:
            raise HTTPException(status_code=403, detail="Not a member of this trip")
        ok = trip_member_service.update_member_preferences(
            request.trip_id,
            user_id,
            willing_to_share_points=request.willing_to_share_points,
            points_usage=request.points_usage,
        )
        return {"ok": ok}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating member preferences: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdateLifecycleStateRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    lifecycle_state: str = Field(
        ...,
        description="New lifecycle state: invited, joined_no_wallet, wallet_connected, approved_for_planning, approved_for_booking, inactive",
    )


@app.post("/trips/members/lifecycle-state")
async def update_member_lifecycle_state(
    request: UpdateLifecycleStateRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Update current user's lifecycle state in a trip.

    Lifecycle states:
    - invited: Invite sent; not yet accepted
    - joined_no_wallet: Joined trip but has not linked wallets/balances
    - wallet_connected: Balances provided; not yet approved for planning
    - approved_for_planning: OK for Tripy to use in optimized plan
    - approved_for_booking: Approved allocation; ready for checklist
    - inactive: Dropped or paused; exclude from optimization

    Transitions are validated to ensure they follow the correct order.
    """
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user is a member of the trip
        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member:
            raise HTTPException(status_code=403, detail="Not a member of this trip")

        result = trip_member_service.update_member_lifecycle_state(
            request.trip_id,
            user_id,
            request.lifecycle_state,
            requesting_user_id=user_id,
        )
        return result
    except ValueError as e:
        logger.warning(f"Lifecycle state update error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating lifecycle state: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class TripBookingReadyRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)


class AdminUpdateLifecycleStateRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    target_user_id: str = Field(
        ..., min_length=1, description="User ID of the member to update"
    )
    lifecycle_state: str = Field(
        ...,
        description="New lifecycle state: invited, joined_no_wallet, wallet_connected, approved_for_planning, approved_for_booking, inactive",
    )


@app.post("/trips/members/admin/lifecycle-state")
async def admin_update_member_lifecycle_state(
    request: AdminUpdateLifecycleStateRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    """
    Admin endpoint: Update another member's lifecycle state in a trip.
    Only the trip owner can use this endpoint.

    Used for approve/deny workflows:
    - Approve: wallet_connected -> approved_for_planning (member must connect wallet first)
    - Deny/Remove: any state -> inactive

    Lifecycle states:
    - invited: Invite sent; not yet accepted
    - joined_no_wallet: Joined trip but has not linked wallets/balances
    - wallet_connected: Balances provided; not yet approved for planning
    - approved_for_planning: OK for Tripy to use in optimized plan
    - approved_for_booking: Approved allocation; ready for checklist
    - inactive: Dropped or paused; exclude from optimization

    Sends notification emails to the affected member.
    """
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Only the trip owner can update other members' states
        if trip.get("createdBy") != user_id:
            raise HTTPException(
                status_code=403, detail="Only the trip owner can manage member states"
            )

        # Verify target user is a member of the trip
        members = trip_member_service.list_members(request.trip_id)
        target_member = None
        for m in members:
            if m.get("userId") == request.target_user_id:
                target_member = m
                break

        if not target_member:
            raise HTTPException(
                status_code=404, detail="Target user is not a member of this trip"
            )

        result = trip_member_service.update_member_lifecycle_state(
            request.trip_id,
            request.target_user_id,
            request.lifecycle_state,
            requesting_user_id=user_id,
        )

        # Send notification email in background
        def send_notification():
            try:
                # Get member and organizer details
                member_user = user_service.get_user(request.target_user_id)
                organizer_user = user_service.get_user(user_id)

                member_email = member_user.get("email") if member_user else None
                member_name = (
                    member_user.get("name") or target_member.get("name") or "Traveler"
                )
                organizer_name = (
                    organizer_user.get("name")
                    if organizer_user
                    else "The trip organizer"
                )
                trip_name = trip.get("title") or "Group Trip"

                if not member_email:
                    logger.warning(
                        f"Cannot send notification: no email for user {request.target_user_id}"
                    )
                    return

                # Send appropriate email based on new lifecycle state
                if request.lifecycle_state == "approved_for_planning":
                    email_result = email_service.send_member_approved_email(
                        member_email=member_email,
                        member_name=member_name,
                        trip_id=request.trip_id,
                        trip_name=trip_name,
                        organizer_name=organizer_name,
                    )
                    if email_result.get("success"):
                        logger.info(f"Sent approval email to {member_email}")
                    else:
                        logger.error(
                            f"Failed to send approval email: {email_result.get('error')}"
                        )

                elif request.lifecycle_state == "inactive":
                    email_result = email_service.send_member_denied_email(
                        member_email=member_email,
                        member_name=member_name,
                        trip_name=trip_name,
                    )
                    if email_result.get("success"):
                        logger.info(f"Sent denial email to {member_email}")
                    else:
                        logger.error(
                            f"Failed to send denial email: {email_result.get('error')}"
                        )

            except Exception as e:
                logger.error(f"Error sending notification email: {str(e)}")

        background_tasks.add_task(send_notification)

        return result
    except ValueError as e:
        logger.warning(f"Admin lifecycle state update error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in admin lifecycle state update: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/members/booking-ready")
async def check_trip_booking_ready(
    request: TripBookingReadyRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Check if all required members are approved_for_booking.

    Returns status info about which members are ready and which are blocking.
    This is used to determine if the booking workflow can proceed.
    """
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user has access to this trip
        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member and trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        result = trip_member_service.check_booking_ready(request.trip_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking booking ready: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# HOUSEHOLD AND DELEGATION ENDPOINTS
# =============================================================================


class SetHouseholdRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    household_id: str = Field(..., min_length=1, max_length=100)


@app.post("/trips/members/household")
async def set_member_household(
    request: SetHouseholdRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Set the household_id for the current member.

    Members with the same household_id are treated as one unit for pooling
    (when pooling_scope is household_only).
    """
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user is a member
        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member:
            raise HTTPException(status_code=403, detail="Not a member of this trip")

        result = trip_member_service.set_household(
            request.trip_id,
            user_id,
            request.household_id,
        )
        return result
    except ValueError as e:
        logger.warning(f"Set household error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting household: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/trips/members/household")
async def remove_member_household(
    trip_id: str = Query(..., min_length=1), user_id: str = Depends(get_current_user_id)
):
    """Remove the household_id from the current member."""
    try:
        trip = trip_service.get_trip(trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        members = trip_member_service.list_members(trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member:
            raise HTTPException(status_code=403, detail="Not a member of this trip")

        result = trip_member_service.remove_household(trip_id, user_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing household: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class SetDelegationRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    delegate_user_id: str = Field(
        ..., min_length=1, description="User receiving delegation"
    )
    scope: str = Field(
        default="planning",
        description="Delegation scope: 'planning' (can approve plan) or 'booking' (can book)",
    )


@app.post("/trips/members/delegation")
async def set_member_delegation(
    request: SetDelegationRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Delegate booking authority to another household member.

    The delegate can approve planning/booking using your points.
    Only allowed within the same household.

    Scopes:
    - planning: Delegate can approve plans using your points
    - booking: Delegate can book using your points (includes planning)
    """
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user is a member
        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member:
            raise HTTPException(status_code=403, detail="Not a member of this trip")

        result = trip_member_service.set_delegation(
            request.trip_id,
            user_id,  # delegator
            request.delegate_user_id,
            request.scope,
        )
        return result
    except ValueError as e:
        logger.warning(f"Set delegation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting delegation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/trips/members/delegation")
async def remove_member_delegation(
    trip_id: str = Query(..., min_length=1), user_id: str = Depends(get_current_user_id)
):
    """Remove delegation from the current member."""
    try:
        trip = trip_service.get_trip(trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        members = trip_member_service.list_members(trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member:
            raise HTTPException(status_code=403, detail="Not a member of this trip")

        result = trip_member_service.remove_delegation(trip_id, user_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing delegation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class SetSponsorRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    target_user_id: str = Field(..., min_length=1, description="User to update")
    can_pay_for_others: bool = Field(..., description="Whether user can pay for others")


@app.post("/trips/members/sponsor")
async def set_member_sponsor(
    request: SetSponsorRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Set or unset the sponsor (can_pay_for_others) flag for a member.

    Only the trip owner can grant/revoke sponsor permission.
    Sponsors can pay for other members' seats when pooling_scope is sponsors_only.
    """
    try:
        result = trip_member_service.set_sponsor_flag(
            request.trip_id,
            request.target_user_id,
            request.can_pay_for_others,
            requesting_user_id=user_id,
        )
        return result
    except ValueError as e:
        logger.warning(f"Set sponsor error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting sponsor: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# PASSENGER ENDPOINTS (for dependents)
# =============================================================================


class CreatePassengerAPIRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    first_name: str = Field(..., min_length=1)
    last_name: str = Field(..., min_length=1)
    passenger_type: str = Field(default="adult", description="adult, child, or infant")
    date_of_birth: Optional[str] = Field(None, description="DOB in YYYY-MM-DD format")
    loyalty_number: Optional[str] = None
    seat_preference: Optional[str] = None
    special_needs: Optional[str] = None


@app.post("/trips/passengers")
async def create_passenger(
    request: CreatePassengerAPIRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Create a passenger (traveler) under the current member.

    Each member can add dependents (kids) as passengers.
    Trip seat count is derived from total passengers (excluding lap infants).
    """
    try:
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user is a member
        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member:
            raise HTTPException(status_code=403, detail="Not a member of this trip")

        passenger = passenger_service.create_passenger(
            trip_id=request.trip_id,
            guardian_user_id=user_id,
            first_name=request.first_name,
            last_name=request.last_name,
            passenger_type=request.passenger_type,
            date_of_birth=request.date_of_birth,
            loyalty_number=request.loyalty_number,
            seat_preference=request.seat_preference,
            special_needs=request.special_needs,
        )
        return passenger
    except ValueError as e:
        logger.warning(f"Create passenger error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating passenger: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trips/{trip_id}/passengers")
async def list_trip_passengers(
    trip_id: str, user_id: str = Depends(get_current_user_id)
):
    """
    List all passengers for a trip with summary.

    Returns total counts and passengers grouped by member.
    """
    try:
        trip = trip_service.get_trip(trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user has access
        members = trip_member_service.list_members(trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member and trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        summary = passenger_service.get_trip_passengers_summary(trip_id)
        summary["total_seats_needed"] = passenger_service.get_total_seat_count(trip_id)
        return summary
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing passengers: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/trips/passengers/{passenger_id}")
async def delete_passenger(
    passenger_id: str,
    trip_id: str = Query(..., min_length=1),
    user_id: str = Depends(get_current_user_id),
):
    """
    Delete a passenger.

    Only the guardian can delete their passengers.
    Primary passengers (the member themselves) cannot be deleted.
    """
    try:
        result = passenger_service.delete_passenger(trip_id, passenger_id, user_id)
        return result
    except ValueError as e:
        logger.warning(f"Delete passenger error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting passenger: {str(e)}")
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


class MarkStrategyPaidRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    amount: Optional[float] = None
    currency: Optional[str] = "USD"
    method: Optional[str] = None
    reference: Optional[str] = None


@app.post("/trips/strategy-paid")
async def mark_trip_strategy_paid(
    request: MarkStrategyPaidRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Mark a trip's optimization strategy as paid (owner only).

    Once paid, all group members can access the transfer instructions.
    """
    try:
        payment_info = None
        if request.amount is not None:
            payment_info = {
                "amount": request.amount,
                "currency": request.currency,
                "method": request.method,
                "reference": request.reference,
            }

        result = trip_service.mark_strategy_paid(request.trip_id, user_id, payment_info)
        return result
    except ValueError as e:
        logger.warning(f"Strategy payment error: {str(e)}")
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error marking strategy as paid: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trips/{trip_id}/strategy-status")
async def get_trip_strategy_status(
    trip_id: str, user_id: str = Depends(get_current_user_id)
):
    """
    Check if a trip's optimization strategy has been paid for.

    Any member of the trip can check this status.
    """
    try:
        # Verify user has access to this trip
        trip = trip_service.get_trip(trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Check if user is a member
        members = trip_member_service.list_members(trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member and trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        is_paid = trip.get("strategyPaid", False)
        paid_at = trip.get("strategyPaidAt")
        paid_by = trip.get("strategyPaidBy")

        return {
            "trip_id": trip_id,
            "strategy_paid": is_paid,
            "paid_at": paid_at,
            "paid_by": paid_by,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting strategy status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class UpdatePoolingScopeAPIRequest(BaseModel):
    trip_id: str = Field(..., min_length=1)
    pooling_scope: str = Field(
        ...,
        description="How points can be pooled: individual_only, household_only, full_group, sponsors_only",
    )


@app.post("/trips/pooling-scope")
async def update_trip_pooling_scope(
    request: UpdatePoolingScopeAPIRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Update the pooling scope for a trip.

    Pooling scope controls how points can be shared across travelers:
    - individual_only: No cross-person pooling; each pays for their own seats
    - household_only: Pool only within each household_id; no cross-family pooling
    - full_group: Optimizer can use any willing member's points for any traveler
    - sponsors_only: Only sponsors (can_pay_for_others) can pay for others' seats

    Only the trip owner can change pooling scope.
    Changing pooling scope invalidates any existing plan (requires re-optimization).
    """
    try:
        result = trip_service.update_pooling_scope(
            request.trip_id,
            user_id,
            request.pooling_scope,
        )
        return result
    except ValueError as e:
        logger.warning(f"Update pooling scope error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating pooling scope: {str(e)}")
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
        # Verify user has access to this trip (owner OR member)
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member and trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        destinations = destination_service.list_destinations(request.trip_id)
        scores = destination_service.scores(request.trip_id)
        return {"destinations": destinations, "scores": scores.get("scores", {})}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing destinations: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/destinations/remove")
async def remove_destination(
    request: RemoveDestinationRequest, user_id: str = Depends(get_current_user_id)
):
    """Remove a destination from a trip. Only the trip owner can remove destinations."""
    try:
        # Verify user has access and is the owner
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.get("createdBy") != user_id:
            raise HTTPException(
                status_code=403, detail="Only the trip owner can remove destinations"
            )

        # Check destination exists
        dest = destination_service.get_destination(
            request.trip_id, request.destination_id
        )
        if not dest:
            raise HTTPException(status_code=404, detail="Destination not found")

        success = destination_service.remove_destination(
            request.trip_id, request.destination_id
        )
        if not success:
            raise HTTPException(status_code=500, detail="Failed to remove destination")

        return {"ok": True, "message": "Destination removed"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing destination: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/destinations/update")
async def update_destination(
    request: UpdateDestinationRequest, user_id: str = Depends(get_current_user_id)
):
    """Update a destination (dates, must_include, excluded). Only the trip owner can update."""
    try:
        # Verify user has access and is the owner
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.get("createdBy") != user_id:
            raise HTTPException(
                status_code=403, detail="Only the trip owner can update destinations"
            )

        # Check destination exists
        dest = destination_service.get_destination(
            request.trip_id, request.destination_id
        )
        if not dest:
            raise HTTPException(status_code=404, detail="Destination not found")

        updated = destination_service.update_destination(
            request.trip_id,
            request.destination_id,
            arrival_date=request.arrival_date,
            departure_date=request.departure_date,
            must_include=request.must_include,
            excluded=request.excluded,
        )

        if not updated:
            raise HTTPException(status_code=500, detail="Failed to update destination")

        return {"ok": True, "destination": updated}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating destination: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Points endpoints (require authentication)
@app.post("/points/upsert")
async def upsert_points(
    request: UpsertPointsRequest, user_id: str = Depends(get_current_user_id)
):
    """Add or update points for a user's program in a trip"""
    try:
        # Verify user has access to this trip (owner OR member)
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member and trip.get("createdBy") != user_id:
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
        # Verify user has access to this trip (owner OR member)
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member and trip.get("createdBy") != user_id:
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


# ============================================================================
# Points Estimation (supports anonymous users)
# ============================================================================

# Conservative default balances for common cards (annual spending estimates)
ESTIMATED_CARD_BALANCES = {
    # Bank points (transferable) — conservative estimates
    "amex_mr": {
        "card": "Amex Gold",
        "balance": 60000,
        "label": "Amex Membership Rewards",
    },
    "amex_mr_platinum": {
        "card": "Amex Platinum",
        "balance": 100000,
        "label": "Amex Membership Rewards",
    },
    "chase_ur": {
        "card": "Chase Sapphire Preferred",
        "balance": 50000,
        "label": "Chase Ultimate Rewards",
    },
    "chase_ur_reserve": {
        "card": "Chase Sapphire Reserve",
        "balance": 80000,
        "label": "Chase Ultimate Rewards",
    },
    "citi_typ": {
        "card": "Citi Premier",
        "balance": 40000,
        "label": "Citi ThankYou Points",
    },
    "capital_one": {
        "card": "Capital One Venture X",
        "balance": 50000,
        "label": "Capital One Miles",
    },
    "bilt": {"card": "Bilt Mastercard", "balance": 30000, "label": "Bilt Rewards"},
}

# Pre-configured common card situations for "Confirm My Situation"
COMMON_CARD_PRESETS = [
    {
        "id": "amex_gold",
        "name": "Amex Gold",
        "program": "amex_mr",
        "estimated_balance": 60000,
        "usable_label": "~60,000 MR points",
        "icon": "amex",
    },
    {
        "id": "amex_platinum",
        "name": "Amex Platinum",
        "program": "amex_mr",
        "estimated_balance": 100000,
        "usable_label": "~100,000 MR points",
        "icon": "amex",
    },
    {
        "id": "chase_sapphire_preferred",
        "name": "Chase Sapphire Preferred",
        "program": "chase_ur",
        "estimated_balance": 50000,
        "usable_label": "~50,000 UR points",
        "icon": "chase",
    },
    {
        "id": "chase_sapphire_reserve",
        "name": "Chase Sapphire Reserve",
        "program": "chase_ur",
        "estimated_balance": 80000,
        "usable_label": "~80,000 UR points",
        "icon": "chase",
    },
    {
        "id": "capital_one_venture_x",
        "name": "Capital One Venture X",
        "program": "capital_one",
        "estimated_balance": 50000,
        "usable_label": "~50,000 miles",
        "icon": "capitalone",
    },
    {
        "id": "citi_premier",
        "name": "Citi Premier",
        "program": "citi_typ",
        "estimated_balance": 40000,
        "usable_label": "~40,000 TYP",
        "icon": "citi",
    },
    {
        "id": "bilt",
        "name": "Bilt Mastercard",
        "program": "bilt",
        "estimated_balance": 30000,
        "usable_label": "~30,000 Bilt points",
        "icon": "bilt",
    },
]


@app.get("/points/card-presets")
async def get_card_presets():
    """
    Get pre-configured common card presets for the 'Confirm My Situation' UI.
    No auth required — works for anonymous users.
    """
    return {"presets": COMMON_CARD_PRESETS}


class EstimatePointsRequest(BaseModel):
    """Request to estimate points for selected cards."""

    card_ids: List[str] = Field(
        ..., description="List of card preset IDs the user selected"
    )


@app.post("/points/estimate")
async def estimate_points(request: EstimatePointsRequest):
    """
    Estimate points balances for users who select 'Estimate for me.'
    Uses conservative defaults. No auth required.

    Returns estimated balances with confidence='estimated' so the optimizer
    can bias toward safer itineraries.
    """
    estimated_points = []
    preset_lookup = {p["id"]: p for p in COMMON_CARD_PRESETS}

    for card_id in request.card_ids:
        preset = preset_lookup.get(card_id)
        if preset:
            estimated_points.append(
                {
                    "program": preset["program"],
                    "balance": preset["estimated_balance"],
                    "confidence": "estimated",
                    "owner_type": "anon",
                    "card_name": preset["name"],
                }
            )

    return {
        "estimated_points": estimated_points,
        "disclaimer": "These are conservative estimates. Sign in to use your exact balances.",
    }


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

        # Check if optimization has already been generated (prevent multiple runs)
        if trip.get("optimizationGenerated"):
            # Return existing itinerary instead of re-running optimization
            existing_items = itinerary_service.get_itinerary(request.trip_id)
            return {
                "status": "AlreadyGenerated",
                "solution": {},
                "items": existing_items,
                "message": "Optimization has already been generated for this trip. Returning existing results.",
            }

        # Generate optimized itinerary using points maximization
        result = await itinerary_service.generate_optimized_itinerary(
            request.trip_id, optimization_mode=request.optimization_mode
        )

        # Mark optimization as generated (only if successful)
        if result.get("status") == "Optimal" or result.get("items"):
            trip_service.mark_optimization_generated(request.trip_id)

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
                    "button_text": "Change Dates",
                },
                {
                    "action_type": "increase_budget",
                    "title": "Increase Budget",
                    "description": "Your budget may be too low for this route",
                    "button_text": "Update Budget",
                },
                {
                    "action_type": "modify_destinations",
                    "title": "Modify Destinations",
                    "description": "Some routes may not have available flights",
                    "button_text": "Edit Destinations",
                },
            ],
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
                    "button_text": "Retry",
                },
                {
                    "action_type": "simplify_trip",
                    "title": "Simplify Trip",
                    "description": "Try fewer destinations or more flexible dates",
                    "button_text": "Edit Trip",
                },
            ],
        }
        return error_response


# ── SSE streaming generation endpoint ──────────────────────────────────────
@app.post("/itinerary/generate-stream")
async def generate_itinerary_stream(
    request: GenerateStreamRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Stream itinerary generation progress via SSE. Falls back to SQS for
    complex trips and returns a QUEUED event so the client can poll."""
    import asyncio
    import uuid as _uuid
    from starlette.concurrency import run_in_threadpool
    from starlette.responses import StreamingResponse
    from src.models.sse_events import (
        format_sse, format_sse_comment, format_sse_retry,
        SSEEvent, StatusValue, SeqCounter,
    )
    from src.repos import itinerary_repo
    from src.config import GENERATION_LOCK_STALE_SECONDS

    trip = await run_in_threadpool(trip_service.get_trip, request.trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if trip.get("createdBy") != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    seq = SeqCounter(request.trip_id)
    request_id = request.request_id or str(_uuid.uuid4())

    # -- Idempotency: try to acquire trip-level generation lock --
    job_id = str(_uuid.uuid4())
    now_iso = datetime.utcnow().isoformat() + "Z"
    from datetime import timedelta
    stale_threshold = (datetime.utcnow() - timedelta(seconds=GENERATION_LOCK_STALE_SECONDS)).isoformat() + "Z"

    lock_item = {
        "tripId": request.trip_id,
        "itemId": "__generation_lock__",
        "jobId": job_id,
        "requestId": request_id,
        "status": "processing",
        "lastHeartbeatAt": now_iso,
        "createdAt": now_iso,
    }
    lock_acquired = await run_in_threadpool(
        itinerary_repo.put_item_conditional,
        lock_item,
        "attribute_not_exists(itemId) OR #s IN (:complete, :error) OR lastHeartbeatAt < :stale",
        {"#s": "status"},
        {":complete": "complete", ":error": "error", ":stale": stale_threshold},
    )

    if not lock_acquired:
        existing_lock = await run_in_threadpool(
            itinerary_repo.get_generation_lock, request.trip_id,
        )
        if existing_lock and existing_lock.get("status") in ("complete",):
            evt = seq.next_event(
                type="status", status=StatusValue.COMPLETE,
                itineraryVersion=int(trip.get("itineraryVersion", 1)),
            )
            async def _cached():
                yield format_sse_retry(3000)
                yield format_sse(evt)
            return StreamingResponse(
                _cached(), media_type="text/event-stream",
                headers=_sse_headers(),
            )
        if existing_lock:
            evt = seq.next_event(
                type="status", status=StatusValue.ALREADY_PROCESSING,
                jobId=existing_lock.get("jobId"),
                message="Generation already in progress for this trip.",
            )
            async def _already():
                yield format_sse_retry(3000)
                yield format_sse(evt)
            return StreamingResponse(
                _already(), media_type="text/event-stream",
                headers=_sse_headers(),
            )

    # Cached result fast-path
    if trip.get("optimizationGenerated"):
        evt = seq.next_event(
            type="status", status=StatusValue.COMPLETE,
            itineraryVersion=int(trip.get("itineraryVersion", 1)),
        )
        async def _done():
            yield format_sse_retry(3000)
            yield format_sse(evt)
        return StreamingResponse(
            _done(), media_type="text/event-stream",
            headers=_sse_headers(),
        )

    # -- Stream the generation via asyncio.Queue for heartbeat interleaving --
    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        yield format_sse_retry(3000)

        async def heartbeat():
            while True:
                await asyncio.sleep(15)
                try:
                    queue.put_nowait(format_sse_comment("keep-alive"))
                except asyncio.QueueFull:
                    pass

        async def generate():
            try:
                async for evt in itinerary_service.generate_optimized_itinerary_stream(
                    request.trip_id,
                    request.optimization_mode,
                    request_id,
                    allow_queue=True,
                ):
                    await queue.put(format_sse(evt))
            except Exception as exc:
                logger.exception("SSE generation error for trip %s", request.trip_id)
                error_evt = seq.next_event(
                    type="status", status=StatusValue.ERROR,
                    error={
                        "code": "INTERNAL_ERROR",
                        "userMessage": "An unexpected error occurred.",
                        "debugId": request_id,
                    },
                )
                await queue.put(format_sse(error_evt))
            finally:
                await queue.put(None)

        hb_task = asyncio.create_task(heartbeat())
        gen_task = asyncio.create_task(generate())

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            hb_task.cancel()
            if not gen_task.done():
                gen_task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=_sse_headers(),
    )


@app.get("/itinerary/jobs/latest/{trip_id}")
async def get_latest_job_status(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Polling endpoint: returns latest generation job status for a trip."""
    from starlette.concurrency import run_in_threadpool
    from src.repos import itinerary_repo

    trip = await run_in_threadpool(trip_service.get_trip, trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    if trip.get("createdBy") != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    job = await run_in_threadpool(itinerary_repo.get_latest_job, trip_id)
    if not job:
        raise HTTPException(status_code=404, detail="No generation job found for this trip")
    return job


def _sse_headers() -> dict:
    return {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }


@app.post("/itinerary/get")
async def get_itinerary(
    request: TripIdRequest, user_id: str = Depends(get_current_user_id)
):
    """Get itinerary for a trip"""
    try:
        # Verify user has access to this trip (owner OR member)
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        members = trip_member_service.list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if not is_member and trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        items = itinerary_service.get_itinerary(request.trip_id)
        return {"items": items}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting itinerary: {str(e)}")
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
                c["transport_modes"] = (
                    ["flight", "bus", "car"]
                    if c.get("airport_code")
                    else ["bus", "car"]
                )
        return {"cities": cities}
    except Exception as e:
        logger.error(f"Error in locations_autocomplete for q='{q}': {e}", exc_info=True)
        # Fallback to city_service if OpenAI fails
        try:
            cities = city_service.search_cities_for_autocomplete(q, max_results=limit)
            for c in cities:
                if "transport_modes" not in c:
                    c["transport_modes"] = (
                        ["flight", "bus", "car"]
                        if c.get("airport_code")
                        else ["bus", "car"]
                    )
            return {"cities": cities}
        except Exception as fallback_error:
            logger.error(
                f"Fallback city search also failed: {fallback_error}", exc_info=True
            )
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
                timeout=8.0,  # 8 second timeout (less than App Runner's 30s)
            )
            logger.info(f"Returning {len(airports)} airports for query '{q}'")
            return {"airports": airports}
        except asyncio.TimeoutError:
            logger.warning(
                f"Airport search timed out for query '{q}', returning empty results"
            )
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
    exclude_regions: bool = Query(
        False, description="Exclude region-level suggestions"
    ),
    fuzzy_fallback: bool = Query(
        True, description="Use fuzzy search on CSV when SerpAPI returns nothing"
    ),
    commercial_only: bool = Query(
        False, description="If True, only commercial airports (scheduled service)"
    ),
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
                    q,
                    gl=gl,
                    hl=hl,
                    exclude_regions=exclude_regions,
                    commercial_only=commercial_only,
                ),
                timeout=8.0,  # 8 second timeout
            )

            if not suggestions and fuzzy_fallback:
                # Try fuzzy fallback with shorter timeout
                try:
                    suggestions = await asyncio.wait_for(
                        asyncio.to_thread(
                            fuzzy_search_destinations,
                            q,
                            max_results=limit,
                            commercial_only=commercial_only,
                        ),
                        timeout=2.0,  # 2 second timeout for fallback
                    )
                except asyncio.TimeoutError:
                    logger.warning(f"Fuzzy search timed out for query '{q}'")
                    suggestions = []

            return {"suggestions": (suggestions or [])[:limit]}
        except asyncio.TimeoutError:
            logger.warning(
                f"Destination autocomplete timed out for query '{q}', returning empty results"
            )
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
    Optimize point transfer strategy to minimize out-of-pocket costs for flights.

    This endpoint analyzes all flights for a trip and determines:
    1. Which items to pay with cash vs points
    2. Which bank points to transfer to which programs
    3. Step-by-step transfer instructions

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

        # If trip_id provided, fetch trip data
        if body.trip_id:
            # TODO: Fetch trip's flights from itinerary service
            pass

        solution = await optimize_trip_out_of_pocket(
            flight_edges=flights,
            user_points=body.available_points,
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
    Simulate optimal point allocation for given flight expenses (no trip required).

    Useful for "what if" scenarios to see how points would be allocated
    before creating a trip.

    Example request:
    {
        "available_points": {"amex": 1000000, "chase": 150000},
        "expenses": [
            {"type": "flight", "description": "JFK to CDG", "cash_cost": 800,
             "points_options": [{"program_code": "AF", "points_required": 60000, "surcharge": 150}]}
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

        # Convert expenses to TripCostItems (flights only)
        items = []
        for i, exp in enumerate(body.expenses):
            points_opts = []
            for opt in exp.get("points_options", []):
                points_opts.append(
                    PointsOption(
                        program_code=opt.get("program_code", ""),
                        program_type=opt.get("program_type", "airline"),
                        points_required=int(opt.get("points_required", 0)),
                        surcharge=float(opt.get("surcharge", 0)),
                    )
                )

            items.append(
                TripCostItem(
                    item_id=f"flight_{i}",
                    item_type="flight",
                    description=exp.get("description", f"Flight {i+1}"),
                    cash_cost=float(exp.get("cash_cost", 0)),
                    points_options=points_opts,
                )
            )

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
    program: Optional[str] = Query(
        None, description="Bank program code (e.g., amex, chase)"
    ),
    program_type: Optional[str] = Query(None, description="Filter by 'airline'"),
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
                        "name": EXTENDED_TRANSFER_GRAPH.get(program.lower(), {})
                        .get(p, {})
                        .get("name", p),
                        "type": EXTENDED_TRANSFER_GRAPH.get(program.lower(), {})
                        .get(p, {})
                        .get("type", "airline"),
                        "ratio": EXTENDED_TRANSFER_GRAPH.get(program.lower(), {})
                        .get(p, {})
                        .get("ratio", 1.0),
                    }
                    for p in partners
                    if not program_type
                    or EXTENDED_TRANSFER_GRAPH.get(program.lower(), {})
                    .get(p, {})
                    .get("type")
                    == program_type
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
                partner_list.append(
                    {
                        "code": code,
                        "name": info.get("name", code),
                        "type": info.get("type", "airline"),
                        "ratio": info.get("ratio", 1.0),
                    }
                )
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
    Get current total savings and points used for the user.
    Returns the cached values from the user profile.
    """
    try:
        user = user_service.ensure_user_exists(user_id)
        return {
            "total_savings": user.get("total_savings", 0),
            "total_points_used": user.get("total_points_used", 0),
            "user_id": user_id,
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
                status_code=404, detail=f"No members found for trip {trip_id}"
            )

        # Get each member's points
        for member in members_data:
            member_id = member.get("user_id")
            if member_id:
                points = points_service.get_user_points_for_trip(trip_id, member_id)
                member["points"] = {
                    p.get("program"): p.get("balance")
                    for p in points
                    if p.get("balance")
                }

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
    It searches for flights, runs the ILP optimizer, calculates
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
                detail="No members found for trip. Add members before optimizing.",
            )

        # Get each member's points
        for member in members_data:
            member_id = member.get("user_id")
            if member_id:
                points = points_service.get_user_points_for_trip(trip_id, member_id)
                member["points"] = {
                    p.get("program"): p.get("balance")
                    for p in points
                    if p.get("balance")
                }

        # Get destinations and separate start/end from visit destinations
        all_destinations = destination_service.list_destinations(trip_id)
        if not all_destinations:
            raise HTTPException(
                status_code=400,
                detail="No destinations found for trip. Add destinations before optimizing.",
            )

        # Separate start, end, and visit destinations
        # Start/end are where the user departs from and returns to (e.g., Seattle)
        # Visit destinations are where they want to meet up (e.g., Paris, Amsterdam, Prague)
        start_dest = next((d for d in all_destinations if d.get("isStart")), None)
        end_dest = next((d for d in all_destinations if d.get("isEnd")), None)

        # Fallback: use mustInclude order if isStart/isEnd not set
        must_include = [d for d in all_destinations if d.get("mustInclude", False)]
        if not start_dest and must_include:
            start_dest = must_include[0]
        if not end_dest and must_include:
            end_dest = must_include[-1]

        # Final fallback: first and last destinations
        if not start_dest and all_destinations:
            start_dest = all_destinations[0]
        if not end_dest and all_destinations:
            end_dest = (
                all_destinations[-1]
                if len(all_destinations) > 1
                else all_destinations[0]
            )

        # Get start/end destination IDs to filter them out
        start_dest_id = start_dest.get("destinationId") if start_dest else None
        end_dest_id = end_dest.get("destinationId") if end_dest else None

        # Visit destinations: all destinations that are NOT start/end and NOT excluded
        visit_destinations = [
            d
            for d in all_destinations
            if d.get("destinationId") not in (start_dest_id, end_dest_id)
            and not d.get("excluded", False)
        ]

        # Log the parsed destinations
        start_name = start_dest.get("name", "Unknown") if start_dest else "None"
        end_name = end_dest.get("name", "Unknown") if end_dest else "None"
        visit_names = [d.get("name", "Unknown") for d in visit_destinations]
        logger.info(
            f"Group optimization: Start={start_name}, End={end_name}, Visit={visit_names}"
        )

        if not visit_destinations:
            raise HTTPException(
                status_code=400,
                detail="No visit destinations found. Add destinations to visit (besides start/end) before optimizing.",
            )

        # TODO: Search for actual flight options
        # For now, use placeholder booking items
        # In production, this would call AwardTool API
        booking_items_data = []

        # Create booking items for EACH member to EACH visit destination
        # Members fly from their departure airport to each visit destination
        for member_idx, member in enumerate(members_data):
            member_id = member.get("user_id")
            member_name = member.get("name", f"Member {member_idx + 1}")
            party_size = member.get(
                "party_size", 1
            )  # Support multiple travelers per member
            member_departure = member.get("departure_airport") or (
                start_dest.get("name") if start_dest else "JFK"
            )

            for dest_idx, dest in enumerate(visit_destinations):
                dest_name = dest.get("name", "Unknown")

                # Create flight item for this member to this visit destination
                booking_items_data.append(
                    {
                        "item_id": f"flight_{member_idx}_{dest_idx}",
                        "type": "flight",
                        "member_id": member_id,
                        "origin": member_departure,
                        "destination": dest_name,
                        "description": f"Flight to {dest_name} for {member_name}",
                        "cash_cost": 500.0,  # Placeholder - should come from flight search
                        "party_size": party_size,  # How many travelers in this booking
                        "points_options": [
                            {
                                "program_code": "UA",
                                "points_required": 30000,
                                "surcharge": 50,
                            },
                            {
                                "program_code": "AA",
                                "points_required": 35000,
                                "surcharge": 45,
                            },
                        ],
                    }
                )

        # Log group optimization context
        logger.info(
            f"Group OOP optimization: {len(members_data)} members, "
            f"{len(visit_destinations)} visit destinations, {len(booking_items_data)} booking items"
        )
        for m in members_data:
            logger.info(
                f"  Member {m.get('user_id')}: points={m.get('points', {})}, "
                f"budget={m.get('max_cash_budget') or m.get('max_budget', 'unlimited')}"
            )

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
                member["points"] = {
                    p.get("program"): p.get("balance")
                    for p in points
                    if p.get("balance")
                }

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


# =============================================================================
# SETTLEMENT CONFIGURATION ENDPOINTS (Task 17)
# =============================================================================

# In-memory storage for settlement configs (would be DynamoDB in production)
_settlement_configs: Dict[str, Dict[str, Any]] = {}


def get_settlement_config(trip_id: str) -> Dict[str, Any]:
    """Get settlement config for a trip, with defaults if not set."""
    if trip_id in _settlement_configs:
        return _settlement_configs[trip_id]

    # Return defaults
    return {
        "policy": SettlementPolicy.PAY_YOUR_OWN.value,
        "valuation": {
            "mode": PointsValuationMode.MARKET_IMPLIED.value,
            "fixed_rates_cpp": {},
            "min_cpp": 0.5,
            "max_cpp": 5.0,
            "reimburse_points_value": True,
        },
        "include_taxes_in_split": True,
        "custom_obligations": {},
    }


def save_settlement_config(trip_id: str, config: Dict[str, Any]):
    """Save settlement config for a trip."""
    _settlement_configs[trip_id] = config


@app.get("/trips/{trip_id}/settlement-config")
async def get_trip_settlement_config(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get the settlement configuration for a trip.

    Returns the policy, valuation mode, and all settings with descriptions.
    """
    try:
        trip = trip_service.get_trip(trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        config = get_settlement_config(trip_id)
        policy = SettlementPolicy(config.get("policy", "pay_your_own"))
        valuation = config.get("valuation", {})
        valuation_mode = PointsValuationMode(valuation.get("mode", "market_implied"))

        policy_desc = SETTLEMENT_POLICY_DESCRIPTIONS.get(policy, {})
        valuation_desc = POINTS_VALUATION_DESCRIPTIONS.get(valuation_mode, {})

        return {
            "trip_id": trip_id,
            "policy": policy.value,
            "policy_name": policy_desc.get("name", policy.value),
            "policy_short": policy_desc.get("short", ""),
            "policy_description": policy_desc.get("description", ""),
            "valuation": {
                "mode": valuation_mode.value,
                "mode_name": valuation_desc.get("name", valuation_mode.value),
                "mode_short": valuation_desc.get("short", ""),
                "mode_description": valuation_desc.get("description", ""),
                "fixed_rates_cpp": valuation.get("fixed_rates_cpp", {}),
                "min_cpp": valuation.get("min_cpp", 0.5),
                "max_cpp": valuation.get("max_cpp", 5.0),
                "reimburse_points_value": valuation.get("reimburse_points_value", True),
            },
            "include_taxes_in_split": config.get("include_taxes_in_split", True),
            "custom_obligations": config.get("custom_obligations", {}),
            "available_policies": [
                {
                    "value": p.value,
                    "name": SETTLEMENT_POLICY_DESCRIPTIONS[p]["name"],
                    "short": SETTLEMENT_POLICY_DESCRIPTIONS[p]["short"],
                    "description": SETTLEMENT_POLICY_DESCRIPTIONS[p]["description"],
                }
                for p in SettlementPolicy
            ],
            "available_valuation_modes": [
                {
                    "value": m.value,
                    "name": POINTS_VALUATION_DESCRIPTIONS[m]["name"],
                    "short": POINTS_VALUATION_DESCRIPTIONS[m]["short"],
                    "description": POINTS_VALUATION_DESCRIPTIONS[m]["description"],
                }
                for m in PointsValuationMode
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting settlement config: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/{trip_id}/settlement-config")
async def update_trip_settlement_config(
    trip_id: str,
    request: UpdateSettlementConfigRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Update the settlement configuration for a trip.

    Can update policy, valuation mode, fixed rates, and other settings.
    """
    try:
        trip = trip_service.get_trip(trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Get current config
        config = get_settlement_config(trip_id)

        # Update policy
        if request.policy is not None:
            config["policy"] = request.policy.value

        # Update valuation
        valuation = config.get("valuation", {})
        if request.valuation_mode is not None:
            valuation["mode"] = request.valuation_mode.value
        if request.fixed_rates_cpp is not None:
            valuation["fixed_rates_cpp"] = request.fixed_rates_cpp
        if request.min_cpp is not None:
            valuation["min_cpp"] = request.min_cpp
        if request.max_cpp is not None:
            valuation["max_cpp"] = request.max_cpp
        if request.reimburse_points_value is not None:
            valuation["reimburse_points_value"] = request.reimburse_points_value
        config["valuation"] = valuation

        # Update other settings
        if request.include_taxes_in_split is not None:
            config["include_taxes_in_split"] = request.include_taxes_in_split
        if request.custom_obligations is not None:
            config["custom_obligations"] = request.custom_obligations

        # Save
        save_settlement_config(trip_id, config)

        logger.info(
            f"Updated settlement config for trip {trip_id}: policy={config.get('policy')}"
        )

        return {
            "ok": True,
            "trip_id": trip_id,
            "policy": config.get("policy"),
            "valuation_mode": valuation.get("mode"),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating settlement config: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# SETTLEMENT ENGINE ENDPOINTS (Task 18)
# =============================================================================

from .services import settlement_engine


class ComputeSettlementRequest(BaseModel):
    """Request to compute settlement for a trip."""

    tickets: List[Dict[str, Any]] = Field(default_factory=list)
    allocations: List[Dict[str, Any]] = Field(default_factory=list)
    # Override valuation config (optional)
    override_valuation: Optional[Dict[str, Any]] = None
    override_policy: Optional[str] = None


@app.post("/trips/{trip_id}/settlement/compute")
async def compute_trip_settlement(
    trip_id: str,
    request: ComputeSettlementRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Compute settlement for a trip.

    Uses the trip's settlement config unless overrides are provided.
    Returns obligations, contributions, net balances, and reimbursement transfers.
    """
    try:
        trip = trip_service.get_trip(trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Get members and passengers
        members = trip_member_service.list_members(trip_id)
        passengers = passenger_service.list_passengers(trip_id)

        # Enrich members with user names
        for member in members:
            member_user_id = member.get("userId") or member.get("user_id")
            if member_user_id and not member.get("name"):
                user_data = user_service.get_user(member_user_id)
                if user_data and user_data.get("name"):
                    member["name"] = user_data["name"]
                elif user_data and user_data.get("email"):
                    # Fall back to email username if no name set
                    member["name"] = user_data["email"].split("@")[0]

        # Get settlement config
        config = get_settlement_config(trip_id)

        # Apply overrides if provided
        policy = request.override_policy or config.get("policy", "pay_your_own")
        valuation_config = request.override_valuation or config.get("valuation", {})

        # Compute settlement
        result = settlement_engine.compute_settlement(
            tickets=request.tickets,
            allocations=request.allocations,
            passengers=passengers,
            members=members,
            policy=policy,
            valuation_config=valuation_config,
            custom_obligations=config.get("custom_obligations"),
        )

        return settlement_engine.settlement_result_to_dict(result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error computing settlement: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trips/{trip_id}/settlement/preview")
async def preview_trip_settlement(
    trip_id: str,
    policy: Optional[str] = None,
    reimburse_points: Optional[bool] = None,
    user_id: str = Depends(get_current_user_id),
):
    """
    Preview settlement with different policies.

    Useful for comparing how different policies affect the split.
    """
    try:
        trip = trip_service.get_trip(trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Get current data
        members = trip_member_service.list_members(trip_id)
        passengers = passenger_service.list_passengers(trip_id)

        # Enrich members with user names
        for member in members:
            member_user_id = member.get("userId") or member.get("user_id")
            if member_user_id and not member.get("name"):
                user_data = user_service.get_user(member_user_id)
                if user_data and user_data.get("name"):
                    member["name"] = user_data["name"]
                elif user_data and user_data.get("email"):
                    # Fall back to email username if no name set
                    member["name"] = user_data["email"].split("@")[0]

        # Get ledger to derive tickets/allocations
        ledger = ledger_service.get_ledger(trip_id)

        # Build tickets from ledger entries
        tickets = []
        allocations = []

        if ledger:
            for entry in ledger.entries:
                if entry.entry_type.value in ("cash_payment", "points_contribution"):
                    # Create ticket-like structure
                    tickets.append(
                        {
                            "passenger_id": entry.beneficiary_passenger_id,
                            "base_fare_cash": (
                                entry.cash_amount
                                if entry.entry_type.value == "cash_payment"
                                else 0
                            ),
                            "taxes_fees_cash": 0,
                        }
                    )

                    # Create allocation-like structure
                    allocations.append(
                        {
                            "payer_user_id": entry.payer_user_id,
                            "payment_type": "points" if entry.points_amount else "cash",
                            "cash_amount": entry.cash_amount,
                            "points_used": entry.points_amount,
                            "points_program": entry.points_program,
                        }
                    )

        # Get config with overrides
        config = get_settlement_config(trip_id)
        if policy:
            config["policy"] = policy
        if reimburse_points is not None:
            valuation = config.get("valuation", {})
            valuation["reimburse_points_value"] = reimburse_points
            config["valuation"] = valuation

        # Compute
        result = settlement_engine.compute_settlement(
            tickets=tickets,
            allocations=allocations,
            passengers=passengers,
            members=members,
            policy=config.get("policy", "pay_your_own"),
            valuation_config=config.get("valuation", {}),
            custom_obligations=config.get("custom_obligations"),
        )

        return settlement_engine.settlement_result_to_dict(result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error previewing settlement: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# BOOKING WORKFLOW ENDPOINTS (Tasks 09-13)
# =============================================================================

from .services import booking_workflow, ledger_service


class CreateBookingSessionRequest(BaseModel):
    """Request to create a booking session from a plan."""

    plan_id: str = Field(..., min_length=1)
    plan_allocation: Dict[str, Any] = Field(default_factory=dict)
    transfer_plan: List[Dict[str, Any]] = Field(default_factory=list)


class UpdateChecklistStepRequest(BaseModel):
    """Request to update a checklist step."""

    step_id: str = Field(..., min_length=1)
    status: str = Field(..., description="pending, in_progress, completed, failed")
    confirmation_value: Optional[str] = None
    failure_reason: Optional[str] = None


class ApprovalSubmitRequest(BaseModel):
    """Request to submit an approval or veto."""

    plan_id: str = Field(..., min_length=1)
    approve: bool = True
    veto_reason: Optional[str] = None
    veto_constraints: Optional[Dict[str, Any]] = None


@app.post("/trips/{trip_id}/booking-session")
async def create_booking_session(
    trip_id: str,
    request: CreateBookingSessionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Create a booking session from an approved plan.

    Generates the step-by-step checklist for executing bookings.
    """
    try:
        # Get members and passengers
        members = trip_member_service.list_members(trip_id)
        passengers = passenger_service.list_passengers(trip_id)

        # Get booking dependencies
        dependencies = booking_workflow.get_booking_dependencies(
            request.plan_allocation,
            request.transfer_plan,
        )

        # Generate session
        session = booking_workflow.generate_booking_checklist(
            plan_id=request.plan_id,
            trip_id=trip_id,
            plan_allocation=request.plan_allocation,
            transfer_plan=request.transfer_plan,
            members=members,
            dependencies=dependencies,
        )

        return booking_workflow.booking_session_to_dict(session)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating booking session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trips/{trip_id}/booking-session/{session_id}")
async def get_booking_session(
    trip_id: str,
    session_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get a booking session by ID."""
    session = booking_workflow.get_booking_session(session_id)
    if not session or session.trip_id != trip_id:
        raise HTTPException(status_code=404, detail="Session not found")
    return booking_workflow.booking_session_to_dict(session)


@app.post("/trips/{trip_id}/booking-session/{session_id}/step")
async def update_checklist_step(
    trip_id: str,
    session_id: str,
    request: UpdateChecklistStepRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Update a checklist step status.

    Used to mark steps as completed, failed, etc.
    """
    try:
        from .services.booking_workflow import ChecklistStepStatus

        step = booking_workflow.update_checklist_step(
            session_id=session_id,
            step_id=request.step_id,
            status=ChecklistStepStatus(request.status),
            confirmation_value=request.confirmation_value,
            failure_reason=request.failure_reason,
        )

        return {
            "ok": True,
            "step_id": step.step_id,
            "status": step.status.value,
            "confirmation_value": step.confirmation_value,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating step: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/{trip_id}/risk-assessment")
async def get_risk_assessment(
    trip_id: str,
    request: CreateBookingSessionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Calculate risk score for a booking plan.

    Returns risk level (low/medium/high), score, and explanations.
    """
    try:
        members = trip_member_service.list_members(trip_id)
        passengers = passenger_service.list_passengers(trip_id)

        assessment = booking_workflow.calculate_risk_score(
            plan_allocation=request.plan_allocation,
            transfer_plan=request.transfer_plan,
            members=members,
            passengers=passengers,
        )

        return booking_workflow.risk_assessment_to_dict(assessment)
    except Exception as e:
        logger.error(f"Error calculating risk: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/{trip_id}/approvals")
async def create_approvals(
    trip_id: str,
    request: CreateBookingSessionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Create approval requests for all members who need to approve.
    """
    try:
        members = trip_member_service.list_members(trip_id)
        passengers = passenger_service.list_passengers(trip_id)

        approvals = booking_workflow.create_approval_requests(
            plan_id=request.plan_id,
            members=members,
            passengers=passengers,
            plan_allocation=request.plan_allocation,
        )

        return {
            "plan_id": request.plan_id,
            "approvals_created": len(approvals),
            "approvals": [
                {
                    "approval_id": a.approval_id,
                    "user_id": a.user_id,
                    "user_name": a.user_name,
                    "approving_for": a.approving_for,
                    "status": a.status.value,
                    "expires_at": a.expires_at,
                }
                for a in approvals
            ],
        }
    except Exception as e:
        logger.error(f"Error creating approvals: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/trips/{trip_id}/approvals/submit")
async def submit_approval(
    trip_id: str,
    request: ApprovalSubmitRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Submit an approval or veto for a plan.
    """
    try:
        approval = booking_workflow.submit_approval(
            plan_id=request.plan_id,
            user_id=user_id,
            approve=request.approve,
            veto_reason=request.veto_reason,
            veto_constraints=request.veto_constraints,
        )

        # Get updated summary
        summary = booking_workflow.get_approval_summary(request.plan_id)

        return {
            "ok": True,
            "approval_id": approval.approval_id,
            "status": approval.status.value,
            "summary": booking_workflow.approval_summary_to_dict(summary),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error submitting approval: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trips/{trip_id}/approvals/{plan_id}")
async def get_approval_summary(
    trip_id: str,
    plan_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get approval summary for a plan."""
    summary = booking_workflow.get_approval_summary(plan_id)
    return booking_workflow.approval_summary_to_dict(summary)


@app.get("/trips/{trip_id}/ledger")
async def get_trip_ledger(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get the complete ledger for a trip.

    Shows all financial movements grouped by traveler, household, and payer.
    """
    ledger = ledger_service.get_ledger(trip_id)
    if not ledger:
        # Generate empty ledger
        return {
            "trip_id": trip_id,
            "totals": {
                "total_trip_cost": 0,
                "total_cash_out_of_pocket": 0,
                "total_taxes_fees": 0,
                "total_points_used": {},
            },
            "by_traveler": {},
            "by_household": {},
            "by_payer": {},
            "by_program": {},
            "settlements": [],
        }
    return ledger_service.ledger_to_dict(ledger)


@app.post("/trips/{trip_id}/ledger/generate")
async def generate_trip_ledger(
    trip_id: str,
    request: CreateBookingSessionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Generate ledger from booking allocations.
    """
    try:
        members = trip_member_service.list_members(trip_id)
        passengers = passenger_service.list_passengers(trip_id)

        ledger = ledger_service.generate_ledger_from_allocations(
            trip_id=trip_id,
            allocations=request.plan_allocation.get("seat_allocations", []),
            members=members,
            passengers=passengers,
            transfer_plan=request.transfer_plan,
        )

        return ledger_service.ledger_to_dict(ledger)
    except Exception as e:
        logger.error(f"Error generating ledger: {str(e)}")
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
