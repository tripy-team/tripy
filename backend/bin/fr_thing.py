# backend/award_calendar.py  (panorama calendar wrapper; no typing, no checks)
import os
import json
import requests
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

load_dotenv()

AWARD_TOOL_API_KEY = os.getenv("AWARD_TOOL_API_KEY")
AWARD_CAL_URL = "https://www.awardtool-api.com/panorama/panorama_calendar_data"


# ---------- resilient HTTP session (retry/backoff) ----------
def _make_session():
    try:
        retry = Retry(
            total=4,
            connect=3,
            read=3,
            backoff_factor=1.5,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=frozenset(["POST"]),
            raise_on_status=False,
        )
    except TypeError:
        # older urllib3: use method_whitelist
        retry = Retry(
            total=4,
            connect=3,
            read=3,
            backoff_factor=1.5,
            status_forcelist=[429, 500, 502, 503, 504],
            method_whitelist=frozenset(["POST"]),
            raise_on_status=False,
        )
    s = requests.Session()
    s.mount(
        "https://", HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=20)
    )
    s.headers.update(
        {
            "Content-Type": "application/json",
            "User-Agent": "Tripy/1.0 (+https://tripy.app)",
        }
    )
    return s


_SESSION = _make_session()

# y = economy, w = premium economy, j = business, f = first
_CABIN_KEYS = [
    ("y", "economy"),
    ("w", "premium_economy"),
    ("j", "business"),
    ("f", "first"),
]


# ---------- low-level fetch ----------
def fetch_awardtool_calendar(origin, destination, api_key=None, session=None):
    """
    Call AwardTool panorama calendar for a route like SEA-CDG.
    Returns the raw 'data' list from the API.
    """
    if api_key is None:
        api_key = AWARD_TOOL_API_KEY
    if not api_key:
        raise ValueError(
            "AWARD_TOOL_API_KEY missing; set in environment or pass api_key="
        )

    payload = {"id": f"{origin.upper()}-{destination.upper()}", "api_key": api_key}
    sess = session or _SESSION
    resp = sess.post(AWARD_CAL_URL, data=json.dumps(payload), timeout=(10, 60))
    resp.raise_for_status()
    body = resp.json()
    # API shape: {"machine": "...", "data": [ ... rows ... ]}
    return body.get("data", [])


# ---------- normalization ----------
def normalize_awardtool_calendar_row(row):
    """
    Convert one raw calendar row into a friendlier dict.

    Raw example (abridged):
      {
        "date": "2026-08-15",
        "program": "QF",
        "route": "SEA-CDG",
        "points": {
          "y": 50800, "w": None, "j": None, "f": None,
          "tax": {"y": 214.3, "w": None, "j": None, "f": None},
          "c_a": {"y": ["AY"], "w": [], "j": [], "f": []},   # carrier codes
          "c_s": {"y": 2, "w": None, "j": None, "f": None},  # seats
          "c_p": {"y": 0, "w": None, "j": None, "f": None},  # cash co-pay/flag (keep raw)
          "ss":  {"y": 1},                                    # availability flag/snapshot
          "ls":  1757017643                                   # last seen (unix)
        },
        "points_ns": {"y": None, "w": None, "j": None, "f": None, "ls": 1756530157}, # nonstop-only
        "r_ls": 1756530157
      }
    """
    date = row.get("date")
    program = (row.get("program") or "").upper()
    route = row.get("route") or ""
    points = row.get("points") or {}
    points_ns = row.get("points_ns") or {}

    cabins = {}
    for key, name in _CABIN_KEYS:
        cabins[name] = {
            "points": (
                points.get(key) if isinstance(points.get(key), (int, float)) else None
            ),
            "tax": (
                (points.get("tax") or {}).get(key)
                if isinstance((points.get("tax") or {}).get(key), (int, float))
                else None
            ),
            "airlines": (points.get("c_a") or {}).get(key) or [],
            "seats": (points.get("c_s") or {}).get(key),
            "cash_flag": (points.get("c_p") or {}).get(key),
            "available_flag": (points.get("ss") or {}).get(key),
            "nonstop_points": (
                points_ns.get(key)
                if isinstance(points_ns.get(key), (int, float))
                else None
            ),
        }

    return {
        "date": date,  # 'YYYY-MM-DD'
        "program": program,  # pricing program code (e.g., 'QF','AF','DL',...)
        "route": route,  # 'SEA-CDG'
        "cabins": cabins,  # dict by cabin name
        "last_seen": points.get("ls"),
        "nonstop_last_seen": points_ns.get("ls"),
        "route_last_seen": row.get("r_ls"),
        "raw": row,  # keep raw for debugging if needed
    }


def get_calendar_matrix(origin, destination, api_key=None, session=None):
    """
    High-level convenience: returns a list of normalized rows (one per date).
    """
    raw_rows = fetch_awardtool_calendar(
        origin, destination, api_key=api_key, session=session
    )
    return [normalize_awardtool_calendar_row(r) for r in raw_rows]


# ---------- optional utilities ----------
def filter_calendar_by_program(matrix, program_code):
    """
    Filter normalized rows by pricing program (e.g., 'AF', 'QF').
    """
    pc = (program_code or "").upper()
    return [r for r in (matrix or []) if (r.get("program") or "").upper() == pc]


def best_dates_by_cabin(
    matrix, cabin="economy", top_n=10, require_available_flag=False
):
    """
    Return top N dates with the lowest points for a given cabin.
    If require_available_flag=True, only include rows where available_flag is truthy.
    """
    rows = []
    for r in matrix or []:
        cab = (r.get("cabins") or {}).get(cabin) or {}
        pts = cab.get("points")
        avail = cab.get("available_flag")
        if pts is None:
            continue
        if require_available_flag and not avail:
            continue
        rows.append((pts, r))
    rows.sort(key=lambda t: (t[0], t[1].get("date") or ""))  # sort by points then date
    return [r for _, r in rows[: int(top_n)]]


# ---------- quick demo ----------
if __name__ == "__main__":
    # Example usage
    origin = "SEA"
    destination = "CDG"

    try:
        matrix = get_calendar_matrix(
            origin, destination
        )  # uses AWARD_TOOL_API_KEY from .env
        print(f"rows: {len(matrix)}")

        # Show first 5 normalized rows (economy)
        for row in matrix[:5]:
            eco = row["cabins"]["economy"]
            print(
                row["date"],
                row["program"],
                "economy_points:",
                eco["points"],
                "tax:",
                eco["tax"],
                "airlines:",
                ",".join(eco["airlines"]) or "-",
            )

        # Best 5 dates in economy
        print("\nBest economy dates:")
        for r in best_dates_by_cabin(matrix, "economy", top_n=5):
            eco = r["cabins"]["economy"]
            print(r["date"], r["program"], eco["points"], eco["tax"])
    except Exception as e:
        print("Error:", e)
