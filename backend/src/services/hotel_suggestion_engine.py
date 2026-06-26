"""
Hotel Suggestion Engine

Turns a list of candidate hotels for one stay window into up to three
decision-ready, categorized suggestions — the hotel analogue of
`recommendation_engine.generate_top_3` for flights:

- Best Value           — lowest effective out-of-pocket, within budget
- Best Points Redemption — highest cents-per-point value (points-payable)
- Best Stay            — highest quality (star x rating x amenity match)

This module is intentionally vendor-independent: it operates on
`HotelRecommendation` objects (already normalized + budget/points-evaluated by
the provider layer), so it works identically against the mock provider, the
award_pricing fallback, or a live rooms.aero provider.

Hard constraints (budget fit, max nightly rate, dealbreakers) are applied
upstream in the provider / preference layer. Here we rank within the feasible
set and explain every tradeoff. If nothing is feasible we still surface the
closest option with an explicit over-budget note so the advisor isn't left
empty-handed.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from src.agents.models import CategorizedHotelSuggestion, HotelRecommendation

logger = logging.getLogger(__name__)

# Category keys + display labels (parallel to CATEGORY_LABELS on the flight side).
CAT_BEST_VALUE = "best_value"
CAT_BEST_POINTS = "best_points"
CAT_BEST_STAY = "best_stay"

HOTEL_CATEGORY_LABELS = {
    CAT_BEST_VALUE: "Best Value",
    CAT_BEST_POINTS: "Best Points Redemption",
    CAT_BEST_STAY: "Best Stay",
}

# Cost/quality weights by client budget style (mirrors the flight engine).
_BUDGET_WEIGHTS = {
    "budget": (0.70, 0.30),
    "moderate": (0.50, 0.50),
    "premium": (0.30, 0.70),
    "ultra-premium": (0.15, 0.85),
}

# Redemption value (cents/point) treated as a "great" points deal — used to
# normalize the points score. Above this, points_score saturates at 1.0.
_TARGET_CPP = 1.8

# Surface a risk note when a stay eats more than this share of its cash envelope.
_HIGH_BUDGET_USE = 0.85


# =============================================================================
# SCORING PRIMITIVES (lower-is-worse, all normalized to roughly [0, 1])
# =============================================================================

def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _star_norm(star: Optional[int]) -> float:
    """Map a 2-5 star level onto [0, 1]. Unknown -> mid."""
    if not star:
        return 0.5
    return _clamp01((star - 2) / 3.0)


def _rating_norm(rating: Optional[float]) -> float:
    """Guest rating (typically 0-5) onto [0, 1]. Unknown -> slightly-above-mid."""
    if rating is None:
        return 0.6
    return _clamp01(rating / 5.0)


def _amenity_match(rec: HotelRecommendation, preferred_amenities: List[str]) -> float:
    """Fraction of the client's preferred amenities this hotel offers."""
    if not preferred_amenities:
        return 0.5  # neutral when the client stated no amenity preferences
    have = {a.lower() for a in (rec.amenities or [])}
    matched = sum(1 for a in preferred_amenities if a.lower() in have)
    return _clamp01(matched / len(preferred_amenities))


def _quality_score(rec: HotelRecommendation, preferred_amenities: List[str]) -> float:
    """Comfort/quality signal: star level, guest rating, amenity fit."""
    return (
        0.45 * _star_norm(rec.star_level)
        + 0.35 * _rating_norm(rec.rating)
        + 0.20 * _amenity_match(rec, preferred_amenities)
    )


def _effective_oop(rec: HotelRecommendation) -> float:
    """Cash the traveler actually parts with.

    When the recommended payment is points and the stay is points-feasible, the
    cash outlay is ~0 (we don't track award surcharges on hotels yet), which
    keeps cash free for flights/experiences — consistent with the provider's
    points-first ranking. Otherwise it's the full cash price.
    """
    if rec.recommended_payment == "points" and rec.points_total:
        return 0.0
    return float(rec.price_total or 0.0)


def _cost_score(rec: HotelRecommendation) -> float:
    """Lower effective out-of-pocket = higher score, normalized to the window's
    cash envelope when known, else to twice the cash price."""
    eff = _effective_oop(rec)
    if eff <= 0:
        return 1.0  # fully covered by points
    ceiling = rec.cash_budget_allocated or (2.0 * float(rec.price_total or eff))
    if ceiling <= 0:
        return 0.5
    return _clamp01(1.0 - eff / ceiling)


def _points_score(rec: HotelRecommendation) -> float:
    """Cents-per-point redemption value, normalized to a strong target."""
    cpp = rec.redemption_value_cpp
    if not cpp or cpp <= 0:
        return 0.0
    return _clamp01(cpp / _TARGET_CPP)


def _composite(
    rec: HotelRecommendation,
    budget_style: str,
    preferred_amenities: List[str],
) -> float:
    cost_w, qual_w = _BUDGET_WEIGHTS.get(budget_style, (0.5, 0.5))
    return cost_w * _cost_score(rec) + qual_w * _quality_score(rec, preferred_amenities)


# =============================================================================
# NARRATIVE (why / tradeoffs / risks)
# =============================================================================

def _format_usd(n: Optional[float]) -> str:
    return f"${(n or 0):,.0f}"


