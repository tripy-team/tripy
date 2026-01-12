import boto3
import os
from dotenv import load_dotenv
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


@app.get("/healthz")
def health():
    return {"ok": True}


@app.post("/ingest")
async def ingest(req: Request):
    data = await req.json()
    print("payload:", data)
    return data


# Trip endpoints
@app.post("/trips")
async def create_trip(request: CreateTripRequest):
    """Create a new trip"""
    try:
        trip = trip_service.create_trip(
            request.user_id, request.title, request.start_date, request.end_date
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
        destinations = destination_service.list_destinations(request.trip_id)
        routes = route_service.generate_routes(destinations)
        saved = itinerary_service.save_itinerary(
            request.trip_id, routes[0] if routes else []
        )
        return {"routes": routes, "saved": saved}
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


def start():
    load_dotenv()
    session = boto3.Session(
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )


# a lot of lambdas
