"""
Out-of-Pocket (OOP) Reduction Optimizer

This module provides utilities and configuration for minimizing out-of-pocket costs
when booking travel using points and miles. It implements the strategies outlined in
OUT_OF_POCKET_REDUCTION_STRATEGY.md.

Key Features:
1. Program-specific CPP thresholds (higher thresholds for high-surcharge programs)
2. Surcharge-aware optimization (penalize high-surcharge awards)
3. Partner award support (book same flight through different programs)
4. Transfer bonus tracking (dynamic transfer ratios with promotions)
5. Date flexibility scoring (find lowest OOP dates)
6. Positioning flight analysis (check if positioning saves money)
7. Award sweet spot routing (known good award routes)
8. Mixed cabin optimization (compare OOP across cabins)
9. Group payment optimization (split awards/cash when seats limited)
"""

from typing import Dict, List, Tuple, Optional, Any, Set
from datetime import datetime, timedelta
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


# =============================================================================
# STRATEGY 1: CPP THRESHOLDS BY PROGRAM
# =============================================================================

# Program-specific minimum CPP thresholds
# Higher thresholds for programs with significant surcharges
# Lower thresholds for US domestic where redemptions are typically lower value
PROGRAM_CPP_THRESHOLDS: Dict[str, float] = {
    # Premium long-haul programs - higher expected value
    "SQ": 1.5,   # Singapore Airlines - typically 1.5-3 CPP on int'l
    "NH": 1.5,   # ANA - excellent value on international
    "JL": 1.4,   # JAL - good partner availability
    "VS": 1.3,   # Virgin Atlantic - good partner awards
    "CX": 1.3,   # Cathay Pacific - sweet spots to Asia
    
    # US Domestic - lower thresholds acceptable (dynamic pricing)
    "UA": 1.0,   # United - dynamic pricing
    "AA": 1.0,   # American - dynamic pricing  
    "DL": 1.0,   # Delta - dynamic pricing (often poor)
    "AS": 1.1,   # Alaska - better partner redemptions
    "B6": 0.9,   # JetBlue - often poor redemptions
    
    # High-surcharge programs - need higher CPP to offset
    "BA": 1.8,   # British Airways - significant fuel surcharges
    "LH": 1.6,   # Lufthansa - fuel surcharges on own metal
    "LX": 1.6,   # Swiss - same group as Lufthansa
    "KL": 1.4,   # KLM - moderate surcharges
    "AF": 1.3,   # Air France - moderate surcharges (better via partners)
    
    # Middle East - generally good value
    "EK": 1.2,   # Emirates - reasonable redemptions
    "QR": 1.3,   # Qatar - good availability, some surcharges
    "EY": 1.2,   # Etihad - reasonable redemptions
    "TK": 1.2,   # Turkish - good Star Alliance redemptions
    
    # Other programs
    "AC": 1.2,   # Aeroplan - good partner availability
    "AV": 1.4,   # Avianca LifeMiles - excellent value, no surcharges
    "IB": 1.3,   # Iberia - good for transatlantic
    "QF": 1.3,   # Qantas - good partner availability
}

# Default CPP threshold for programs not listed
DEFAULT_CPP_THRESHOLD = 1.0


def get_cpp_threshold(program: str) -> float:
    """
    Get the minimum CPP threshold for a program.
    Programs with higher typical redemption values or surcharges have higher thresholds.
    """
    return PROGRAM_CPP_THRESHOLDS.get(program.upper(), DEFAULT_CPP_THRESHOLD)


# =============================================================================
# STRATEGY 1: SURCHARGE CAPS AND PENALTIES
# =============================================================================

# Maximum acceptable surcharge per segment (in USD)
# Awards with surcharges above this are penalized or rejected
MAX_SURCHARGE_PER_SEGMENT = 200

# Surcharge penalty weight in objective function
# Higher values more aggressively avoid high-surcharge awards
SURCHARGE_PENALTY_WEIGHT = 100.0

# Programs known for high surcharges (use partner awards when possible)
HIGH_SURCHARGE_PROGRAMS: Set[str] = {"BA", "LH", "LX", "QF", "SQ"}


