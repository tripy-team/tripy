"""
Card benefits for travel optimization.

Uses live web search (SerpAPI) + OpenAI extraction for up-to-date credit card
benefits (e.g. free checked bags on specific airlines). Falls back to OpenAI-only
when SerpAPI is unavailable. No static map—data comes from APIs you configure:

- SERPAPI_KEY or SERP_API_KEY: Google organic search for current benefit snippets
- OPENAI_ADMIN_KEY: extract structured benefits from snippets, or infer from model when no snippets

Enhanced with comprehensive benefit tracking for OOP reduction:
- Travel credits (annual credits that reduce OOP)
- Lounge access (quality of life benefit)
- Trip protections (insurance value)
- Points earning rates (earn value calculation)
"""

import logging
import os
import re
from typing import Dict, List, Optional, Set, Any
from dataclasses import dataclass, field

from .airline_utils import infer_airline_from_flight_number

logger = logging.getLogger(__name__)

# In-memory cache for final extracted benefits (avoids repeated SerpAPI+OpenAI per process)
_benefits_cache: Dict[str, Dict] = {}


# =============================================================================
# COMPREHENSIVE CARD BENEFITS DATABASE
# =============================================================================

@dataclass
class ComprehensiveCardBenefit:
    """Comprehensive credit card benefit data for OOP optimization."""
    card_name: str
    issuer: str  # amex, chase, citi, capitalone, bilt
    annual_fee: float = 0
    
    # Travel credits (reduce OOP directly)
    travel_credit: float = 0          # Annual travel credit
    airline_fee_credit: float = 0     # Annual airline incidental fee credit
    hotel_credit: float = 0           # Annual hotel credit
    
    # Airline-specific benefits
    free_checked_bags: Dict[str, int] = field(default_factory=dict)  # {airline: num_bags}
    priority_boarding: List[str] = field(default_factory=list)
    companion_pass: bool = False
    status_boost: Optional[str] = None  # e.g., "Gold status"
    
    # Lounge access
    priority_pass: bool = False
    priority_pass_guests: int = 0
    airline_lounge: Optional[str] = None
    centurion_lounge: bool = False
    capital_one_lounge: bool = False
    
    # Trip protections (insurance value)
    trip_delay_coverage: float = 0    # Per occurrence
    trip_cancel_coverage: float = 0   # Max coverage
    baggage_delay: float = 0
    lost_baggage: float = 0
    primary_car_rental: bool = False
    
    # Points earning
    travel_earn_rate: float = 1.0     # Points per dollar on travel
    dining_earn_rate: float = 1.0
    flights_earn_rate: float = 1.0
    hotels_earn_rate: float = 1.0
    
    # Redemption value
    points_value_cpp: float = 1.0     # Average cents per point value


