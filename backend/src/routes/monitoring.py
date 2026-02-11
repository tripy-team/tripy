"""
Monitoring Feature Routes

Endpoints for the "We'll Keep Watching" monitoring feature.
See docs/KEEP_WATCHING_FEATURE.md for full specification.
"""
import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from src.config.monitoring import (
    FRONTEND_URL,
    MINIMUM_SUPPORTED_UPDATE_SCHEMA,
    MONITORING_ALERTS_ENABLED,
    MONITORING_CRON_SECRET,
    MONITORING_PAID_ENABLED,
    MONITORING_SEARCH_MODE,
    RATE_LIMIT_RESEND_PER_DAY_PER_EMAIL,
    RATE_LIMIT_START_PER_DAY_PER_TRIP,
    RATE_LIMIT_START_PER_HOUR_PER_IP,
    RATE_LIMIT_UPDATE_FETCH_PER_MIN_PER_IP,
    RATE_LIMIT_VERIFY_PER_HOUR_PER_IP,
    UPDATE_EXPIRY_DAYS,
    UPDATE_TTL_GRACE_DAYS,
)
from src.domain.monitoring import repo
from src.domain.monitoring.models import (
    MonitoringCheckResponse,
    MonitoringState,
    MonitoringStatusNotFound,
    MonitoringStatusResponse,
    MonitoringTier,
    ReplayRequest,
    ReplayResponse,
    StartMonitoringRequest,
    StartMonitoringResponse,
    UpdateDegradedResponse,
    UpdateExpiredResponse,
    UpdateRecordResponse,
)
from src.domain.monitoring.tokens import (
    issue_unsubscribe_token,
    issue_verification_token,
    verify_monitoring_token,
    verify_unsubscribe_token,
)
from src.domain.monitoring.utils import (
    compute_expires_at,
    compute_next_check_at,
    compute_state_bucket,
    far_future_iso,
    hash_ip_for_consent,
    mask_email,
    normalize_email,
    now_iso,
)
from src.utils.jwt_auth import get_current_user_id, get_user_or_anon_id, is_anonymous

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/solo", tags=["Monitoring"])


# =============================================================================
# HELPERS
# =============================================================================

