# awardtool_delta_scraper.py
# Usage: python awardtool_delta_scraper.py
# (or pass your URL as an arg)

import re
import sys
from typing import List, Dict, Any, Optional

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

AWARD_URL = (
    sys.argv[1]
    if len(sys.argv) > 1
    else "https://www.awardtool.com/flight?flightWay=oneway&pax=1&children=0&cabins=Economy&range=true&rangeV2=false&from=SEA&to=MCO&programs=DL&targetId=&oneWayRangeStartDate=1760770800&oneWayRangeEndDate=1760770800"
)

AMEX_GUIDE_URL = "https://www.awardtool.com/guides/amextransfer"

# Text we’ll try for cookie/consent banners (AwardTool shows a “Privacy Manager”)
CONSENT_BUTTON_TEXTS = [
    "Accept All",
    "I Accept",
    "Agree",
    "Accept",
    "Continue",
    "Got it",
]

MILES_REGEX = re.compile(
    r"\b(\d{1,3}(?:,\d{3})*|\d+)\s*(?:SkyMiles|miles|pts?|points?)\b",
    re.IGNORECASE,
)
USD_REGEX = re.compile(
    r"\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)"
)  # for taxes/fees if shown


def _click_any_consent_button(page) -> None:
    # Try in main page
    for label in CONSENT_BUTTON_TEXTS:
        try:
            btn = page.get_by_role("button", name=re.compile(label, re.I))
            if btn.count() > 0:
                btn.first.click(timeout=1500)
                return
        except PWTimeoutError:
            pass
        except Exception:
            pass
    # Try in iframes (some CMPs live in an iframe)
    for frame in page.frames:
        for label in CONSENT_BUTTON_TEXTS:
            try:
                btn = frame.get_by_role("button", name=re.compile(label, re.I))
                if btn.count() > 0:
                    btn.first.click(timeout=1500)
                    return
            except PWTimeoutError:
                pass
            except Exception:
                pass


def confirm_delta_is_amex_partner(page) -> Dict[str, Any]:
    """
    Opens AwardTool's Amex transfer guide and checks if Delta is mentioned among Amex partners.
    Returns:
      {
        "is_partner": bool,
        "evidence_snippet": Optional[str]
      }
    """
    page.goto(AMEX_GUIDE_URL, wait_until="domcontentloaded")
    _click_any_consent_button(page)

    # Let late-loading content render
    page.wait_for_timeout(2000)

    body_text = page.locator("body").inner_text(timeout=10000)

    # Heuristic: look for "American Express" or "Amex" near "Delta" / "Delta Air Lines" / "SkyMiles"
    m = re.search(
        r"(American Express|Amex).*?(Delta|Delta Air Lines|SkyMiles)|"
        r"(Delta|Delta Air Lines|SkyMiles).*?(American Express|Amex)",
        body_text,
        re.IGNORECASE | re.DOTALL,
    )

    if m:
        # Show a small snippet for proof
        start = max(m.start() - 80, 0)
        end = min(m.end() + 80, len(body_text))
        snippet = re.sub(r"\s+", " ", body_text[start:end]).strip()
        return {"is_partner": True, "evidence_snippet": snippet}

    return {"is_partner": False, "evidence_snippet": None}


def extract_miles_from_flight_results(page) -> List[Dict[str, Any]]:
    """
    Scrapes the visible flight results and extracts Delta SkyMiles award costs.
    Returns a list of dicts like:
      [{"miles": 11500, "text": "…full text snippet…", "fees_usd": 5.6}, ...]
    """
    # Common containers AwardTool (and similar SPAs) use; we try several fallbacks.
    candidate_selectors = [
        '[data-testid*="result"]',
        '[class*="result"]',
        '[class*="flight"]',
        "article",
        "li",
        "div",
    ]

    # Wait for something that contains "mile/points/pts/SkyMiles"
    page.wait_for_load_state("domcontentloaded")
    _click_any_consent_button(page)

    # Wait a bit for results to render
    page.wait_for_timeout(3500)

    # Best-effort: look through a bunch of nodes and regex the text for miles and fees
    items: List[Dict[str, Any]] = []
    seen_texts = set()

    for sel in candidate_selectors:
        loc = page.locator(sel)
        count = min(loc.count(), 80)  # cap to keep it fast
        for i in range(count):
            txt = ""
            try:
                txt = loc.nth(i).inner_text(timeout=500)
            except Exception:
                continue
            compact = re.sub(r"\s+", " ", txt).strip()
            if compact in seen_texts:
                continue
            seen_texts.add(compact)

            m_miles = MILES_REGEX.search(compact)
            if m_miles:
                miles_val = int(m_miles.group(1).replace(",", ""))
                fees_match = USD_REGEX.search(compact)
                fees_val = (
                    float(fees_match.group(1).replace(",", "")) if fees_match else None
                )
                items.append(
                    {
                        "miles": miles_val,
                        "fees_usd": fees_val,
                        "text": compact[:300],  # snippet
                    }
                )

    # Deduplicate by miles + fees
    dedup = {}
    for it in items:
        key = (it["miles"], it.get("fees_usd"))
        if key not in dedup:
            dedup[key] = it
    return list(dedup.values())


def get_delta_points_for_url(page, url: str) -> List[Dict[str, Any]]:
    page.goto(url, wait_until="domcontentloaded")
    _click_any_consent_button(page)

    # Give dynamic search a moment
    page.wait_for_timeout(4000)

    # Try to catch lazy-loaded results too
    results = extract_miles_from_flight_results(page)
    if not results:
        # Scroll to trigger any lazy rendering
        page.mouse.wheel(0, 2000)
        page.wait_for_timeout(2000)
        results = extract_miles_from_flight_results(page)
    return results


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0.0.0 Safari/537.36"
            )
        )
        page = ctx.new_page()

        # 1) Confirm Amex partner status for Delta (from AwardTool guide)
        partner_info = confirm_delta_is_amex_partner(page)

        # 2) Pull Delta miles prices from your search URL
        results = get_delta_points_for_url(page, AWARD_URL)

        browser.close()

    # Pick a simple summary: minimum miles found, plus a couple samples
    min_miles: Optional[int] = None
    if results:
        min_miles = min(r["miles"] for r in results)

    print("\n=== Partner Check (AwardTool) ===")
    print(f"Delta is Amex partner? {partner_info['is_partner']}")
    if partner_info["evidence_snippet"]:
        print(f"Evidence: …{partner_info['evidence_snippet']}…")

    print("\n=== Delta SkyMiles award prices (from your URL) ===")
    if not results:
        print("No award prices found on the page (selectors may need an update).")
    else:
        print(f"Found {len(results)} prices; min miles: {min_miles}")
        for r in results[:5]:
            print(
                f"- {r['miles']} miles"
                + (f" (+${r['fees_usd']:.2f} fees)" if r["fees_usd"] else "")
                + f" | snippet: {r['text']}"
            )


if __name__ == "__main__":
    main()