# Comprehensive card benefits database
CARD_BENEFITS_DB: Dict[str, ComprehensiveCardBenefit] = {
    # AMEX Cards
    "amex_platinum": ComprehensiveCardBenefit(
        card_name="American Express Platinum",
        issuer="amex",
        annual_fee=695,
        travel_credit=200,
        airline_fee_credit=200,
        hotel_credit=200,  # Fine Hotels + Resorts credit
        priority_pass=True,
        priority_pass_guests=2,
        centurion_lounge=True,
        trip_delay_coverage=500,
        trip_cancel_coverage=10000,
        baggage_delay=300,
        primary_car_rental=True,
        travel_earn_rate=5.0,
        flights_earn_rate=5.0,
        hotels_earn_rate=5.0,
        points_value_cpp=2.0,
    ),
    "amex_gold": ComprehensiveCardBenefit(
        card_name="American Express Gold",
        issuer="amex",
        annual_fee=250,
        airline_fee_credit=100,
        dining_earn_rate=4.0,
        flights_earn_rate=3.0,
        points_value_cpp=2.0,
    ),
    
    # Chase Cards
    "chase_sapphire_reserve": ComprehensiveCardBenefit(
        card_name="Chase Sapphire Reserve",
        issuer="chase",
        annual_fee=550,
        travel_credit=300,
        priority_pass=True,
        priority_pass_guests=2,
        trip_delay_coverage=500,
        trip_cancel_coverage=10000,
        baggage_delay=100,
        primary_car_rental=True,
        travel_earn_rate=3.0,
        dining_earn_rate=3.0,
        flights_earn_rate=3.0,
        hotels_earn_rate=3.0,
        points_value_cpp=1.5,
    ),
    "chase_sapphire_preferred": ComprehensiveCardBenefit(
        card_name="Chase Sapphire Preferred",
        issuer="chase",
        annual_fee=95,
        travel_earn_rate=2.0,
        dining_earn_rate=3.0,
        flights_earn_rate=2.0,
        trip_cancel_coverage=10000,
        points_value_cpp=1.25,
    ),
    "united_club_infinite": ComprehensiveCardBenefit(
        card_name="United Club Infinite",
        issuer="chase",
        annual_fee=525,
        free_checked_bags={"UA": 2},
        priority_boarding=["UA"],
        airline_lounge="United Club",
        status_boost="Premier Access",
        travel_earn_rate=2.0,
        flights_earn_rate=4.0,
        points_value_cpp=1.3,
    ),
    "united_quest": ComprehensiveCardBenefit(
        card_name="United Quest",
        issuer="chase",
        annual_fee=250,
        travel_credit=125,
        free_checked_bags={"UA": 2},
        priority_boarding=["UA"],
        travel_earn_rate=2.0,
        flights_earn_rate=3.0,
        points_value_cpp=1.3,
    ),
    
    # Delta/Amex Cards
    "delta_reserve": ComprehensiveCardBenefit(
        card_name="Delta SkyMiles Reserve",
        issuer="amex",
        annual_fee=550,
        free_checked_bags={"DL": 1},
        priority_boarding=["DL"],
        airline_lounge="Delta Sky Club",
        companion_pass=True,
        status_boost="MQD waiver",
        travel_earn_rate=2.0,
        flights_earn_rate=3.0,
        points_value_cpp=1.2,
    ),
    "delta_platinum": ComprehensiveCardBenefit(
        card_name="Delta SkyMiles Platinum",
        issuer="amex",
        annual_fee=350,
        free_checked_bags={"DL": 1},
        priority_boarding=["DL"],
        companion_pass=True,
        travel_earn_rate=2.0,
        flights_earn_rate=3.0,
        points_value_cpp=1.2,
    ),
    "delta_gold": ComprehensiveCardBenefit(
        card_name="Delta SkyMiles Gold",
        issuer="amex",
        annual_fee=150,
        free_checked_bags={"DL": 1},
        priority_boarding=["DL"],
        travel_earn_rate=2.0,
        points_value_cpp=1.1,
    ),
    
    # American Airlines/Citi Cards
    "aa_executive": ComprehensiveCardBenefit(
        card_name="Citi AAdvantage Executive",
        issuer="citi",
        annual_fee=595,
        free_checked_bags={"AA": 1},
        priority_boarding=["AA"],
        airline_lounge="Admirals Club",
        travel_earn_rate=2.0,
        flights_earn_rate=2.0,
        points_value_cpp=1.4,
    ),
    "aa_platinum_select": ComprehensiveCardBenefit(
        card_name="Citi AAdvantage Platinum Select",
        issuer="citi",
        annual_fee=99,
        free_checked_bags={"AA": 1},
        priority_boarding=["AA"],
        travel_earn_rate=2.0,
        points_value_cpp=1.4,
    ),
    
    # Citi Cards
    "citi_premier": ComprehensiveCardBenefit(
        card_name="Citi Premier",
        issuer="citi",
        annual_fee=95,
        travel_earn_rate=3.0,
        dining_earn_rate=3.0,
        flights_earn_rate=3.0,
        hotels_earn_rate=3.0,
        points_value_cpp=1.0,
    ),
    
    # Capital One Cards
    "capital_one_venture_x": ComprehensiveCardBenefit(
        card_name="Capital One Venture X",
        issuer="capitalone",
        annual_fee=395,
        travel_credit=300,
        priority_pass=True,
        priority_pass_guests=2,
        capital_one_lounge=True,
        travel_earn_rate=2.0,
        flights_earn_rate=5.0,
        hotels_earn_rate=10.0,  # Booked through Capital One Travel
        points_value_cpp=1.0,
    ),
    "capital_one_venture": ComprehensiveCardBenefit(
        card_name="Capital One Venture",
        issuer="capitalone",
        annual_fee=95,
        travel_earn_rate=2.0,
        flights_earn_rate=2.0,
        points_value_cpp=1.0,
    ),
    
    # Bilt Cards
    "bilt_mastercard": ComprehensiveCardBenefit(
        card_name="Bilt Mastercard",
        issuer="bilt",
        annual_fee=0,
        travel_earn_rate=2.0,
        dining_earn_rate=3.0,
        flights_earn_rate=2.0,
        points_value_cpp=1.5,  # Good transfer partners
    ),
    
    # Alaska Airlines Cards
    "alaska_visa_signature": ComprehensiveCardBenefit(
        card_name="Alaska Airlines Visa Signature",
        issuer="bofa",
        annual_fee=95,
        free_checked_bags={"AS": 1},
        priority_boarding=["AS"],
        companion_pass=True,  # Companion fare annually
        flights_earn_rate=3.0,
        points_value_cpp=1.8,
    ),
    
    # Southwest Cards
    "southwest_priority": ComprehensiveCardBenefit(
        card_name="Southwest Rapid Rewards Priority",
        issuer="chase",
        annual_fee=149,
        travel_credit=75,  # Southwest credit
        priority_boarding=["WN"],
        flights_earn_rate=3.0,
        points_value_cpp=1.4,
    ),
}


