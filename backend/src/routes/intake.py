"""
Intake routes — AI-powered trip request parsing.
"""
import json
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from ..schemas.intake import (
    IntakeParseRequest,
    IntakeParseResponse,
    TripIntakeResult,
    TravelerExtraction,
    LoyaltyBalanceExtraction,
    DateRangeExtraction,
    BudgetExtraction,
)
from ..utils.jwt_auth import get_user_or_anon_id, OrgContext, get_org_context

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/intake", tags=["Intake"])

INTAKE_SYSTEM_PROMPT = """You are a travel request extraction assistant for professional travel advisors.
Extract structured trip details from messy client requests.

RULES:
1. Extract ALL travelers mentioned, with their individual origins if different.
2. Identify relationships (spouse, child, parent, friend, colleague).
3. Parse cabin preferences with qualifiers ("if reasonable", "must be", "prefer").
4. Extract loyalty program references (Chase UR, Amex MR, Citi TY, Capital One, etc.) with balances if mentioned.
5. Identify budget type: total trip budget, per-person, or flexible/soft limit.
6. Parse date flexibility ("around June", "first two weeks of July", "flexible ±3 days").
7. Extract special constraints verbatim (avoid layovers, luxury preference, dietary, accessibility, etc.).
8. DO NOT extract month names as cities.
9. Use ISO dates (YYYY-MM-DD) when specific dates are mentioned.
10. For vague dates like "June", use the 1st and last day of the month.
11. Identify points preference: does the client want to maximize points usage, minimize cash, or mixed?

Return a JSON object matching the TripIntakeResult schema."""

INTAKE_USER_PROMPT_TEMPLATE = """Extract trip information from this client request:

"{text}"

{client_context}

Return JSON with this structure:
{{
  "travelers": [
    {{
      "name": "string or null",
      "origin": "IATA code or city name or null",
      "loyalty_programs": [{{"program": "string", "points": int_or_null}}],
      "relationship": "string or null",
      "cabin_preference": "economy|premium_economy|business|first|null"
    }}
  ],
  "destinations": ["city or IATA code"],
  "date_range": {{
    "start_date": "YYYY-MM-DD or null",
    "end_date": "YYYY-MM-DD or null",
    "duration_days": int_or_null,
    "flexibility_days": int
  }},
  "cabin_preference": "economy|premium_economy|business|first|flexible",
  "cabin_qualifier": "if reasonable|must be|prefer|null",
  "budget": {{
    "amount": float_or_null,
    "budget_type": "total|per_person|flexible",
    "currency": "USD"
  }},
  "points_preference": "points_first|cash_first|mixed",
  "special_constraints": ["verbatim constraint strings"],
  "raw_input": "original text",
  "confidence": 0.0_to_1.0
}}"""


def _build_client_context(org_id: str, client_id: str) -> str:
    """Fetch client profile to provide context for extraction."""
    try:
        from ..repos import client_repo, client_points_repo

        client = client_repo.get_client(org_id, client_id)
        if not client:
            return ""

        points = client_points_repo.list_points(org_id, client_id)
        parts = [f"Client: {client.get('name', 'Unknown')}"]

        home = client.get("homeAirport")
        if home:
            parts.append(f"Home airport: {home}")

        prefs = client.get("preferences", {})
        if prefs:
            if prefs.get("preferredAirlines"):
                parts.append(f"Preferred airlines: {', '.join(prefs['preferredAirlines'])}")
            if prefs.get("cabinDefault"):
                parts.append(f"Default cabin: {prefs['cabinDefault']}")
            if prefs.get("budgetStyle"):
                parts.append(f"Budget style: {prefs['budgetStyle']}")

        family = client.get("familyMembers", [])
        if family:
            members = [f"{m.get('name', '?')} ({m.get('relationship', '?')})" for m in family]
            parts.append(f"Family members: {', '.join(members)}")

        if points:
            balances = [f"{p['program']}: {p.get('balance', 0):,}" for p in points]
            parts.append(f"Loyalty balances: {', '.join(balances)}")

        notes = client.get("notes")
        if notes:
            parts.append(f"Advisor notes: {notes}")

        return "Known client context:\n" + "\n".join(parts)
    except Exception as e:
        logger.warning(f"Could not load client context: {e}")
        return ""


@router.post("", response_model=IntakeParseResponse)
async def parse_intake(
    request: IntakeParseRequest,
    user_id: str = Depends(get_user_or_anon_id),
):
    """Parse a messy client request into structured trip intake."""
    try:
        from openai import OpenAI
    except ImportError:
        raise HTTPException(status_code=503, detail="OpenAI not available")

    import httpx
    from dotenv import load_dotenv

    load_dotenv()
    api_key = os.getenv("OPENAI_ADMIN_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured")

    client_context = ""
    client_context_applied = False
    if request.client_id and request.org_id:
        client_context = _build_client_context(request.org_id, request.client_id)
        client_context_applied = bool(client_context)

    user_prompt = INTAKE_USER_PROMPT_TEMPLATE.format(
        text=request.text,
        client_context=client_context if client_context else "No prior client context available.",
    )

    client = OpenAI(
        api_key=api_key,
        timeout=httpx.Timeout(15.0, connect=5.0),
        max_retries=0,
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": INTAKE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )

        content = response.choices[0].message.content
        parsed = json.loads(content)

        travelers_raw = parsed.get("travelers", [])
        travelers = []
        for t in travelers_raw:
            programs = []
            for p in t.get("loyalty_programs", []):
                programs.append(LoyaltyBalanceExtraction(
                    program=p.get("program", ""),
                    points=p.get("points"),
                ))
            travelers.append(TravelerExtraction(
                name=t.get("name"),
                origin=t.get("origin"),
                loyalty_programs=programs,
                relationship=t.get("relationship"),
                cabin_preference=t.get("cabin_preference"),
            ))

        date_raw = parsed.get("date_range", {})
        date_range = DateRangeExtraction(
            start_date=date_raw.get("start_date") if date_raw else None,
            end_date=date_raw.get("end_date") if date_raw else None,
            duration_days=date_raw.get("duration_days") if date_raw else None,
            flexibility_days=date_raw.get("flexibility_days", 0) if date_raw else 0,
        ) if date_raw else None

        budget_raw = parsed.get("budget", {})
        budget = BudgetExtraction(
            amount=budget_raw.get("amount") if budget_raw else None,
            budget_type=budget_raw.get("budget_type", "total") if budget_raw else "total",
            currency=budget_raw.get("currency", "USD") if budget_raw else "USD",
        ) if budget_raw and budget_raw.get("amount") else None

        result = TripIntakeResult(
            travelers=travelers,
            destinations=parsed.get("destinations", []),
            date_range=date_range,
            cabin_preference=parsed.get("cabin_preference", "economy"),
            cabin_qualifier=parsed.get("cabin_qualifier"),
            budget=budget,
            points_preference=parsed.get("points_preference", "mixed"),
            special_constraints=parsed.get("special_constraints", []),
            raw_input=request.text,
            confidence=float(parsed.get("confidence", 0.5)),
        )

        suggestions = []
        if not travelers:
            suggestions.append("No travelers detected — please specify who is traveling.")
        if not result.destinations:
            suggestions.append("No destination detected — where would the client like to go?")
        if not date_range or (not date_range.start_date and not date_range.duration_days):
            suggestions.append("No dates detected — when is the trip planned?")

        return IntakeParseResponse(
            result=result,
            client_context_applied=client_context_applied,
            suggestions=suggestions,
        )

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        logger.error(f"Intake parsing failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Intake parsing failed")
