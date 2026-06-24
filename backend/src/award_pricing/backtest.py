"""
Backtest harness — the P3.5 gate (see docs/AWARD_POINTS_EXACT_PRICING_PLAN.md §8).

Spot-compares the self-hosted engine against LIVE AwardTool on a sample of routes
and reports per-program median error %. This is what makes the "should we scrape
program X?" decision data-driven instead of a guess:

  - Chart programs should show ~0% error (proves bookable-exact).
  - Dynamic programs' error tells you whether the free cash-derived estimate is
    good enough, or whether that specific program needs a P4 scraper.

Dev-only: requires a real AWARDTOOL_API_KEY in the environment. Never run in prod.

    python -m src.award_pricing.backtest                 # default sample
    python -m src.award_pricing.backtest --threshold 15  # flag programs >15% err
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import statistics
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# (origin, destination, date, cabins) — small, representative sample.
DEFAULT_ROUTES: List[Tuple[str, str, str, List[str]]] = [
    ("JFK", "LHR", "2026-03-08", ["Economy", "Business"]),
    ("LHR", "CDG", "2026-03-08", ["Economy", "Business"]),
    ("SEA", "LHR", "2026-03-08", ["Economy", "Business"]),
    ("SFO", "NRT", "2026-03-08", ["Economy", "Business"]),
    ("JFK", "LAX", "2026-03-08", ["Economy"]),
    ("LAX", "SYD", "2026-03-08", ["Economy", "Business"]),
]

DEFAULT_PROGRAMS = ["BA", "AS", "AC", "NH", "VS", "UA", "AA", "DL"]


def _index_by_program_cabin(rows: List[Dict[str, Any]]) -> Dict[Tuple[str, str], int]:
    """Cheapest award_points per (program, cabin)."""
    out: Dict[Tuple[str, str], int] = {}
    for r in rows:
        prog = (r.get("program_code") or r.get("airline_code") or "").upper()
        cabin = (r.get("cabin") or "").strip().lower()
        pts = r.get("award_points")
        if not prog or pts is None:
            continue
        key = (prog, cabin)
        if key not in out or pts < out[key]:
            out[key] = int(pts)
    return out


async def _live_awardtool(origin, dest, date, cabins, pax, programs, api_key) -> List[Dict[str, Any]]:
    from src.handlers.awardtool_v2 import (
        search_award_flights_v2,
        convert_v2_result_to_v1_format,
    )

    result = await search_award_flights_v2(
        origin=origin, destination=dest, date=date,
        cabins=cabins, pax=pax, programs=programs, api_key=api_key,
    )
    return convert_v2_result_to_v1_format(result).get("data", [])


def run_backtest(
    routes: Optional[list] = None,
    programs: Optional[list] = None,
    pax: int = 1,
) -> Dict[str, Any]:
    """Returns {per_program: {error_pct, n, samples}, routes: [...]}."""
    from src.award_pricing import search_award_flights

    api_key = os.environ.get("AWARDTOOL_API_KEY") or os.environ.get("AWARD_TOOL_API_KEY")
    if not api_key:
        raise RuntimeError("Backtest needs a live AWARDTOOL_API_KEY in the environment.")

    routes = routes or DEFAULT_ROUTES
    programs = programs or DEFAULT_PROGRAMS

    errors_by_program: Dict[str, List[float]] = defaultdict(list)
    sources_by_program: Dict[str, str] = {}
    route_reports: List[Dict[str, Any]] = []

    for origin, dest, date, cabins in routes:
        engine_body = search_award_flights(origin, dest, date, cabins, programs, pax)
        engine_idx = _index_by_program_cabin(engine_body.get("data", []))
        engine_src = {
            (r.get("program_code") or "").upper(): r.get("source")
            for r in engine_body.get("data", [])
        }

        live_rows = asyncio.run(
            _live_awardtool(origin, dest, date, cabins, pax, programs, api_key)
        )
        live_idx = _index_by_program_cabin(live_rows)

        pairs = []
        for key, live_pts in live_idx.items():
            if key not in engine_idx or live_pts <= 0:
                continue
            prog, cabin = key
            eng_pts = engine_idx[key]
            err = abs(eng_pts - live_pts) / live_pts * 100.0
            errors_by_program[prog].append(err)
            sources_by_program[prog] = engine_src.get(prog, "?")
            pairs.append({
                "program": prog, "cabin": cabin,
                "engine": eng_pts, "live": live_pts, "error_pct": round(err, 1),
                "source": engine_src.get(prog),
            })
        route_reports.append({"route": f"{origin}-{dest}", "date": date, "pairs": pairs})

    per_program = {}
    for prog, errs in sorted(errors_by_program.items()):
        per_program[prog] = {
            "median_error_pct": round(statistics.median(errs), 1),
            "max_error_pct": round(max(errs), 1),
            "n": len(errs),
            "source": sources_by_program.get(prog),
        }

    return {"per_program": per_program, "routes": route_reports}


def main():
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser(description="Backtest the AwardPricingEngine vs live AwardTool.")
    ap.add_argument("--threshold", type=float, default=15.0,
                    help="Flag programs whose median error exceeds this %% as scraper candidates.")
    ap.add_argument("--json", action="store_true", help="Emit full JSON report.")
    args = ap.parse_args()

    report = run_backtest()
    if args.json:
        print(json.dumps(report, indent=2))
        return

    print("\n=== AwardPricingEngine backtest (engine vs live AwardTool) ===\n")
    print(f"{'PROGRAM':8} {'SOURCE':13} {'MEDIAN ERR':>10} {'MAX ERR':>8} {'N':>4}   VERDICT")
    print("-" * 64)
    for prog, s in report["per_program"].items():
        verdict = "OK"
        if s["source"] == "chart" and s["median_error_pct"] > 1.0:
            verdict = "CHART DRIFT — re-verify chart"
        elif s["median_error_pct"] > args.threshold:
            verdict = f"SCRAPER CANDIDATE (>{args.threshold:.0f}%)"
        print(f"{prog:8} {str(s['source']):13} {s['median_error_pct']:>9.1f}% "
              f"{s['max_error_pct']:>7.1f}% {s['n']:>4}   {verdict}")
    print("\nChart programs should be ~0%. Dynamic programs over the threshold are the\n"
          "data-driven case for a P4 scraper (plan §5/§9).\n")


if __name__ == "__main__":
    main()
