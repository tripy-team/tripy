"""
Hotel Recommendation Service

Shared service for generating hotel recommendations in both solo and group
trip flows. Derives stay windows from trip data, calls a provider abstraction,
and returns normalized HotelRecommendation objects.

Provider strategy:
- Uses a pluggable provider interface.
- Ships with a MockHotelProvider that returns realistic sample data derived
  from trip parameters so the full pipeline works end-to-end.
- TODO: Replace MockHotelProvider with a live provider (e.g. SerpAPI Hotels,
  Booking.com API, or hotel calendar integration).
"""

import logging
import math
import random
import uuid
from datetime import date, timedelta
from typing import Dict, List, Optional, Protocol

from src.agents.models import HotelRecommendation, PreferenceDeviation

logger = logging.getLogger(__name__)

# Canonical loyalty-program codes used by the points pipeline.
# Callers may supply balances keyed by these codes OR by common aliases
# (e.g. "marriott", "marriott_bonvoy"). We match loosely below.
_CHAIN_PROGRAM_ALIASES = {
    "Marriott": ("MAR", "marriott", "bonvoy", "marriott_bonvoy", "marriottbonvoy"),
    "Hilton": ("HH", "hilton", "hilton_honors", "hiltonhonors", "honors"),
    "Hyatt": ("HYATT", "hyatt", "world_of_hyatt", "worldofhyatt"),
    "IHG": ("IHG", "ihg", "ihg_one_rewards", "ihgonerewards"),
}

# Minimum redemption value (cents per point) at which points are preferred
# over cash. Below this, cash is the better use of the balance.
_MIN_POINTS_CPP = 1.0


def _lookup_chain_points(chain_name: str, user_points: Optional[Dict[str, int]]) -> int:
    """Return the user's points balance for a given hotel chain, or 0."""
    if not user_points:
        return 0
    aliases = _CHAIN_PROGRAM_ALIASES.get(chain_name, ())
    normalized = {
        str(k).lower().replace("_", "").replace(" ", ""): int(v)
        for k, v in user_points.items()
        if v is not None
    }
    for alias in aliases:
        key = alias.lower().replace("_", "").replace(" ", "")
        if key in normalized:
            return normalized[key]
    return 0


# =============================================================================
# STAY WINDOW DERIVATION
# =============================================================================

class StayWindow:
    """A contiguous hotel stay at a single destination."""

    def __init__(
        self,
        destination: str,
        check_in: str,
        check_out: str,
        traveler_count: int = 1,
        room_count: int = 1,
    ):
        self.destination = destination
        self.check_in = check_in
        self.check_out = check_out
        self.traveler_count = traveler_count
        self.room_count = room_count

    @property
    def nights(self) -> int:
        try:
            ci = date.fromisoformat(self.check_in)
            co = date.fromisoformat(self.check_out)
            return max(1, (co - ci).days)
        except (ValueError, TypeError):
            return 1


def estimate_room_count(traveler_count: int) -> int:
    """Estimate rooms needed from traveler count.

    Isolated helper so it can be refined later (e.g. with rooming preferences).
    Assumption: 2 travelers per room, rounded up.
    """
    return max(1, math.ceil(traveler_count / 2))


