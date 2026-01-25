"""
HTTP logging utilities for the v2 itinerary pipeline.

Provides consistent, greppable logs for API calls with:
- Request metadata and response summaries
- Truncated large bodies
- Never logs API keys
"""

import json
import logging
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _truncate(s: str, n: int = 2000) -> str:
    """Truncate string to n characters with indicator."""
    s = s or ""
    return s if len(s) <= n else s[:n] + f"...(truncated,{len(s)} chars)"


def _redact_keys(d: dict) -> dict:
    """Redact sensitive keys from dict for logging."""
    sensitive = {"api_key", "apikey", "key", "token", "secret", "password", "authorization"}
    result = {}
    for k, v in d.items():
        k_lower = k.lower()
        if any(s in k_lower for s in sensitive):
            result[k] = "***REDACTED***"
        elif isinstance(v, dict):
            result[k] = _redact_keys(v)
        else:
            result[k] = v
    return result


def log_api_call(
    *,
    run_id: str,
    provider: str,
    method: str,
    url: str,
    request_summary: dict[str, Any],
    status_code: Optional[int],
    response_summary: dict[str, Any],
    response_body_preview: Optional[str] = None,
    elapsed_ms: Optional[int] = None,
    level: int = logging.INFO,
) -> None:
    """
    Log an API call with structured data.
    
    Args:
        run_id: Correlation ID for this pipeline run
        provider: Provider name (e.g., "SERP", "AwardTool")
        method: HTTP method
        url: Request URL (sensitive params redacted)
        request_summary: Summary of request params (redacted)
        status_code: HTTP response status code
        response_summary: Summary of response (counts, key values)
        response_body_preview: Truncated response body for debugging
        elapsed_ms: Request duration in milliseconds
        level: Log level
    """
    # Redact sensitive data
    safe_request = _redact_keys(request_summary) if request_summary else {}
    
    payload = {
        "run_id": run_id,
        "provider": provider,
        "method": method,
        "url": _redact_url(url),
        "elapsed_ms": elapsed_ms,
        "request": safe_request,
        "status_code": status_code,
        "response": response_summary,
    }
    
    if response_body_preview:
        payload["response_preview"] = _truncate(response_body_preview, 1200)
    
    logger.log(level, "api_call %s", json.dumps(payload, default=str))


def _redact_url(url: str) -> str:
    """Redact API keys from URL query params."""
    if not url:
        return url
    
    # Simple redaction of common API key patterns
    import re
    patterns = [
        (r'api_key=[^&]+', 'api_key=***'),
        (r'apikey=[^&]+', 'apikey=***'),
        (r'key=[^&]+', 'key=***'),
        (r'token=[^&]+', 'token=***'),
    ]
    result = url
    for pattern, replacement in patterns:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result


def log_run_start(
    run_id: str,
    trip_id: str,
    user_id: Optional[str],
    constraints: dict[str, Any],
    traveler_count: int,
) -> None:
    """Log the start of a v2 itinerary generation run."""
    payload = {
        "event": "itinv2_start",
        "run_id": run_id,
        "trip_id": trip_id,
        "user_id": user_id,
        "constraints": constraints,
        "traveler_count": traveler_count,
    }
    logger.info("itinv2 start %s", json.dumps(payload, default=str))


def log_run_end(
    run_id: str,
    trip_id: str,
    status: str,
    totals: dict[str, Any],
    item_count: int,
    elapsed_ms: int,
) -> None:
    """Log the end of a v2 itinerary generation run."""
    payload = {
        "event": "itinv2_end",
        "run_id": run_id,
        "trip_id": trip_id,
        "status": status,
        "totals": totals,
        "item_count": item_count,
        "elapsed_ms": elapsed_ms,
    }
    logger.info("itinv2 end %s", json.dumps(payload, default=str))


def log_ilp_start(
    run_id: str,
    leg_count: int,
    option_count: int,
    traveler_count: int,
    points_programs: int,
) -> None:
    """Log the start of ILP optimization."""
    payload = {
        "event": "itinv2_ilp_start",
        "run_id": run_id,
        "legs": leg_count,
        "options": option_count,
        "travelers": traveler_count,
        "points_programs": points_programs,
    }
    logger.info("itinv2 ilp start %s", json.dumps(payload, default=str))


def log_ilp_end(
    run_id: str,
    status: str,
    objective_value: Optional[float],
    totals: dict[str, Any],
    chosen_options: list[str],
) -> None:
    """Log the end of ILP optimization."""
    payload = {
        "event": "itinv2_ilp_end",
        "run_id": run_id,
        "status": status,
        "objective_value": objective_value,
        "totals": totals,
        "chosen_options": chosen_options[:10],  # Limit to first 10
    }
    logger.info("itinv2 ilp end %s", json.dumps(payload, default=str))


def log_render(
    run_id: str,
    item_count: int,
    path_count: int,
    payment_count: int,
    totals: dict[str, Any],
) -> None:
    """Log the render step."""
    payload = {
        "event": "itinv2_render",
        "run_id": run_id,
        "item_count": item_count,
        "path_count": path_count,
        "payment_count": payment_count,
        "totals": totals,
    }
    logger.info("itinv2 render %s", json.dumps(payload, default=str))


def log_error(
    run_id: str,
    trip_id: str,
    error: Exception,
    context: Optional[dict[str, Any]] = None,
) -> None:
    """Log an error with run context."""
    payload = {
        "event": "itinv2_error",
        "run_id": run_id,
        "trip_id": trip_id,
        "error_type": type(error).__name__,
        "error_message": str(error),
        "context": context or {},
    }
    logger.error("itinv2 error %s", json.dumps(payload, default=str), exc_info=True)


def log_leg_fetch(
    run_id: str,
    leg: str,  # "JFK->CDG"
    serp_count: int,
    serp_min_cash: Optional[float],
    award_count: int,
    award_min_miles: Optional[int],
    fallback_used: bool,
) -> None:
    """Log fetch results for a single leg."""
    payload = {
        "event": "itinv2_leg_fetch",
        "run_id": run_id,
        "leg": leg,
        "serp_options": serp_count,
        "serp_min_cash": serp_min_cash,
        "award_quotes": award_count,
        "award_min_miles": award_min_miles,
        "fallback_used": fallback_used,
    }
    logger.info("itinv2 leg fetch %s", json.dumps(payload, default=str))


def log_points_summary(
    run_id: str,
    total_points: int,
    top_programs: list[tuple[str, int]],
    traveler_count: int,
) -> None:
    """Log points summary for the run."""
    payload = {
        "event": "itinv2_points_summary",
        "run_id": run_id,
        "total_points": total_points,
        "top_programs": [{"program": p, "balance": b} for p, b in top_programs[:5]],
        "traveler_count": traveler_count,
    }
    logger.info("itinv2 points summary %s", json.dumps(payload, default=str))
