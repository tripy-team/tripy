import os
import logging
from datetime import datetime
from dotenv import load_dotenv
from json import JSONDecodeError

# Load environment variables from .env file early
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, Request, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr, validator
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

    @validator("start_date", "end_date")
    def validate_date(cls, v):
        try:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
            return v
        except ValueError:
            raise ValueError("Date must be in ISO format (YYYY-MM-DD)")

    @validator("end_date")
    def validate_end_after_start(cls, v, values):
        if "start_date" in values:
            try:
                start = datetime.fromisoformat(
                    values["start_date"].replace("Z", "+00:00")
                )
                end = datetime.fromisoformat(v.replace("Z", "+00:00"))
                if end < start:
                    raise ValueError("End date must be after start date")
            except ValueError:
                pass  # Date format validation will catch this
        return v


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
            user_id, request.title, request.start_date, request.end_date
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

        return {"inviteCode": trip.get("inviteCode")}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting invite code: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/trips/by-invite/{invite_code}")
async def get_trip_by_invite(invite_code: str):
    """Get trip information by invite code (public endpoint for joining)"""
    try:
        trip = trip_service.get_trip_by_invite(invite_code)
        if not trip:
            raise HTTPException(status_code=404, detail="Invalid invite code")
        
        # Get member count and destinations for display
        from .services.destination_service import list_destinations
        from .services.trip_member_service import list_members
        
        members = list_members(trip["tripId"])
        trip["memberCount"] = len(members) if members else 1
        
        destinations = list_destinations(trip["tripId"])
        if destinations:
            trip["destinations"] = [d.get("name") for d in destinations]
            trip["firstDestination"] = destinations[0].get("name", "")
        else:
            trip["destinations"] = []
            trip["firstDestination"] = ""
        
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

        points = points_service.upsert_points(
            request.trip_id, user_id, request.program, request.balance
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


# Itinerary endpoints (require authentication)
@app.post("/itinerary/generate")
async def generate_itinerary(
    request: GenerateItineraryRequest, user_id: str = Depends(get_current_user_id)
):
    """Generate itineraries for a trip"""
    try:
        # Get trip to verify access
        trip = trip_service.get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        # Verify user has access to this trip
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

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
        logger.error(f"Error generating itinerary: {str(e)}")
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


# City search endpoints (public, no authentication required)
@app.post("/cities/search")
async def search_cities(request: CitySearchRequest):
    """Search for cities/airports using Amadeus API"""
    try:
        results = city_service.search_cities(request.query, request.max_results or 10)
        return {"cities": results}
    except Exception as e:
        logger.error(f"Error searching cities: {str(e)}")
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

        results = city_service.search_cities(query, max_results or 10)
        return {"cities": results}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error searching cities: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Image endpoints (public, no authentication required for viewing)
class CityImageRequest(BaseModel):
    city: str = Field(..., min_length=1, max_length=200)


@app.get("/images/city/{city_name}")
async def get_city_images(
    city_name: str, 
    size: Optional[str] = "800",
    background_tasks: BackgroundTasks = None
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
        from backend.src.repos import city_image_repo
        city_data = city_image_repo.get_city_images(city_name.lower().strip())
        city_exists = city_data is not None
        
        # Get images (will return coming soon if not exists)
        urls = image_service.get_city_image_urls(city_name, size or "800", trigger_background=True)
        
        if not urls:
            raise HTTPException(status_code=404, detail=f"No images found for city: {city_name}")
        
        # Check if this is a "coming soon" placeholder
        is_coming_soon = any("coming_soon" in url.lower() for url in urls)
        
        response = {
            "city": city_name,
            "images": urls,
            "count": len(urls),
            "is_coming_soon": is_coming_soon,
            "status": "coming_soon" if is_coming_soon else "curated"
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
    background_tasks: BackgroundTasks = None
):
    """
    Get the primary/hero image for a city.
    
    If city doesn't exist, returns "coming soon" placeholder and triggers background curation.
    """
    try:
        # Get images (will return coming soon if not exists)
        urls = image_service.get_city_image_urls(city_name, size or "800", trigger_background=True)
        url = urls[0] if urls else None
        
        if not url:
            raise HTTPException(status_code=404, detail=f"No hero image found for city: {city_name}")
        
        is_coming_soon = "coming_soon" in url.lower()
        
        return {
            "city": city_name,
            "url": url,
            "size": size,
            "is_coming_soon": is_coming_soon,
            "status": "coming_soon" if is_coming_soon else "curated"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting city hero image: {str(e)}")
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
            raise HTTPException(status_code=404, detail=f"No images found for city: {city_name}")
        
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
