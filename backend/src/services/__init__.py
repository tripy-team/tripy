"""
Services package

We avoid importing heavy services with deep dependencies (like itinerary_service)
at module import time, so that scripts which only need image_service/city_service
don't pull in modules that depend on unavailable extras (e.g. award_calendar).
"""

from . import trip_service
from . import destination_service
from . import points_service
from . import route_service
from . import user_service
from . import city_service
from . import trip_member_service
from . import auth_service
from . import image_service
from . import itinerary_service
from . import solo_trip_service

__all__ = [
    "trip_service",
    "destination_service",
    "points_service",
    "route_service",
    "user_service",
    "city_service",
    "trip_member_service",
    "auth_service",
    "image_service",
    "itinerary_service",
    "solo_trip_service",
]