def _get_client_ip(request: Request) -> str:
    """Extract client IP from request (supports X-Forwarded-For)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "0.0.0.0"


def _validate_cron_secret(x_cron_secret: str):
    """Validate the cron secret header."""
    if not MONITORING_CRON_SECRET or x_cron_secret != MONITORING_CRON_SECRET:
        raise HTTPException(status_code=403, detail="Invalid cron secret")


# =============================================================================
# A) POST /solo/trips/{trip_id}/monitoring/start
# =============================================================================

@router.post(
    "/trips/{trip_id}/monitoring/start",
    response_model=StartMonitoringResponse,
)
async def start_monitoring(
    trip_id: str,
    body: StartMonitoringRequest,
    request: Request,
):
    """
    Start monitoring for a trip. Handles:
    - New subscription creation (with atomic dedupe)
    - Resend verification for pending subscriptions
    - Idempotent return for active subscriptions
    """
    from fastapi import Depends
    from src.utils.jwt_auth import get_user_or_anon_id, optional_security

    # Auth: try to get user (may be anonymous)
    from src.utils.jwt_auth import get_optional_user_id
    credentials = request.headers.get("authorization", "").replace("Bearer ", "")
    user_id = None
    is_anon = True
    if credentials:
        try:
            from src.utils.jwt_auth import verify_token as verify_jwt
            claims = verify_jwt(credentials)
            user_id = claims.get("sub")
            is_anon = False
        except Exception:
            pass  # anonymous

    # Validate tier
    if body.tier == MonitoringTier.PAID and not MONITORING_PAID_ENABLED:
        raise HTTPException(status_code=404, detail="Paid monitoring is not yet available")

    # Determine email BEFORE rate limiting — don't burn rate limit tokens on
    # requests that would fail validation anyway
    email = None
    if body.email:
        email = normalize_email(body.email)
    elif not is_anon and user_id:
        # Try to get email from user profile (same service used by booking ack)
        try:
            from src.services.user_service import get_user
            user = get_user(user_id)
            if user:
                email = normalize_email(user.get("email", ""))
        except Exception:
            pass

    if not email:
        raise HTTPException(status_code=400, detail="Email is required for monitoring.")

    # Rate limit: per IP (checked AFTER validation so bad requests don't burn tokens)
    client_ip = _get_client_ip(request)
    ip_hash = hash_ip_for_consent(client_ip)
    if not repo.check_rate_limit(f"start:ip:{ip_hash}", 3600, RATE_LIMIT_START_PER_HOUR_PER_IP):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please try again later.")

    # Rate limit: per trip
    if not repo.check_rate_limit(f"start:trip:{trip_id}", 86400, RATE_LIMIT_START_PER_DAY_PER_TRIP):
        raise HTTPException(status_code=429, detail="Rate limit exceeded for this trip.")

    # Build trip_email_key
    trip_email_key = f"{trip_id}#{email}"

    # Check for existing subscription (fast path)
    existing = repo.query_by_trip_email_key(trip_email_key)
    active_or_pending = [
        s for s in existing
        if s.get("state") in ("active", "pending_verification")
    ]

    if active_or_pending:
        sub = active_or_pending[0]
        sub_state = sub.get("state")

        if sub_state == "active":
            return StartMonitoringResponse(
                subscription_id=sub["subscription_id"],
                state=MonitoringState.ACTIVE,
                tier=MonitoringTier(sub.get("tier", "free_email")),
                expires_at=sub.get("expires_at"),
                message="Monitoring is already active for this trip.",
            )

        if sub_state == "pending_verification":
            # Resend verification (rate limited)
            if not repo.check_rate_limit(
                f"resend:email:{email}", 86400, RATE_LIMIT_RESEND_PER_DAY_PER_EMAIL
            ):
                raise HTTPException(status_code=429, detail="Verification email resend limit reached. Check your inbox.")

            token = issue_verification_token(sub)
            resend_ok = _send_verification_email(email, token, trip_id)

            return StartMonitoringResponse(
                subscription_id=sub["subscription_id"],
                state=MonitoringState.PENDING_VERIFICATION,
                tier=MonitoringTier(sub.get("tier", "free_email")),
                expires_at=sub.get("expires_at"),
                email_sent=resend_ok,
                message="Verification email resent. Check your inbox." if resend_ok else "Could not send verification email. Please try again later.",
            )

    # New subscription — capture baseline first
    baseline_id = f"mbl_{uuid.uuid4().hex}"
    baseline_item = _build_baseline(baseline_id, body, trip_id, user_id, is_anon)
    if baseline_item is None:
        raise HTTPException(
            status_code=400,
            detail="Baseline data is required. Please refresh the page and try again.",
        )
    try:
        repo.put_baseline(baseline_item)
    except Exception as e:
        error_str = str(e)
        if "ResourceNotFoundException" in error_str or "ResourceNotFound" in error_str:
            logger.error(f"[monitoring/start] Monitoring tables not deployed: {e}")
            raise HTTPException(
                status_code=503,
                detail="Monitoring service is not yet available. Please try again later.",
            )
        logger.error(f"[monitoring/start] Failed to save baseline: {e}")
        raise HTTPException(status_code=500, detail="Failed to save monitoring baseline.")

    # Create subscription via atomic dedupe
    sub_id = f"msub_{uuid.uuid4().hex}"
    expires_at = compute_expires_at(body.tier.value).isoformat()
    now = now_iso()
    bucket = compute_state_bucket(sub_id, "pending_verification" if is_anon else "active")

    initial_state = "pending_verification" if is_anon else "active"
    nca = compute_next_check_at(body.tier.value).isoformat() if not is_anon else far_future_iso()

    sub_item = {
        "subscription_id": sub_id,
        "trip_id": trip_id,
        # DynamoDB GSI (user-index) rejects empty strings as key values,
        # so omit user_id entirely for anonymous users — the item simply
        # won't appear in the user-index, which is correct behavior.
        **({"user_id": user_id} if user_id else {}),
        "email": email,
        "trip_email_key": trip_email_key,
        "tier": body.tier.value,
        "state": initial_state,
        "state_bucket": bucket,
        "schema_version": 1,
        "baseline_snapshot_id": baseline_id,
        "query_version": 1,
        "next_check_at": nca,
        "created_at": now,
        "updated_at": now,
        "expires_at": expires_at,
        "last_checked_at": None,
        "last_alert_sent_at": None,
        "last_change_fingerprint": None,
        "pending_change_fingerprint": None,
        "recent_fingerprints": [],
        "cooldown_until": None,
        "active_token_jti": None,
        "consent_source": "authenticated_signup" if not is_anon else "free_email_form",
        "consent_ip_hash": ip_hash,
        "consent_at": now,
    }

    lock_pk = f"lock#{trip_email_key}"
    lock_item = {
        "subscription_id": lock_pk,
        "entity_type": "lock",
        "trip_email_key": trip_email_key,
        "active_subscription_id": sub_id,
        "state": initial_state,
        "updated_at": now,
    }

    try:
        repo.put_subscription_transact_with_lock(sub_item, lock_item)
    except Exception as e:
        error_str = str(e)
        if "ResourceNotFoundException" in error_str or "ResourceNotFound" in error_str:
            logger.error(f"[monitoring/start] Monitoring tables not deployed: {e}")
            raise HTTPException(
                status_code=503,
                detail="Monitoring service is not yet available. Please try again later.",
            )
        if "TransactionCanceledException" in error_str or "ConditionalCheckFailed" in error_str:
            # Another request won the race — read the lock to find the winner
            lock = repo.get_lock_item(lock_pk)
            if lock and lock.get("active_subscription_id"):
                winner = repo.get_subscription(lock["active_subscription_id"])
                if winner and winner.get("state") in ("active", "pending_verification"):
                    return StartMonitoringResponse(
                        subscription_id=winner["subscription_id"],
                        state=MonitoringState(winner["state"]),
                        tier=MonitoringTier(winner.get("tier", "free_email")),
                        expires_at=winner.get("expires_at"),
                        message="Monitoring already active.",
                    )
            raise HTTPException(status_code=409, detail="Could not create subscription. Please try again.")
        logger.error(f"[monitoring/start] Failed to create subscription: {e}")
        raise HTTPException(status_code=500, detail="Internal error creating subscription.")

    # Send verification email for unauthenticated users
    verification_email_sent = True
    if is_anon:
        token = issue_verification_token(sub_item)
        verification_email_sent = _send_verification_email(email, token, trip_id)

    return StartMonitoringResponse(
        subscription_id=sub_id,
        state=MonitoringState(initial_state),
        tier=body.tier,
        expires_at=expires_at,
        email_sent=verification_email_sent,
        message=(
            "Check your email to verify." if (is_anon and verification_email_sent)
            else "Could not send verification email. Please try again later." if (is_anon and not verification_email_sent)
            else "Monitoring activated."
        ),
    )


def _build_baseline(
    baseline_id: str,
    body: StartMonitoringRequest,
    trip_id: str,
    user_id: Optional[str],
    is_anon: bool,
) -> Optional[dict]:
    """Build baseline item from request payload or stored trip data."""
    now = now_iso()

    if body.baseline_payload:
        return {
            "baseline_id": baseline_id,
            "schema_version": body.baseline_payload.schema_version,
            "captured_at": now,
            "selected_itinerary": body.baseline_payload.selected_itinerary,
            "alternatives": body.baseline_payload.alternatives or [],
            "query_inputs": body.baseline_payload.query_inputs or {},
        }

    # Fallback: try to derive from stored trip selection (authenticated only)
    if not is_anon and user_id:
        try:
            from src.repos.ddb import get_item, table
            from src.config import TRIPS_TABLE
            trip = get_item(table(TRIPS_TABLE), {"tripId": trip_id})
            if trip:
                selected = trip.get("selectedItinerary") or trip.get("selected_plan") or {}
                if selected:
                    return {
                        "baseline_id": baseline_id,
                        "schema_version": 1,
                        "captured_at": now,
                        "selected_itinerary": selected,
                        "alternatives": [],
                        "query_inputs": {},
                    }
        except Exception as e:
            logger.warning(f"Could not derive baseline from trip {trip_id}: {e}")

    # If unauthenticated and no payload: fail
    if is_anon:
        return None

    # If authenticated but no data found: create a minimal baseline
    return {
        "baseline_id": baseline_id,
        "schema_version": 1,
        "captured_at": now,
        "selected_itinerary": {},
        "alternatives": [],
        "query_inputs": {},
    }


def _send_verification_email(email: str, token: str, trip_id: str) -> bool:
    """Send a verification email with a magic link. Returns True if sent successfully."""
    verify_url = f"{FRONTEND_URL}/api/monitoring/verify?token={token}"
    try:
        from src.services.email_service import send_email, is_email_enabled
        if is_email_enabled():
            result = send_email(
                to_email=email,
                subject="Verify your Tripy monitoring alerts",
                html_body=f"""
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2 style="color: #1e40af;">Confirm your trip monitoring</h2>
                    <p>Click the button below to activate price and schedule alerts for your trip.</p>
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="{verify_url}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">
                            Activate monitoring
                        </a>
                    </div>
                    <p style="color: #64748b; font-size: 14px;">This link expires in 24 hours. If you didn't request this, you can ignore this email.</p>
                    <p style="color: #94a3b8; font-size: 12px;">&copy; 2026 Tripy &middot; Book with confidence.</p>
                </div>
                """,
                text_body=f"Activate monitoring for your Tripy trip: {verify_url}\n\nThis link expires in 24 hours.",
            )
            if result.get("success"):
                return True
            logger.warning(f"Email service returned failure: {result.get('error')}")
            return False
        else:
            logger.warning(f"Email not enabled. Verification URL: {verify_url}")
            return False
    except Exception as e:
        logger.error(f"Failed to send verification email to {mask_email(email)}: {e}")
        return False


# =============================================================================
# B) GET /solo/trips/{trip_id}/monitoring/status
# =============================================================================

@router.get("/trips/{trip_id}/monitoring/status")
async def get_monitoring_status(trip_id: str, request: Request):
    """
    Get monitoring status for authenticated users only.
    Checks trip ownership (owner or collaborator).
    """
    # Require auth
    credentials = request.headers.get("authorization", "").replace("Bearer ", "")
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        from src.utils.jwt_auth import verify_token as verify_jwt
        claims = verify_jwt(credentials)
        user_id = claims.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Authentication failed")

    # Ownership check
    try:
        from src.repos.ddb import get_item, table
        from src.config import TRIPS_TABLE
        trip = get_item(table(TRIPS_TABLE), {"tripId": trip_id})
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")

        owner_id = trip.get("userId") or trip.get("ownerId") or trip.get("owner_id", "")
        collaborators = trip.get("collaborator_ids", []) or trip.get("collaborators", [])

        if user_id != owner_id and user_id not in collaborators:
            raise HTTPException(status_code=403, detail="Not authorized for this trip")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking trip ownership: {e}")
        raise HTTPException(status_code=500, detail="Error checking trip ownership")

    # Find active subscription for this trip + user
    subs = repo.query_by_trip_id(trip_id)
    user_subs = [s for s in subs if s.get("user_id") == user_id]
    active_sub = next(
        (s for s in user_subs if s.get("state") in ("active", "pending_verification")),
        None,
    )

    if not active_sub:
        return JSONResponse(status_code=404, content={"state": "none"})

    # Count alerts sent
    updates = repo.query_updates_by_subscription(active_sub["subscription_id"])
    alerts_sent = sum(1 for u in updates if u.get("email_status") == "sent")

    return MonitoringStatusResponse(
        subscription_id=active_sub["subscription_id"],
        state=MonitoringState(active_sub["state"]),
        tier=MonitoringTier(active_sub.get("tier", "free_email")),
        email_masked=mask_email(active_sub.get("email", "")),
        expires_at=active_sub.get("expires_at"),
        next_check_at=active_sub.get("next_check_at"),
        last_checked_at=active_sub.get("last_checked_at"),
        alerts_sent=alerts_sent,
    )


# =============================================================================
# C) POST /solo/trips/{trip_id}/monitoring/stop
# =============================================================================

@router.post("/trips/{trip_id}/monitoring/stop")
async def stop_monitoring(trip_id: str, request: Request):
    """Cancel the user's monitoring subscription for this trip."""
    # Require auth
    credentials = request.headers.get("authorization", "").replace("Bearer ", "")
    if not credentials:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        from src.utils.jwt_auth import verify_token as verify_jwt
        claims = verify_jwt(credentials)
        user_id = claims.get("sub")
    except Exception:
        raise HTTPException(status_code=401, detail="Authentication failed")

    subs = repo.query_by_trip_id(trip_id)
    user_sub = next(
        (s for s in subs if s.get("user_id") == user_id and s.get("state") in ("active", "pending_verification")),
        None,
    )

    if not user_sub:
        return {"ok": True, "message": "No active subscription found."}

    new_bucket = compute_state_bucket(user_sub["subscription_id"], "cancelled")
    repo.update_subscription_state_transact(
        subscription_id=user_sub["subscription_id"],
        lock_pk=f"lock#{user_sub['trip_email_key']}",
        new_state="cancelled",
        new_bucket=new_bucket,
        next_check_at=far_future_iso(),
    )

    return {"ok": True}