def calculate_surcharge_penalty(surcharge: float, program: str) -> float:
    """
    Calculate penalty for high surcharges.
    Returns a value to subtract from the objective function.
    """
    if surcharge <= 50:
        return 0.0
    
    base_penalty = max(0, surcharge - 50) * SURCHARGE_PENALTY_WEIGHT
    
    # Extra penalty for notoriously high-surcharge programs
    if program.upper() in HIGH_SURCHARGE_PROGRAMS:
        base_penalty *= 1.5
    
    return base_penalty


def should_reject_award(surcharge: float, cash_price: float) -> bool:
    """
    Determine if an award should be rejected due to excessive surcharges.
    If surcharge is more than 50% of cash price, probably better to pay cash.
    """
    if surcharge > MAX_SURCHARGE_PER_SEGMENT:
        return True
    if cash_price > 0 and surcharge > cash_price * 0.5:
        return True
    return False


# =============================================================================
# STRATEGY 2: PARTNER AWARDS
# =============================================================================

# Alliance partnerships - which programs can book which carriers
# Key = operating carrier, Value = list of booking programs that can access it
ALLIANCE_PARTNERS: Dict[str, List[str]] = {
    # Star Alliance
    "UA": ["AC", "LH", "TK", "SQ", "NH", "AV", "LX", "TG", "ET"],
    "LH": ["UA", "AC", "TK", "SQ", "NH", "AV", "LX", "TG", "ET"],
    "AC": ["UA", "LH", "TK", "SQ", "NH", "AV", "LX", "TG", "ET"],
    "SQ": ["UA", "AC", "LH", "TK", "NH", "AV", "LX", "TG", "ET"],
    "NH": ["UA", "AC", "LH", "TK", "SQ", "AV", "LX", "TG", "ET"],
    "TK": ["UA", "AC", "LH", "SQ", "NH", "AV", "LX", "TG", "ET"],
    
    # Oneworld
    "AA": ["BA", "IB", "QF", "CX", "QR", "AS", "FJ"],
    "BA": ["AA", "IB", "QF", "CX", "QR", "AS", "FJ"],
    "IB": ["AA", "BA", "QF", "CX", "QR"],
    "QF": ["AA", "BA", "IB", "CX", "QR", "AS"],
    "CX": ["AA", "BA", "IB", "QF", "QR", "AS"],
    "QR": ["AA", "BA", "IB", "QF", "CX"],
    "AS": ["AA", "BA", "QF", "CX"],  # Alaska is Oneworld partner
    
    # SkyTeam
    "DL": ["AF", "KL", "VS", "KE", "AM", "CI"],
    "AF": ["DL", "KL", "VS", "KE", "AM", "CI"],
    "KL": ["DL", "AF", "VS", "KE", "AM", "CI"],
    "VS": ["DL", "AF", "KL"],  # Virgin Atlantic is limited partner
    "KE": ["DL", "AF", "KL", "AM", "CI"],
}

# Partner award surcharge overrides
# Some programs have much lower surcharges when booking through partners
# Key = (operating_carrier, booking_program), Value = typical surcharge
PARTNER_SURCHARGE_OVERRIDES: Dict[Tuple[str, str], float] = {
    # BA metal booked via AA has low surcharges
    ("BA", "AA"): 50,
    ("BA", "AS"): 50,
    
    # Lufthansa Group via United
    ("LH", "UA"): 30,
    ("LX", "UA"): 30,
    
    # Air France/KLM via Delta
    ("AF", "DL"): 50,
    ("KL", "DL"): 50,
    
    # Singapore via partners (usually no fuel surcharges)
    ("SQ", "UA"): 30,
    ("SQ", "AC"): 30,
}


def get_partner_programs(operating_carrier: str) -> List[str]:
    """Get list of programs that can book flights on this carrier."""
    partners = ALLIANCE_PARTNERS.get(operating_carrier.upper(), [])
    # Always include the operating carrier itself
    return [operating_carrier.upper()] + [p for p in partners if p != operating_carrier.upper()]


