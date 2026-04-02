"""
Proprietary Preference Graph (Feature 13)

Learns from advisor behavior to personalize recommendations over time.
MVP implementation: signal logging + frequency-based heuristic weights.
ML-based learning deferred until sufficient data volume.
"""
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

PREFERENCE_SIGNALS_TABLE = "tripy-preference-signals"
MIN_SIGNALS_FOR_INFERENCE = 5


def _get_signals_table():
    from src.repos.ddb import table
    table_name = os.environ.get("PREFERENCE_SIGNALS_TABLE", PREFERENCE_SIGNALS_TABLE)
    return table(table_name)


def record_signal(
    org_id: str,
    advisor_id: str,
    signal_type: str,
    context: Dict[str, Any],
    signal_data: Dict[str, Any],
    client_id: Optional[str] = None,
) -> None:
    """
    Record a preference signal.

    Signal types:
    - selected_option: advisor chose a specific recommendation
    - rejected_option: advisor dismissed an option
    - edited_before_share: advisor modified output before sharing
    - copilot_instruction: natural language refinement instruction
    - constraint_override: advisor overrode a default constraint
    - client_preference_set: advisor explicitly set a client preference
    """
    now = datetime.now(timezone.utc)
    signal_id = f"sig_{uuid.uuid4().hex[:12]}"
    timestamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    item = {
        "orgId": org_id,
        "timestampSignalId": f"{timestamp}#{signal_id}",
        "signalId": signal_id,
        "advisorId": advisor_id,
        "clientId": client_id or "",
        "signalType": signal_type,
        "context": json.dumps(context),
        "signalData": json.dumps(signal_data),
        "createdAt": timestamp,
    }

    try:
        from src.repos.ddb import put_item, sanitize_for_dynamodb
        t = _get_signals_table()
        put_item(t, sanitize_for_dynamodb(item))
    except Exception as e:
        logger.warning(f"Failed to record preference signal: {e}")


def get_preference_weights(
    org_id: str,
    advisor_id: Optional[str] = None,
    client_id: Optional[str] = None,
) -> Dict[str, float]:
    """
    Compute preference weights from historical signals.

    Returns a dict of weight adjustments to apply to the optimizer:
    - nonstop_preference: 0.0-1.0 (how often nonstop was chosen)
    - luxury_preference: 0.0-1.0 (how often premium cabins were chosen)
    - cost_sensitivity: 0.0-1.0 (how often cheapest option was chosen)
    - points_preference: 0.0-1.0 (how often points strategy was preferred)
    - self_transfer_tolerance: 0.0-1.0 (how often self-transfers were accepted)
    """
    default_weights = {
        "nonstop_preference": 0.5,
        "luxury_preference": 0.5,
        "cost_sensitivity": 0.5,
        "points_preference": 0.5,
        "self_transfer_tolerance": 0.3,
    }

    try:
        signals = _query_signals(org_id, advisor_id, client_id, limit=100)
    except Exception as e:
        logger.warning(f"Failed to query preference signals: {e}")
        return default_weights

    if len(signals) < MIN_SIGNALS_FOR_INFERENCE:
        return default_weights

    return _compute_weights(signals, default_weights)