def derive_stay_windows_from_trip(
    destinations: List[str],
    start_date: Optional[str],
    end_date: Optional[str],
    leg_dates: Optional[List[str]] = None,
    traveler_count: int = 1,
    room_count: Optional[int] = None,
    is_round_trip: bool = True,
) -> List[StayWindow]:
    """Derive hotel stay windows from trip parameters.

    Handles:
    - Single-destination round trips: one stay for the full window.
    - Multi-city itineraries with leg_dates: one stay per destination
      between consecutive leg dates.
    - Multi-city without leg_dates: evenly split the total duration.
    """
    if room_count is None:
        room_count = estimate_room_count(traveler_count)

    if not destinations or not start_date or not end_date:
        return []

    try:
        trip_start = date.fromisoformat(start_date)
        trip_end = date.fromisoformat(end_date)
    except (ValueError, TypeError):
        return []

    if trip_end <= trip_start:
        return []

    windows: List[StayWindow] = []

    if len(destinations) == 1 or (is_round_trip and len(destinations) == 1):
        windows.append(StayWindow(
            destination=destinations[0],
            check_in=start_date,
            check_out=end_date,
            traveler_count=traveler_count,
            room_count=room_count,
        ))
        return windows

    if leg_dates and len(leg_dates) >= len(destinations):
        for i, dest in enumerate(destinations):
            ci = leg_dates[i]
            co = leg_dates[i + 1] if i + 1 < len(leg_dates) else end_date
            if ci and co and ci < co:
                windows.append(StayWindow(
                    destination=dest,
                    check_in=ci,
                    check_out=co,
                    traveler_count=traveler_count,
                    room_count=room_count,
                ))
        return windows

    total_days = (trip_end - trip_start).days
    days_per_city = max(1, total_days // len(destinations))
    current = trip_start
    for i, dest in enumerate(destinations):
        ci = current
        if i == len(destinations) - 1:
            co = trip_end
        else:
            co = ci + timedelta(days=days_per_city)
        if co > trip_end:
            co = trip_end
        if ci < co:
            windows.append(StayWindow(
                destination=dest,
                check_in=ci.isoformat(),
                check_out=co.isoformat(),
                traveler_count=traveler_count,
                room_count=room_count,
            ))
        current = co

    return windows


def derive_stay_windows_for_group(
    destination: str,
    start_date: str,
    end_date: str,
    traveler_count: int,
    room_count: Optional[int] = None,
) -> List[StayWindow]:
    """Derive stay windows for a group trip (typically single destination)."""
    destinations = [d.strip() for d in destination.split(",") if d.strip()] or [destination]
    return derive_stay_windows_from_trip(
        destinations=destinations,
        start_date=start_date,
        end_date=end_date,
        traveler_count=traveler_count,
        room_count=room_count,
        is_round_trip=True,
    )


# =============================================================================
# PROVIDER ABSTRACTION
# =============================================================================

class HotelProvider(Protocol):
    """Provider interface for hotel recommendations.

    Implementations must return a list of HotelRecommendation for a given
    stay window. The provider may return an empty list on failure.

    When `cash_budget` or `user_points` are supplied, implementations should
    prefer options that fit the budget and mark the payment method (points
    vs cash) that best uses the traveler's balances. Both are optional so
    the original call site (`provider.recommend(window)`) remains valid.
    """

    def recommend(
        self,
        window: StayWindow,
        *,
        cash_budget: Optional[float] = None,
        user_points: Optional[Dict[str, int]] = None,
    ) -> List[HotelRecommendation]: ...


# =============================================================================
# MOCK PROVIDER (stub for live API integration)
# =============================================================================

_MOCK_HOTEL_CHAINS = [
    {
        "name": "Marriott",
        "brands": ["Marriott", "Westin", "Sheraton", "W Hotels", "Ritz-Carlton"],
        "loyalty": "Marriott Bonvoy",
        "points_base": {4: 35000, 5: 60000},
    },
    {
        "name": "Hilton",
        "brands": ["Hilton", "Conrad", "DoubleTree", "Waldorf Astoria"],
        "loyalty": "Hilton Honors",
        "points_base": {4: 50000, 5: 80000},
    },
    {
        "name": "Hyatt",
        "brands": ["Hyatt Regency", "Grand Hyatt", "Park Hyatt", "Andaz"],
        "loyalty": "World of Hyatt",
        "points_base": {4: 15000, 5: 25000},
    },
    {
        "name": "IHG",
        "brands": ["InterContinental", "Crowne Plaza", "Holiday Inn"],
        "loyalty": "IHG One Rewards",
        "points_base": {4: 30000, 5: 50000},
    },
]

_CITY_TIER = {
    "NYC": 1, "JFK": 1, "LGA": 1, "EWR": 1, "LAX": 1, "SFO": 1, "MIA": 1,
    "LHR": 1, "CDG": 1, "NRT": 1, "HND": 1, "SIN": 1, "HKG": 1, "DXB": 1,
    "ORD": 2, "BOS": 2, "SEA": 2, "DEN": 2, "ATL": 2, "DFW": 2,
    "FCO": 2, "BCN": 2, "AMS": 2, "FRA": 2, "MUC": 2, "ICN": 2, "BKK": 2,
}

_AMENITIES_POOL = [
    "Free WiFi", "Pool", "Fitness Center", "Spa", "Restaurant",
    "Room Service", "Business Center", "Airport Shuttle",
    "Complimentary Breakfast", "Rooftop Bar", "Concierge",
]


class MockHotelProvider:
    """Returns realistic mock hotel data derived from trip parameters.

    When the caller supplies `cash_budget` (for this stay window) and/or
    `user_points`, the provider builds one candidate per major chain, scores
    each against the budget/points balance, and returns the single best
    match. Without that context it falls back to the original single-random
    pick so legacy callers keep their current shape.

    TODO: Replace with live provider integration (e.g. SerpAPI Hotels,
    Booking.com Affiliate API, or Amadeus Hotel API).
    """

    def _build_candidate(
        self,
        window: StayWindow,
        chain: dict,
        tier: int,
        base_rate: float,
    ) -> HotelRecommendation:
        brand = random.choice(chain["brands"])
        star = 5 if brand in ("Ritz-Carlton", "Waldorf Astoria", "Park Hyatt", "Conrad", "InterContinental") else 4
        rate = base_rate * (1.3 if star == 5 else 1.0) * window.room_count
        rate = round(rate + random.uniform(-30, 30), 2)
        total = round(rate * window.nights, 2)
        rating = round(random.uniform(4.0, 4.8), 1)
        amenities = random.sample(_AMENITIES_POOL, min(5, len(_AMENITIES_POOL)))

        loyalty_program = chain["loyalty"]
        tier_multiplier = {1: 1.4, 2: 1.1, 3: 0.9}.get(tier, 1.0)
        ppn = int(chain["points_base"].get(star, 35000) * tier_multiplier * window.room_count)
        ppn += random.randint(-2000, 2000)
        ppn = max(5000, ppn)
        points_total = ppn * window.nights

        city_label = window.destination
        reason = (
            f"{star}-star {brand} in {city_label} for your "
            f"{window.nights}-night stay. {loyalty_program} redemption: "
            f"{ppn:,} pts/night."
        )

        return HotelRecommendation(
            hotel_id=f"mock-{uuid.uuid4().hex[:8]}",
            hotel_name=f"{brand} {city_label}",
            destination=window.destination,
            check_in=window.check_in,
            check_out=window.check_out,
            price_total=total,
            nightly_rate=rate,
            currency="USD",
            booking_url=f"https://www.{chain['name'].lower()}.com/search?dest={city_label}",
            rating=rating,
            star_level=star,
            amenities=amenities,
            recommendation_reason=reason,
            traveler_count=window.traveler_count,
            room_count=window.room_count,
            loyalty_program=loyalty_program,
            points_per_night=ppn,
            points_total=points_total,
        )

    def _evaluate(
        self,
        rec: HotelRecommendation,
        chain_name: str,
        cash_budget: Optional[float],
        user_points: Optional[Dict[str, int]],
    ) -> HotelRecommendation:
        """Annotate the rec with payment recommendation and budget fit."""
        balance = _lookup_chain_points(chain_name, user_points)
        points_feasible = (
            rec.points_total is not None
            and balance >= rec.points_total
        )
        cash_feasible = (
            cash_budget is None
            or (rec.price_total is not None and rec.price_total <= cash_budget)
        )

        # Redemption value in cents/point for the full stay.
        cpp = None
        if rec.points_total and rec.points_total > 0 and rec.price_total:
            cpp = round((rec.price_total * 100.0) / rec.points_total, 2)

        # Prefer points when:
        #   (1) the user has enough balance AND
        #   (2) redemption value clears the minimum cpp threshold OR
        #       cash wouldn't fit the budget anyway.
        if points_feasible and (
            (cpp is not None and cpp >= _MIN_POINTS_CPP)
            or not cash_feasible
        ):
            rec.recommended_payment = "points"
            rec.fits_budget = True
        elif cash_feasible:
            rec.recommended_payment = "cash"
            rec.fits_budget = True
        else:
            # Neither fits — surface it so the caller can show the shortfall.
            rec.recommended_payment = "cash"
            rec.fits_budget = False

        rec.cash_budget_allocated = cash_budget
        rec.redemption_value_cpp = cpp
        return rec

    def recommend(
        self,
        window: StayWindow,
        *,
        cash_budget: Optional[float] = None,
        user_points: Optional[Dict[str, int]] = None,
    ) -> List[HotelRecommendation]:
        tier = _CITY_TIER.get(window.destination.upper(), 3)
        base_rate = {1: 280, 2: 200, 3: 150}.get(tier, 180)

        # Legacy path — no budget or points context. Preserve the old
        # "one random hotel per window" shape so existing callers and tests
        # keep working without modification.
        if cash_budget is None and not user_points:
            chain = random.choice(_MOCK_HOTEL_CHAINS)
            return [self._build_candidate(window, chain, tier, base_rate)]

        # Budget/points-aware path: evaluate every chain, then pick the one
        # that best uses the traveler's budget and balances.
        candidates: List[tuple[HotelRecommendation, dict]] = []
        for chain in _MOCK_HOTEL_CHAINS:
            rec = self._build_candidate(window, chain, tier, base_rate)
            self._evaluate(rec, chain["name"], cash_budget, user_points)
            candidates.append((rec, chain))

        # Ranking:
        #   1) fits_budget True beats False
        #   2) points-paid beats cash-paid when both fit (keeps cash free
        #      for flights/experiences — caller passed us points for a reason)
        #   3) among points-paid, higher cpp wins
        #   4) among cash-paid, lower price wins
        def _rank_key(item: tuple[HotelRecommendation, dict]) -> tuple:
            rec, _ = item
            fits_rank = 0 if rec.fits_budget else 1
            if rec.recommended_payment == "points":
                pay_rank = 0
                # Higher cpp first → negate so smaller sorts first.
                value_rank = -(rec.redemption_value_cpp or 0.0)
            else:
                pay_rank = 1
                value_rank = rec.price_total or float("inf")
            return (fits_rank, pay_rank, value_rank)

        candidates.sort(key=_rank_key)
        best_rec, best_chain = candidates[0]

        # Rewrite the reason to reflect the actual decision so the UI copy
        # explains why this was chosen over the other chains.
        if best_rec.recommended_payment == "points":
            best_rec.recommendation_reason = (
                f"Best points redemption for {window.destination}: "
                f"{best_rec.points_total:,} {best_chain['loyalty']} points covers "
                f"{window.nights} nights "
                f"(worth ~${best_rec.price_total:,.0f}, "
                f"{best_rec.redemption_value_cpp or 0:.1f}c/pt)."
            )
        elif best_rec.fits_budget:
            best_rec.recommendation_reason = (
                f"Best cash value in {window.destination} within your budget: "
                f"{best_rec.hotel_name} at ${best_rec.price_total:,.0f} "
                f"for {window.nights} nights."
            )
        else:
            over_by = (best_rec.price_total or 0) - (cash_budget or 0)
            best_rec.recommendation_reason = (
                f"No hotel in {window.destination} fits the remaining cash "
                f"budget (${cash_budget:,.0f}) or available points. "
                f"Closest option is {best_rec.hotel_name} — "
                f"${over_by:,.0f} over budget."
            )

        return [best_rec]


# Singleton provider — swap this to use a live implementation
_provider: HotelProvider = MockHotelProvider()


def set_hotel_provider(provider: HotelProvider) -> None:
    """Replace the active hotel provider (useful for testing or live APIs)."""
    global _provider
    _provider = provider


# =============================================================================
# PUBLIC API
# =============================================================================

def _apply_client_preferences(
    recs: List[HotelRecommendation],
    client_preferences: Optional[dict],
) -> List[HotelRecommendation]:
    """Rank hotels by client preferences and attach deviation explanations.

    Soft preferences only — no hard filtering. If the preferred chain or
    star level isn't available, we still return options but explain the
    mismatch on each recommendation so the advisor can justify the choice.
    """
    if not client_preferences or not recs:
        return recs

    star_min = client_preferences.get("hotel_star_min")
    preferred_chains = [c.lower() for c in (client_preferences.get("preferred_hotel_chains") or [])]
    avoid_chains = [c.lower() for c in (client_preferences.get("avoid_hotel_chains") or [])]
    preferred_amenities = [a.lower() for a in (client_preferences.get("preferred_hotel_amenities") or [])]

    def _chain_from(rec: HotelRecommendation) -> str:
        return (rec.hotel_name or "").lower()

    def _score(rec: HotelRecommendation) -> float:
        # Lower is better. Start from price and apply preference nudges.
        base = rec.price_total if rec.price_total else float('inf')
        name = _chain_from(rec)
        if any(c in name for c in preferred_chains):
            base *= 0.85
        if any(c in name for c in avoid_chains):
            base *= 1.20
        if star_min is not None and rec.star_level >= star_min:
            base *= 0.95
        if preferred_amenities:
            matched = sum(
                1 for a in (rec.amenities or []) if a.lower() in preferred_amenities
            )
            if matched:
                base *= (1.0 - 0.03 * min(matched, 3))
        return base

    # Populate preference_deviations based on the chosen rec vs. stated prefs.
    for rec in recs:
        deviations: list[PreferenceDeviation] = []
        name = _chain_from(rec)
        if star_min is not None and rec.star_level < star_min:
            deviations.append(PreferenceDeviation(
                field="hotel_star_min",
                preferred=star_min,
                chosen=rec.star_level,
                reason=(
                    f"No {star_min}-star property available for this stay window; "
                    f"selected the highest-rated {rec.star_level}-star option."
                ),
            ))
        if preferred_chains and not any(c in name for c in preferred_chains):
            deviations.append(PreferenceDeviation(
                field="preferred_hotel_chains",
                preferred=client_preferences.get("preferred_hotel_chains"),
                chosen=rec.hotel_name,
                reason=(
                    "Preferred chain not available at a competitive rate here; "
                    "selected best-value alternative."
                ),
            ))
        if avoid_chains and any(c in name for c in avoid_chains):
            deviations.append(PreferenceDeviation(
                field="avoid_hotel_chains",
                preferred=f"avoid {client_preferences.get('avoid_hotel_chains')}",
                chosen=rec.hotel_name,
                reason=(
                    "Only options in this market are from a chain the client asked "
                    "to avoid; surfacing for advisor review."
                ),
            ))
        if deviations:
            rec.preference_deviations = deviations

    recs.sort(key=_score)
    return recs


def _allocate_cash_budget(
    windows: List[StayWindow],
    cash_budget_remaining: Optional[float],
) -> List[Optional[float]]:
    """Split the remaining cash budget across windows by night count.

    Longer stays and larger rooms get proportionally more cash. Returns a
    list of per-window cash allocations parallel to `windows`. When no
    budget is supplied, returns Nones so downstream code treats it as
    unconstrained.
    """
    if cash_budget_remaining is None or not windows:
        return [None] * len(windows)
    weights = [max(1, w.nights) * max(1, w.room_count) for w in windows]
    total_weight = sum(weights) or 1
    return [
        round(cash_budget_remaining * (w / total_weight), 2) for w in weights
    ]


def get_hotel_recommendations(
    windows: List[StayWindow],
    client_preferences: Optional[dict] = None,
    cash_budget_remaining: Optional[float] = None,
    user_points: Optional[Dict[str, int]] = None,
) -> List[HotelRecommendation]:
    """Generate hotel recommendations for a list of stay windows.

    When `cash_budget_remaining` is supplied (the cash left over after
    flights), it is split across windows proportional to nights/rooms so
    each stay has its own cash envelope. `user_points` carries the
    traveler's hotel loyalty balances so the provider can prefer points
    redemptions when they clear a minimum value threshold.

    Failures for individual windows are logged and skipped so that partial
    results are returned. This ensures hotel failures never block the
    flight-only itinerary.
    """
    allocations = _allocate_cash_budget(windows, cash_budget_remaining)
    has_context = cash_budget_remaining is not None or bool(user_points)
    recommendations: List[HotelRecommendation] = []
    for window, window_budget in zip(windows, allocations):
        try:
            # Only pass budget/points kwargs when the caller supplied them.
            # Lets provider implementations keep the original `recommend(window)`
            # signature until they're ready to opt in.
            if has_context:
                recs = _provider.recommend(
                    window,
                    cash_budget=window_budget,
                    user_points=user_points,
                )
            else:
                recs = _provider.recommend(window)
            recs = _apply_client_preferences(recs, client_preferences)
            recommendations.extend(recs)
        except Exception:
            logger.exception(
                "Hotel recommendation failed for %s (%s to %s), skipping",
                window.destination,
                window.check_in,
                window.check_out,
            )
    return recommendations


def recommend_hotels_for_solo_trip(
    destinations: List[str],
    start_date: Optional[str],
    end_date: Optional[str],
    leg_dates: Optional[List[str]] = None,
    traveler_count: int = 1,
    is_round_trip: bool = True,
    client_preferences: Optional[dict] = None,
    cash_budget_remaining: Optional[float] = None,
    user_points: Optional[Dict[str, int]] = None,
) -> List[HotelRecommendation]:
    """Entry point for solo trip hotel recommendations."""
    windows = derive_stay_windows_from_trip(
        destinations=destinations,
        start_date=start_date,
        end_date=end_date,
        leg_dates=leg_dates,
        traveler_count=traveler_count,
        is_round_trip=is_round_trip,
    )
    return get_hotel_recommendations(
        windows,
        client_preferences=client_preferences,
        cash_budget_remaining=cash_budget_remaining,
        user_points=user_points,
    )


def recommend_hotels_for_group_trip(
    destination: str,
    start_date: str,
    end_date: str,
    traveler_count: int,
    room_count: Optional[int] = None,
    client_preferences: Optional[dict] = None,
    cash_budget_remaining: Optional[float] = None,
    user_points: Optional[Dict[str, int]] = None,
) -> List[HotelRecommendation]:
    """Entry point for group trip hotel recommendations."""
    windows = derive_stay_windows_for_group(
        destination=destination,
        start_date=start_date,
        end_date=end_date,
        traveler_count=traveler_count,
        room_count=room_count,
    )
    return get_hotel_recommendations(
        windows,
        client_preferences=client_preferences,
        cash_budget_remaining=cash_budget_remaining,
        user_points=user_points,
    )
