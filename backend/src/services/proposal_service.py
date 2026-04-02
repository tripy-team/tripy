"""
Client-Ready Proposal Generator (Feature 7)

Creates polished, branded proposals from trip optimization results.
Proposals are stored in DynamoDB and accessible via public share tokens.
"""
import hashlib
import json
import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

PROPOSALS_TABLE = "tripy-proposals"


def _get_proposals_table():
    import os
    from src.repos.ddb import table
    table_name = os.environ.get("PROPOSALS_TABLE", PROPOSALS_TABLE)
    return table(table_name)


def _generate_share_token() -> str:
    return secrets.token_urlsafe(32)


def create_proposal(
    trip_id: str,
    org_id: str,
    client_id: str,
    client_name: str,
    advisor_id: str,
    recommendations: List[Dict[str, Any]],
    advisor_note: str = "",
    show_alternatives: bool = True,
    show_booking_steps: bool = True,
    show_points_breakdown: bool = True,
    branding: Optional[Dict[str, Any]] = None,
    trip_summary: str = "",
    expires_days: int = 30,
) -> Dict[str, Any]:
    """Create a new client-facing proposal."""
    now = datetime.now(timezone.utc)
    proposal_id = f"prop_{uuid.uuid4()}"
    share_token = _generate_share_token()
    expires_at = (now + timedelta(days=expires_days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    client_recommendations = []
    for rec in recommendations:
        client_rec = _strip_to_client_safe(rec, show_points_breakdown)
        client_recommendations.append(client_rec)

    item = {
        "orgId": org_id,
        "proposalId": proposal_id,
        "shareToken": share_token,
        "tripId": trip_id,
        "clientId": client_id,
        "clientName": client_name,
        "advisorId": advisor_id,
        "advisorNote": advisor_note,
        "tripSummary": trip_summary,
        "recommendations": json.dumps(client_recommendations),
        "showAlternatives": show_alternatives,
        "showBookingSteps": show_booking_steps,
        "showPointsBreakdown": show_points_breakdown,
        "branding": json.dumps(branding or {}),
        "status": "active",
        "viewCount": 0,
        "createdAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expiresAt": expires_at,
    }

    try:
        from src.repos.ddb import put_item, sanitize_for_dynamodb
        t = _get_proposals_table()
        put_item(t, sanitize_for_dynamodb(item))
    except Exception as e:
        logger.error(f"Failed to create proposal: {e}")
        raise

    return {
        "proposal_id": proposal_id,
        "share_token": share_token,
        "share_url": f"/proposals/{share_token}",
        "expires_at": expires_at,
        "created_at": item["createdAt"],
    }


def get_proposal(org_id: str, proposal_id: str) -> Optional[Dict[str, Any]]:
    """Get a proposal by org and ID (advisor view)."""
    try:
        from src.repos.ddb import get_item
        t = _get_proposals_table()
        item = get_item(t, {"orgId": org_id, "proposalId": proposal_id})
        if item:
            return _deserialize_proposal(item)
        return None
    except Exception as e:
        logger.error(f"Failed to get proposal: {e}")
        return None


def get_proposal_by_token(share_token: str) -> Optional[Dict[str, Any]]:
    """Get a proposal by share token (public client view)."""
    try:
        from boto3.dynamodb.conditions import Attr
        t = _get_proposals_table()
        resp = t.scan(
            FilterExpression=Attr("shareToken").eq(share_token),
            Limit=1,
        )
        items = resp.get("Items", [])
        if items:
            item = items[0]
            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            expires_at = item.get("expiresAt", "")
            if expires_at and expires_at < now:
                return None

            view_count = int(item.get("viewCount", 0)) + 1
            try:
                t.update_item(
                    Key={"orgId": item["orgId"], "proposalId": item["proposalId"]},
                    UpdateExpression="SET viewCount = :v",
                    ExpressionAttributeValues={":v": view_count},
                )
            except Exception:
                pass

            return _deserialize_proposal(item)
        return None
    except Exception as e:
        logger.error(f"Failed to get proposal by token: {e}")
        return None


def list_proposals(org_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    """List proposals for an org."""
    try:
        from boto3.dynamodb.conditions import Key
        t = _get_proposals_table()
        resp = t.query(
            KeyConditionExpression=Key("orgId").eq(org_id),
            Limit=limit,
            ScanIndexForward=False,
        )
        return [_deserialize_proposal(item) for item in resp.get("Items", [])]
    except Exception as e:
        logger.error(f"Failed to list proposals: {e}")
        return []


def _strip_to_client_safe(recommendation: Dict[str, Any], show_points: bool) -> Dict[str, Any]:
    """Remove advisor-only data from a recommendation for client viewing."""
    client_rec = {
        "category": recommendation.get("category", ""),
        "label": recommendation.get("label", ""),
        "route_summary": recommendation.get("route_summary", ""),
        "price_summary": recommendation.get("price_summary", ""),
        "why_this_option": recommendation.get("why_this_option", ""),
        "tradeoffs": recommendation.get("tradeoffs", []),
        "risks": [r for r in recommendation.get("risks", []) if not r.startswith("Point transfer")],
        "booking_steps": recommendation.get("booking_steps", []),
    }

    if show_points and "cash_vs_points" in recommendation:
        cvp = recommendation["cash_vs_points"]
        client_rec["points_summary"] = {
            "strategy": cvp.get("recommended_strategy", ""),
            "savings": cvp.get("savings_vs_all_cash", 0),
            "summary": cvp.get("comparison_summary", ""),
        }

    itinerary = recommendation.get("itinerary", {})
    flights = itinerary.get("flights", [])
    client_flights = []
    for f in flights:
        client_flights.append({
            "airline": f.get("airline", ""),
            "origin": f.get("departure_airport", f.get("origin", "")),
            "destination": f.get("arrival_airport", f.get("destination", "")),
            "departure_time": f.get("departure_time", ""),
            "arrival_time": f.get("arrival_time", ""),
            "duration_display": f.get("duration_display", ""),
            "stops": f.get("stops", 0),
            "cabin_class": f.get("cabin_class", ""),
        })
    client_rec["flights"] = client_flights

    return client_rec


def _deserialize_proposal(item: Dict[str, Any]) -> Dict[str, Any]:
    """Deserialize a DynamoDB proposal item."""
    recommendations = item.get("recommendations", "[]")
    if isinstance(recommendations, str):
        try:
            recommendations = json.loads(recommendations)
        except json.JSONDecodeError:
            recommendations = []

    branding = item.get("branding", "{}")
    if isinstance(branding, str):
        try:
            branding = json.loads(branding)
        except json.JSONDecodeError:
            branding = {}

    return {
        "proposal_id": item.get("proposalId", ""),
        "org_id": item.get("orgId", ""),
        "trip_id": item.get("tripId", ""),
        "client_id": item.get("clientId", ""),
        "client_name": item.get("clientName", ""),
        "advisor_id": item.get("advisorId", ""),
        "advisor_note": item.get("advisorNote", ""),
        "trip_summary": item.get("tripSummary", ""),
        "recommendations": recommendations,
        "show_alternatives": item.get("showAlternatives", True),
        "show_booking_steps": item.get("showBookingSteps", True),
        "show_points_breakdown": item.get("showPointsBreakdown", True),
        "branding": branding,
        "share_token": item.get("shareToken", ""),
        "share_url": f"/proposals/{item.get('shareToken', '')}",
        "status": item.get("status", "active"),
        "view_count": int(item.get("viewCount", 0)),
        "created_at": item.get("createdAt", ""),
        "expires_at": item.get("expiresAt", ""),
    }
