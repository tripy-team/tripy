"""
Quick test: scrape NerdWallet and print current transfer bonuses.

Usage:
    cd backend
    python test_transfer_bonuses.py
"""

import asyncio
import sys
from pathlib import Path

# Ensure src imports work
sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.services.transfer_bonus_scraper import (
    refresh_bonuses,
    get_active_bonuses,
    get_ilp_transfer_bonuses,
    get_cache_info,
)


async def main():
    print("=" * 70)
    print("  Transfer Bonus Scraper — Live Test")
    print("=" * 70)
    print()
    print("Scraping NerdWallet...")
    print()

    all_records = await refresh_bonuses()

    if not all_records:
        print("No bonuses parsed from NerdWallet page.")
        print("The page structure may have changed, or the request failed.")
        return

    # Show everything that was parsed
    print(f"Parsed {len(all_records)} bonus record(s):\n")
    print(f"  {'Bank':<16} {'Program':<10} {'Bonus':>6}   {'Start':<12} {'End':<12} {'Active':<7} {'Source'}")
    print(f"  {'-'*16} {'-'*10} {'-'*6}   {'-'*12} {'-'*12} {'-'*7} {'-'*30}")

    for b in all_records:
        start = b.start_date.isoformat() if b.start_date else "—"
        end = b.end_date.isoformat() if b.end_date else "—"
        active = "YES" if b.is_active else "no"
        print(
            f"  {b.bank_code:<16} {b.program_code:<10} {b.bonus_pct:>5.0f}%   "
            f"{start:<12} {end:<12} {active:<7} "
            f"{b.bank_display} → {b.program_display}"
        )

    # Show active-only summary
    active = get_active_bonuses()
    print(f"\nActive right now: {len(active)} bonus(es)\n")

    # Show ILP format
    ilp = get_ilp_transfer_bonuses()
    if ilp:
        print("ILP multipliers (what the optimizer sees):\n")
        for (bank, prog), mult in sorted(ilp.items()):
            pct = (mult - 1) * 100
            print(f"  ({bank!r}, {prog!r}): {mult:.2f}  (+{pct:.0f}%)")
    else:
        print("No active ILP multipliers.")

    # Cache info
    info = get_cache_info()
    print(f"\nCache: {info}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
