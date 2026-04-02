"""
Recommendation Feedback Loop (Feature 14)

Captures structured feedback at every decision point to create training data
and improve recommendations over time.
"""
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

FEEDBACK_TABLE = "tripy-preference-signals"


def _get_feedback_table():
    from src.repos.ddb import table
    table_name = os.environ.get("PREFERENCE_SIGNALS_TABLE", FEEDBACK_TABLE)
    return table(table_name)


def record_feedback(
    org_id: str,
    trip_id: str,
    advisor_id: str,
    event_type: str,
    data: Dict[str, Any],
    client_id: Optional[str] = None,
) -> str:
    """
    Record a feedback event.

    Event types:
    - recommendation_selected: which recommendation was chosen
    - recommendation_edited: what the advisor changed before sharing
    - recommendation_rejected: advisor dismissed an option
    - proposal_sent: proposal shared with client
    - client_responded: client accepted/rejected
    - booking_completed: trip was actually booked
    - booking_failed: booking attempt failed
    - plan_changed: client changed plans after booking
    - reoptimization_accepted: monitoring alert led to rebooking
    """
    now = datetime.now(timezone.utc)
    event_id = f"fb_{uuid.uuid4().hex[:12]}"
    timestamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    item = {
        "orgId": org_id,
        "timestampSignalId": f"{timestamp}#{event_id}",
        "signalId": event_id,
        "advisorId": advisor_id,
        "clientId": client_id or "",
        "signalType": f"feedback_{event_type}",
        "context": json.dumps({"tripId": trip_id}),
        "signalData": json.dumps(data),
        "createdAt": timestamp,
    }

    try:
        from src.repos.ddb import put_item, sanitize_for_dynamodb
        t = _get_feedback_table()
        put_item(t, sanitize_for_dynamodb(item))
    except Exception as e:
        logger.warning(f"Failed to record feedback: {e}")
        return ""

    try:
        from .preference_graph import record_signal
        record_signal(
            org_id=org_id,
            advisor_id=advisor_id,
            signal_type=f"feedback_{event_type}",
            context={"trip_id": trip_id},
            signal_data=data,
            client_id=client_id,
        )
    except Exception:
        pass

    return event_id


def get_trip_feedback(org_id: str, trip_id: str) -> List[Dict[str, Any]]:
    """Get the feedback timeline for a specific trip."""
    try:
        from boto3.dynamodb.conditions import Key, Attr
        t = _get_feedback_table()

        resp = t.query(
            KeyConditionExpression=Key("orgId").eq(org_id),
            FilterExpression=Attr("signalType").begins_with("feedback_"),
            ScanIndexForward=False,
            Limit=100,
        )

        events = []
        for item in resp.get("Items", []):
            context = item.get("context", "{}")
            if isinstance(context, str):
                try:
                    context = json.loads(context)
                except json.JSONDecodeError:
                    context = {}

            if context.get("tripId") != trip_id:
                continue

            signal_data = item.get("signalData", "{}")
            if isinstance(signal_data, str):
                try:
                    signal_data = json.loads(signal_data)
                except json.JSONDecodeError:
                    signal_data = {}

            events.append({
                "event_id": item.get("signalId", ""),
                "event_type": item.get("signalType", "").replace("feedback_", ""),
                "data": signal_data,
                "advisor_id": item.get("advisorId", ""),
                "created_at": item.get("createdAt", ""),
            })

        return events
    except Exception as e:
        logger.warning(f"Failed to get trip feedback: {e}")
        return []


def get_org_feedback_stats(org_id: str) -> Dict[str, Any]:
    """Get aggregate feedback statistics for an org."""
    try:
        from boto3.dynamodb.conditions import Key, Attr
        t = _get_feedback_table()

        resp = t.query(
            KeyConditionExpression=Key("orgId").eq(org_id),
            FilterExpression=Attr("signalType").begins_with("feedback_"),
            ScanIndexForward=False,
            Limit=500,
        )

        items = resp.get("Items", [])
        stats = {
            "total_events": len(items),
            "selections": 0,
            "edits": 0,
            "rejections": 0,
            "proposals_sent": 0,
            "bookings_completed": 0,
            "bookings_failed": 0,
            "reoptimizations_accepted": 0,
        }

        for item in items:
            signal_type = item.get("signalType", "")
            if "selected" in signal_type:
                stats["selections"] += 1
            elif "edited" in signal_type:
                stats["edits"] += 1
            elif "rejected" in signal_type:
                stats["rejections"] += 1
            elif "proposal_sent" in signal_type:
                stats["proposals_sent"] += 1
            elif "booking_completed" in signal_type:
                stats["bookings_completed"] += 1
            elif "booking_failed" in signal_type:
                stats["bookings_failed"] += 1
            elif "reoptimization_accepted" in signal_type:
                stats["reoptimizations_accepted"] += 1

        if stats["selections"] > 0:
            stats["edit_rate"] = round(stats["edits"] / stats["selections"], 2)
        else:
            stats["edit_rate"] = 0

        if stats["proposals_sent"] > 0:
            stats["booking_rate"] = round(stats["bookings_completed"] / stats["proposals_sent"], 2)
        else:
            stats["booking_rate"] = 0

        return stats
    except Exception as e:
        logger.warning(f"Failed to get feedback stats: {e}")
        return {"total_events": 0}
