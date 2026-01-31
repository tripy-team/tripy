import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


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
    - AWARDTOOL_API_KEY is not configured
    """
    if USE_AWARDTOOL_DUMMY_DATA:
        return True
    # Auto-enable dummy mode if no API key is configured
    if not AWARDTOOL_API_KEY:
        return True
    return False
