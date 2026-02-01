from __future__ import annotations

from typing import Any


def is_sentinel_number(x: Any) -> bool:
    """
    Sentinel number contract:
    - only applies to numeric (int/float) values
    - negative values are considered sentinel/invalid

    Note: bool is a subclass of int in Python; we explicitly exclude it.
    """
    if isinstance(x, bool):
        return False
    if isinstance(x, (int, float)):
        return x < 0
    return False


def scrub_sentinels(obj: Any) -> Any:
    """
    Deep-walk dict/list (and tuples) and replace sentinel numbers (< 0) with None.

    - Preserves other scalar types unchanged.
    - Preserves container type for dict/list/tuple.
    """
    if is_sentinel_number(obj):
        return None

    if isinstance(obj, dict):
        return {k: scrub_sentinels(v) for k, v in obj.items()}

    if isinstance(obj, list):
        return [scrub_sentinels(v) for v in obj]

    if isinstance(obj, tuple):
        return tuple(scrub_sentinels(v) for v in obj)

    return obj

