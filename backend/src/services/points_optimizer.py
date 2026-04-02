"""
Cash vs Points Recommendation Engine (Feature 3)

Sits between the ILP solver output and the recommendation layer.
Constructs three strategies (all-cash, all-points, optimal-mix),
calculates CPP achieved vs benchmarks, and recommends the best approach.
"""
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

CPP_BENCHMARKS: Dict[str, float] = {
    "chase_ur": 2.0,
    "amex_mr": 2.0,
    "citi_ty": 1.8,
    "capital_one": 1.85,
    "bilt": 2.0,
    "united_mp": 1.5,
    "delta_sm": 1.2,
    "aa_miles": 1.5,
    "alaska_mp": 1.8,
    "jetblue_tp": 1.3,
    "southwest_rr": 1.4,
    "virgin_atlantic": 1.5,
    "british_airways": 1.5,
    "air_canada": 1.5,
    "singapore_kf": 1.8,
    "ana_mc": 1.8,
    "cathay_am": 1.5,
    "hyatt_woh": 2.0,
    "marriott_bp": 0.8,
    "hilton_hp": 0.6,
    "ihg_rc": 0.5,
}


def _rate_value(cpp: float, benchmark: float) -> str:
    ratio = cpp / benchmark if benchmark > 0 else 0
    if ratio >= 1.5:
        return "excellent"
    if ratio >= 1.0:
        return "good"
    if ratio >= 0.7:
        return "fair"
    return "poor"


@dataclass
class TransferStep:
    from_program: str
    to_program: str
    points_amount: int
    ratio: float = 1.0
    transfer_time: str = "1-2 business days"
    bonus_active: bool = False
    bonus_percentage: int = 0


@dataclass
class CashOption:
    total_cost: float
    route_summary: str
    booking_steps: List[str] = field(default_factory=list)


@dataclass
class PointsOption:
    total_points_used: Dict[str, int] = field(default_factory=dict)
    taxes_and_fees: float = 0.0
    total_cash_outlay: float = 0.0
    cpp_achieved: Dict[str, float] = field(default_factory=dict)
    cpp_benchmark: Dict[str, float] = field(default_factory=dict)
    value_rating: Dict[str, str] = field(default_factory=dict)
    overall_value_rating: str = "good"
    transfers_required: List[TransferStep] = field(default_factory=list)
    route_summary: str = ""
    booking_steps: List[str] = field(default_factory=list)


@dataclass
class MixedOption:
    cash_portion: float = 0.0
    points_used: Dict[str, int] = field(default_factory=dict)
    total_cash_outlay: float = 0.0
    cpp_achieved: Dict[str, float] = field(default_factory=dict)
    value_rating: str = "good"
    transfers_required: List[TransferStep] = field(default_factory=list)
    strategy_description: str = ""
    route_summary: str = ""
    booking_steps: List[str] = field(default_factory=list)


@dataclass
class CashVsPointsComparison:
    all_cash: Optional[CashOption] = None
    all_points: Optional[PointsOption] = None
    recommended_mix: Optional[MixedOption] = None
    recommended_strategy: str = "mixed"
    comparison_summary: str = ""
    savings_vs_all_cash: float = 0.0
    transfer_bonuses_applied: List[Dict[str, Any]] = field(default_factory=list)