def get_partner_surcharge(operating_carrier: str, booking_program: str, default_surcharge: float) -> float:
    """
    Get expected surcharge when booking operating_carrier via booking_program.
    Returns override if available, otherwise the default surcharge.
    """
    key = (operating_carrier.upper(), booking_program.upper())
    return PARTNER_SURCHARGE_OVERRIDES.get(key, default_surcharge)


# =============================================================================
# STRATEGY 2: TRANSFER BONUSES
# =============================================================================

@dataclass
class TransferBonus:
    """Represents an active transfer bonus promotion."""
    bank: str
    airline: str
    bonus_percentage: float  # e.g., 30 for 30% bonus
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    description: str = ""


# Active transfer bonuses (should be updated regularly or fetched from API)
# In production, this would come from a database or external API
ACTIVE_TRANSFER_BONUSES: List[TransferBonus] = [
    # Example bonuses (update with real promotions)
    # TransferBonus("chase", "BA", 30, description="30% bonus to British Airways"),
    # TransferBonus("amex", "VS", 30, description="30% bonus to Virgin Atlantic"),
]


def get_active_transfer_bonus(bank: str, airline: str) -> Optional[TransferBonus]:
    """
    Check for active transfer bonuses between bank and airline.
    Returns the bonus if active, None otherwise.
    """
    now = datetime.now()
    bank_lower = bank.lower()
    airline_upper = airline.upper()
    
    for bonus in ACTIVE_TRANSFER_BONUSES:
        if bonus.bank.lower() != bank_lower or bonus.airline.upper() != airline_upper:
            continue
        # Check if bonus is currently active
        if bonus.start_date and now < bonus.start_date:
            continue
        if bonus.end_date and now > bonus.end_date:
            continue
        return bonus
    
    return None


def get_effective_transfer_ratio(bank: str, airline: str, base_ratio: float = 1.0) -> float:
    """
    Get the effective transfer ratio including any active bonuses.
    
    Example: If base_ratio is 1.0 and there's a 30% bonus,
    returns 1.3 (1000 points → 1300 miles).
    """
    bonus = get_active_transfer_bonus(bank, airline)
    if bonus:
        return base_ratio * (1 + bonus.bonus_percentage / 100)
    return base_ratio


# =============================================================================
# STRATEGY 3: AWARD SWEET SPOTS
# =============================================================================

@dataclass
class AwardSweetSpot:
    """Represents a known award sweet spot route."""
    origin_region: str  # e.g., "US-EAST", "US-WEST"
    destination_region: str
    program: str
    typical_points: int
    cabin: str = "economy"
    via_hub: Optional[str] = None  # Connection point if any
    notes: str = ""


# Known award sweet spots - routes with consistently good redemption value
AWARD_SWEET_SPOTS: List[AwardSweetSpot] = [
    # US to Europe sweet spots
    AwardSweetSpot("US-EAST", "EUROPE", "AF", 30000, "economy", notes="Flying Blue promo awards"),
    AwardSweetSpot("US-EAST", "EUROPE", "AV", 30000, "economy", notes="LifeMiles to Star Alliance"),
    AwardSweetSpot("US-EAST", "EUROPE", "VS", 30000, "economy", notes="Virgin Atlantic to Air France"),
    AwardSweetSpot("US-EAST", "EUROPE", "AA", 22500, "economy", via_hub="DUB", notes="Aer Lingus via Dublin"),
    
    # US to Asia sweet spots
    AwardSweetSpot("US-WEST", "ASIA", "NH", 45000, "economy", notes="ANA to Japan"),
    AwardSweetSpot("US-WEST", "ASIA", "JL", 25000, "economy", notes="JAL distance-based"),
    AwardSweetSpot("US", "ASIA", "AS", 35000, "economy", notes="Alaska to Cathay"),
    AwardSweetSpot("US", "ASIA", "CX", 35000, "economy", notes="Cathay Pacific"),
    
    # US to Middle East
    AwardSweetSpot("US-EAST", "MIDDLE-EAST", "EY", 40000, "economy", notes="Etihad Guest"),
    AwardSweetSpot("US", "MIDDLE-EAST", "AA", 42500, "economy", notes="Qatar via AA"),
    
    # Intra-US sweet spots
    AwardSweetSpot("US", "US", "BA", 7500, "economy", notes="Avios short-haul under 1150mi"),
    AwardSweetSpot("US", "US", "AS", 10000, "economy", notes="Alaska fixed rate"),
    
    # Business class sweet spots
    AwardSweetSpot("US", "ASIA", "NH", 75000, "business", notes="ANA business to Japan"),
    AwardSweetSpot("US-EAST", "EUROPE", "AV", 63000, "business", notes="LifeMiles business"),
    AwardSweetSpot("US", "MIDDLE-EAST", "AA", 70000, "business", notes="Qatar Qsuites via AA"),
]


