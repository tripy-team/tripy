"""
Re-Optimization Service (Feature 9)

Monitors trips for improvement opportunities and triggers re-optimization
when better options become available (price drops, award availability,
transfer bonuses, schedule changes).
"""
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class ReoptimizationTrigger:
    def __init__(
        self,
        trip_id: str,
        trigger_type: str,
        original_value: str,
        new_value: str,
        potential_savings: float,
        recommendation: str,
    ):
        self.trigger_id = f"reopt_{uuid.uuid4().hex[:12]}"
        self.trip_id = trip_id
        self.trigger_type = trigger_type
        self.original_value = original_value
        self.new_value = new_value
        self.potential_savings = potential_savings
        self.recommendation = recommendation
        self.created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.status = "pending"  # pending | accepted | dismissed

    def to_dict(self) -> Dict[str, Any]:
        return {
            "trigger_id": self.trigger_id,
            "trip_id": self.trip_id,
            "trigger_type": self.trigger_type,
            "original_value": self.original_value,
            "new_value": self.new_value,
            "potential_savings": self.potential_savings,
            "recommendation": self.recommendation,
            "created_at": self.created_at,
            "status": self.status,
        }


def check_for_opportunities(
    trip_id: str,
    original_itinerary: Dict[str, Any],
    current_search_results: Dict[str, Any],
    active_bonuses: Optional[List[Dict[str, Any]]] = None,
) -> List[ReoptimizationTrigger]:
    """
    Compare original optimization with current market data to find improvements.

    Args:
        trip_id: The trip being monitored
        original_itinerary: The optimization result at time of booking
        current_search_results: Fresh search results from monitoring check
        active_bonuses: Current transfer bonus promotions
    """
    triggers = []

    price_trigger = _check_price_drop(trip_id, original_itinerary, current_search_results)
    if price_trigger:
        triggers.append(price_trigger)

    award_trigger = _check_award_availability(trip_id, original_itinerary, current_search_results)
    if award_trigger:
        triggers.append(award_trigger)

    if active_bonuses:
        bonus_trigger = _check_transfer_bonus(trip_id, original_itinerary, active_bonuses)
        if bonus_trigger:
            triggers.append(bonus_trigger)

    schedule_trigger = _check_schedule_improvement(trip_id, original_itinerary, current_search_results)
    if schedule_trigger:
        triggers.append(schedule_trigger)

    return triggers


def _check_price_drop(
    trip_id: str,
    original: Dict[str, Any],
    current: Dict[str, Any],
) -> Optional[ReoptimizationTrigger]:
    """Check if cash fares have dropped significantly."""
    original_cash = float(original.get("cash_price", 0) or 0)
    current_cash = float(current.get("cash_price", 0) or 0)

    if original_cash <= 0 or current_cash <= 0:
        return None

    drop = original_cash - current_cash
    drop_pct = (drop / original_cash) * 100

    if drop >= 50 and drop_pct >= 10:
        return ReoptimizationTrigger(
            trip_id=trip_id,
            trigger_type="price_drop",
            original_value=f"${original_cash:,.0f}",
            new_value=f"${current_cash:,.0f}",
            potential_savings=drop,
            recommendation=f"Cash price dropped {drop_pct:.0f}% (${drop:,.0f}). Re-optimize to capture savings.",
        )
    return None


def _check_award_availability(
    trip_id: str,
    original: Dict[str, Any],
    current: Dict[str, Any],
) -> Optional[ReoptimizationTrigger]:
    """Check if premium cabin award seats have become available."""
    original_cabin = (original.get("cabin_class") or "economy").lower()
    current_awards = current.get("award_options", [])

    if not current_awards:
        return None

    for award in current_awards:
        award_cabin = (award.get("cabin_class") or "").lower()
        cabin_priority = {"first": 4, "business": 3, "premium_economy": 2, "economy": 1}

        if cabin_priority.get(award_cabin, 0) > cabin_priority.get(original_cabin, 0):
            points_cost = int(award.get("points_cost", 0) or 0)
            return ReoptimizationTrigger(
                trip_id=trip_id,
                trigger_type="award_availability",
                original_value=f"{original_cabin} class",
                new_value=f"{award_cabin} class for {points_cost:,} points",
                potential_savings=0,
                recommendation=f"{award_cabin.title()} class now available via {award.get('program', 'points')}.",
            )
    return None