# =============================================================================
# D) GET /solo/monitoring/verify
# =============================================================================

@router.get("/monitoring/verify")
async def verify_email(token: str, request: Request):
    """
    Verify a monitoring email. Redirects to the frontend booking page
    with the appropriate status.
    """
    # Rate limit
    client_ip = _get_client_ip(request)
    ip_hash = hash_ip_for_consent(client_ip)
    if not repo.check_rate_limit(f"verify:ip:{ip_hash}", 3600, RATE_LIMIT_VERIFY_PER_HOUR_PER_IP):
        return RedirectResponse(f"{FRONTEND_URL}/solo/booking?monitoring=rate_limited")

    result = verify_monitoring_token(token)
    status = result.get("status", "invalid")
    trip_id = result.get("trip_id", "")

    base_url = f"{FRONTEND_URL}/solo/booking"
    params = f"?trip_id={trip_id}&monitoring={status}" if trip_id else f"?monitoring={status}"

    return RedirectResponse(f"{base_url}{params}")


# =============================================================================
# E) GET/POST /solo/monitoring/unsubscribe
# =============================================================================

@router.get("/monitoring/unsubscribe")
async def unsubscribe_get(token: str):
    """Browser click unsubscribe — renders confirmation page."""
    payload = verify_unsubscribe_token(token)
    if not payload:
        return HTMLResponse(
            "<html><body><h2>Invalid unsubscribe link.</h2></body></html>",
            status_code=400,
        )

    _cancel_by_unsubscribe(payload)

    return HTMLResponse(
        f"""<html><body style="font-family: sans-serif; max-width: 500px; margin: 40px auto; text-align: center;">
        <h2>You've been unsubscribed</h2>
        <p>You won't receive any more monitoring alerts for this trip.</p>
        <p style="color: #64748b; margin-top: 20px;"><a href="{FRONTEND_URL}">Go to Tripy</a></p>
        </body></html>"""
    )


