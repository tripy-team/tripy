"""
Top 3 Recommendation Generator (Feature 5)

Categorizes optimization output into three decision-ready options:
- Best Overall (composite score weighted by client preferences)
- Lowest Out-of-Pocket (minimize total cash outlay)
- Best Experience (maximize comfort, minimize hassle)
"""
import logging
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class RecommendationCategory(str, Enum):
    BEST_OVERALL = "best_overall"
    LOWEST_COST = "lowest_cost"
    BEST_EXPERIENCE = "best_experience"


CATEGORY_LABELS = {
    RecommendationCategory.BEST_OVERALL: "Best Overall",
    RecommendationCategory.LOWEST_COST: "Lowest Out-of-Pocket",
    RecommendationCategory.BEST_EXPERIENCE: "Best Comfort & Convenience",
}


@dataclass
class BookingStep:
    step_number: int
    action: str
    platform: str = ""
    timing: str = ""
    is_irreversible: bool = False
    warning: Optional[str] = None


@dataclass
class CategorizedRecommendation:
    category: str
    label: str
    itinerary_id: str
    itinerary: Dict[str, Any]
    cash_vs_points: Optional[Dict[str, Any]] = None
    route_summary: str = ""
    price_summary: str = ""
    tradeoffs: List[str] = field(default_factory=list)
    risks: List[str] = field(default_factory=list)
    booking_steps: List[BookingStep] = field(default_factory=list)
    why_this_option: str = ""
    score: float = 0.0


def _compute_cost_score(itinerary: Dict[str, Any]) -> float:
    """Lower cost = higher score (inverted and normalized)."""
    oop = float(itinerary.get("out_of_pocket", itinerary.get("total_price", 0)) or 0)
    if oop <= 0:
        return 1.0
    return max(0, 1.0 - (oop / 20000))


def _compute_experience_score(itinerary: Dict[str, Any]) -> float:
    """Higher comfort = higher score."""
    score = 0.5

    cabin = (itinerary.get("cabin_class") or itinerary.get("flight_class") or "economy").lower()
    cabin_scores = {"first": 1.0, "business": 0.85, "premium_economy": 0.6, "premium": 0.6, "economy": 0.3, "basic_economy": 0.1}
    score = cabin_scores.get(cabin, 0.3)

    flights = itinerary.get("flights", [])
    total_stops = sum(int(f.get("stops", 0)) for f in flights)
    if total_stops == 0:
        score += 0.3
    elif total_stops <= 1:
        score += 0.15
    else:
        score -= 0.1

    total_duration = sum(float(f.get("duration_minutes", 0) or 0) for f in flights)
    if total_duration > 0 and total_duration < 600:
        score += 0.1
    elif total_duration > 1200:
        score -= 0.1

    has_self_transfer = any(
        f.get("is_self_transfer") or f.get("self_transfer") for f in flights
    )
    if has_self_transfer:
        score -= 0.2

    has_separate_tickets = itinerary.get("separate_tickets", False)
    if has_separate_tickets:
        score -= 0.15

    return max(0, min(1.0, score))


def _compute_composite_score(
    itinerary: Dict[str, Any],
    budget_style: str = "moderate",
) -> float:
    """Weighted composite of cost and experience, adjusted by client preferences."""
    cost = _compute_cost_score(itinerary)
    experience = _compute_experience_score(itinerary)

    weights = {
        "budget": (0.7, 0.3),
        "moderate": (0.5, 0.5),
        "premium": (0.3, 0.7),
        "ultra-premium": (0.15, 0.85),
    }
    cost_w, exp_w = weights.get(budget_style, (0.5, 0.5))

    return cost * cost_w + experience * exp_w


def _build_route_summary(itinerary: Dict[str, Any]) -> str:
    flights = itinerary.get("flights", [])
    if not flights:
        return "No flight details available"

    parts = []
    for f in flights:
        dep = f.get("departure_airport", f.get("origin", "?"))
        arr = f.get("arrival_airport", f.get("destination", "?"))
        airline = f.get("airline", "")
        stops = int(f.get("stops", 0))
        duration = f.get("duration_display", "")

        stop_text = "nonstop" if stops == 0 else f"{stops} stop{'s' if stops > 1 else ''}"
        parts_text = f"{dep} → {arr}"
        if airline:
            parts_text += f", {airline}"
        parts_text += f", {stop_text}"
        if duration:
            parts_text += f", {duration}"
        parts.append(parts_text)

    return " | ".join(parts)


def _build_price_summary(itinerary: Dict[str, Any]) -> str:
    oop = float(itinerary.get("out_of_pocket", 0) or 0)
    points_used = int(itinerary.get("total_points_used", 0) or 0)
    cash_price = float(itinerary.get("cash_price", 0) or 0)

    if points_used > 0 and oop > 0:
        return f"${oop:,.0f} + {points_used:,} points"
    if points_used > 0:
        return f"{points_used:,} points (+ taxes)"
    if oop > 0:
        return f"${oop:,.0f}"
    if cash_price > 0:
        return f"${cash_price:,.0f}"
    return "Price unavailable"