def build_comparison(
    itinerary: Dict[str, Any],
    solver_output: Dict[str, Any],
    transfer_plan: List[Dict[str, Any]],
    available_points: Dict[str, int],
    active_bonuses: Optional[List[Dict[str, Any]]] = None,
    client_budget_style: str = "moderate",
) -> CashVsPointsComparison:
    """
    Build a cash-vs-points comparison from optimization output.

    Args:
        itinerary: The itinerary data (flights, prices, etc.)
        solver_output: The ILP solver result
        transfer_plan: Transfer instructions from the optimizer
        available_points: Client's loyalty balances {program: balance}
        active_bonuses: Current transfer bonus promotions
        client_budget_style: Client preference (budget|moderate|premium|ultra-premium)
    """
    comparison = CashVsPointsComparison()

    all_cash_price = float(solver_output.get("all_cash_cost", 0) or itinerary.get("cash_price", 0))
    total_oop = float(solver_output.get("total_out_of_pocket", 0))
    total_points = int(solver_output.get("total_points_used", 0))

    flights = itinerary.get("flights", [])
    route_parts = []
    for f in flights:
        dep = f.get("departure_airport", f.get("origin", "?"))
        arr = f.get("arrival_airport", f.get("destination", "?"))
        airline = f.get("airline", "")
        route_parts.append(f"{dep}→{arr}" + (f" ({airline})" if airline else ""))
    route_summary = ", ".join(route_parts) if route_parts else "Route details unavailable"

    comparison.all_cash = CashOption(
        total_cost=all_cash_price,
        route_summary=route_summary,
        booking_steps=[
            "Search on Google Flights or airline website",
            f"Book for ${all_cash_price:,.2f} total",
            "Use a travel rewards card for future points",
        ],
    )

    if total_points > 0:
        points_by_program: Dict[str, int] = {}
        cpp_by_program: Dict[str, float] = {}
        transfers: List[TransferStep] = []

        for t in transfer_plan:
            from_prog = t.get("from_program", "")
            to_prog = t.get("to_program", "")
            amount = int(t.get("points_to_transfer", 0))
            ratio = float(t.get("ratio", 1.0))

            points_by_program[from_prog] = points_by_program.get(from_prog, 0) + amount

            bonus_active = False
            bonus_pct = 0
            if active_bonuses:
                for b in active_bonuses:
                    if (b.get("from_program", "").lower() == from_prog.lower()
                            and b.get("to_program", "").lower() == to_prog.lower()):
                        bonus_active = True
                        bonus_pct = int(b.get("bonus_percentage", 0))
                        break

            transfers.append(TransferStep(
                from_program=from_prog,
                to_program=to_prog,
                points_amount=amount,
                ratio=ratio,
                bonus_active=bonus_active,
                bonus_percentage=bonus_pct,
            ))

        value_saved = all_cash_price - total_oop
        if total_points > 0 and value_saved > 0:
            avg_cpp = (value_saved / total_points) * 100
            for prog, pts in points_by_program.items():
                prog_key = prog.lower().replace(" ", "_")
                cpp_by_program[prog_key] = round(avg_cpp, 2)

        value_ratings: Dict[str, str] = {}
        for prog_key, cpp in cpp_by_program.items():
            benchmark = CPP_BENCHMARKS.get(prog_key, 1.5)
            value_ratings[prog_key] = _rate_value(cpp, benchmark)

        overall = "good"
        if value_ratings:
            ratings_list = list(value_ratings.values())
            if all(r == "excellent" for r in ratings_list):
                overall = "excellent"
            elif any(r == "poor" for r in ratings_list):
                overall = "fair"
            elif all(r in ("excellent", "good") for r in ratings_list):
                overall = "good"

        comparison.all_points = PointsOption(
            total_points_used=points_by_program,
            taxes_and_fees=total_oop,
            total_cash_outlay=total_oop,
            cpp_achieved=cpp_by_program,
            cpp_benchmark={k: CPP_BENCHMARKS.get(k, 1.5) for k in cpp_by_program},
            value_rating=value_ratings,
            overall_value_rating=overall,
            transfers_required=transfers,
            route_summary=route_summary,
        )

    if comparison.all_points and all_cash_price > 0:
        comparison.recommended_mix = MixedOption(
            cash_portion=total_oop,
            points_used=comparison.all_points.total_points_used,
            total_cash_outlay=total_oop,
            cpp_achieved=comparison.all_points.cpp_achieved,
            value_rating=comparison.all_points.overall_value_rating,
            transfers_required=comparison.all_points.transfers_required,
            strategy_description=_build_strategy_description(
                comparison.all_points, all_cash_price, total_oop, client_budget_style,
            ),
            route_summary=route_summary,
        )

    comparison.savings_vs_all_cash = all_cash_price - total_oop if all_cash_price > total_oop else 0

    if active_bonuses:
        for b in active_bonuses:
            for t in (comparison.recommended_mix or comparison.all_points or MixedOption()).transfers_required:
                if t.bonus_active:
                    comparison.transfer_bonuses_applied.append({
                        "from_program": t.from_program,
                        "to_program": t.to_program,
                        "bonus_percentage": t.bonus_percentage,
                    })

    comparison.recommended_strategy = _pick_strategy(
        comparison, client_budget_style,
    )
    comparison.comparison_summary = _build_summary(comparison)

    return comparison