def get_comprehensive_card_benefit(card_key: str) -> Optional[ComprehensiveCardBenefit]:
    """Get comprehensive benefit data for a card."""
    return CARD_BENEFITS_DB.get(card_key.lower().replace(" ", "_").replace("-", "_"))


def _normalize_card_name(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[®™]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def get_benefits_for_card(
    card_product: Optional[str],
    program: Optional[str] = None,
    *,
    use_serp: bool = True,
    use_openai: bool = True,
) -> Dict:
    """
    Get benefits for a card from live sources. Returns dict with:
      - free_bag_airlines: List[str] IATA codes (e.g. ["DL","AA"])
      - applies_to_reservation: bool (everyone on booking when cardholder pays)

    Sources (in order):
      1. SerpAPI organic search ("{card} credit card benefits free checked bag") -> snippets
         -> OpenAI extracts free_bag_airlines, applies_to_reservation from snippets. (Requires SERPAPI_KEY or SERP_API_KEY + OPENAI_ADMIN_KEY.)
      2. OpenAI only from model knowledge. (Requires OPENAI_ADMIN_KEY. Less up-to-date than 1.)
      3. Empty if both unavailable.

    If card_product is missing/empty, returns empty benefits.
    """
    out = {"free_bag_airlines": [], "applies_to_reservation": False}
    if not card_product or not str(card_product).strip():
        return out

    key = _normalize_card_name(card_product)
    if not key:
        return out

    # Check in-memory cache
    cached = _benefits_cache.get(key)
    if cached is not None:
        return cached

    serp_key = os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")
    openai_key = os.getenv("OPENAI_ADMIN_KEY")

    # 1) SerpAPI + OpenAI: up-to-date from web snippets
    if use_serp and serp_key and use_openai and openai_key:
        try:
            from ..handlers.serp_client import organic_search
            from ..handlers.openAI import extract_card_benefits_from_snippets

            query = f'"{card_product}" credit card benefits free checked bag'
            snippets = organic_search(query, num=8)
            if snippets:
                b = extract_card_benefits_from_snippets(card_product, snippets)
                if b:
                    _benefits_cache[key] = b
                    return b
        except Exception as e:
            logger.debug("get_benefits SerpAPI+OpenAI path failed for %s: %s", card_product, e)

    # 2) OpenAI-only fallback (model knowledge; may be less current)
    if use_openai and openai_key:
        try:
            from ..handlers.openAI import get_card_benefits_openai

            b = get_card_benefits_openai(card_product)
            if b:
                _benefits_cache[key] = b
                return b
        except Exception as e:
            logger.debug("get_benefits OpenAI fallback failed for %s: %s", card_product, e)

    return out


def build_benefit_airlines_for_travelers(
    traveler_profiles: Dict[str, Dict],
) -> Dict[str, Set[str]]:
    """
    For each traveler (user_id -> profile with credit_cards), build
    benefit_airlines[user_id] = set of IATA codes where they have free bag.
    """
    result: Dict[str, Set[str]] = {}
    for user_id, profile in (traveler_profiles or {}).items():
        airlines: Set[str] = set()
        cards = profile.get("credit_cards") or []
        for c in cards:
            name = c.get("card_product") or c.get("card_name") or ""
            if not name:
                continue
            b = get_benefits_for_card(name, c.get("program"))
            for iata in b.get("free_bag_airlines") or []:
                if iata and len(iata) >= 2:
                    airlines.add(str(iata).upper()[:2])
        result[user_id] = airlines
    return result


def build_edge_to_airline(edges_dict: Dict) -> Dict:
    """
    Build mapping edge -> IATA operating airline.
    edge = (dep, arr, fn). Uses operating_airline, points_program, or infers from fn.
    Skips bus/car edges (fn in BUS, CAR or mode in bus, car) so they are not treated as airlines.
    """
    out = {}
    for e, d in (edges_dict or {}).items():
        if not isinstance(e, (list, tuple)) or len(e) < 3:
            continue
        dep, arr, fn = e[0], e[1], e[2]
        if str(fn).upper() in ("BUS", "CAR") or str(d.get("mode") or "").lower() in ("bus", "car"):
            continue
        al = (d.get("operating_airline") or d.get("points_program") or "")
        if al and isinstance(al, str) and len(al) >= 2:
            out[e] = str(al).strip().upper()[:2]
        else:
            inferred = infer_airline_from_flight_number(fn)
            if inferred:
                out[e] = inferred
    return out


# =============================================================================
# COMPREHENSIVE BENEFIT CALCULATIONS FOR OOP REDUCTION
# =============================================================================

def calculate_comprehensive_benefit_value(
    card_key: str,
    itinerary_airlines: List[str],
    cash_spend: float,
    num_travelers: int = 1,
    num_segments: int = 2,  # Round trip = 2 segments
    include_annual_credits: bool = True,
) -> Dict[str, Any]:
    """
    Calculate total benefit value a card provides for an itinerary.
    
    Returns breakdown of all benefit values for OOP optimization.
    
    Args:
        card_key: Key in CARD_BENEFITS_DB
        itinerary_airlines: List of airlines in the itinerary
        cash_spend: Total cash spend on the itinerary
        num_travelers: Number of travelers
        num_segments: Number of flight segments (for bag benefit calculation)
        include_annual_credits: Whether to include annual travel credits
    
    Returns:
        Dict with breakdown of benefit values
    """
    card = CARD_BENEFITS_DB.get(card_key)
    if not card:
        return {
            "total_value": 0,
            "bag_savings": 0,
            "credit_value": 0,
            "earn_value": 0,
            "protection_value": 0,
            "lounge_value": 0,
        }
    
    bag_fee = 35  # Average checked bag fee
    bag_savings = 0.0
    
    # Checked bag benefits
    for airline in itinerary_airlines:
        bags = card.free_checked_bags.get(airline, 0)
        if bags > 0:
            # Each traveler saves on bags for each segment
            bag_savings += bags * bag_fee * num_travelers * num_segments
    
    # Travel credits (reduce OOP directly)
    credit_value = 0.0
    if include_annual_credits:
        if card.travel_credit > 0:
            # Prorate: assume this booking uses some of the annual credit
            credit_value += min(card.travel_credit, cash_spend * 0.5)
        if card.airline_fee_credit > 0:
            # Incidental credits (bags, seat selection, etc.)
            credit_value += min(card.airline_fee_credit, 50)  # Conservative estimate
    
    # Points earning value
    earned_points = cash_spend * card.flights_earn_rate
    earn_value = earned_points * card.points_value_cpp / 100  # Convert to dollars
    
    # Trip protection expected value
    protection_value = 0.0
    if card.trip_delay_coverage > 0:
        protection_value += 15  # Expected value of trip delay coverage
    if card.trip_cancel_coverage > 0:
        protection_value += 20  # Expected value of trip cancel coverage
    if card.primary_car_rental:
        protection_value += 15  # Expected value of primary rental coverage
    if card.baggage_delay > 0:
        protection_value += 5
    
    # Lounge access value (quality of life, not direct OOP reduction)
    lounge_value = 0.0
    if card.priority_pass or card.centurion_lounge or card.capital_one_lounge:
        lounge_value += 30 * num_travelers * (num_segments // 2)  # Per airport visit
    if card.airline_lounge:
        for airline in itinerary_airlines:
            if airline in card.priority_boarding:  # Likely has airline lounge for this airline
                lounge_value += 40 * num_travelers
    
    total_value = bag_savings + credit_value + earn_value + protection_value + lounge_value
    
    return {
        "total_value": round(total_value, 2),
        "bag_savings": round(bag_savings, 2),
        "credit_value": round(credit_value, 2),
        "earn_value": round(earn_value, 2),
        "protection_value": round(protection_value, 2),
        "lounge_value": round(lounge_value, 2),
        "card_name": card.card_name,
        "annual_fee": card.annual_fee,
        "net_value": round(total_value - (card.annual_fee / 12), 2),  # Monthly amortized
    }


def recommend_payment_card(
    user_cards: List[str],
    itinerary_airlines: List[str],
    cash_amount: float,
    num_travelers: int = 1,
) -> Dict[str, Any]:
    """
    Recommend the best card to use for payment based on comprehensive benefits.
    
    Args:
        user_cards: List of card keys the user has
        itinerary_airlines: Airlines in the itinerary
        cash_amount: Cash amount to pay
        num_travelers: Number of travelers
    
    Returns:
        Recommendation with card and benefit breakdown
    """
    best_card = None
    best_value = 0
    best_breakdown = None
    all_options = []
    
    for card_key in user_cards:
        breakdown = calculate_comprehensive_benefit_value(
            card_key,
            itinerary_airlines,
            cash_amount,
            num_travelers,
        )
        
        all_options.append({
            "card_key": card_key,
            **breakdown,
        })
        
        if breakdown["total_value"] > best_value:
            best_value = breakdown["total_value"]
            best_card = card_key
            best_breakdown = breakdown
    
    return {
        "recommended_card": best_card,
        "recommended_card_name": best_breakdown["card_name"] if best_breakdown else None,
        "total_benefit_value": best_value,
        "benefit_breakdown": best_breakdown,
        "all_options": sorted(all_options, key=lambda x: -x["total_value"]),
    }


def get_cards_with_bag_benefit(airline: str) -> List[str]:
    """Get list of cards that provide free checked bags on a specific airline."""
    cards = []
    for card_key, card in CARD_BENEFITS_DB.items():
        if airline.upper() in card.free_checked_bags:
            cards.append(card_key)
    return cards


def get_cards_with_lounge_access() -> List[str]:
    """Get list of cards that provide lounge access."""
    cards = []
    for card_key, card in CARD_BENEFITS_DB.items():
        if card.priority_pass or card.centurion_lounge or card.capital_one_lounge or card.airline_lounge:
            cards.append(card_key)
    return cards


def estimate_annual_travel_benefit(
    card_key: str,
    annual_flights: int = 10,
    annual_hotel_nights: int = 20,
    annual_travel_spend: float = 5000,
) -> Dict[str, Any]:
    """
    Estimate annual value of a card for a typical traveler.
    Useful for comparing card value against annual fee.
    """
    card = CARD_BENEFITS_DB.get(card_key)
    if not card:
        return {"error": f"Card not found: {card_key}"}
    
    # Travel credits (full annual value)
    credit_value = card.travel_credit + card.airline_fee_credit + card.hotel_credit
    
    # Points earning
    earn_value = annual_travel_spend * card.travel_earn_rate * card.points_value_cpp / 100
    
    # Lounge access (estimate 10 visits per year)
    lounge_value = 0
    if card.priority_pass or card.centurion_lounge:
        lounge_value = 10 * 50  # $50 per visit
    
    # Protections (expected value across all trips)
    protection_value = 0
    if card.trip_delay_coverage > 0:
        protection_value += 50  # Annual expected value
    if card.primary_car_rental:
        protection_value += 100  # Annual expected value
    
    # Bag benefits (estimate average of 5 trips with checked bags)
    bag_value = sum(card.free_checked_bags.values()) * 35 * 5
    
    total_value = credit_value + earn_value + lounge_value + protection_value + bag_value
    net_value = total_value - card.annual_fee
    
    return {
        "card_name": card.card_name,
        "annual_fee": card.annual_fee,
        "total_annual_value": round(total_value, 2),
        "net_annual_value": round(net_value, 2),
        "breakdown": {
            "credits": credit_value,
            "earn_value": round(earn_value, 2),
            "lounge_value": lounge_value,
            "protection_value": protection_value,
            "bag_savings": bag_value,
        },
        "worth_keeping": net_value > 0,
    }
