"""
Monitoring feature utility functions.

Pure functions for email normalization, hashing, scoring, fingerprinting, etc.
"""
import hashlib
import ipaddress
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from src.config.monitoring import (
    COOLDOWN_HOURS,
    COOLDOWN_OVERRIDE_CASH_FLOOR,
    COOLDOWN_OVERRIDE_POINTS_FLOOR,
    COOLDOWN_OVERRIDE_SCORE,
    DEPARTURE_BUFFER_HOURS,
    DUE_INDEX_SHARD_COUNT,
    FREE_CHECK_INTERVAL_S,
    FREE_MONITORING_DAYS,
    PAID_CHECK_INTERVAL_S,
    PAID_MONITORING_DAYS,
    SCORE_THRESHOLD_HIGH,
    SCORE_THRESHOLD_MEDIUM_LOW,
)


# =============================================================================
# EMAIL
# =============================================================================

def normalize_email(email: str) -> str:
    """Normalize email for consistent storage and comparison."""
    return email.strip().lower()


def mask_email(email: str) -> str:
    """Mask email for display: show first char, last char before @, and full domain."""
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked_local = local[0] + "***"
    else:
        masked_local = local[0] + "***" + local[-1]
    return f"{masked_local}@{domain}"


# =============================================================================
# STATE BUCKET (for due-index sharding)
# =============================================================================

def compute_state_bucket(subscription_id: str, state: str) -> str:
    """
    Compute the sharded state_bucket for the due-index GSI.
    Format: "{state}#{hash(subscription_id) % SHARD_COUNT}"
    This distributes active subscriptions across N partitions to prevent hot keys.
    """
    shard = int(hashlib.md5(subscription_id.encode()).hexdigest()[:2], 16) % DUE_INDEX_SHARD_COUNT
    return f"{state}#{shard}"


# =============================================================================
# IP HASHING (privacy)
# =============================================================================

def hash_ip_for_consent(ip: str) -> str:
    """
    Hash an IP address for consent tracking and rate limiting.
    IPv4: truncate to /24 then hash.
    IPv6: truncate to /48 then hash.
    Returns a hex digest suitable as a DynamoDB key component.
    """
    try:
        addr = ipaddress.ip_address(ip)
        if isinstance(addr, ipaddress.IPv4Address):
            network = ipaddress.ip_network(f"{ip}/24", strict=False)
        else:
            network = ipaddress.ip_network(f"{ip}/48", strict=False)
        cidr_str = str(network)
    except ValueError:
        cidr_str = ip  # fallback to raw if parsing fails

    return hashlib.sha256(cidr_str.encode()).hexdigest()[:16]


# =============================================================================
# SCHEDULING
# =============================================================================

def compute_next_check_at(tier: str) -> datetime:
    """Compute next check time based on tier."""
    interval = PAID_CHECK_INTERVAL_S if tier == "paid" else FREE_CHECK_INTERVAL_S
    return datetime.now(timezone.utc) + timedelta(seconds=interval)


def compute_expires_at(tier: str, departure_dt: Optional[datetime] = None) -> datetime:
    """
    Compute subscription expiry.
    Rule: min(tier_max_days from now, departure - buffer_hours).
    """
    now = datetime.now(timezone.utc)
    max_days = PAID_MONITORING_DAYS if tier == "paid" else FREE_MONITORING_DAYS
    tier_expiry = now + timedelta(days=max_days)

    if departure_dt:
        if departure_dt.tzinfo is None:
            departure_dt = departure_dt.replace(tzinfo=timezone.utc)
        departure_expiry = departure_dt - timedelta(hours=DEPARTURE_BUFFER_HOURS)
        return min(tier_expiry, departure_expiry)

    return tier_expiry


# =============================================================================
# FINGERPRINTING
# =============================================================================

def compute_change_fingerprint(
    baseline: Dict[str, Any],
    candidate: Dict[str, Any],
) -> str:
    """
    Compute a change fingerprint for dedupe.
    Includes itinerary identity + bucketed price/points/schedule deltas.
    Bucket sizes: $25 cash, 2500 points — wide enough to avoid noise, narrow enough to catch real changes.
    """
    # Candidate identity (carrier + flight numbers + times)
    identity_parts = []
    for seg in candidate.get("segments", []):
        identity_parts.append(
            f"{seg.get('carrier', '')}{seg.get('flight_number', '')}"
            f"{seg.get('departure_time', '')}"
        )
    identity_key = "|".join(identity_parts)

    # Price deltas (bucketed)
    baseline_cash = baseline.get("cash_price") or 0
    candidate_cash = candidate.get("cash_price") or 0
    cash_bucket = _bucket(candidate_cash - baseline_cash, 25)

    baseline_points = baseline.get("points_cost") or 0
    candidate_points = candidate.get("points_cost") or 0
    points_bucket = _bucket(candidate_points - baseline_points, 2500)

    # Stops delta
    baseline_stops = baseline.get("stops", 0)
    candidate_stops = candidate.get("stops", 0)
    stops_delta = candidate_stops - baseline_stops

    fp_data = f"{identity_key}|cash:{cash_bucket}|pts:{points_bucket}|stops:{stops_delta}"
    return hashlib.sha256(fp_data.encode()).hexdigest()[:16]


