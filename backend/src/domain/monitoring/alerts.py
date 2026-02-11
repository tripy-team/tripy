"""
Kill-switch-gated alert sending.

Implements the two-step send pattern:
1. Update record is ALWAYS created first.
2. Email send is ONLY attempted if MONITORING_ALERTS_ENABLED=true AND the update
   page can render stored data (render check).

This module enforces the trust rule:
"No alert emails are sent until the update click-through page can render stored comparison data."
"""
import logging
from typing import Any, Dict, Optional

import httpx

from src.config.monitoring import (
    FRONTEND_URL,
    MONITORING_ALERTS_ENABLED,
)
from src.domain.monitoring import repo
from src.domain.monitoring.tokens import issue_unsubscribe_token
from src.domain.monitoring.utils import mask_email

logger = logging.getLogger(__name__)


def maybe_send_alert(
    update_record: Dict[str, Any],
    subscription: Dict[str, Any],
) -> bool:
    """
    Attempt to send a monitoring alert email, gated by the kill switch and render check.

    Returns True if email was sent, False if skipped.
    The update_record must already be persisted in DynamoDB.
    """
    update_id = update_record.get("update_id", "")

    # Gate 1: Kill switch
    if not MONITORING_ALERTS_ENABLED:
        _mark_email_status(update_id, "skipped_alerts_disabled")
        logger.info(f"monitoring.alert_skipped update_id={update_id} reason=alerts_disabled")
        return False

    # Gate 2: Render check — verify the update page returns renderable data
    try:
        resp = httpx.get(
            f"{FRONTEND_URL}/solo/api/monitoring/updates/{update_id}",
            timeout=5,
            follow_redirects=True,
        )
        if resp.status_code != 200:
            _mark_email_status(update_id, f"skipped_render_check_failed:{resp.status_code}")
            logger.error(
                f"monitoring.render_check_failed update_id={update_id} "
                f"status={resp.status_code}"
            )
            return False

        data = resp.json()
        bullets = data.get("deltas", {}).get("bullets", [])
        if not bullets:
            _mark_email_status(update_id, "skipped_render_check_empty")
            logger.error(f"monitoring.render_check_empty update_id={update_id}")
            return False

    except Exception as e:
        _mark_email_status(update_id, f"skipped_render_error:{type(e).__name__}")
        logger.error(f"monitoring.render_check_error update_id={update_id} error={e}")
        return False

    # Gate passed — send the email
    try:
        email = subscription.get("email", "")
        trip_update_link = f"{FRONTEND_URL}/solo/updates/{update_id}"

        # Generate unsubscribe token + link
        unsub_token = issue_unsubscribe_token(
            subscription_id=subscription["subscription_id"],
            email=email,
            scope="trip",
        )
        unsubscribe_link = f"{FRONTEND_URL}/solo/monitoring/unsubscribe?token={unsub_token}"
        manage_link = f"{FRONTEND_URL}/settings"
        consent_date = subscription.get("consent_at", "")

        from src.services.email_service import send_monitoring_alert_email, is_email_enabled

        if not is_email_enabled():
            _mark_email_status(update_id, "skipped_email_not_enabled")
            logger.warning(f"monitoring.email_not_enabled update_id={update_id}")
            return False

        result = send_monitoring_alert_email(
            to_email=email,
            trip_update_link=trip_update_link,
            unsubscribe_link=unsubscribe_link,
            manage_link=manage_link,
            consent_date=consent_date,
        )

        if result.get("success"):
            _mark_email_status(update_id, "sent")
            logger.info(
                f"monitoring.alert_sent update_id={update_id} "
                f"email={mask_email(email)} message_id={result.get('message_id')}"
            )
            return True
        else:
            _mark_email_status(update_id, f"skipped_send_failed:{result.get('error', 'unknown')}")
            logger.error(f"monitoring.send_failed update_id={update_id} error={result.get('error')}")
            return False

    except Exception as e:
        _mark_email_status(update_id, f"skipped_send_error:{type(e).__name__}")
        logger.error(f"monitoring.send_error update_id={update_id} error={e}")
        return False


def _mark_email_status(update_id: str, status: str):
    """Update the email_status field on an update record."""
    try:
        repo.update_update_fields(update_id, email_status=status)
    except Exception as e:
        logger.error(f"Failed to mark email_status for {update_id}: {e}")