@router.post("/monitoring/unsubscribe")
async def unsubscribe_post(token: str, request: Request):
    """RFC 8058 one-click unsubscribe. Token is in query string."""
    payload = verify_unsubscribe_token(token)
    if not payload:
        raise HTTPException(status_code=400, detail="Invalid token")

    _cancel_by_unsubscribe(payload)
    return {"ok": True}


def _cancel_by_unsubscribe(payload: dict):
    """Cancel subscription(s) based on unsubscribe token scope."""
    scope = payload.get("scope", "trip")
    sub_id = payload.get("sub_id")
    email = payload.get("email")

    if scope == "trip" and sub_id:
        sub = repo.get_subscription(sub_id)
        if sub and sub.get("state") in ("active", "pending_verification"):
            new_bucket = compute_state_bucket(sub_id, "cancelled")
            repo.update_subscription_state_transact(
                subscription_id=sub_id,
                lock_pk=f"lock#{sub['trip_email_key']}",
                new_state="cancelled",
                new_bucket=new_bucket,
                next_check_at=far_future_iso(),
            )

    elif scope == "all" and email:
        # Cancel all active subs for this email (across all trips)
        # Note: this requires scanning by email — fine for low volume
        normalized = normalize_email(email)
        # We don't have an email-only index, so check each trip_email_key
        # For MVP this is acceptable; for scale, add an email-index GSI
        logger.info(f"Unsubscribe all for {mask_email(normalized)}")
        # For now, cancel the specific subscription as a fallback
        sub_id = payload.get("sub_id")
        if sub_id:
            sub = repo.get_subscription(sub_id)
            if sub and sub.get("state") in ("active", "pending_verification"):
                new_bucket = compute_state_bucket(sub_id, "cancelled")
                repo.update_subscription_state_transact(
                    subscription_id=sub_id,
                    lock_pk=f"lock#{sub['trip_email_key']}",
                    new_state="cancelled",
                    new_bucket=new_bucket,
                    next_check_at=far_future_iso(),
                )


