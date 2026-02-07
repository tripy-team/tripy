"""
Monitoring verification and unsubscribe token management.

Uses HS256 JWTs with single-use enforcement via active_token_jti on the subscription.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, Literal, Optional

import jwt
from fastapi import HTTPException

from src.config.monitoring import (
    MONITORING_TOKEN_SECRET,
    VERIFICATION_TOKEN_EXPIRY_HOURS,
)
from src.domain.monitoring import repo
from src.domain.monitoring.utils import (
    compute_next_check_at,
    compute_state_bucket,
    far_future_iso,
    now_iso,
)

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"


# =============================================================================
# VERIFICATION TOKENS
# =============================================================================

def issue_verification_token(subscription: Dict) -> str:
    """
    Issue a new verification token for a subscription.
    Invalidates any previous token by writing a new JTI to the subscription.
    Returns the encoded JWT string.
    """
    jti = str(uuid.uuid4())

    # Persist the new JTI on the subscription (invalidates old tokens)
    repo.update_subscription_fields(
        subscription["subscription_id"],
        active_token_jti=jti,
    )

    payload = {
        "jti": jti,
        "sub_id": subscription["subscription_id"],
        "email": subscription["email"],
        "trip_id": subscription["trip_id"],
        "type": "verify",
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=VERIFICATION_TOKEN_EXPIRY_HOURS),
    }

    return jwt.encode(payload, MONITORING_TOKEN_SECRET, algorithm=ALGORITHM)


def verify_monitoring_token(token: str) -> Dict:
    """
    Verify and consume a monitoring verification token.
    Returns dict with status and trip_id for redirect.

    Possible statuses:
    - "verified": subscription activated successfully
    - "already_verified": subscription was already active (idempotent)
    - "token_superseded": this token was replaced by a newer one
    - "link_expired": token is expired
    - "invalid": generic error
    """
    try:
        payload = jwt.decode(token, MONITORING_TOKEN_SECRET, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        return {"status": "link_expired"}
    except jwt.InvalidTokenError:
        return {"status": "invalid"}

    sub = repo.get_subscription(payload.get("sub_id", ""))
    if sub is None:
        return {"status": "invalid"}

    trip_id = sub.get("trip_id", "")

    # Already active — idempotent success
    if sub.get("state") == "active":
        return {"status": "already_verified", "trip_id": trip_id}

    # Cancelled or expired — link is no longer valid
    if sub.get("state") in ("cancelled", "expired"):
        return {"status": "invalid", "trip_id": trip_id}

    # Check JTI matches (single-use enforcement)
    if payload.get("jti") != sub.get("active_token_jti"):
        return {"status": "token_superseded", "trip_id": trip_id}

    # Activate the subscription
    try:
        new_bucket = compute_state_bucket(sub["subscription_id"], "active")
        nca = compute_next_check_at(sub.get("tier", "free_email")).isoformat()

        repo.update_subscription_state_transact(
            subscription_id=sub["subscription_id"],
            lock_pk=f"lock#{sub['trip_email_key']}",
            new_state="active",
            new_bucket=new_bucket,
            next_check_at=nca,
            active_token_jti="",  # clear the JTI (consumed)
            verified_at=now_iso(),
        )
        return {"status": "verified", "trip_id": trip_id}
    except Exception as e:
        logger.error(f"Error activating subscription {sub['subscription_id']}: {e}")
        return {"status": "invalid", "trip_id": trip_id}


# =============================================================================
# UNSUBSCRIBE TOKENS
# =============================================================================

def issue_unsubscribe_token(
    subscription_id: str,
    email: str,
    scope: Literal["trip", "all"] = "trip",
) -> str:
    """Issue an unsubscribe token for email links."""
    payload = {
        "sub_id": subscription_id,
        "email": email,
        "scope": scope,
        "type": "unsubscribe",
        "iat": datetime.now(timezone.utc),
        # Unsubscribe tokens don't expire (per RFC 8058 — link must always work)
    }
    return jwt.encode(payload, MONITORING_TOKEN_SECRET, algorithm=ALGORITHM)


def verify_unsubscribe_token(token: str) -> Optional[Dict]:
    """
    Verify an unsubscribe token.
    Returns payload dict or None if invalid.
    """
    try:
        payload = jwt.decode(
            token,
            MONITORING_TOKEN_SECRET,
            algorithms=[ALGORITHM],
            options={"verify_exp": False},  # unsubscribe links never expire
        )
        if payload.get("type") != "unsubscribe":
            return None
        return payload
    except jwt.InvalidTokenError:
        return None