def _query_signals(
    org_id: str,
    advisor_id: Optional[str],
    client_id: Optional[str],
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Query preference signals from DynamoDB."""
    try:
        from boto3.dynamodb.conditions import Key, Attr
        t = _get_signals_table()

        kwargs = {
            "KeyConditionExpression": Key("orgId").eq(org_id),
            "Limit": limit,
            "ScanIndexForward": False,
        }

        filter_parts = []
        if advisor_id:
            filter_parts.append(Attr("advisorId").eq(advisor_id))
        if client_id:
            filter_parts.append(Attr("clientId").eq(client_id))

        if filter_parts:
            combined = filter_parts[0]
            for fp in filter_parts[1:]:
                combined = combined & fp
            kwargs["FilterExpression"] = combined

        resp = t.query(**kwargs)
        items = resp.get("Items", [])

        for item in items:
            for field in ("context", "signalData"):
                raw = item.get(field, "{}")
                if isinstance(raw, str):
                    try:
                        item[field] = json.loads(raw)
                    except json.JSONDecodeError:
                        item[field] = {}

        return items
    except Exception as e:
        logger.warning(f"Failed to query signals: {e}")
        return []


def _compute_weights(
    signals: List[Dict[str, Any]],
    defaults: Dict[str, float],
) -> Dict[str, float]:
    """Compute frequency-based preference weights from signals."""
    weights = dict(defaults)

    counters = {
        "total_selections": 0,
        "nonstop_selected": 0,
        "premium_selected": 0,
        "cheapest_selected": 0,
        "points_preferred": 0,
        "self_transfer_accepted": 0,
    }

    for signal in signals:
        signal_type = signal.get("signalType", "")
        data = signal.get("signalData", {})

        if signal_type == "selected_option":
            counters["total_selections"] += 1

            category = data.get("category", "")
            if category == "lowest_cost":
                counters["cheapest_selected"] += 1
            elif category == "best_experience":
                counters["premium_selected"] += 1

            itinerary = data.get("itinerary", {})
            flights = itinerary.get("flights", [])
            total_stops = sum(int(f.get("stops", 0)) for f in flights)
            if total_stops == 0:
                counters["nonstop_selected"] += 1

            if itinerary.get("total_points_used", 0) > 0:
                counters["points_preferred"] += 1

            has_self_transfer = any(f.get("is_self_transfer") for f in flights)
            if has_self_transfer:
                counters["self_transfer_accepted"] += 1

        elif signal_type == "copilot_instruction":
            instruction = data.get("instruction", "").lower()
            if "nonstop" in instruction or "direct" in instruction:
                counters["nonstop_selected"] += 1
                counters["total_selections"] += 1
            if "cheap" in instruction or "budget" in instruction or "less" in instruction:
                counters["cheapest_selected"] += 1
                counters["total_selections"] += 1
            if "business" in instruction or "first" in instruction or "comfort" in instruction:
                counters["premium_selected"] += 1
                counters["total_selections"] += 1
            if "points" in instruction or "miles" in instruction:
                counters["points_preferred"] += 1
                counters["total_selections"] += 1

    total = max(counters["total_selections"], 1)
    weights["nonstop_preference"] = min(1.0, counters["nonstop_selected"] / total + 0.1)
    weights["luxury_preference"] = min(1.0, counters["premium_selected"] / total + 0.1)
    weights["cost_sensitivity"] = min(1.0, counters["cheapest_selected"] / total + 0.1)
    weights["points_preference"] = min(1.0, counters["points_preferred"] / total + 0.1)
    weights["self_transfer_tolerance"] = min(1.0, counters["self_transfer_accepted"] / total)

    return weights


def apply_weights_to_optimizer(
    optimizer_config: Dict[str, Any],
    weights: Dict[str, float],
) -> Dict[str, Any]:
    """
    Apply learned preference weights to optimizer configuration.
    These are soft adjustments — they influence scoring, not hard constraints.
    """
    config = dict(optimizer_config)

    nonstop_pref = weights.get("nonstop_preference", 0.5)
    if nonstop_pref > 0.7:
        current_penalty = float(config.get("stop_penalty_multiplier", 1.0))
        config["stop_penalty_multiplier"] = current_penalty * 1.5

    luxury_pref = weights.get("luxury_preference", 0.5)
    if luxury_pref > 0.7:
        config["prefer_premium_cabin"] = True

    cost_pref = weights.get("cost_sensitivity", 0.5)
    if cost_pref > 0.7:
        config["aggressive_cost_optimization"] = True

    st_tolerance = weights.get("self_transfer_tolerance", 0.3)
    if st_tolerance < 0.2:
        config["penalize_self_transfers"] = True

    return config