def _price_phrase(rec: HotelRecommendation) -> str:
    if rec.recommended_payment == "points" and rec.points_total:
        cpp = f" (~{rec.redemption_value_cpp:.1f}c/pt)" if rec.redemption_value_cpp else ""
        return f"{rec.points_total:,} {rec.loyalty_program or 'points'}{cpp}"
    return f"{_format_usd(rec.price_total)} cash"


def _why(rec: HotelRecommendation, category: str) -> str:
    n = max(1, rec.room_count)
    rooms = f" ({n} rooms)" if n > 1 else ""
    if category == CAT_BEST_VALUE:
        return (
            f"Lowest out-of-pocket for {rec.destination}{rooms}: "
            f"{_price_phrase(rec)} for {rec.hotel_name}."
        )
    if category == CAT_BEST_POINTS:
        return (
            f"Best use of your points in {rec.destination}: {rec.points_total:,} "
            f"{rec.loyalty_program or 'points'} covers the stay "
            f"(worth ~{_format_usd(rec.price_total)}, "
            f"{(rec.redemption_value_cpp or 0):.1f}c/pt)."
        )
    if category == CAT_BEST_STAY:
        return (
            f"Highest-rated option in {rec.destination}: {rec.star_level}-star "
            f"{rec.hotel_name}"
            + (f", {rec.rating:.1f} guest rating" if rec.rating else "")
            + f" — {_price_phrase(rec)}."
        )
    return rec.recommendation_reason or ""


def _tradeoffs(
    rec: HotelRecommendation,
    category: str,
    others: List[HotelRecommendation],
) -> List[str]:
    out: List[str] = []
    cheapest = min((_effective_oop(o) for o in others), default=_effective_oop(rec))
    best_star = max((o.star_level for o in others), default=rec.star_level)

    if category == CAT_BEST_VALUE:
        if rec.star_level < best_star:
            out.append(
                f"{rec.star_level}-star — a notch below the Best Stay option "
                f"({best_star}-star)."
            )
    elif category == CAT_BEST_STAY:
        eff = _effective_oop(rec)
        if eff > cheapest and cheapest > 0:
            out.append(
                f"Costs {_format_usd(eff - cheapest)} more than the Best Value option."
            )
    elif category == CAT_BEST_POINTS:
        out.append(
            "Uses loyalty points rather than cash — best when you'd rather "
            "preserve cash for flights or experiences."
        )
    return out


def _risks(rec: HotelRecommendation) -> List[str]:
    out: List[str] = []
    # Budget shortfall.
    if rec.fits_budget is False:
        if rec.cash_budget_allocated and rec.price_total:
            over = max(0.0, rec.price_total - rec.cash_budget_allocated)
            out.append(
                f"Over the stay's cash budget by {_format_usd(over)} and not fully "
                f"covered by points — needs advisor review."
            )
        else:
            out.append("Does not fit the remaining cash budget or available points.")
    elif (
        rec.recommended_payment == "cash"
        and rec.cash_budget_allocated
        and rec.price_total
        and rec.price_total >= _HIGH_BUDGET_USE * rec.cash_budget_allocated
    ):
        pct = round(100 * rec.price_total / rec.cash_budget_allocated)
        out.append(f"Uses ~{pct}% of the cash budget allocated to this stay.")

    # Preference deviations surfaced by the provider/preference layer.
    for dev in (rec.preference_deviations or []):
        out.append(dev.reason)
    return out


# =============================================================================
# PUBLIC API
# =============================================================================

def generate_hotel_suggestions(
    candidates: List[HotelRecommendation],
    *,
    budget_style: str = "moderate",
    preferred_amenities: Optional[List[str]] = None,
) -> List[CategorizedHotelSuggestion]:
    """Pick up to three distinct categorized suggestions from candidate hotels.

    Returns fewer than three when there aren't enough distinct candidates, and
    omits Best Points entirely when no candidate is points-payable. Falls back
    to the closest over-budget option (with a risk note) when nothing fits.
    """
    preferred_amenities = preferred_amenities or []
    if not candidates:
        return []

    feasible = [c for c in candidates if c.fits_budget] or list(candidates)
    points_payable = [c for c in feasible if c.recommended_payment == "points" and c.redemption_value_cpp]

    # Category selectors: (key, pool, sort_key) — sort_key returns a value where
    # the MAX is best, so all selectors are framed as "higher is better".
    selectors = [
        (CAT_BEST_VALUE, feasible, lambda r: (-_effective_oop(r), _quality_score(r, preferred_amenities))),
        (CAT_BEST_POINTS, points_payable, lambda r: (r.redemption_value_cpp or 0.0)),
        (CAT_BEST_STAY, feasible, lambda r: _quality_score(r, preferred_amenities)),
    ]

    used_ids: set[str] = set()
    suggestions: List[CategorizedHotelSuggestion] = []

    for category, pool, key in selectors:
        # Best not-yet-used candidate in this pool.
        ranked = sorted(pool, key=key, reverse=True)
        pick = next((r for r in ranked if r.hotel_id not in used_ids), None)
        if pick is None:
            continue
        used_ids.add(pick.hotel_id)
        others = [c for c in candidates if c.hotel_id != pick.hotel_id]
        suggestions.append(CategorizedHotelSuggestion(
            category=category,
            label=HOTEL_CATEGORY_LABELS[category],
            recommendation=pick,
            why_this_option=_why(pick, category),
            tradeoffs=_tradeoffs(pick, category, others),
            risks=_risks(pick),
            score=round(_composite(pick, budget_style, preferred_amenities), 4),
        ))

    return suggestions
