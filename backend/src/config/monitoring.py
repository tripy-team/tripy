"""
Monitoring feature configuration.

All monitoring env vars are OPTIONAL with safe defaults (feature off).
This module never raises at import time — missing vars disable the feature, not crash the app.
"""
import os
import logging

logger = logging.getLogger(__name__)


def _bool_env(key: str, default: bool = False) -> bool:
    """Parse a boolean environment variable safely."""
    return os.environ.get(key, str(default)).lower() in ("true", "1", "yes")


# =============================================================================
# FEATURE FLAGS (kill switches)
# =============================================================================

# Master kill switch for alert emails. Must be True AND render check must pass.
MONITORING_ALERTS_ENABLED: bool = _bool_env("MONITORING_ALERTS_ENABLED", False)

# Gate paid monitoring backend endpoints (checkout, Stripe webhooks).
MONITORING_PAID_ENABLED: bool = _bool_env("MONITORING_PAID_ENABLED", False)

# Search mode for the monitoring cron job.
#   "stub"      — candidate = baseline (current no-op behavior, score always 0)
#   "fake_drop" — candidate = baseline with cash_price reduced ~20%, stops -1 (dev testing)
#   "real"      — calls real flight search pipeline
MONITORING_SEARCH_MODE: str = os.environ.get("MONITORING_SEARCH_MODE", "stub")

# =============================================================================
# SECRETS
# =============================================================================

# Protects internal cron endpoints (re-uses existing CRON_SECRET if set).
MONITORING_CRON_SECRET: str = os.environ.get(
    "MONITORING_CRON_SECRET",
    os.environ.get("CRON_SECRET", ""),
)

# JWT signing secret for verification + unsubscribe tokens.
# Falls back to CRON_SECRET to keep dev setup simple; override in prod.
MONITORING_TOKEN_SECRET: str = os.environ.get(
    "MONITORING_TOKEN_SECRET",
    os.environ.get("CRON_SECRET", "monitoring-dev-secret"),
)

# =============================================================================
# TABLE NAMES
# =============================================================================

MONITORING_TABLE_SUBSCRIPTIONS: str = os.environ.get(
    "MONITORING_TABLE_SUBSCRIPTIONS", "tripy-monitoring-subscriptions"
)
MONITORING_TABLE_BASELINES: str = os.environ.get(
    "MONITORING_TABLE_BASELINES", "tripy-monitoring-baselines"
)
MONITORING_TABLE_UPDATES: str = os.environ.get(
    "MONITORING_TABLE_UPDATES", "tripy-monitoring-updates"
)
RATE_LIMIT_TABLE: str = os.environ.get(
    "RATE_LIMIT_TABLE", "tripy-rate-limit-counters"
)

# =============================================================================
# FRONTEND URL (for email links + render check)
# =============================================================================

FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "https://tripy.app")

# =============================================================================
# OPERATIONAL CONSTANTS
# =============================================================================

# Check intervals (seconds)
FREE_CHECK_INTERVAL_S: int = 6 * 3600     # 6 hours
PAID_CHECK_INTERVAL_S: int = 2 * 3600     # 2 hours

# Subscription expiry
FREE_MONITORING_DAYS: int = 14
PAID_MONITORING_DAYS: int = 30
DEPARTURE_BUFFER_HOURS: int = 24

# Cooldown
COOLDOWN_HOURS: int = 48

# Cron job limits
CRON_BATCH_SIZE: int = 25
SEARCH_CONCURRENCY: int = 3
PER_SUB_TIMEOUT_S: int = 30
JOB_TIMEOUT_S: int = 300  # 5 minutes

# Score thresholds
SCORE_THRESHOLD_HIGH: float = 0.25
SCORE_THRESHOLD_MEDIUM_LOW: float = 0.10
SCORE_THRESHOLD_NOISE: float = 0.05
COOLDOWN_OVERRIDE_SCORE: float = 0.40
COOLDOWN_OVERRIDE_CASH_FLOOR: int = 150
COOLDOWN_OVERRIDE_POINTS_FLOOR: int = 10_000

# Rate limits
RATE_LIMIT_START_PER_HOUR_PER_IP: int = 10
RATE_LIMIT_START_PER_DAY_PER_TRIP: int = 10
RATE_LIMIT_RESEND_PER_DAY_PER_EMAIL: int = 3
RATE_LIMIT_VERIFY_PER_HOUR_PER_IP: int = 20
RATE_LIMIT_UPDATE_FETCH_PER_MIN_PER_IP: int = 30

# Update record expiry
UPDATE_EXPIRY_DAYS: int = 90
UPDATE_TTL_GRACE_DAYS: int = 30  # DDB cleanup after expiry

# Schema versions
MINIMUM_SUPPORTED_SUBSCRIPTION_SCHEMA: int = 1
MINIMUM_SUPPORTED_BASELINE_SCHEMA: int = 1
MINIMUM_SUPPORTED_UPDATE_SCHEMA: int = 1
MINIMUM_SUPPORTED_QUERY_VERSION: int = 1

# Due-index shard count
DUE_INDEX_SHARD_COUNT: int = 10

# Flight disappeared: minimum search results to consider market "populated"
FLIGHT_DISAPPEARED_MIN_RESULTS: int = 5

# Verification token
VERIFICATION_TOKEN_EXPIRY_HOURS: int = 24


# =============================================================================
# Startup logging
# =============================================================================

def _log_monitoring_config():
    logger.info(
        f"[MONITORING CONFIG] alerts_enabled={MONITORING_ALERTS_ENABLED}, "
        f"paid_enabled={MONITORING_PAID_ENABLED}, "
        f"search_mode={MONITORING_SEARCH_MODE}, "
        f"subs_table={MONITORING_TABLE_SUBSCRIPTIONS}, "
        f"baselines_table={MONITORING_TABLE_BASELINES}, "
        f"updates_table={MONITORING_TABLE_UPDATES}, "
        f"rate_limit_table={RATE_LIMIT_TABLE}"
    )


_log_monitoring_config()