# =============================================================================
# F) GET /solo/api/monitoring/updates/{update_id}  (public by UUID)
# =============================================================================

@router.get("/api/monitoring/updates/{update_id}")
async def get_monitoring_update(update_id: str, request: Request):
    """
    Public endpoint for the update click-through page.
    The UUID is the capability token — no auth required.
    NEVER includes email/user_id/subscription_id in response.
    Rate-limited per IP to prevent scraping.
    """
    # Rate limit: per IP (prevents scraping of capability URLs)
    client_ip = _get_client_ip(request)
    ip_hash = hashlib.sha256(client_ip.encode()).hexdigest()[:16]
    if not repo.check_rate_limit(
        f"update_fetch:ip:{ip_hash}", 60, RATE_LIMIT_UPDATE_FETCH_PER_MIN_PER_IP
    ):
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded. Please try again later."},
            headers=_update_security_headers(),
        )

    update = repo.get_update(update_id)
    if not update:
        return JSONResponse(
            status_code=404,
            content={"detail": "Update not found"},
            headers=_update_security_headers(),
        )

    # Check expiry
    expires_at = update.get("expires_at")
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at)
            if exp_dt < datetime.now(timezone.utc):
                return JSONResponse(
                    status_code=410,
                    content=UpdateExpiredResponse().dict(),
                    headers=_update_security_headers(),
                )
        except (ValueError, TypeError):
            pass

    # Check schema version for graceful degradation
    schema_v = update.get("schema_version", 1)
    if isinstance(schema_v, str):
        try:
            schema_v = int(schema_v)
        except ValueError:
            schema_v = 1

    if schema_v < MINIMUM_SUPPORTED_UPDATE_SCHEMA:
        return JSONResponse(
            status_code=200,
            content=UpdateDegradedResponse(
                update_id=update_id,
                detected_at=update.get("detected_at"),
                trip_id=update.get("trip_id"),
            ).dict(),
            headers=_update_security_headers(),
        )

    # Parse deltas
    deltas_raw = update.get("deltas", {})
    if isinstance(deltas_raw, str):
        try:
            deltas_raw = json.loads(deltas_raw)
        except json.JSONDecodeError:
            deltas_raw = {"bullets": [], "recommendation": "", "caveat": ""}

    # Build response — NO PII, NO internal IDs
    return JSONResponse(
        content={
            "update_id": update_id,
            "detected_at": update.get("detected_at", ""),
            "severity": update.get("severity", "medium"),
            "baseline_summary": _safe_json(update.get("baseline_summary", {})),
            "new_candidate_summary": _safe_json(update.get("new_candidate_summary", {})),
            "deltas": deltas_raw,
            "trip_id": update.get("trip_id", ""),
            "subscription_tier": update.get("subscription_tier", "free_email"),
        },
        headers=_update_security_headers(),
    )