def _pick_strategy(
    comparison: CashVsPointsComparison,
    budget_style: str,
) -> str:
    if not comparison.all_points:
        return "all_cash"

    rating = comparison.all_points.overall_value_rating
    savings = comparison.savings_vs_all_cash
    cash_cost = comparison.all_cash.total_cost if comparison.all_cash else 0

    if budget_style in ("budget", "moderate"):
        if rating in ("excellent", "good") and savings > 50:
            return "mixed"
        if savings < 50:
            return "all_cash"
    elif budget_style in ("premium", "ultra-premium"):
        if rating == "excellent":
            return "mixed"
        if rating == "good" and savings > 100:
            return "mixed"

    if rating == "poor":
        return "all_cash"

    return "mixed"


def _build_strategy_description(
    points_option: PointsOption,
    all_cash_price: float,
    total_oop: float,
    budget_style: str,
) -> str:
    savings = all_cash_price - total_oop
    if savings <= 0:
        return "Cash is the better option for this itinerary — points don't provide meaningful savings."

    pct = (savings / all_cash_price * 100) if all_cash_price > 0 else 0
    rating = points_option.overall_value_rating

    if rating == "excellent":
        return (
            f"Outstanding redemption. Save ${savings:,.0f} ({pct:.0f}%) by using points. "
            f"This is well above typical value for these programs."
        )
    if rating == "good":
        return (
            f"Good use of points. Save ${savings:,.0f} ({pct:.0f}%). "
            f"Solid value that justifies the transfer."
        )
    if rating == "fair":
        return (
            f"Marginal points value. You'd save ${savings:,.0f} ({pct:.0f}%), "
            f"but the redemption rate is below benchmarks. Consider saving points for a better opportunity."
        )
    return f"Points provide weak value here. Cash booking at ${all_cash_price:,.0f} is recommended."


def _build_summary(comparison: CashVsPointsComparison) -> str:
    strategy = comparison.recommended_strategy
    savings = comparison.savings_vs_all_cash

    if strategy == "all_cash":
        return "Cash is the best option for this trip."
    if savings > 0:
        return (
            f"Using points saves ${savings:,.0f} compared to all-cash. "
            f"Recommended strategy: {strategy.replace('_', ' ')}."
        )
    return f"Recommended strategy: {strategy.replace('_', ' ')}."


def comparison_to_dict(comparison: CashVsPointsComparison) -> Dict[str, Any]:
    """Convert to JSON-serializable dict."""
    from dataclasses import asdict

    result: Dict[str, Any] = {
        "recommended_strategy": comparison.recommended_strategy,
        "comparison_summary": comparison.comparison_summary,
        "savings_vs_all_cash": comparison.savings_vs_all_cash,
        "transfer_bonuses_applied": comparison.transfer_bonuses_applied,
    }

    if comparison.all_cash:
        result["all_cash"] = asdict(comparison.all_cash)
    if comparison.all_points:
        result["all_points"] = asdict(comparison.all_points)
    if comparison.recommended_mix:
        result["recommended_mix"] = asdict(comparison.recommended_mix)

    return result