# Region mappings for airports
AIRPORT_REGIONS: Dict[str, str] = {
    # US East Coast
    "JFK": "US-EAST", "EWR": "US-EAST", "BOS": "US-EAST", "PHL": "US-EAST",
    "IAD": "US-EAST", "DCA": "US-EAST", "MIA": "US-EAST", "FLL": "US-EAST",
    "ATL": "US-EAST", "CLT": "US-EAST", "ORD": "US-EAST", "DTW": "US-EAST",
    
    # US West Coast
    "LAX": "US-WEST", "SFO": "US-WEST", "SEA": "US-WEST", "PDX": "US-WEST",
    "SAN": "US-WEST", "PHX": "US-WEST", "LAS": "US-WEST", "DEN": "US-WEST",
    
    # Europe
    "LHR": "EUROPE", "CDG": "EUROPE", "AMS": "EUROPE", "FRA": "EUROPE",
    "MAD": "EUROPE", "BCN": "EUROPE", "FCO": "EUROPE", "MXP": "EUROPE",
    "ZRH": "EUROPE", "MUC": "EUROPE", "DUB": "EUROPE", "LIS": "EUROPE",
    
    # Asia
    "NRT": "ASIA", "HND": "ASIA", "HKG": "ASIA", "SIN": "ASIA",
    "ICN": "ASIA", "BKK": "ASIA", "TPE": "ASIA", "PVG": "ASIA",
    "KIX": "ASIA", "MNL": "ASIA",
    
    # Middle East
    "DXB": "MIDDLE-EAST", "DOH": "MIDDLE-EAST", "AUH": "MIDDLE-EAST",
    "IST": "MIDDLE-EAST", "TLV": "MIDDLE-EAST",
}


def get_airport_region(airport_code: str) -> str:
    """Get the region for an airport."""
    return AIRPORT_REGIONS.get(airport_code.upper(), "OTHER")


def find_sweet_spots(origin: str, destination: str, cabin: str = "economy") -> List[AwardSweetSpot]:
    """
    Find award sweet spots for a given route.
    Returns list of sweet spots sorted by typical points (lowest first).
    """
    origin_region = get_airport_region(origin)
    dest_region = get_airport_region(destination)
    
    matches = []
    for spot in AWARD_SWEET_SPOTS:
        # Check cabin match
        if spot.cabin.lower() != cabin.lower():
            continue
        
        # Check region match (with wildcards like "US" matching "US-EAST" and "US-WEST")
        origin_match = (
            spot.origin_region == origin_region or
            (spot.origin_region == "US" and origin_region.startswith("US"))
        )
        dest_match = (
            spot.destination_region == dest_region or
            (spot.destination_region == "US" and dest_region.startswith("US"))
        )
        
        if origin_match and dest_match:
            matches.append(spot)
    
    return sorted(matches, key=lambda s: s.typical_points)


# =============================================================================
# STRATEGY 3: POSITIONING FLIGHTS
# =============================================================================

# Major hubs with good award availability (worth positioning to)
POSITIONING_HUBS: List[str] = ["JFK", "EWR", "ORD", "LAX", "SFO", "MIA", "IAD", "SEA", "DFW"]


