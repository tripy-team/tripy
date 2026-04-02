"""
Configuration module for backend services.

This __init__.py re-exports all original config.py exports to maintain backward
compatibility, while also adding optimizer-specific configuration.

SECURITY NOTE:
- For local development, secrets are loaded from .env file
- For production, set USE_SECRETS_MANAGER=true to use AWS Secrets Manager
- See backend/src/utils/secrets_manager.py for details
"""
import os
import logging
from dotenv import load_dotenv

# Load environment variables from .env file (for local development)
load_dotenv()

logger = logging.getLogger(__name__)

# Import secrets manager for sensitive keys
from src.utils.secrets_manager import secrets, get_api_keys


def _get_required_env(key: str) -> str:
    """Get required environment variable, raise clear error if missing"""
    value = os.environ.get(key)
    if not value:
        raise ValueError(
            f"Required environment variable '{key}' is not set. "
            f"Please set it in your .env file or environment."
        )
    return value


def _validate_env_vars():
    """Validate all required environment variables at startup"""
    required_vars = [
        "USERS_TABLE",
        "TRIPS_TABLE",
        "TRIP_MEMBERS_TABLE",
        "POINTS_TABLE",
        "DESTINATIONS_TABLE",
        "DESTINATION_VOTES_TABLE",
        "ITINERARY_TABLE",
    ]
    missing = []
    for var in required_vars:
        if not os.environ.get(var):
            missing.append(var)

    if missing:
        raise ValueError(
            f"Missing required environment variables: {', '.join(missing)}. "
            f"Please set them in your .env file or environment."
        )


# Validate required environment variables
_validate_env_vars()

# Required database tables
USERS_TABLE = _get_required_env("USERS_TABLE")
TRIPS_TABLE = _get_required_env("TRIPS_TABLE")
TRIP_MEMBERS_TABLE = _get_required_env("TRIP_MEMBERS_TABLE")
POINTS_TABLE = _get_required_env("POINTS_TABLE")
DESTINATIONS_TABLE = _get_required_env("DESTINATIONS_TABLE")
DESTINATION_VOTES_TABLE = _get_required_env("DESTINATION_VOTES_TABLE")
ITINERARY_TABLE = _get_required_env("ITINERARY_TABLE")

# Group planning table (optional, defaults for local dev)
GROUP_PLANNING_TABLE = os.environ.get("GROUP_PLANNING_TABLE", "tripy-group-planning")

# B2B tables (optional, defaults for local dev)
ORGANIZATIONS_TABLE = os.environ.get("ORGANIZATIONS_TABLE", "tripy-organizations")
ORG_MEMBERS_TABLE = os.environ.get("ORG_MEMBERS_TABLE", "tripy-org-members")
CLIENTS_TABLE = os.environ.get("CLIENTS_TABLE", "tripy-clients")
CLIENT_POINTS_TABLE = os.environ.get("CLIENT_POINTS_TABLE", "tripy-client-points")

# Feature tables (optional, defaults for local dev)
PROPOSALS_TABLE = os.environ.get("PROPOSALS_TABLE", "tripy-proposals")
PREFERENCE_SIGNALS_TABLE = os.environ.get("PREFERENCE_SIGNALS_TABLE", "tripy-preference-signals")

