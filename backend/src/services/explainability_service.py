"""
Explainability Layer (Feature 6)

Generates structured reasoning for every recommendation.
All explanations are deterministic (template-based), not LLM-generated.
"""
import logging
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class ExplanationBlock:
    type: str       # why_best | tradeoff | risk | alternative_rejected | points_strategy
    headline: str
    detail: str
    confidence: str = "high"  # high | medium | low
    data_sources: List[str] = field(default_factory=list)


@dataclass
class RecommendationExplanation:
    why_recommended: Optional[ExplanationBlock] = None
    tradeoffs: List[ExplanationBlock] = field(default_factory=list)
    risks: List[ExplanationBlock] = field(default_factory=list)
    alternatives_rejected: List[ExplanationBlock] = field(default_factory=list)
    points_reasoning: Optional[ExplanationBlock] = None


def explain_recommendation(
    recommended: Dict[str, Any],
    alternatives: List[Dict[str, Any]],
    category: str,
    cash_vs_points: Optional[Dict[str, Any]] = None,
) -> RecommendationExplanation:
    """
    Generate a structured explanation for a recommendation.

    Args:
        recommended: The recommended itinerary
        alternatives: Other itineraries that were not chosen
        category: best_overall | lowest_cost | best_experience
        cash_vs_points: Cash vs points comparison data
    """
    explanation = RecommendationExplanation()

    explanation.why_recommended = _explain_why_best(recommended, category)
    explanation.tradeoffs = _explain_tradeoffs(recommended, alternatives)
    explanation.risks = _explain_risks(recommended)
    explanation.alternatives_rejected = _explain_rejected(recommended, alternatives)

    if cash_vs_points:
        explanation.points_reasoning = _explain_points_strategy(cash_vs_points)

    return explanation


def _explain_why_best(itinerary: Dict[str, Any], category: str) -> ExplanationBlock:
    oop = float(itinerary.get("out_of_pocket", 0) or 0)
    flights = itinerary.get("flights", [])
    total_stops = sum(int(f.get("stops", 0)) for f in flights)
    cabin = itinerary.get("cabin_class", itinerary.get("flight_class", "economy"))
    savings = float(itinerary.get("savings", 0) or 0)

    if category == "lowest_cost":
        headline = f"Lowest out-of-pocket at ${oop:,.0f}"
        detail = f"This option minimizes your cash outlay."
        if savings > 0:
            detail += f" Saves ${savings:,.0f} compared to all-cash pricing."
    elif category == "best_experience":
        stop_text = "nonstop" if total_stops == 0 else f"{total_stops} stop{'s' if total_stops > 1 else ''}"
        headline = f"Most comfortable: {cabin} class, {stop_text}"
        detail = f"Prioritizes comfort and convenience over cost."
        if total_stops == 0:
            detail += " Direct flights mean less hassle and lower risk of delays."
    else:
        headline = "Best overall balance of price and comfort"
        detail = (
            f"${oop:,.0f} out-of-pocket, {cabin} class, "
            f"{'nonstop' if total_stops == 0 else f'{total_stops} stop(s)'}. "
            f"The best tradeoff for your preferences."
        )

    return ExplanationBlock(
        type="why_best",
        headline=headline,
        detail=detail,
        data_sources=["Google Flights", "AwardTool"],
    )


def _explain_tradeoffs(
    recommended: Dict[str, Any],
    alternatives: List[Dict[str, Any]],
) -> List[ExplanationBlock]:
    tradeoffs = []
    rec_oop = float(recommended.get("out_of_pocket", 0) or 0)
    rec_flights = recommended.get("flights", [])
    rec_stops = sum(int(f.get("stops", 0)) for f in rec_flights)

    cheapest_alt = None
    for alt in alternatives:
        alt_oop = float(alt.get("out_of_pocket", 0) or 0)
        if cheapest_alt is None or alt_oop < float(cheapest_alt.get("out_of_pocket", 0) or 0):
            cheapest_alt = alt

    if cheapest_alt:
        cheapest_oop = float(cheapest_alt.get("out_of_pocket", 0) or 0)
        if rec_oop > cheapest_oop > 0:
            diff = rec_oop - cheapest_oop
            cheap_flights = cheapest_alt.get("flights", [])
            cheap_stops = sum(int(f.get("stops", 0)) for f in cheap_flights)

            reason = ""
            if rec_stops < cheap_stops:
                reason = f"but has {'fewer' if cheap_stops - rec_stops == 1 else f'{cheap_stops - rec_stops} fewer'} stops"
            elif rec_stops == 0 and cheap_stops > 0:
                reason = "but avoids connections entirely"

            headline = f"Costs ${diff:,.0f} more than the cheapest option"
            detail = f"This option costs ${diff:,.0f} more"
            if reason:
                detail += f", {reason}."
            else:
                detail += "."

            tradeoffs.append(ExplanationBlock(
                type="tradeoff",
                headline=headline,
                detail=detail,
            ))

    for f in rec_flights:
        if f.get("is_self_transfer") or f.get("self_transfer"):
            tradeoffs.append(ExplanationBlock(
                type="tradeoff",
                headline="Includes a self-transfer",
                detail=(
                    "You'll need to collect luggage, recheck it, and clear security again. "
                    "Allow at least 2-3 hours between flights."
                ),
                confidence="high",
            ))
            break

    if recommended.get("separate_tickets"):
        tradeoffs.append(ExplanationBlock(
            type="tradeoff",
            headline="Booked on separate tickets",
            detail=(
                "If one flight is cancelled or delayed, the airline is not responsible "
                "for rebooking you on the other ticket."
            ),
            confidence="high",
        ))

    return tradeoffs


