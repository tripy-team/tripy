from __future__ import annotations

from typing import Any

from src.contracts.validate import find_negative_numbers

SNAPSHOT_VERSION = 1
REQUIRED_KEYS = ["snapshot_version", "itinerary_id", "segments"]


def normalize_snapshot(snapshot: Any) -> dict:
    """
    Normalize snapshot keys across camelCase/snake_case variants.

    This codebase historically persisted itinerary snapshots in camelCase because the
    frontend sends `SoloRankedItinerary` objects directly. We normalize to include
    BOTH snake_case and camelCase aliases for the core fields so downstream code can
    safely depend on them.
    """
    if not isinstance(snapshot, dict):
        snapshot = {}

    out = dict(snapshot)

    # version
    version = (
        out.get("snapshot_version")
        or out.get("snapshotVersion")
        or SNAPSHOT_VERSION
    )
    try:
        version = int(version)
    except Exception:
        version = SNAPSHOT_VERSION

    out["snapshot_version"] = version
    out["snapshotVersion"] = version

    # itinerary id
    itin_id = (
        out.get("itinerary_id")
        or out.get("itineraryId")
        or out.get("id")
    )
    if itin_id is not None:
        out["itinerary_id"] = str(itin_id)
        out["itineraryId"] = str(itin_id)

    return out


def validate_snapshot(snapshot: Any) -> list[str]:
    """
    Validate that a snapshot is safe to persist and safe to use for booking guide generation.
    Returns list of human-readable error strings.
    """
    errors: list[str] = []
    if not isinstance(snapshot, dict):
        return ["snapshot must be an object/dict"]

    for k in REQUIRED_KEYS:
        if k not in snapshot or snapshot.get(k) in (None, "", []):
            errors.append(f"missing required key: {k}")

    # segments
    segments = snapshot.get("segments")
    if "segments" in snapshot:
        if not isinstance(segments, list):
            errors.append("segments must be a list")
        elif len(segments) == 0:
            errors.append("segments must be non-empty")

    # numeric contract - check for negative numbers
    # Certain fields are allowed to be negative:
    # - cashSaved: can be negative when trip cost exceeds budget (meaning user "lost" money vs paying cash)
    # - savings*: savings metrics can be negative when trip exceeds budget
    ALLOWED_NEGATIVE_PATTERNS = (
        "cashSaved", "cash_saved",
        "savingsAmount", "savings_amount",
        "savings", "Savings",
    )
    
    negatives = find_negative_numbers(snapshot)
    # Filter out allowed negative paths
    filtered_negatives = [
        (path, val) for path, val in negatives
        if not any(allowed in path for allowed in ALLOWED_NEGATIVE_PATTERNS)
    ]
    
    if filtered_negatives:
        errors.append(
            "negative numeric values detected: "
            + ", ".join([p for p, _ in filtered_negatives[:10]])
        )

    return errors

