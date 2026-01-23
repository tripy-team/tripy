# backend/serp_client.py
from itertools import chain
from typing import List, Optional, Dict, Any

try:
    from serpapi import GoogleSearch
except ImportError:
    GoogleSearch = None


def search(params: Dict[str, Any]) -> Dict[str, Any]:
    if GoogleSearch is None:
        raise ImportError("serpapi package is not installed. Install it with: pip install google-search-results")
    return GoogleSearch(params).get_dict()


def collect_items(res: dict) -> List[dict]:
    return list(
        chain(res.get("best_flights", []) or [], res.get("other_flights", []) or [])
    )


def pick_cheapest(items: List[dict]) -> Optional[dict]:
    if not items:
        return None
    priced = [it for it in items if isinstance(it.get("price"), (int, float))]
    return min(priced, key=lambda it: it["price"]) if priced else items[0]
