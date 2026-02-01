import os
import json
import time
import threading
from typing import Any, Optional
import logging

from src.contracts.validate import find_negative_numbers

# ============================================================
# Config
# ============================================================

CACHE_NAMESPACE = "tripy"
REDIS_URL = os.getenv("REDIS_URL")  # e.g. redis://localhost:6379/0
DEFAULT_TTL = 300  # seconds (used only for memory cache)

# ============================================================
# Redis client (optional)
# ============================================================

_redis = None
if REDIS_URL:
    try:
        import redis

        _redis = redis.Redis.from_url(
            REDIS_URL,
            decode_responses=True,  # return str not bytes
            socket_timeout=1.5,
            socket_connect_timeout=1.5,
        )
        _redis.ping()
    except Exception:
        _redis = None


# ============================================================
# In-memory fallback cache
# ============================================================

_mem_cache = {}
_mem_lock = threading.Lock()
logger = logging.getLogger(__name__)


def _mem_set(key: str, value: Any, ttl: int):
    expires_at = time.time() + ttl
    with _mem_lock:
        _mem_cache[key] = (value, expires_at)


def _mem_get(key: str) -> Optional[Any]:
    now = time.time()
    with _mem_lock:
        item = _mem_cache.get(key)
        if not item:
            return None
        value, expires_at = item
        if expires_at < now:
            _mem_cache.pop(key, None)
            return None
        return value


# ============================================================
# Helpers
# ============================================================


def _ns(key: str) -> str:
    """Namespace all keys"""
    return f"{CACHE_NAMESPACE}:{key}"


def _json_dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), default=str)


def _json_loads(value: str) -> Any:
    return json.loads(value)


# ============================================================
# Public API
# ============================================================


def get_json(key: str) -> Optional[Any]:
    """
    Fetch cached JSON value.
    Returns None on cache miss or any error.
    """
    k = _ns(key)

    def _invalidate():
        # Best-effort invalidation.
        if _redis:
            try:
                _redis.delete(k)
            except Exception:
                pass
        try:
            with _mem_lock:
                _mem_cache.pop(k, None)
        except Exception:
            pass

    # --- Redis path ---
    if _redis:
        try:
            raw = _redis.get(k)
            if raw is None:
                return None
            value = _json_loads(raw)
            negatives = find_negative_numbers(value)
            if negatives:
                logger.warning("[CACHE_INVALID_SENTINEL_VALUES] key=%s sample=%s", k, negatives[:5])
                _invalidate()
                return None
            return value
        except Exception:
            return None

    # --- Memory fallback ---
    try:
        value = _mem_get(k)
        if value is None:
            return None
        negatives = find_negative_numbers(value)
        if negatives:
            logger.warning("[CACHE_INVALID_SENTINEL_VALUES] key=%s sample=%s", k, negatives[:5])
            _invalidate()
            return None
        return value
    except Exception:
        return None


def set_json(key: str, value: Any, ttl: int = DEFAULT_TTL) -> None:
    """
    Store JSON-serializable value with TTL (seconds).
    Fails silently by design.
    """
    k = _ns(key)

    # --- Redis path ---
    if _redis:
        try:
            _redis.setex(k, ttl, _json_dumps(value))
            return
        except Exception:
            pass

    # --- Memory fallback ---
    try:
        _mem_set(k, value, ttl)
    except Exception:
        pass
