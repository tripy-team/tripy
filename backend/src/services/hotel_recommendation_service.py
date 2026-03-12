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
from typing import List, Optional, Protocol

from src.agents.models import HotelRecommendation

logger = logging.getLogger(__name__)


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
    """

    def recommend(self, window: StayWindow) -> List[HotelRecommendation]: ...


# =============================================================================
# MOCK PROVIDER (stub for live API integration)
# =============================================================================

_MOCK_HOTEL_CHAINS = [
    {"name": "Marriott", "brands": ["Marriott", "Westin", "Sheraton", "W Hotels", "Ritz-Carlton"]},
    {"name": "Hilton", "brands": ["Hilton", "Conrad", "DoubleTree", "Waldorf Astoria"]},
    {"name": "Hyatt", "brands": ["Hyatt Regency", "Grand Hyatt", "Park Hyatt", "Andaz"]},
    {"name": "IHG", "brands": ["InterContinental", "Crowne Plaza", "Holiday Inn"]},
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

    TODO: Replace with live provider integration (e.g. SerpAPI Hotels,
    Booking.com Affiliate API, or Amadeus Hotel API).
    """

    def recommend(self, window: StayWindow) -> List[HotelRecommendation]:
        tier = _CITY_TIER.get(window.destination.upper(), 3)
        base_rate = {1: 280, 2: 200, 3: 150}.get(tier, 180)

        chain = random.choice(_MOCK_HOTEL_CHAINS)
        brand = random.choice(chain["brands"])
        star = 5 if brand in ("Ritz-Carlton", "Waldorf Astoria", "Park Hyatt", "Conrad", "InterContinental") else 4
        rate = base_rate * (1.3 if star == 5 else 1.0) * window.room_count
        rate = round(rate + random.uniform(-30, 30), 2)
        total = round(rate * window.nights, 2)
        rating = round(random.uniform(4.0, 4.8), 1)
        amenities = random.sample(_AMENITIES_POOL, min(5, len(_AMENITIES_POOL)))

        city_label = window.destination
        reason = (
            f"Best value {star}-star hotel in {city_label} for your "
            f"{window.nights}-night stay. {brand} offers strong loyalty "
            f"value and consistent quality."
        )

        return [HotelRecommendation(
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
        )]


# Singleton provider — swap this to use a live implementation
_provider: HotelProvider = MockHotelProvider()


def set_hotel_provider(provider: HotelProvider) -> None:
    """Replace the active hotel provider (useful for testing or live APIs)."""
    global _provider
    _provider = provider


# =============================================================================
# PUBLIC API
# =============================================================================

def get_hotel_recommendations(
    windows: List[StayWindow],
) -> List[HotelRecommendation]:
    """Generate hotel recommendations for a list of stay windows.

    Failures for individual windows are logged and skipped so that partial
    results are returned. This ensures hotel failures never block the
    flight-only itinerary.
    """
    recommendations: List[HotelRecommendation] = []
    for window in windows:
        try:
            recs = _provider.recommend(window)
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
    return get_hotel_recommendations(windows)


def recommend_hotels_for_group_trip(
    destination: str,
    start_date: str,
    end_date: str,
    traveler_count: int,
    room_count: Optional[int] = None,
) -> List[HotelRecommendation]:
    """Entry point for group trip hotel recommendations."""
    windows = derive_stay_windows_for_group(
        destination=destination,
        start_date=start_date,
        end_date=end_date,
        traveler_count=traveler_count,
        room_count=room_count,
    )
    return get_hotel_recommendations(windows)
