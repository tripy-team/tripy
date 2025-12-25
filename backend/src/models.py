from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    default_home_airport: Optional[str] = None
    timezone: Optional[str] = None


class CreateTripRequest(BaseModel):
    title: str
    start_date: str
    end_date: str


class JoinTripRequest(BaseModel):
    invite_code: str


class UpsertPointsRequest(BaseModel):
    trip_id: str
    program: str
    balance: int = Field(ge=0)


class TripIdRequest(BaseModel):
    trip_id: str


class DestinationAddRequest(BaseModel):
    trip_id: str
    name: str
    must_include: bool = False
    excluded: bool = False


class DestinationVoteRequest(BaseModel):
    trip_id: str
    destination_id: str
    vote: int  # e.g. -1, 0, +1


class GenerateItineraryRequest(BaseModel):
    trip_id: str
