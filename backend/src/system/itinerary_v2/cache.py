"""
Cache utilities for the v2 itinerary pipeline.

Wraps src/utils/cache_layer with v2-specific cache keys and TTLs.
"""

import hashlib
from typing import Any, Optional

from src.utils.cache_layer import get_json, set_json

# TTL constants (in seconds)
SERP_CACHE_TTL = 90 * 60  # 90 minutes (same as v1)
AWARD_CACHE_TTL = 6 * 3600  # 6 hours
ORDER_CACHE_TTL = 3600  # 1 hour for route ordering

# Cache key prefixes
PREFIX_SERP = "itinv2:serp"
PREFIX_AWARD = "itinv2:award"
PREFIX_ORDER = "itinv2:order"


def _hash_key(*parts: str) -> str:
    """Create a short hash from parts for cache key."""
    combined = ":".join(str(p) for p in parts)
    return hashlib.sha256(combined.encode("utf-8")).hexdigest()[:24]


def make_serp_key(
    origin: str,
    destination: str,
    date: str,
    travel_class: str = "economy",
    pax: int = 1,
) -> str:
    """
    Create cache key for SERP flight results.
    
    Format: itinv2:serp:{hash}
    """
    h = _hash_key(origin, destination, date, travel_class, str(pax))
    return f"{PREFIX_SERP}:{h}"


def make_award_key(
    origin: str,
    destination: str,
    date: str,
    cabins: str,  # comma-separated
    programs: str,  # comma-separated
    pax: int = 1,
) -> str:
    """
    Create cache key for AwardTool results.
    
    Format: itinv2:award:{hash}
    """
    h = _hash_key(origin, destination, date, cabins, programs, str(pax))
    return f"{PREFIX_AWARD}:{h}"


def make_order_key(
    airports: list[str],
    representative_date: str,
) -> str:
    """
    Create cache key for route ordering results.
    
    Format: itinv2:order:{hash}
    """
    h = _hash_key(":".join(sorted(airports)), representative_date)
    return f"{PREFIX_ORDER}:{h}"


def cache_get(key: str) -> Optional[Any]:
    """Get cached value by key."""
    return get_json(key)


def cache_set(key: str, value: Any, ttl: int) -> None:
    """Set cached value with TTL."""
    set_json(key, value, ttl)


def cache_serp_get(
    origin: str,
    destination: str,
    date: str,
    travel_class: str = "economy",
    pax: int = 1,
) -> Optional[Any]:
    """Get cached SERP results."""
    key = make_serp_key(origin, destination, date, travel_class, pax)
    return cache_get(key)


def cache_serp_set(
    origin: str,
    destination: str,
    date: str,
    value: Any,
    travel_class: str = "economy",
    pax: int = 1,
) -> None:
    """Set cached SERP results."""
    key = make_serp_key(origin, destination, date, travel_class, pax)
    cache_set(key, value, SERP_CACHE_TTL)


def cache_award_get(
    origin: str,
    destination: str,
    date: str,
    cabins: list[str],
    programs: list[str],
    pax: int = 1,
) -> Optional[Any]:
    """Get cached AwardTool results."""
    key = make_award_key(
        origin, destination, date,
        ",".join(sorted(cabins)),
        ",".join(sorted(programs)),
        pax,
    )
    return cache_get(key)


def cache_award_set(
    origin: str,
    destination: str,
    date: str,
    cabins: list[str],
    programs: list[str],
    value: Any,
    pax: int = 1,
) -> None:
    """Set cached AwardTool results."""
    key = make_award_key(
        origin, destination, date,
        ",".join(sorted(cabins)),
        ",".join(sorted(programs)),
        pax,
    )
    cache_set(key, value, AWARD_CACHE_TTL)
