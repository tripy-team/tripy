# backend/time_utils.py
import re
from typing import Optional, Any

_HOUR_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\s+(\d{2}):\d{2}\b")


def extract_hour(dt_str: str) -> Optional[int]:
    m = _HOUR_RE.search(dt_str or "")
    return int(m.group(1)) if m else None


def to_minutes(duration_val: Any) -> Optional[int]:
    if duration_val is None:
        return None
    if isinstance(duration_val, int):
        return duration_val
    s = str(duration_val).lower()
    h = m = 0
    hm = re.search(r"(\d+)\s*h", s)
    if hm:
        h = int(hm.group(1))
    mm = re.search(r"(\d+)\s*m", s)
    if mm:
        m = int(mm.group(1))
    if not hm and not mm:
        try:
            return int(float(s))
        except Exception:
            return None
    return h * 60 + m


def hour_bucket(hour: Optional[int], window_hours: int = 3) -> Optional[str]:
    if hour is None:
        return None
    start = (hour // window_hours) * window_hours
    end = min(23, start + window_hours)
    return f"{start},{end}"