def evaluate_positioning_value(
    home_airport: str,
    destination: str,
    home_oop: float,
    hub_oop: float,
    positioning_cost: float,
    min_savings_pct: float = 0.20
) -> Dict[str, Any]:
    """
    Evaluate if positioning to a hub is worthwhile.
    
    Args:
        home_airport: User's home airport
        destination: Final destination
        home_oop: OOP cost flying direct from home
        hub_oop: OOP cost flying from hub
        positioning_cost: Cost to get to hub (cash or cheap points)
        min_savings_pct: Minimum savings percentage to recommend positioning
    
    Returns:
        Dict with recommendation and savings info
    """
    total_with_positioning = positioning_cost + hub_oop
    savings = home_oop - total_with_positioning
    savings_pct = savings / home_oop if home_oop > 0 else 0
    
    return {
        "recommended": savings_pct >= min_savings_pct,
        "home_oop": home_oop,
        "hub_oop": hub_oop,
        "positioning_cost": positioning_cost,
        "total_with_positioning": total_with_positioning,
        "savings": savings,
        "savings_percentage": savings_pct * 100,
    }


# =============================================================================
# STRATEGY 4: DATE FLEXIBILITY SCORING
# =============================================================================

@dataclass
class DateOOPScore:
    """OOP score for a specific date."""
    date: datetime
    cash_price: float
    award_oop: float  # Surcharge/taxes only when using points
    award_points: int
    has_award: bool
    savings: float  # cash_price - award_oop
    cpp: float  # cents per point


def score_date_for_oop(
    date: datetime,
    cash_price: Optional[float],
    award_data: Optional[Dict[str, Any]]
) -> DateOOPScore:
    """
    Score a date based on OOP optimization.
    Lower OOP is better; higher savings is better.
    """
    cash = cash_price or float('inf')
    
    if award_data and award_data.get("points"):
        points = award_data["points"]
        surcharge = award_data.get("surcharge", 0) or 0
        award_oop = surcharge
        savings = cash - surcharge if cash < float('inf') else 0
        cpp = (savings * 100 / points) if points > 0 and savings > 0 else 0
        has_award = True
    else:
        award_oop = cash
        points = 0
        savings = 0
        cpp = 0
        has_award = False
    
    return DateOOPScore(
        date=date,
        cash_price=cash,
        award_oop=award_oop,
        award_points=points,
        has_award=has_award,
        savings=savings,
        cpp=cpp,
    )


def find_best_oop_dates(
    date_scores: List[DateOOPScore],
    prefer_awards: bool = True,
    min_cpp: float = 1.0
) -> List[DateOOPScore]:
    """
    Sort dates by OOP optimization criteria.
    
    If prefer_awards=True, prioritize dates with award availability.
    Filter out awards below min_cpp threshold.
    """
    # Filter by CPP threshold
    filtered = [
        d for d in date_scores
        if not d.has_award or d.cpp >= min_cpp
    ]
    
    if prefer_awards:
        # Sort: has_award first, then by award_oop (lowest first)
        return sorted(filtered, key=lambda d: (not d.has_award, d.award_oop))
    else:
        # Sort purely by OOP
        return sorted(filtered, key=lambda d: d.award_oop)


# =============================================================================
# STRATEGY 5: COMPREHENSIVE CARD BENEFITS
# =============================================================================

@dataclass
class CardBenefit:
    """Comprehensive card benefit data."""
    card_name: str
    issuer: str  # amex, chase, citi, capitalone, bilt
    
    # Travel credits
    travel_credit: float = 0  # Annual travel credit
    airline_fee_credit: float = 0  # Annual airline incidental credit
    
    # Airline-specific benefits
    free_checked_bags: Dict[str, int] = None  # {airline: num_bags}
    priority_boarding: List[str] = None  # List of airlines
    companion_pass: bool = False
    
    # Lounge access
    priority_pass: bool = False
    airline_lounge: Optional[str] = None  # e.g., "Delta Sky Club"
    centurion_lounge: bool = False
    
    # Protections
    trip_delay_coverage: float = 0  # Per occurrence
    trip_cancel_coverage: float = 0
    primary_car_rental: bool = False
    
    # Points earning
    travel_earn_rate: float = 1.0  # Points per dollar on travel
    dining_earn_rate: float = 1.0
    
    def __post_init__(self):
        if self.free_checked_bags is None:
            self.free_checked_bags = {}
        if self.priority_boarding is None:
            self.priority_boarding = []


