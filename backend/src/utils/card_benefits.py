"""
Card benefits for travel optimization.

Uses live web search (SerpAPI) + OpenAI extraction for up-to-date credit card
benefits (e.g. free checked bags on specific airlines). Falls back to OpenAI-only
when SerpAPI is unavailable. No static map—data comes from APIs you configure:

- SERPAPI_KEY or SERP_API_KEY: Google organic search for current benefit snippets
- OPENAI_ADMIN_KEY: extract structured benefits from snippets, or infer from model when no snippets
"""

import logging
import os
import re
from typing import Dict, List, Optional, Set

from .airline_utils import infer_airline_from_flight_number

logger = logging.getLogger(__name__)

# In-memory cache for final extracted benefits (avoids repeated SerpAPI+OpenAI per process)
_benefits_cache: Dict[str, Dict] = {}


def _normalize_card_name(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[®™]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def get_benefits_for_card(
    card_product: Optional[str],
    program: Optional[str] = None,
    *,
    use_serp: bool = True,
    use_openai: bool = True,
) -> Dict:
    """
    Get benefits for a card from live sources. Returns dict with:
      - free_bag_airlines: List[str] IATA codes (e.g. ["DL","AA"])
      - applies_to_reservation: bool (everyone on booking when cardholder pays)

    Sources (in order):
      1. SerpAPI organic search ("{card} credit card benefits free checked bag") -> snippets
         -> OpenAI extracts free_bag_airlines, applies_to_reservation from snippets. (Requires SERPAPI_KEY or SERP_API_KEY + OPENAI_ADMIN_KEY.)
      2. OpenAI only from model knowledge. (Requires OPENAI_ADMIN_KEY. Less up-to-date than 1.)
      3. Empty if both unavailable.

    If card_product is missing/empty, returns empty benefits.
    """
    out = {"free_bag_airlines": [], "applies_to_reservation": False}
    if not card_product or not str(card_product).strip():
        return out

    key = _normalize_card_name(card_product)
    if not key:
        return out

    # Check in-memory cache
    cached = _benefits_cache.get(key)
    if cached is not None:
        return cached

    serp_key = os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")
    openai_key = os.getenv("OPENAI_ADMIN_KEY")

    # 1) SerpAPI + OpenAI: up-to-date from web snippets
    if use_serp and serp_key and use_openai and openai_key:
        try:
            from ..handlers.serp_client import organic_search
            from ..handlers.openAI import extract_card_benefits_from_snippets

            query = f'"{card_product}" credit card benefits free checked bag'
            snippets = organic_search(query, num=8)
            if snippets:
                b = extract_card_benefits_from_snippets(card_product, snippets)
                if b:
                    _benefits_cache[key] = b
                    return b
        except Exception as e:
            logger.debug("get_benefits SerpAPI+OpenAI path failed for %s: %s", card_product, e)

    # 2) OpenAI-only fallback (model knowledge; may be less current)
    if use_openai and openai_key:
        try:
            from ..handlers.openAI import get_card_benefits_openai

            b = get_card_benefits_openai(card_product)
            if b:
                _benefits_cache[key] = b
                return b
        except Exception as e:
            logger.debug("get_benefits OpenAI fallback failed for %s: %s", card_product, e)

    return out


def build_benefit_airlines_for_travelers(
    traveler_profiles: Dict[str, Dict],
) -> Dict[str, Set[str]]:
    """
    For each traveler (user_id -> profile with credit_cards), build
    benefit_airlines[user_id] = set of IATA codes where they have free bag.
    """
    result: Dict[str, Set[str]] = {}
    for user_id, profile in (traveler_profiles or {}).items():
        airlines: Set[str] = set()
        cards = profile.get("credit_cards") or []
        for c in cards:
            name = c.get("card_product") or c.get("card_name") or ""
            if not name:
                continue
            b = get_benefits_for_card(name, c.get("program"))
            for iata in b.get("free_bag_airlines") or []:
                if iata and len(iata) >= 2:
                    airlines.add(str(iata).upper()[:2])
        result[user_id] = airlines
    return result


def build_edge_to_airline(edges_dict: Dict) -> Dict:
    """
    Build mapping edge -> IATA operating airline.
    edge = (dep, arr, fn). Uses operating_airline, points_program, or infers from fn.
    Skips bus/car edges (fn in BUS, CAR or mode in bus, car) so they are not treated as airlines.
    """
    out = {}
    for e, d in (edges_dict or {}).items():
        if not isinstance(e, (list, tuple)) or len(e) < 3:
            continue
        dep, arr, fn = e[0], e[1], e[2]
        if str(fn).upper() in ("BUS", "CAR") or str(d.get("mode") or "").lower() in ("bus", "car"):
            continue
        al = (d.get("operating_airline") or d.get("points_program") or "")
        if al and isinstance(al, str) and len(al) >= 2:
            out[e] = str(al).strip().upper()[:2]
        else:
            inferred = infer_airline_from_flight_number(fn)
            if inferred:
                out[e] = inferred
    return out
