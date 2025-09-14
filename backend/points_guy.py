import re
import time
import math
import requests
from bs4 import BeautifulSoup
from typing import Dict, Optional, Tuple

TPG_VALUATIONS_URL = "https://thepointsguy.com/loyalty-programs/monthly-valuations/"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TripyBot/1.0; +https://example.com/bot)"
}

# Common aliases -> TPG program names on the valuations page
ALIASES = {
    # Flexible / credit-card currencies
    "UR": "Chase Ultimate Rewards",
    "MR": "American Express Membership Rewards",
    "C1": "Capital One",
    "Citi": "Citi ThankYou Rewards",
    "Bilt": "Bilt Rewards",
    # Major airlines
    "AA": "American Airlines AAdvantage",
    "United": "United MileagePlus",
    "UA": "United MileagePlus",
    "Delta": "Delta SkyMiles",
    "DL": "Delta SkyMiles",
    "JetBlue": "JetBlue TrueBlue",
    "Avios": "Avios",
    "Aeroplan": "Air Canada Aeroplan",
    "FlyingBlue": "Flying Blue",
    "KrisFlyer": "Singapore Airlines KrisFlyer",
    "Qantas": "Qantas Frequent Flyer",
    "Southwest": "Southwest Rapid Rewards",
    "Turkish": "Turkish Airlines Miles&Smiles",
    "Virgin Atlantic": "Virgin Atlantic Flying Club",
    # Hotels (add as needed)
    "Hyatt": "World of Hyatt",
    "Marriott": "Marriott Bonvoy",
    "Hilton": "Hilton Honors",
}


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _parse_cents(val: str) -> Optional[float]:
    """
    Accept '2.05', '2.05¢', '2', '1.3 (up from 1.2)', etc. -> float cents value.
    """
    if not val:
        return None
    m = re.search(r"(\d+(?:\.\d+)?)", val.replace(",", ""))
    return float(m.group(1)) if m else None


def fetch_tpg_valuations(timeout=20, cache_buster=False) -> Dict[str, float]:
    """
    Scrape TPG's monthly valuations and return {program_name: cents_per_point}.
    """
    url = TPG_VALUATIONS_URL
    if cache_buster:
        url += f"?t={int(time.time())}"

    resp = requests.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    valuations: Dict[str, float] = {}

    # Prefer parsing tables with a 'Program' header and a 'valuation' column.
    for table in soup.find_all("table"):
        headers = [_clean_text(th.get_text()) for th in table.find_all("th")]
        if not headers:
            continue
        # Heuristic: tables that include a "Program" column and a "valuation" column
        header_str = " ".join(h.lower() for h in headers)
        if "program" in header_str and (
            "valuation" in header_str or "cents" in header_str
        ):
            for tr in table.find_all("tr"):
                tds = tr.find_all(["td", "th"])
                if len(tds) < 2:
                    continue
                program = _clean_text(tds[0].get_text())
                val_txt = _clean_text(tds[1].get_text())
                cents = _parse_cents(val_txt)
                if program and cents is not None:
                    valuations[program] = cents

    # Fallback: scan key sections if tables weren’t detected
    if not valuations:
        text = _clean_text(soup.get_text(" "))
        # Look for "... ProgramName ... 2.05 ..." near each program name
        # Add more program names here if needed.
        candidates = [
            "American Express Membership Rewards",
            "Capital One",
            "Chase Ultimate Rewards",
            "Citi ThankYou Rewards",
            "Wells Fargo Rewards",
            "Bilt Rewards",
            "United MileagePlus",
            "Delta SkyMiles",
            "American Airlines AAdvantage",
            "JetBlue TrueBlue",
            "Avios",
            "Air Canada Aeroplan",
            "Flying Blue",
            "Singapore Airlines KrisFlyer",
            "Qantas Frequent Flyer",
            "Southwest Rapid Rewards",
            "Spirit Airlines Free Spirit",
            "Turkish Airlines Miles&Smiles",
            "Virgin Atlantic Flying Club",
            "World of Hyatt",
            "Marriott Bonvoy",
            "Hilton Honors",
        ]
        for name in candidates:
            # capture a number within ~40 characters after the name
            m = re.search(
                re.escape(name) + r".{0,40}?(\d+(?:\.\d+)?)", text, flags=re.I
            )
            if m:
                valuations[name] = float(m.group(1))

    if not valuations:
        raise RuntimeError("Could not extract valuations from TPG page.")

    return valuations


def resolve_program_name(program: str, valuations: Dict[str, float]) -> Optional[str]:
    """
    Try exact, alias, and fuzzy contains match to map an input program to a key in valuations.
    """
    if program in valuations:
        return program
    if program in ALIASES and ALIASES[program] in valuations:
        return ALIASES[program]
    # try case-insensitive exact
    for k in valuations.keys():
        if k.lower() == program.lower():
            return k
    # try contains (both ways)
    for k in valuations.keys():
        if program.lower() in k.lower() or k.lower() in program.lower():
            return k
    return None


def points_value_cpp(
    cash_price_usd: float, points: int, award_taxes_usd: float = 0.0
) -> float:
    """
    Return realized cents-per-point for a redemption.
    CPP = (cash_price - award_taxes) * 100 / points
    """
    if points <= 0:
        return math.nan
    return (max(0.0, cash_price_usd - award_taxes_usd) * 100.0) / points


def is_worth_using_points(
    program: str,
    cash_price_usd: float,
    points: int,
    award_taxes_usd: float = 0.0,
    valuations: Optional[Dict[str, float]] = None,
) -> Tuple[bool, float, float, str]:
    """
    Compare realized CPP vs TPG valuation for the program.
    Returns: (is_worth, realized_cpp, tpg_cpp, resolved_program_name)
    """
    vals = valuations or fetch_tpg_valuations()
    resolved = resolve_program_name(program, vals)
    if not resolved:
        raise KeyError(f"Program '{program}' not found in TPG valuations.")
    realized_cpp = points_value_cpp(cash_price_usd, points, award_taxes_usd)
    tpg_cpp = vals[resolved]
    return (realized_cpp >= tpg_cpp, realized_cpp, tpg_cpp, resolved)


# ------------------- example -------------------
if __name__ == "__main__":
    vals = fetch_tpg_valuations()
    ok, realized, tpg, name = is_worth_using_points(
        program="UR",  # alias -> "Chase Ultimate Rewards"
        cash_price_usd=550,  # cash ticket price
        points=30000,  # points required
        award_taxes_usd=5.6,  # award fees/taxes you'd still pay
        valuations=vals,
    )
    print(
        f"Program: {name} | Realized CPP: {realized:.2f}¢ vs TPG: {tpg:.2f}¢ -> Worth? {ok}"
    )
