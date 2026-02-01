from __future__ import annotations

from typing import Any


def _is_negative_number(x: Any) -> bool:
    # bool is a subclass of int; do not treat booleans as numbers here.
    if isinstance(x, bool):
        return False
    return isinstance(x, (int, float)) and x < 0


def find_negative_numbers(obj: Any, path: str = "") -> list[tuple[str, float]]:
    """
    Traverse nested dict/list/tuple structures and return a list of (path, value)
    for any negative numeric values.

    Path format:
    - dict keys use dot notation: "a.b.c"
    - list/tuple indices use bracket notation: "a.items[0].price"
    - root scalar negative uses "<root>"
    """
    results: list[tuple[str, float]] = []

    if _is_negative_number(obj):
        results.append((path or "<root>", float(obj)))
        return results

    if isinstance(obj, dict):
        for k, v in obj.items():
            key = str(k)
            child_path = key if not path else f"{path}.{key}"
            results.extend(find_negative_numbers(v, child_path))
        return results

    if isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            child_path = f"{path}[{i}]" if path else f"[{i}]"
            results.extend(find_negative_numbers(v, child_path))
        return results

    return results


def assert_no_negative_numbers(obj: Any, context: str = "") -> None:
    negatives = find_negative_numbers(obj)
    if not negatives:
        return

    header = "Negative numeric values detected"
    if context:
        header += f" ({context})"

    lines = [header, ""]
    for p, v in negatives:
        lines.append(f"- {p}: {v}")

    raise ValueError("\n".join(lines))

