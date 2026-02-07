# backend/src/handlers/tpg_valuations.py
"""
Fetch The Points Guy monthly valuations (cents per point) via web scrape.
Used to compute market-rate dollar value of points balances.
"""
import requests
import re
from typing import Dict, Optional

from bs4 import BeautifulSoup

try:
    from ..utils.cache_layer import get_json, set_json
except ImportError:
    try:
        from src.utils.cache_layer import get_json, set_json
    except ImportError:
        def get_json(_k):
            return None
        def set_json(_k, _v, _ttl=0):
            pass

TPG_VALUATIONS_URL = "https://thepointsguy.com/loyalty-programs/monthly-valuations/"
HEADERS_TPG = {"User-Agent": "Mozilla/5.0 (compatible; TripyBot/1.0)"}
CACHE_KEY = "tpg_valuations"
CACHE_TTL = 86400  # 24 hours

# Map our program identifiers (labels, normalized, abbreviations) -> TPG table program names
PROGRAM_TO_TPG: Dict[str, str] = {
    # Credit — our labels and common stored forms
    "Chase Ultimate Rewards": "Chase Ultimate Rewards",
    "CHASE_ULTIMATE_REWARDS": "Chase Ultimate Rewards",
    "chase": "Chase Ultimate Rewards",
    "CHASE_UR": "Chase Ultimate Rewards",
    "Amex Membership Rewards": "American Express Membership Rewards",
    "AMEX_MEMBERSHIP_REWARDS": "American Express Membership Rewards",
    "amex": "American Express Membership Rewards",
    "AMEX_MR": "American Express Membership Rewards",
    "Citi ThankYou Points": "Citi ThankYou Rewards",
    "CITI_THANKYOU_POINTS": "Citi ThankYou Rewards",
    "citi": "Citi ThankYou Rewards",
    "CITI_TYP": "Citi ThankYou Rewards",
    "Capital One Miles": "Capital One",
    "CAPITAL_ONE_MILES": "Capital One",
    "capital one": "Capital One",
    "capitalone": "Capital One",
    "C1": "Capital One",
    "Wells Fargo Points": "Wells Fargo Rewards",
    "WELLS_FARGO_POINTS": "Wells Fargo Rewards",
    "wells_fargo": "Wells Fargo Rewards",
    "Bank of America Points": "Bank of America",
    "BANK_OF_AMERICA_POINTS": "Bank of America",
    "bank_of_america": "Bank of America",
    "Discover Miles": "Discover",
    "DISCOVER_MILES": "Discover",
    "discover": "Discover",
    "US Bank Rewards": "US Bank",
    "US_BANK_REWARDS": "US Bank",
    "us_bank": "US Bank",
    "Bilt Rewards": "Bilt Rewards",
    "bilt": "Bilt Rewards",
    "BILT": "Bilt Rewards",
    # Hotels
    "Marriott Bonvoy": "Marriott Bonvoy",
    "Hilton Honors": "Hilton Honors",
    "Hyatt World of Hyatt": "World of Hyatt",
    "HYATT_WORLD_OF_HYATT": "World of Hyatt",
    "IHG Rewards": "IHG One Rewards",
    "IHG_REWARDS": "IHG One Rewards",
    "Wyndham Rewards": "Wyndham Rewards",
    "Choice Privileges": "Choice Privileges",
    "Best Western Rewards": "Best Western Rewards",
    "Accor Live Limitless": "Accor Live Limitless",
    # Airlines
    "Delta SkyMiles": "Delta SkyMiles",
    "DELTA_SKYMILES": "Delta SkyMiles",
    "DL": "Delta SkyMiles",
    "United MileagePlus": "United MileagePlus",
    "UNITED_MILEAGEPLUS": "United MileagePlus",
    "UA": "United MileagePlus",
    "American Airlines AAdvantage": "American Airlines AAdvantage",
    "AMERICAN_AIRLINES_AADVANTAGE": "American Airlines AAdvantage",
    "AA": "American Airlines AAdvantage",
    "Southwest Rapid Rewards": "Southwest Rapid Rewards",
    "Alaska Mileage Plan": "Alaska Airlines Atmos Rewards",
    "ALASKA_MILEAGE_PLAN": "Alaska Airlines Atmos Rewards",
    "AS": "Alaska Airlines Atmos Rewards",
    "JetBlue TrueBlue": "JetBlue TrueBlue",
    "JETBLUE_TRUEBLUE": "JetBlue TrueBlue",
    "B6": "JetBlue TrueBlue",
    "Spirit FreeSpirit": "Spirit Airlines Free Spirit",
    "SPIRIT_FREESPIRIT": "Spirit Airlines Free Spirit",
    "Frontier Miles": "Frontier Miles",
    "British Airways Avios": "Avios",
    "BRITISH_AIRWAYS_AVIOS": "Avios",
    "BA": "Avios",
    "Air France-KLM Flying Blue": "Flying Blue",
    "AIR_FRANCE_KLM_FLYING_BLUE": "Flying Blue",
    "AF": "Flying Blue",
    "KL": "Flying Blue",
    "Aeroplan": "Air Canada Aeroplan",
    "AC": "Air Canada Aeroplan",
    "Avianca LifeMiles": "Avianca LifeMiles",
    "Singapore Airlines KrisFlyer": "Singapore KrisFlyer",
    "SINGAPORE_AIRLINES_KRISFLYER": "Singapore KrisFlyer",
    "SQ": "Singapore KrisFlyer",
    "Qantas Frequent Flyer": "Qantas Frequent Flyer",
    "Emirates Skywards": "Emirates Skywards",
    "EK": "Emirates Skywards",
    "Cathay Pacific Asia Miles": "Cathay Asia Miles",
    "CATHAY_PACIFIC_ASIA_MILES": "Cathay Asia Miles",
    "CX": "Cathay Asia Miles",
    "Virgin Atlantic Flying Club": "Virgin Atlantic Flying Club",
    "VS": "Virgin Atlantic Flying Club",
    "Etihad Guest": "Etihad Guest",
    "EY": "Etihad Guest",
    "Turkish Airlines Miles&Smiles": "Turkish Airlines Miles&Smiles",
    "TURKISH_AIRLINES_MILES_SMILES": "Turkish Airlines Miles&Smiles",
    "TK": "Turkish Airlines Miles&Smiles",
}


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def _num(val: str) -> Optional[float]:
    m = re.search(r"(\d+(?:\.\d+)?)", (val or "").replace(",", ""))
    return float(m.group(1)) if m else None


