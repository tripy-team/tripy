#!/usr/bin/env python3
"""Find flights ITH → CDG for tomorrow via serp_award_flights."""
import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

_dir = Path(__file__).resolve().parent
tomorrow = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
print(f"ITH → CDG on {tomorrow}\n", flush=True)
rc = subprocess.run(
    [
        sys.executable,
        str(_dir / "serp_award_flights.py"),
        "--origin", "ITH",
        "--destination", "CDG",
        "--date", tomorrow,
        "--programs", "UA,DL,AA",
        "--cabins", "Economy",
        "--pax", "1",
    ],
    cwd=str(_dir),
    env=os.environ,
)
sys.exit(rc.returncode)
