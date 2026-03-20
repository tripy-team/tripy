from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class ClientPreferences(BaseModel):
    flight_class: Optional[str] = None


class ClientStats(BaseModel):
    total_trips: int = 0
    total_savings: float = 0
    total_points_optimized: int = 0


class CreateClientRequest(BaseModel):
    name: str
    email: Optional[str] = None
    home_airport: Optional[str] = None
    notes: Optional[str] = None
    preferences: Optional[ClientPreferences] = None
    initial_points: Optional[List[Dict[str, Any]]] = None


class UpdateClientRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    home_airport: Optional[str] = None
    notes: Optional[str] = None
    preferences: Optional[ClientPreferences] = None


class ClientResponse(BaseModel):
    org_id: str
    client_id: str
    name: str
    email: Optional[str] = None
    home_airport: Optional[str] = None
    notes: Optional[str] = None
    preferences: Optional[ClientPreferences] = None
    stats: Optional[ClientStats] = None
    is_self_client: bool = False
    created_by: Optional[str] = None
    created_at: str


class ClientPointBalance(BaseModel):
    program: str
    balance: int
    updated_at: Optional[str] = None
    updated_by: Optional[str] = None


class UpsertClientPointsRequest(BaseModel):
    points: List[ClientPointBalance]


class ClientPointsResponse(BaseModel):
    org_id: str
    client_id: str
    points: List[ClientPointBalance]
    total_points: int = 0