def _explain_risks(itinerary: Dict[str, Any]) -> List[ExplanationBlock]:
    risks = []
    flights = itinerary.get("flights", [])

    for f in flights:
        connection_mins = int(f.get("connection_duration_minutes", 0) or 0)
        if 0 < connection_mins < 90:
            risks.append(ExplanationBlock(
                type="risk",
                headline=f"Tight connection: {connection_mins} minutes",
                detail=(
                    f"A {connection_mins}-minute connection is tight. If the first flight "
                    f"is delayed, you may miss the connection."
                ),
                confidence="high",
            ))

    transfer_plan = itinerary.get("transfer_plan", [])
    for t in transfer_plan:
        timing = t.get("transfer_time", "")
        if timing and "instant" not in timing.lower():
            risks.append(ExplanationBlock(
                type="risk",
                headline=f"Point transfer takes {timing}",
                detail=(
                    f"Transferring to {t.get('to_program', 'partner')} takes {timing}. "
                    f"Start the transfer early to avoid missing the booking window."
                ),
            ))

    return risks


def _explain_rejected(
    recommended: Dict[str, Any],
    alternatives: List[Dict[str, Any]],
) -> List[ExplanationBlock]:
    rejected = []
    rec_oop = float(recommended.get("out_of_pocket", 0) or 0)
    rec_flights = recommended.get("flights", [])
    rec_stops = sum(int(f.get("stops", 0)) for f in rec_flights)
    rec_duration = sum(float(f.get("duration_minutes", 0) or 0) for f in rec_flights)

    for alt in alternatives[:5]:
        alt_id = alt.get("itinerary_id", alt.get("id", "?"))
        alt_oop = float(alt.get("out_of_pocket", 0) or 0)
        alt_flights = alt.get("flights", [])
        alt_stops = sum(int(f.get("stops", 0)) for f in alt_flights)
        alt_duration = sum(float(f.get("duration_minutes", 0) or 0) for f in alt_flights)

        reasons = []
        if alt_oop > rec_oop * 1.15:
            reasons.append(f"costs ${alt_oop - rec_oop:,.0f} more")
        if alt_stops > rec_stops + 1:
            reasons.append(f"has {alt_stops - rec_stops} more stops")
        if alt_duration > rec_duration + 120:
            extra_hrs = (alt_duration - rec_duration) / 60
            reasons.append(f"takes {extra_hrs:.1f}h longer")

        for f in alt_flights:
            if f.get("is_self_transfer") and not any(
                rf.get("is_self_transfer") for rf in rec_flights
            ):
                reasons.append("requires a self-transfer")
                break

        if reasons:
            headline = f"Alternative {alt_id}: {'; '.join(reasons)}"
            rejected.append(ExplanationBlock(
                type="alternative_rejected",
                headline=headline,
                detail=f"Not selected because it {' and '.join(reasons)}.",
            ))

    return rejected


def _explain_points_strategy(cash_vs_points: Dict[str, Any]) -> ExplanationBlock:
    strategy = cash_vs_points.get("recommended_strategy", "mixed")
    savings = float(cash_vs_points.get("savings_vs_all_cash", 0) or 0)
    summary = cash_vs_points.get("comparison_summary", "")

    points_data = cash_vs_points.get("all_points") or cash_vs_points.get("recommended_mix") or {}
    overall_rating = points_data.get("overall_value_rating", points_data.get("value_rating", ""))

    if strategy == "all_cash":
        return ExplanationBlock(
            type="points_strategy",
            headline="Cash is the better move here",
            detail=(
                "Using points for this itinerary provides weak value. "
                "Save your points for a higher-value redemption."
            ),
        )

    if isinstance(overall_rating, str) and overall_rating == "excellent":
        return ExplanationBlock(
            type="points_strategy",
            headline=f"Excellent point redemption — saves ${savings:,.0f}",
            detail=(
                f"This redemption achieves above-benchmark value. "
                f"{summary}"
            ),
        )

    if savings > 0:
        return ExplanationBlock(
            type="points_strategy",
            headline=f"Points save ${savings:,.0f} vs all-cash",
            detail=summary or f"Using points saves ${savings:,.0f} on this itinerary.",
        )

    return ExplanationBlock(
        type="points_strategy",
        headline="Points strategy applied",
        detail=summary or "A mixed cash and points strategy was used.",
    )


def explanation_to_dict(explanation: RecommendationExplanation) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    if explanation.why_recommended:
        result["why_recommended"] = asdict(explanation.why_recommended)
    result["tradeoffs"] = [asdict(t) for t in explanation.tradeoffs]
    result["risks"] = [asdict(r) for r in explanation.risks]
    result["alternatives_rejected"] = [asdict(a) for a in explanation.alternatives_rejected]
    if explanation.points_reasoning:
        result["points_reasoning"] = asdict(explanation.points_reasoning)
    return result