def fetch_tpg_valuations(force: bool = False) -> Dict[str, float]:
    """Scrape TPG monthly valuations (program name -> cents per point). Cached 24h."""
    if not force:
        cached = get_json(CACHE_KEY)
        if isinstance(cached, dict) and cached:
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

    try:
        set_json(CACHE_KEY, vals, CACHE_TTL)
    except Exception:
        pass
    return vals


def get_cents_per_point(program: str, tpg_vals: Optional[Dict[str, float]] = None) -> Optional[float]:
    """Resolve our program identifier to TPG cents-per-point. Returns None if unknown."""
    if not (program or isinstance(program, str)):
        return None
    p = (program or "").strip()
    if not p:
        return None

    if tpg_vals is None:
        try:
            tpg_vals = fetch_tpg_valuations()
        except Exception:
            return None

    tpg_name = PROGRAM_TO_TPG.get(p) or PROGRAM_TO_TPG.get(p.upper()) or PROGRAM_TO_TPG.get(p.lower())
    if tpg_name and tpg_name in tpg_vals:
        return tpg_vals[tpg_name]

    # Direct match in TPG (e.g. raw label stored)
    if p in tpg_vals:
        return tpg_vals[p]
    return None


def get_valuations() -> Dict[str, float]:
    """
    Return a map from our program identifiers to cents-per-point (TPG market rate).
    Includes our labels and common aliases (e.g. Chase Ultimate Rewards, CHASE_UR, amex).
    """
    tpg = fetch_tpg_valuations()
    out: Dict[str, float] = {}
    for our_name, tpg_name in PROGRAM_TO_TPG.items():
        if tpg_name in tpg:
            out[our_name] = tpg[tpg_name]
    return out