# Common premium card benefits
CARD_BENEFITS_DB: Dict[str, CardBenefit] = {
    "amex_platinum": CardBenefit(
        card_name="American Express Platinum",
        issuer="amex",
        travel_credit=200,
        airline_fee_credit=200,
        priority_pass=True,
        centurion_lounge=True,
        trip_delay_coverage=500,
        primary_car_rental=True,
        travel_earn_rate=5.0,
        dining_earn_rate=1.0,
    ),
    "chase_sapphire_reserve": CardBenefit(
        card_name="Chase Sapphire Reserve",
        issuer="chase",
        travel_credit=300,
        priority_pass=True,
        trip_delay_coverage=500,
        trip_cancel_coverage=10000,
        primary_car_rental=True,
        travel_earn_rate=3.0,
        dining_earn_rate=3.0,
    ),
    "chase_sapphire_preferred": CardBenefit(
        card_name="Chase Sapphire Preferred",
        issuer="chase",
        travel_earn_rate=2.0,
        dining_earn_rate=3.0,
        trip_cancel_coverage=10000,
    ),
    "united_club_infinite": CardBenefit(
        card_name="United Club Infinite",
        issuer="chase",
        free_checked_bags={"UA": 2},
        priority_boarding=["UA"],
        airline_lounge="United Club",
        travel_earn_rate=2.0,
    ),
    "united_quest": CardBenefit(
        card_name="United Quest",
        issuer="chase",
        free_checked_bags={"UA": 2},
        priority_boarding=["UA"],
        travel_credit=125,
        travel_earn_rate=2.0,
    ),
    "delta_reserve": CardBenefit(
        card_name="Delta SkyMiles Reserve",
        issuer="amex",
        free_checked_bags={"DL": 1},
        priority_boarding=["DL"],
        airline_lounge="Delta Sky Club",
        companion_pass=True,
        travel_earn_rate=2.0,
    ),
    "delta_platinum": CardBenefit(
        card_name="Delta SkyMiles Platinum",
        issuer="amex",
        free_checked_bags={"DL": 1},
        priority_boarding=["DL"],
        companion_pass=True,
        travel_earn_rate=2.0,
    ),
    "aa_executive": CardBenefit(
        card_name="Citi AAdvantage Executive",
        issuer="citi",
        free_checked_bags={"AA": 1},
        priority_boarding=["AA"],
        airline_lounge="Admirals Club",
        travel_earn_rate=2.0,
    ),
    "citi_premier": CardBenefit(
        card_name="Citi Premier",
        issuer="citi",
        travel_earn_rate=3.0,
        dining_earn_rate=3.0,
    ),
    "capital_one_venture_x": CardBenefit(
        card_name="Capital One Venture X",
        issuer="capitalone",
        travel_credit=300,
        priority_pass=True,
        travel_earn_rate=2.0,
        dining_earn_rate=2.0,
    ),
    "bilt_mastercard": CardBenefit(
        card_name="Bilt Mastercard",
        issuer="bilt",
        travel_earn_rate=2.0,
        dining_earn_rate=3.0,
    ),
}


def calculate_card_benefit_value(
    card_key: str,
    itinerary_airlines: List[str],
    cash_spend: float,
    num_travelers: int = 1
) -> float:
    """
    Calculate the total benefit value a card provides for an itinerary.
    
    Args:
        card_key: Key in CARD_BENEFITS_DB
        itinerary_airlines: List of airlines in the itinerary
        cash_spend: Total cash spend on the itinerary
        num_travelers: Number of travelers
    
    Returns:
        Total estimated benefit value in dollars
    """
    card = CARD_BENEFITS_DB.get(card_key)
    if not card:
        return 0.0
    
    value = 0.0
    
    # Checked bag benefits
    bag_fee = 35  # Average bag fee
    for airline in itinerary_airlines:
        bags = card.free_checked_bags.get(airline, 0)
        if bags > 0:
            # Each traveler saves on bags for round trip
            value += bags * bag_fee * num_travelers * 2
    
    # Travel credit (prorated estimate)
    if card.travel_credit > 0:
        # Assume user can use up to the travel credit for this booking
        value += min(card.travel_credit, cash_spend)
    
    # Points earning value (assuming 1 cpp)
    earned_points = cash_spend * card.travel_earn_rate
    value += earned_points * 0.01  # 1 cpp value
    
    # Trip protection expected value (rough estimate)
    if card.trip_delay_coverage > 0:
        value += 10  # Expected value of trip delay protection
    if card.primary_car_rental:
        value += 15  # Expected value of primary rental coverage
    
    return value