# Optional configuration
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
USER_POOL_CLIENT_ID = os.environ.get("USER_POOL_CLIENT_ID", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")

# API Keys - Use secrets manager for sensitive keys (supports AWS Secrets Manager)
SERP_API_KEY = secrets.get("SERP_API_KEY", "") or secrets.get("SERPAPI_KEY", "")
AWARDTOOL_API_KEY = secrets.get("AWARDTOOL_API_KEY", "") or secrets.get(
    "AWARD_TOOL_API_KEY", ""
)

# Additional API keys available via secrets manager:
# - OPENAI_ADMIN_KEY: secrets.get("OPENAI_ADMIN_KEY")
# - CLAUDE_API_KEY: secrets.get("CLAUDE_API_KEY")
# - AMADEUS_CLIENT_ID: secrets.get("AMADEUS_CLIENT_ID")
# - AMADEUS_CLIENT_SECRET: secrets.get("AMADEUS_CLIENT_SECRET")

# Email (AWS SES) configuration
SES_SENDER_EMAIL = os.environ.get("SES_SENDER_EMAIL", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://tripy.app")

# Internal cron secret — protects /solo/internal/* endpoints
CRON_SECRET = os.environ.get("CRON_SECRET", "")

# AwardTool Dummy Data Mode - set USE_AWARDTOOL_DUMMY_DATA=true in .env to use dummy data
USE_AWARDTOOL_DUMMY_DATA = (
    os.environ.get("USE_AWARDTOOL_DUMMY_DATA", "false").lower() == "true"
)


def is_awardtool_dummy_mode() -> bool:
    """
    Check if we should use dummy data instead of live AwardTool API.
    Returns True if:
    - USE_AWARDTOOL_DUMMY_DATA is explicitly set to "true", OR
    - AWARDTOOL_API_KEY is not configured or empty
    
    IMPORTANT: This function is called frequently, so logging is done once at startup.
    """
    if USE_AWARDTOOL_DUMMY_DATA:
        return True
    # Auto-enable dummy mode if no API key is configured or is whitespace
    if not AWARDTOOL_API_KEY or not AWARDTOOL_API_KEY.strip():
        return True
    return False


# Log API key status at startup (helps debug dummy mode issues)
def _log_api_status():
    """Log API key configuration status at startup."""
    awardtool_dummy = is_awardtool_dummy_mode()
    serp_key_present = bool(SERP_API_KEY and SERP_API_KEY.strip())
    awardtool_key_present = bool(AWARDTOOL_API_KEY and AWARDTOOL_API_KEY.strip())
    
    if awardtool_dummy:
        if USE_AWARDTOOL_DUMMY_DATA:
            logger.warning(
                "[CONFIG] AwardTool DUMMY MODE ENABLED: USE_AWARDTOOL_DUMMY_DATA=true. "
                "Flights will use simulated data!"
            )
        elif not awardtool_key_present:
            logger.warning(
                "[CONFIG] AwardTool DUMMY MODE AUTO-ENABLED: AWARDTOOL_API_KEY not configured. "
                "Set AWARDTOOL_API_KEY in .env to use real flight data."
            )
    else:
        logger.info(
            f"[CONFIG] AwardTool API ACTIVE: key configured (length={len(AWARDTOOL_API_KEY)}). "
            f"Real flight data will be used."
        )
    
    if not serp_key_present:
        logger.warning(
            "[CONFIG] SERP_API_KEY not configured. Cash flight prices will NOT be available. "
            "Set SERP_API_KEY in .env for cash pricing."
        )
    else:
        logger.info(f"[CONFIG] SERP_API_KEY configured (length={len(SERP_API_KEY)})")


# Run status logging at import time
_log_api_status()

# Log secrets manager status
if secrets.is_using_secrets_manager():
    logger.info("[CONFIG] SECRETS: Using AWS Secrets Manager for API keys")
else:
    logger.info("[CONFIG] SECRETS: Using environment variables (.env) for API keys")

# =============================================================================
# FEATURE FLAGS
# =============================================================================

# FEATURE_FLIGHTS_ONLY: When True, Tripy operates as a flight-only optimizer.
# Hotel/lodging endpoints will return HTTP 410 Gone.
# This is the product decision: Tripy is a points-first, seat-allocation,
# ticketing optimizer for flights only. Lodging is out of scope.
FEATURE_FLIGHTS_ONLY = os.environ.get("FEATURE_FLIGHTS_ONLY", "true").lower() == "true"


def is_flights_only_mode() -> bool:
    """
    Check if Tripy is running in flight-only mode (default: True).
    When True, hotel/lodging endpoints return HTTP 410 Gone.
    """
    return FEATURE_FLIGHTS_ONLY


# Log feature flag status at startup
if FEATURE_FLIGHTS_ONLY:
    logger.info("[CONFIG] FLIGHT-ONLY MODE: Hotel/lodging features are disabled (FEATURE_FLIGHTS_ONLY=true)")
else:
    logger.info("[CONFIG] FULL MODE: Hotel/lodging features are enabled (FEATURE_FLIGHTS_ONLY=false)")


# =============================================================================
# STREAMING / ASYNC GENERATION CONFIGURATION
# =============================================================================

GENERATION_QUEUE_URL = os.environ.get("GENERATION_QUEUE_URL", "")

FEATURE_STREAM_GENERATION = os.environ.get("FEATURE_STREAM_GENERATION", "false").lower() == "true"

# Heuristic thresholds for inline-vs-queue decision
STREAM_QUEUE_PAIR_THRESHOLD = int(os.environ.get("STREAM_QUEUE_PAIR_THRESHOLD", "20"))

# Stale lock timeout in seconds (locks older than this are considered abandoned)
GENERATION_LOCK_STALE_SECONDS = int(os.environ.get("GENERATION_LOCK_STALE_SECONDS", "300"))

if FEATURE_STREAM_GENERATION:
    logger.info("[CONFIG] STREAM GENERATION: Enabled (FEATURE_STREAM_GENERATION=true)")
else:
    logger.info("[CONFIG] STREAM GENERATION: Disabled — legacy sync endpoint only")


# =============================================================================
# OPTIMIZER CONFIGURATION (from optimizer_config.py)
# =============================================================================

from .optimizer_config import (
    GROUP_SOLVE_TIME_LIMIT_S,
    GROUP_SOLVER,
    RELAX_BIG_M_GROUP,
    RELAX_BIG_M_MEMBER,
    RELAX_BIG_M_MAX_MEMBER,
    RELAX_EPS_OOP,
    RELAX_EPS_POINTS,
    RELAX_ENABLE_MINIMAX,
    MAX_ALTERNATIVE_SOLUTIONS,
    GENERATE_ALTERNATIVES_IN_RELAXED,
    get_relaxation_config,
    log_relaxation_config,
)
