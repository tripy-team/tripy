# backend/tpg_valuations.py
import requests, re
from typing import Dict, Optional
from bs4 import BeautifulSoup
try:
    from ..utils.cache_layer import get_json as get_tpg_cache
except ImportError:
    # Fallback if cache_layer doesn't have get_json
    def get_tpg_cache(key: str):
        return None

TPG_VALUATIONS_URL = "https://thepointsguy.com/loyalty-programs/monthly-valuations/"
HEADERS_TPG = {"User-Agent": "Mozilla/5.0 (compatible; TripyBot/1.0)"}


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _num(val: str) -> Optional[float]:
    m = re.search(r"(\d+(?:\.\d+)?)", (val or "").replace(",", ""))
    return float(m.group(1)) if m else None


def fetch_tpg_valuations(force: bool = False) -> Dict[str, float]:
    cache = get_tpg_cache()
    if not force:
        cached = cache.get_vals()
        if cached:
            return cached

    resp = requests.get(TPG_VALUATIONS_URL, headers=HEADERS_TPG, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    vals: Dict[str, float] = {}
    for table in soup.find_all("table"):
        headers = [_clean(th.get_text()) for th in table.find_all("th")]
        if not headers:
            continue
        h = " ".join(x.lower() for x in headers)
        if "program" in h and ("valuation" in h or "cents" in h):
            for tr in table.find_all("tr"):
                tds = tr.find_all(["td", "th"])
                if len(tds) < 2:
                    continue
                p = _clean(tds[0].get_text())
                v = _num(_clean(tds[1].get_text()))
                if p and v is not None:
                    vals[p] = v
    cache.put_vals(vals)
    return vals