def _safe_json(val):
    """Ensure a value is a dict (parse from string if needed)."""
    if isinstance(val, str):
        try:
            return json.loads(val)
        except json.JSONDecodeError:
            return {}
    return val or {}


def _update_security_headers() -> dict:
    """Security headers for public update capability endpoint."""
    return {
        "Cache-Control": "private, no-store",
        "Pragma": "no-cache",
        "X-Robots-Tag": "noindex",
    }


# =============================================================================
# G) POST /solo/internal/monitoring-check  (CRON)
# =============================================================================

@router.post(
    "/internal/monitoring-check",
    response_model=MonitoringCheckResponse,
)
async def monitoring_check(
    x_cron_secret: str = Header(..., alias="X-Cron-Secret"),
):
    """
    Cron endpoint: check all active subscriptions due for monitoring.
    Creates update records when meaningful changes detected.
    Email sending is gated by MONITORING_ALERTS_ENABLED kill switch.
    """
    _validate_cron_secret(x_cron_secret)

    import asyncio
    from src.config.monitoring import (
        CRON_BATCH_SIZE,
        SEARCH_CONCURRENCY,
        PER_SUB_TIMEOUT_S,
        JOB_TIMEOUT_S,
        MINIMUM_SUPPORTED_BASELINE_SCHEMA,
        MINIMUM_SUPPORTED_QUERY_VERSION,
        COOLDOWN_OVERRIDE_SCORE,
        COOLDOWN_OVERRIDE_CASH_FLOOR,
        COOLDOWN_OVERRIDE_POINTS_FLOOR,
        COOLDOWN_HOURS,
        UPDATE_EXPIRY_DAYS,
        UPDATE_TTL_GRACE_DAYS,
    )
    from src.domain.monitoring.alerts import maybe_send_alert
    from src.domain.monitoring.utils import (
        compute_change_fingerprint,
        compute_change_score,
        compute_next_check_at as compute_nca,
        compute_state_bucket,
        far_future_iso,
        generate_delta_bullets,
        generate_recommendation_and_caveat,
        should_alert,
    )

    now = datetime.now(timezone.utc)
    now_str = now.isoformat()

    stats = MonitoringCheckResponse()

    # Query all due subscriptions
    subs = repo.query_due_subscriptions(now_str)
    logger.info(f"monitoring.cron_start due_subs={len(subs)}")

    sem = asyncio.Semaphore(SEARCH_CONCURRENCY)

    def process_one(sub: dict):
        nonlocal stats

        sub_id = sub.get("subscription_id", "")
        trip_id = sub.get("trip_id", "")
        tier = sub.get("tier", "free_email")

        try:
            # 1. Check expiry
            expires_at = sub.get("expires_at", "")
            if expires_at:
                try:
                    exp_dt = datetime.fromisoformat(expires_at)
                    if exp_dt <= now:
                        new_bucket = compute_state_bucket(sub_id, "expired")
                        repo.update_subscription_state_transact(
                            subscription_id=sub_id,
                            lock_pk=f"lock#{sub['trip_email_key']}",
                            new_state="expired",
                            new_bucket=new_bucket,
                            next_check_at=far_future_iso(),
                        )
                        stats.expired += 1
                        return
                except (ValueError, TypeError):
                    pass

            # 2. Load baseline
            baseline_id = sub.get("baseline_snapshot_id", "")
            baseline = repo.get_baseline(baseline_id)
            if not baseline:
                logger.warning(f"monitoring.no_baseline sub={sub_id} baseline_id={baseline_id}")
                repo.update_subscription_fields(sub_id, next_check_at=far_future_iso())
                stats.skipped_version += 1
                return

            # 3. Validate baseline schema
            schema_v = baseline.get("schema_version", 1)
            if isinstance(schema_v, str):
                try:
                    schema_v = int(schema_v)
                except ValueError:
                    schema_v = 0
            if schema_v < MINIMUM_SUPPORTED_BASELINE_SCHEMA:
                logger.warning(f"monitoring.old_baseline sub={sub_id} schema={schema_v}")
                repo.update_subscription_fields(sub_id, next_check_at=far_future_iso())
                stats.skipped_version += 1
                return

            query_v = baseline.get("query_version", 1)
            if isinstance(query_v, str):
                try:
                    query_v = int(query_v)
                except ValueError:
                    query_v = 0
            if query_v < MINIMUM_SUPPORTED_QUERY_VERSION:
                logger.warning(f"monitoring.old_query sub={sub_id} query_version={query_v}")
                repo.update_subscription_fields(sub_id, next_check_at=far_future_iso())
                stats.skipped_version += 1
                return

            # 4. Run search via monitoring search adapter
            from src.domain.monitoring.search import run_search

            selected_itinerary = baseline.get("selected_itinerary", {})
            if isinstance(selected_itinerary, str):
                try:
                    selected_itinerary = json.loads(selected_itinerary)
                except json.JSONDecodeError:
                    selected_itinerary = {}

            candidate = run_search(baseline, mode=MONITORING_SEARCH_MODE)
            if candidate is None:
                # Search returned nothing — log and skip
                logger.warning(f"monitoring.no_candidate sub={sub_id}")
                nca = compute_nca(tier).isoformat()
                repo.update_subscription_fields(sub_id, next_check_at=nca, last_checked_at=now_str)
                stats.checked += 1
                return

            # 5. Compute score
            score = compute_change_score(selected_itinerary, candidate, tier)

            # 6. Compute fingerprint
            current_fp = compute_change_fingerprint(selected_itinerary, candidate)

            # 7. Check debounce (BEFORE appending to ring buffer)
            recent_fps = sub.get("recent_fingerprints", [])
            if isinstance(recent_fps, str):
                try:
                    recent_fps = json.loads(recent_fps)
                except json.JSONDecodeError:
                    recent_fps = []

            alert_triggered = should_alert(score, current_fp, recent_fps)

            # Append to ring buffer (keep last 2)
            recent_fps = (recent_fps or [])[-1:] + [current_fp]

            # 8. Cooldown check
            in_cooldown = False
            cooldown_until = sub.get("cooldown_until")
            if cooldown_until:
                try:
                    cd_dt = datetime.fromisoformat(cooldown_until)
                    in_cooldown = cd_dt > now
                except (ValueError, TypeError):
                    pass

            if alert_triggered and in_cooldown:
                # Check cooldown override
                is_new_fp = current_fp != sub.get("last_change_fingerprint")
                cash_drop = max(0, float(selected_itinerary.get("cash_price", 0) or 0) - float(candidate.get("cash_price", 0) or 0))
                points_drop = max(0, float(selected_itinerary.get("points_cost", 0) or 0) - float(candidate.get("points_cost", 0) or 0))
                stops_decreased = int(candidate.get("stops", 0) or 0) < int(selected_itinerary.get("stops", 0) or 0)

                override = (
                    score > COOLDOWN_OVERRIDE_SCORE
                    and is_new_fp
                    and (cash_drop >= COOLDOWN_OVERRIDE_CASH_FLOOR or points_drop >= COOLDOWN_OVERRIDE_POINTS_FLOOR or stops_decreased)
                )

                if override:
                    stats.cooldown_overrides += 1
                else:
                    alert_triggered = False
                    stats.skipped_cooldown += 1

            # 9. Create update record + maybe send email (TWO-STEP SEND)
            if alert_triggered:
                update_id = f"mupd_{uuid.uuid4().hex}"
                update_expires = (now + timedelta(days=UPDATE_EXPIRY_DAYS)).isoformat()
                ttl_epoch = int((now + timedelta(days=UPDATE_EXPIRY_DAYS + UPDATE_TTL_GRACE_DAYS)).timestamp())

                # Generate real delta bullets
                bullets = generate_delta_bullets(selected_itinerary, candidate, tier)
                recommendation, caveat = generate_recommendation_and_caveat(
                    bullets, selected_itinerary, candidate,
                )

                # If bullets are empty despite score > threshold, skip alert
                # (prevents render-check failure and empty emails)
                if not bullets:
                    logger.warning(
                        f"monitoring.empty_bullets sub={sub_id} score={score} — skipping alert"
                    )
                    nca = compute_nca(tier).isoformat()
                    repo.update_subscription_fields(
                        sub_id, next_check_at=nca, last_checked_at=now_str,
                        recent_fingerprints=json.dumps(recent_fps),
                    )
                    stats.checked += 1
                    return

                update_item = {
                    "update_id": update_id,
                    "subscription_id": sub_id,
                    "trip_id": trip_id,
                    "schema_version": 1,
                    "detected_at": now_str,
                    "change_score": str(score),
                    "severity": "high" if score > 0.25 else "medium",
                    "baseline_summary": json.dumps(selected_itinerary),
                    "new_candidate_summary": json.dumps(candidate),
                    "deltas": json.dumps({
                        "bullets": bullets,
                        "recommendation": recommendation,
                        "caveat": caveat,
                    }),
                    "change_fingerprint": current_fp,
                    "email_status": None,
                    "email_sent_at": None,
                    "expires_at": update_expires,
                    "ttl": ttl_epoch,
                    "subscription_tier": tier,
                }

                # Step A: ALWAYS create update record
                repo.put_update(update_item)
                stats.updates_created += 1

                # Step B: GATED email send
                sent = maybe_send_alert(update_item, sub)
                if sent:
                    stats.alerts_sent += 1
                else:
                    stats.alerts_skipped += 1
                    if not MONITORING_ALERTS_ENABLED:
                        stats.alerts_skipped_reason = "alerts_disabled"

                # Update cooldown
                cooldown_until_new = (now + timedelta(hours=COOLDOWN_HOURS)).isoformat()
                repo.update_subscription_fields(
                    sub_id,
                    last_alert_sent_at=now_str if sent else sub.get("last_alert_sent_at"),
                    last_change_fingerprint=current_fp,
                    cooldown_until=cooldown_until_new,
                )

            # 10. Always update next_check_at + metadata
            nca = compute_nca(tier).isoformat()
            repo.update_subscription_fields(
                sub_id,
                next_check_at=nca,
                last_checked_at=now_str,
                recent_fingerprints=json.dumps(recent_fps),
            )

            # 11. Heartbeat: refresh lock TTL for this active subscription
            lock_pk = f"lock#{sub.get('trip_email_key', '')}"
            if lock_pk != "lock#":
                repo.refresh_lock_expiry(lock_pk)

            stats.checked += 1

        except Exception as e:
            logger.error(f"monitoring.check_error sub={sub_id} error={e}", exc_info=True)
            stats.errors.append(f"{sub_id}: {str(e)[:100]}")
            # Still update next_check_at so we don't get stuck
            try:
                nca = compute_nca(tier).isoformat()
                repo.update_subscription_fields(sub_id, next_check_at=nca)
            except Exception:
                pass

    async def check_with_sem(sub: dict):
        async with sem:
            try:
                await asyncio.wait_for(
                    asyncio.to_thread(process_one, sub),
                    timeout=PER_SUB_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                sub_id = sub.get("subscription_id", "?")
                logger.warning(f"monitoring.timeout sub={sub_id}")
                stats.errors.append(f"{sub_id}: timeout")
                try:
                    tier = sub.get("tier", "free_email")
                    nca = compute_nca(tier).isoformat()
                    repo.update_subscription_fields(sub_id, next_check_at=nca)
                except Exception:
                    pass

    # Process all subs with bounded concurrency
    await asyncio.gather(*(check_with_sem(s) for s in subs))

    logger.info(
        f"monitoring.cron_complete checked={stats.checked} "
        f"updates={stats.updates_created} sent={stats.alerts_sent} "
        f"skipped={stats.alerts_skipped} expired={stats.expired} "
        f"errors={len(stats.errors)}"
    )

    return stats


# =============================================================================
# H) POST /solo/internal/monitoring-replay  (admin tool)
# =============================================================================

@router.post(
    "/internal/monitoring-replay",
    response_model=ReplayResponse,
)
async def monitoring_replay(
    body: ReplayRequest,
    x_cron_secret: str = Header(..., alias="X-Cron-Secret"),
):
    """
    Admin tool: re-attempt email sending for a specific update record.
    Useful when kill switch was off during a cron run, or render check temporarily failed.
    """
    _validate_cron_secret(x_cron_secret)

    from src.domain.monitoring.alerts import maybe_send_alert

    update = repo.get_update(body.update_id)
    if not update:
        raise HTTPException(status_code=404, detail="Update not found")

    prev_status = update.get("email_status")
    if prev_status == "sent":
        return ReplayResponse(
            update_id=body.update_id,
            previous_email_status=prev_status,
            message="Already sent",
        )

    sub_id = update.get("subscription_id")
    if not sub_id:
        raise HTTPException(status_code=400, detail="Update missing subscription reference")

    sub = repo.get_subscription(sub_id)
    if not sub:
        raise HTTPException(status_code=400, detail="Subscription not found")

    sent = maybe_send_alert(update, sub)

    return ReplayResponse(
        update_id=body.update_id,
        previous_email_status=prev_status,
        new_email_status="sent" if sent else update.get("email_status", "unknown"),
    )