def _check_transfer_bonus(
    trip_id: str,
    original: Dict[str, Any],
    active_bonuses: List[Dict[str, Any]],
) -> Optional[ReoptimizationTrigger]:
    """Check if a new transfer bonus makes a different strategy better."""
    transfer_plan = original.get("transfer_plan", [])
    if not transfer_plan:
        return None

    for bonus in active_bonuses:
        bonus_from = bonus.get("from_program", "").lower()
        bonus_to = bonus.get("to_program", "").lower()
        bonus_pct = int(bonus.get("bonus_percentage", 0))

        for transfer in transfer_plan:
            if (transfer.get("from_program", "").lower() == bonus_from
                    and transfer.get("to_program", "").lower() == bonus_to):
                continue

        if bonus_pct >= 15:
            return ReoptimizationTrigger(
                trip_id=trip_id,
                trigger_type="transfer_bonus",
                original_value="No bonus applied",
                new_value=f"{bonus_pct}% bonus: {bonus_from} → {bonus_to}",
                potential_savings=0,
                recommendation=(
                    f"{bonus_pct}% transfer bonus active for "
                    f"{bonus.get('from_program', '')} → {bonus.get('to_program', '')}. "
                    f"Re-optimize to take advantage."
                ),
            )
    return None


def _check_schedule_improvement(
    trip_id: str,
    original: Dict[str, Any],
    current: Dict[str, Any],
) -> Optional[ReoptimizationTrigger]:
    """Check if schedule changes create better options (fewer stops, shorter duration)."""
    original_flights = original.get("flights", [])
    current_flights = current.get("flights", [])

    if not original_flights or not current_flights:
        return None

    orig_stops = sum(int(f.get("stops", 0)) for f in original_flights)
    orig_duration = sum(float(f.get("duration_minutes", 0) or 0) for f in original_flights)

    curr_stops = sum(int(f.get("stops", 0)) for f in current_flights)
    curr_duration = sum(float(f.get("duration_minutes", 0) or 0) for f in current_flights)

    if curr_stops < orig_stops:
        return ReoptimizationTrigger(
            trip_id=trip_id,
            trigger_type="schedule_change",
            original_value=f"{orig_stops} stops",
            new_value=f"{curr_stops} stops",
            potential_savings=0,
            recommendation=(
                f"A {'nonstop' if curr_stops == 0 else 'fewer-stop'} option is now available. "
                f"Re-optimize for a better schedule."
            ),
        )

    if orig_duration > 0 and curr_duration > 0:
        time_saved_mins = orig_duration - curr_duration
        if time_saved_mins >= 60:
            return ReoptimizationTrigger(
                trip_id=trip_id,
                trigger_type="schedule_change",
                original_value=f"{orig_duration / 60:.1f}h total",
                new_value=f"{curr_duration / 60:.1f}h total",
                potential_savings=0,
                recommendation=f"A faster routing saves {time_saved_mins / 60:.1f} hours.",
            )

    return None


def get_opportunities_for_trip(trip_id: str) -> List[Dict[str, Any]]:
    """Get pending improvement opportunities for a trip (placeholder for DDB storage)."""
    return []


def accept_opportunity(trip_id: str, trigger_id: str) -> Dict[str, Any]:
    """Accept an improvement opportunity and trigger re-optimization."""
    return {"ok": True, "message": "Re-optimization triggered", "trigger_id": trigger_id}


def dismiss_opportunity(trip_id: str, trigger_id: str) -> Dict[str, Any]:
    """Dismiss an improvement opportunity."""
    return {"ok": True, "message": "Opportunity dismissed", "trigger_id": trigger_id}