def recommend_payment_card(
    cards: List[str],
    airlines: List[str],
    cash_amount: float,
    num_travelers: int = 1
) -> Dict[str, Any]:
    """
    Recommend the best card to use for payment.
    
    Args:
        cards: List of card keys the user has
        airlines: Airlines in the itinerary
        cash_amount: Cash amount to pay
        num_travelers: Number of travelers
    
    Returns:
        Recommendation with card and benefit value
    """
    best_card = None
    best_value = 0
    
    for card_key in cards:
        value = calculate_card_benefit_value(card_key, airlines, cash_amount, num_travelers)
        if value > best_value:
            best_value = value
            best_card = card_key
    
    return {
        "recommended_card": best_card,
        "benefit_value": best_value,
        "card_name": CARD_BENEFITS_DB[best_card].card_name if best_card else None,
    }


# =============================================================================
# STRATEGY 6: MIXED CABIN OPTIMIZATION
# =============================================================================

@dataclass
class CabinOption:
    """Option for a specific cabin class."""
    cabin: str
    points: int
    surcharge: float
    cash_price: float
    cpp: float
    oop: float
    savings: float  # cash_price - oop


def evaluate_cabin_options(
    economy_award: Optional[Dict],
    economy_cash: float,
    business_award: Optional[Dict],
    business_cash: float,
    first_award: Optional[Dict] = None,
    first_cash: float = float('inf'),
) -> List[CabinOption]:
    """
    Compare OOP and value across cabin classes.
    Sometimes business class provides much better CPP even with higher OOP.
    
    Returns list of cabin options sorted by savings (highest first).
    """
    options = []
    
    # Economy
    if economy_award:
        eco_oop = economy_award.get("surcharge", 0) or 0
        eco_points = economy_award.get("points", 0)
        eco_savings = economy_cash - eco_oop
        eco_cpp = (eco_savings * 100 / eco_points) if eco_points > 0 else 0
        options.append(CabinOption(
            cabin="Economy",
            points=eco_points,
            surcharge=eco_oop,
            cash_price=economy_cash,
            cpp=eco_cpp,
            oop=eco_oop,
            savings=eco_savings,
        ))
    
    # Business
    if business_award:
        biz_oop = business_award.get("surcharge", 0) or 0
        biz_points = business_award.get("points", 0)
        biz_savings = business_cash - biz_oop
        biz_cpp = (biz_savings * 100 / biz_points) if biz_points > 0 else 0
        options.append(CabinOption(
            cabin="Business",
            points=biz_points,
            surcharge=biz_oop,
            cash_price=business_cash,
            cpp=biz_cpp,
            oop=biz_oop,
            savings=biz_savings,
        ))
    
    # First
    if first_award and first_cash < float('inf'):
        first_oop = first_award.get("surcharge", 0) or 0
        first_points = first_award.get("points", 0)
        first_savings = first_cash - first_oop
        first_cpp = (first_savings * 100 / first_points) if first_points > 0 else 0
        options.append(CabinOption(
            cabin="First",
            points=first_points,
            surcharge=first_oop,
            cash_price=first_cash,
            cpp=first_cpp,
            oop=first_oop,
            savings=first_savings,
        ))
    
    # Sort by savings (highest first) - this shows where points provide most value
    return sorted(options, key=lambda o: -o.savings)


# =============================================================================
# STRATEGY 7: GROUP PAYMENT OPTIMIZATION
# =============================================================================

