import os
import logging
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

logger = logging.getLogger(__name__)


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

# Optional configuration
USER_POOL_ID = os.environ.get("USER_POOL_ID", "")
USER_POOL_CLIENT_ID = os.environ.get("USER_POOL_CLIENT_ID", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")

SERP_API_KEY = os.environ.get("SERP_API_KEY", "")
AWARDTOOL_API_KEY = os.environ.get("AWARDTOOL_API_KEY", "") or os.environ.get(
    "AWARD_TOOL_API_KEY", ""
)

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
