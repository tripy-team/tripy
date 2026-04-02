"""
ROI Dashboard Analytics Service (Feature 17)

Computes ROI metrics from operational data — no separate analytics tables.
All metrics derived from existing trip, client, proposal, and feedback data.
"""
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def get_roi_metrics(org_id: str, period_days: int = 30) -> Dict[str, Any]:
    """
    Compute ROI metrics for an organization.

    All data is derived from existing DynamoDB tables:
    - Trips (tripy-trips): savings, optimization times, trip counts
    - Clients (tripy-clients): client counts, per-client stats
    - Proposals (tripy-proposals): proposal counts, view counts
    - Feedback signals (tripy-preference-signals): booking rates
    """
    now = datetime.now(timezone.utc)
    period_start = (now - timedelta(days=period_days)).strftime("%Y-%m-%dT%H:%M:%SZ")

    trips = _get_org_trips(org_id, period_start)
    clients = _get_org_clients(org_id)
    proposals = _get_org_proposals(org_id, period_start)

    total_savings = sum(float(t.get("estimatedSavings", 0) or 0) for t in trips)
    total_points_optimized = sum(int(t.get("totalPointsUsed", 0) or 0) for t in trips)
    optimized_trips = [t for t in trips if t.get("status") in ("optimized", "selected", "booked", "completed")]

    avg_savings = total_savings / len(optimized_trips) if optimized_trips else 0

    active_clients = set()
    for t in trips:
        cid = t.get("clientId")
        if cid:
            active_clients.add(cid)

    trips_by_advisor: Dict[str, int] = {}
    for t in trips:
        advisor = t.get("createdBy", t.get("assignedTo", "unknown"))
        trips_by_advisor[advisor] = trips_by_advisor.get(advisor, 0) + 1

    clients_by_advisor: Dict[str, int] = {}
    for c in clients:
        creator = c.get("createdBy", "unknown")
        clients_by_advisor[creator] = clients_by_advisor.get(creator, 0) + 1

    estimated_manual_hours_per_trip = 2.5
    estimated_tripy_hours_per_trip = 0.25
    hours_saved = len(optimized_trips) * (estimated_manual_hours_per_trip - estimated_tripy_hours_per_trip)

    proposal_count = len(proposals)
    total_views = sum(int(p.get("viewCount", 0) or 0) for p in proposals)
    proposals_per_trip = proposal_count / len(optimized_trips) if optimized_trips else 0

    return {
        "period_days": period_days,
        "period_start": period_start,

        "time_savings": {
            "estimated_hours_saved": round(hours_saved, 1),
            "trips_optimized": len(optimized_trips),
            "avg_time_per_trip_minutes": round(estimated_tripy_hours_per_trip * 60, 0),
        },

        "value_metrics": {
            "total_savings_generated": round(total_savings, 2),
            "avg_savings_per_trip": round(avg_savings, 2),
            "total_points_optimized": total_points_optimized,
        },

        "engagement_metrics": {
            "proposals_sent": proposal_count,
            "proposals_per_trip": round(proposals_per_trip, 2),
            "proposal_views": total_views,
        },

        "portfolio_metrics": {
            "total_clients": len(clients),
            "active_clients": len(active_clients),
            "total_trips": len(trips),
            "trips_per_advisor": trips_by_advisor,
            "clients_per_advisor": clients_by_advisor,
        },

        "monthly_trend": _compute_monthly_trend(trips),
    }


def _get_org_trips(org_id: str, since: str) -> List[Dict[str, Any]]:
    """Get trips for an org since a date."""
    try:
        from src.repos.ddb import query_gsi, table
        from src.config import TRIPS_TABLE
        from boto3.dynamodb.conditions import Attr

        trips = query_gsi(table(TRIPS_TABLE), "orgId-index", "orgId", org_id)
        if since:
            trips = [t for t in trips if (t.get("createdAt", "") or "") >= since]
        return trips
    except Exception as e:
        logger.warning(f"Failed to get org trips: {e}")
        return []


def _get_org_clients(org_id: str) -> List[Dict[str, Any]]:
    """Get all clients for an org."""
    try:
        from src.repos.client_repo import list_clients
        return list_clients(org_id, limit=1000)
    except Exception as e:
        logger.warning(f"Failed to get org clients: {e}")
        return []


def _get_org_proposals(org_id: str, since: str) -> List[Dict[str, Any]]:
    """Get proposals for an org since a date."""
    try:
        from src.services.proposal_service import list_proposals
        proposals = list_proposals(org_id, limit=500)
        if since:
            proposals = [p for p in proposals if (p.get("created_at", "") or "") >= since]
        return proposals
    except Exception as e:
        logger.warning(f"Failed to get org proposals: {e}")
        return []


def _compute_monthly_trend(trips: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group trips by month for trend charts."""
    by_month: Dict[str, Dict[str, Any]] = {}

    for t in trips:
        created = t.get("createdAt", "")
        if not created or len(created) < 7:
            continue
        month_key = created[:7]

        if month_key not in by_month:
            by_month[month_key] = {
                "month": month_key,
                "trips": 0,
                "savings": 0.0,
            }

        by_month[month_key]["trips"] += 1
        by_month[month_key]["savings"] += float(t.get("estimatedSavings", 0) or 0)

    months = sorted(by_month.values(), key=lambda x: x["month"])
    for m in months:
        m["savings"] = round(m["savings"], 2)

    return months


def export_roi_csv(org_id: str, period_days: int = 90) -> str:
    """Generate a CSV string of ROI data for download."""
    metrics = get_roi_metrics(org_id, period_days)

    lines = ["Metric,Value"]
    lines.append(f"Period (days),{metrics['period_days']}")
    lines.append(f"Hours Saved,{metrics['time_savings']['estimated_hours_saved']}")
    lines.append(f"Trips Optimized,{metrics['time_savings']['trips_optimized']}")
    lines.append(f"Total Savings,${metrics['value_metrics']['total_savings_generated']:,.2f}")
    lines.append(f"Avg Savings/Trip,${metrics['value_metrics']['avg_savings_per_trip']:,.2f}")
    lines.append(f"Points Optimized,{metrics['value_metrics']['total_points_optimized']:,}")
    lines.append(f"Proposals Sent,{metrics['engagement_metrics']['proposals_sent']}")
    lines.append(f"Total Clients,{metrics['portfolio_metrics']['total_clients']}")
    lines.append(f"Active Clients,{metrics['portfolio_metrics']['active_clients']}")
    lines.append("")
    lines.append("Month,Trips,Savings")
    for m in metrics.get("monthly_trend", []):
        lines.append(f"{m['month']},{m['trips']},${m['savings']:,.2f}")

    return "\n".join(lines)