@dataclass
class TravelerPaymentAssignment:
    """Payment assignment for a single traveler."""
    traveler_id: str
    payment_type: str  # "award" or "cash"
    points_used: int
    oop: float


def optimize_group_payment(
    travelers: List[str],
    points_balances: Dict[str, int],
    award_price: int,
    award_surcharge: float,
    cash_price: float,
    available_award_seats: int,
) -> Dict[str, Any]:
    """
    Optimize payment split for a group when award seats are limited.
    
    Assigns award seats to travelers with the most points first.
    
    Args:
        travelers: List of traveler IDs
        points_balances: {traveler_id: total_points}
        award_price: Points cost per seat
        award_surcharge: Taxes/fees per award seat
        cash_price: Cash price per seat
        available_award_seats: Number of available award seats
    
    Returns:
        Optimization result with assignments and totals
    """
    # Sort travelers by points balance (highest first)
    sorted_travelers = sorted(
        travelers,
        key=lambda t: points_balances.get(t, 0),
        reverse=True
    )
    
    assignments: List[TravelerPaymentAssignment] = []
    award_seats_used = 0
    total_oop = 0.0
    total_points = 0
    
    for traveler in sorted_travelers:
        balance = points_balances.get(traveler, 0)
        
        # Try to assign award seat if available and traveler has enough points
        if award_seats_used < available_award_seats and balance >= award_price:
            assignments.append(TravelerPaymentAssignment(
                traveler_id=traveler,
                payment_type="award",
                points_used=award_price,
                oop=award_surcharge,
            ))
            award_seats_used += 1
            total_oop += award_surcharge
            total_points += award_price
        else:
            # Assign cash seat
            assignments.append(TravelerPaymentAssignment(
                traveler_id=traveler,
                payment_type="cash",
                points_used=0,
                oop=cash_price,
            ))
            total_oop += cash_price
    
    all_cash_oop = cash_price * len(travelers)
    savings = all_cash_oop - total_oop
    
    return {
        "assignments": [
            {
                "traveler_id": a.traveler_id,
                "payment_type": a.payment_type,
                "points_used": a.points_used,
                "oop": a.oop,
            }
            for a in assignments
        ],
        "total_oop": total_oop,
        "total_points_used": total_points,
        "award_seats_used": award_seats_used,
        "cash_seats_used": len(travelers) - award_seats_used,
        "comparison_all_cash": all_cash_oop,
        "savings": savings,
        "savings_percentage": (savings / all_cash_oop * 100) if all_cash_oop > 0 else 0,
    }


# =============================================================================
# OOP SUMMARY CALCULATION
# =============================================================================

def calculate_trip_oop_summary(
    flight_segments: List[Dict[str, Any]],
    hotel_nights: int = 0,
    hotel_rate: float = 0.0,
    travelers: int = 1,
) -> Dict[str, Any]:
    """
    Calculate comprehensive OOP summary for a trip.
    
    Args:
        flight_segments: List of flight segment dicts with payment info
        hotel_nights: Number of hotel nights
        hotel_rate: Nightly hotel rate (cash)
        travelers: Number of travelers
    
    Returns:
        Summary with breakdown of all OOP costs
    """
    flight_oop = 0.0
    flight_points = 0
    flight_cash_saved = 0.0
    
    for seg in flight_segments:
        if seg.get("payment_type") == "award":
            flight_oop += seg.get("surcharge", 0) * travelers
            flight_points += seg.get("points", 0) * travelers
            cash_price = seg.get("cash_price", 0)
            surcharge = seg.get("surcharge", 0)
            flight_cash_saved += (cash_price - surcharge) * travelers
        else:
            flight_oop += seg.get("cash_price", 0) * travelers
    
    hotel_oop = hotel_nights * hotel_rate
    total_oop = flight_oop + hotel_oop
    
    return {
        "flight_oop": flight_oop,
        "hotel_oop": hotel_oop,
        "total_oop": total_oop,
        "points_used": flight_points,
        "cash_saved_by_points": flight_cash_saved,
        "average_cpp": (flight_cash_saved * 100 / flight_points) if flight_points > 0 else 0,
    }