def _bucket(value: float, bucket_size: int) -> int:
    """Round a value to the nearest bucket."""
    if bucket_size <= 0:
        return int(value)
    return round(value / bucket_size) * bucket_size


# =============================================================================
# SCORING
# =============================================================================

def compute_change_score(
    baseline: Dict[str, Any],
    candidate: Dict[str, Any],
    tier: str,
) -> float:
    """
    Compute a weighted composite score for how much "better" the candidate is.
    Returns 0.0–1.0+. Higher = more significant improvement.
    Tier-aware: free tier only scores price + schedule.
    """
    score = 0.0
    weights_used = 0.0

    # Cash price improvement
    baseline_cash = baseline.get("cash_price")
    candidate_cash = candidate.get("cash_price")
    if baseline_cash and candidate_cash and baseline_cash > 0:
        pct_drop = (baseline_cash - candidate_cash) / baseline_cash
        if pct_drop > 0:
            score += min(pct_drop * 0.5, 0.5)  # weight 0.5, capped
            weights_used += 0.5

    # Schedule improvement (both tiers)
    duration_delta = _duration_improvement(baseline, candidate)
    if duration_delta is not None and duration_delta > 0:
        # Normalize: 60 min improvement ~ 0.1 contribution
        score += min(duration_delta / 600.0 * 0.15, 0.15)
        weights_used += 0.15

    # Stops improvement (both tiers)
    baseline_stops = baseline.get("stops", 0)
    candidate_stops = candidate.get("stops", 0)
    if candidate_stops < baseline_stops:
        score += 0.15 * (baseline_stops - candidate_stops)
        weights_used += 0.15

    # Points improvement (paid tier only)
    if tier == "paid":
        baseline_points = baseline.get("points_cost")
        candidate_points = candidate.get("points_cost")
        if baseline_points and candidate_points and baseline_points > 0:
            pct_drop = (baseline_points - candidate_points) / baseline_points
            if pct_drop > 0:
                score += min(pct_drop * 0.3, 0.3)
                weights_used += 0.3

    return round(score, 4)


def _duration_improvement(baseline: Dict, candidate: Dict) -> Optional[float]:
    """Return positive minutes saved, or None if data missing."""
    b_dur = baseline.get("total_duration_minutes")
    c_dur = candidate.get("total_duration_minutes")
    if b_dur is not None and c_dur is not None:
        return b_dur - c_dur
    return None


# =============================================================================
# DEBOUNCE
# =============================================================================

def should_alert(
    score: float,
    current_fp: str,
    recent_fingerprints: list,
) -> bool:
    """
    Decide whether to alert based on score and debounce rules.

    MUST be called BEFORE appending current_fp to recent_fingerprints.
    The ring buffer contains the last 2 completed prior check fingerprints.
    "matches >= 1" means the current check (implicit) + 1 prior match = 2 of 3.
    """
    if score > SCORE_THRESHOLD_HIGH:
        return True  # big deal — alert immediately
    if score < SCORE_THRESHOLD_MEDIUM_LOW:
        return False  # noise — never alert
    # Medium score (0.10–0.25): require 2 of last 3 checks to show this fingerprint
    recent = recent_fingerprints or []
    matches = sum(1 for fp in recent if fp == current_fp)
    return matches >= 1  # 1 prior match + current (implicit) = 2 of 3


# =============================================================================
# SCHEDULE MATERIALITY
# =============================================================================

def is_schedule_material(baseline: Dict[str, Any], candidate: Dict[str, Any]) -> bool:
    """Only return True if the schedule change crosses a materiality threshold."""
    baseline_stops = baseline.get("stops", 0)
    candidate_stops = candidate.get("stops", 0)
    if candidate_stops != baseline_stops:
        return True

    b_dur = baseline.get("total_duration_minutes", 0)
    c_dur = candidate.get("total_duration_minutes", 0)
    if abs(c_dur - b_dur) >= 60:
        return True

    # Departure time shift
    b_segments = baseline.get("segments", [])
    c_segments = candidate.get("segments", [])
    if b_segments and c_segments:
        try:
            from dateutil.parser import parse as parse_dt
            b_dep = parse_dt(b_segments[0].get("departure_time", ""))
            c_dep = parse_dt(c_segments[0].get("departure_time", ""))
            shift_minutes = abs((c_dep - b_dep).total_seconds()) / 60
            if shift_minutes >= 90:
                return True
        except (ValueError, TypeError):
            pass

    return False


# =============================================================================
# DATETIME HELPERS
# =============================================================================

def now_iso() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def far_future_iso() -> str:
    """Return a far-future date for 'never check again' sentinel."""
    return "2099-01-01T00:00:00+00:00"
