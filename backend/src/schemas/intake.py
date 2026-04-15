"""
Intake Schemas — Enhanced AI trip extraction for multi-traveler, multi-origin planning.
"""
from pydantic import BaseModel
from typing import Optional, List


class LoyaltyBalanceExtraction(BaseModel):
    program: str
    points: Optional[int] = None


class TravelerExtraction(BaseModel):
    name: Optional[str] = None
    origin: Optional[str] = None
    loyalty_programs: List[LoyaltyBalanceExtraction] = []
    relationship: Optional[str] = None
    cabin_preference: Optional[str] = None


class DateRangeExtraction(BaseModel):
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    duration_days: Optional[int] = None
    flexibility_days: int = 0


class BudgetExtraction(BaseModel):
    amount: Optional[float] = None
    budget_type: str = "total"  # total | per_person | flexible
    currency: str = "USD"


class TripIntakeResult(BaseModel):
    travelers: List[TravelerExtraction] = []
    destinations: List[str] = []
    date_range: Optional[DateRangeExtraction] = None
    cabin_preference: str = "economy"
    cabin_qualifier: Optional[str] = None
    budget: Optional[BudgetExtraction] = None
    points_preference: str = "mixed"  # points_first | cash_first | mixed
    special_constraints: List[str] = []
    raw_input: str = ""
    confidence: float = 0.0


class IntakeParseRequest(BaseModel):
    text: str
    client_id: Optional[str] = None
    org_id: Optional[str] = None


class IntakeParseResponse(BaseModel):
    result: TripIntakeResult
    client_context_applied: bool = False
    suggestions: List[str] = []
    preferences_updated: bool = False