def _identify_tradeoffs(
    itinerary: Dict[str, Any],
    all_itineraries: List[Dict[str, Any]],
    category: RecommendationCategory,
) -> List[str]:
    """Identify tradeoffs compared to other categories."""
    tradeoffs = []
    oop = float(itinerary.get("out_of_pocket", 0) or 0)
    flights = itinerary.get("flights", [])
    total_stops = sum(int(f.get("stops", 0)) for f in flights)

    if category == RecommendationCategory.LOWEST_COST:
        if total_stops > 0:
            tradeoffs.append(f"Has {total_stops} stop{'s' if total_stops > 1 else ''} — not the most convenient option.")
        cabin = (itinerary.get("cabin_class") or "economy").lower()
        if cabin in ("economy", "basic_economy"):
            tradeoffs.append("Economy class — less comfortable for long flights.")

    elif category == RecommendationCategory.BEST_EXPERIENCE:
        cheapest_oop = min(
            (float(i.get("out_of_pocket", 0) or 0) for i in all_itineraries),
            default=0,
        )
        if oop > cheapest_oop and cheapest_oop > 0:
            diff = oop - cheapest_oop
            tradeoffs.append(f"Costs ${diff:,.0f} more than the cheapest option.")

    elif category == RecommendationCategory.BEST_OVERALL:
        tradeoffs.append("Balanced option — not the absolute cheapest or most luxurious.")

    has_self_transfer = any(f.get("is_self_transfer") for f in flights)
    if has_self_transfer:
        tradeoffs.append("Includes a self-transfer — luggage must be rechecked.")

    return tradeoffs


def _identify_risks(itinerary: Dict[str, Any]) -> List[str]:
    risks = []
    flights = itinerary.get("flights", [])

    for f in flights:
        if f.get("is_self_transfer") or f.get("self_transfer"):
            risks.append("Self-transfer required — allow extra time and recheck bags.")
        connection_mins = int(f.get("connection_duration_minutes", 0) or 0)
        if 0 < connection_mins < 90:
            risks.append(f"Tight connection ({connection_mins} min) — risk of missing the next flight.")

    if itinerary.get("separate_tickets"):
        risks.append("Separate tickets — if one flight is cancelled, the other is not protected.")

    transfers = itinerary.get("transfer_plan", [])
    for t in transfers:
        timing = t.get("transfer_time", "")
        if timing and "instant" not in timing.lower():
            risks.append(f"Point transfer to {t.get('to_program', 'partner')} takes {timing}.")

    return risks


def generate_top_3(
    itineraries: List[Dict[str, Any]],
    budget_style: str = "moderate",
) -> List[CategorizedRecommendation]:
    """
    Generate three categorized recommendations from ranked itineraries.

    Returns up to 3 recommendations (may return fewer if there aren't enough
    distinct itineraries).
    """
    if not itineraries:
        return []

    scored = []
    for it in itineraries:
        it_id = it.get("itinerary_id", it.get("id", ""))
        scored.append({
            "itinerary": it,
            "id": it_id,
            "cost_score": _compute_cost_score(it),
            "experience_score": _compute_experience_score(it),
            "composite_score": _compute_composite_score(it, budget_style),
        })

    best_overall = max(scored, key=lambda x: x["composite_score"])
    lowest_cost = min(scored, key=lambda x: float(
        x["itinerary"].get("out_of_pocket", x["itinerary"].get("total_price", float("inf"))) or float("inf")
    ))
    best_experience = max(scored, key=lambda x: x["experience_score"])

    used_ids = set()
    recommendations = []

    for category, pick in [
        (RecommendationCategory.BEST_OVERALL, best_overall),
        (RecommendationCategory.LOWEST_COST, lowest_cost),
        (RecommendationCategory.BEST_EXPERIENCE, best_experience),
    ]:
        it_id = pick["id"]
        if it_id in used_ids:
            for s in scored:
                if s["id"] not in used_ids:
                    pick = s
                    it_id = s["id"]
                    break
            else:
                continue

        used_ids.add(it_id)
        it = pick["itinerary"]

        rec = CategorizedRecommendation(
            category=category.value,
            label=CATEGORY_LABELS[category],
            itinerary_id=it_id,
            itinerary=it,
            route_summary=_build_route_summary(it),
            price_summary=_build_price_summary(it),
            tradeoffs=_identify_tradeoffs(it, itineraries, category),
            risks=_identify_risks(it),
            why_this_option=_build_why(it, category, budget_style),
            score=pick["composite_score"],
        )
        recommendations.append(rec)

    return recommendations


def _build_why(
    itinerary: Dict[str, Any],
    category: RecommendationCategory,
    budget_style: str,
) -> str:
    if category == RecommendationCategory.BEST_OVERALL:
        return "Best balance of price, comfort, and schedule for your preferences."
    elif category == RecommendationCategory.LOWEST_COST:
        oop = float(itinerary.get("out_of_pocket", 0) or 0)
        return f"Minimizes your out-of-pocket cost at ${oop:,.0f}."
    elif category == RecommendationCategory.BEST_EXPERIENCE:
        cabin = itinerary.get("cabin_class", "economy")
        flights = itinerary.get("flights", [])
        stops = sum(int(f.get("stops", 0)) for f in flights)
        stop_desc = "nonstop" if stops == 0 else f"{stops} stop{'s' if stops > 1 else ''}"
        return f"Most comfortable option: {cabin} class, {stop_desc}."
    return ""


def recommendations_to_dict(recs: List[CategorizedRecommendation]) -> List[Dict[str, Any]]:
    return [asdict(r) for r in recs]
