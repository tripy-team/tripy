"""
Group Planning Repository

DynamoDB single-table design for group planning entities.
PK: groupTripId
SK: META | TRAVELER#<id> | BALANCE#<travelerId>#<balanceId> |
    PREF#<travelerId> | LEDGER#<entryId> | SETTLEMENT#<travelerId>#<version>
GSI: ownerUserId-index
"""

import os
import logging
from typing import Optional, Dict, Any, List
from boto3.dynamodb.conditions import Key
from .ddb import table, get_item, put_item, delete_item, sanitize_for_dynamodb

logger = logging.getLogger(__name__)

TABLE_NAME = os.environ.get("GROUP_PLANNING_TABLE", "tripy-group-planning")
t = table(TABLE_NAME)

SK_META = "META"
SK_TRAVELER = "TRAVELER#"
SK_BALANCE = "BALANCE#"
SK_PREF = "PREF#"
SK_LEDGER = "LEDGER#"
SK_SETTLEMENT = "SETTLEMENT#"
SK_ASSIGNMENT = "ASSIGNMENT#"


def _query_sk_prefix(group_trip_id: str, sk_prefix: str) -> List[Dict[str, Any]]:
    """Query items by PK and SK prefix."""
    resp = t.query(
        KeyConditionExpression=(
            Key("groupTripId").eq(group_trip_id) & Key("sk").begins_with(sk_prefix)
        )
    )
    return resp.get("Items", [])


# =============================================================================
# GROUP TRIP
# =============================================================================

def put_group_trip(trip: Dict[str, Any]) -> None:
    item = {**trip, "sk": SK_META}
    put_item(t, item)


def get_group_trip(group_trip_id: str) -> Optional[Dict[str, Any]]:
    item = get_item(t, {"groupTripId": group_trip_id, "sk": SK_META})
    return item


def delete_group_trip(group_trip_id: str) -> None:
    delete_item(t, {"groupTripId": group_trip_id, "sk": SK_META})


def get_group_trips_by_owner(owner_user_id: str) -> List[Dict[str, Any]]:
    resp = t.query(
        IndexName="ownerUserId-index",
        KeyConditionExpression=Key("ownerUserId").eq(owner_user_id),
    )
    return resp.get("Items", [])


# =============================================================================
# TRAVELER PROFILE
# =============================================================================

def put_traveler_profile(group_trip_id: str, profile: Dict[str, Any]) -> None:
    traveler_id = profile["travelerId"]
    item = {**profile, "groupTripId": group_trip_id, "sk": f"{SK_TRAVELER}{traveler_id}"}
    put_item(t, item)


def get_traveler_profile(group_trip_id: str, traveler_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"groupTripId": group_trip_id, "sk": f"{SK_TRAVELER}{traveler_id}"})


def get_travelers_for_trip(group_trip_id: str) -> List[Dict[str, Any]]:
    return _query_sk_prefix(group_trip_id, SK_TRAVELER)


def delete_traveler_profile(group_trip_id: str, traveler_id: str) -> None:
    delete_item(t, {"groupTripId": group_trip_id, "sk": f"{SK_TRAVELER}{traveler_id}"})


# =============================================================================
# LOYALTY BALANCE
# =============================================================================

def put_loyalty_balance(group_trip_id: str, balance: Dict[str, Any]) -> None:
    traveler_id = balance["travelerProfileId"]
    balance_id = balance["balanceId"]
    item = {**balance, "groupTripId": group_trip_id, "sk": f"{SK_BALANCE}{traveler_id}#{balance_id}"}
    put_item(t, item)


def get_loyalty_balance(group_trip_id: str, traveler_id: str, balance_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"groupTripId": group_trip_id, "sk": f"{SK_BALANCE}{traveler_id}#{balance_id}"})


def get_balances_for_traveler(group_trip_id: str, traveler_id: str) -> List[Dict[str, Any]]:
    return _query_sk_prefix(group_trip_id, f"{SK_BALANCE}{traveler_id}#")


def get_all_balances_for_trip(group_trip_id: str) -> List[Dict[str, Any]]:
    return _query_sk_prefix(group_trip_id, SK_BALANCE)


def delete_loyalty_balance(group_trip_id: str, traveler_id: str, balance_id: str) -> None:
    delete_item(t, {"groupTripId": group_trip_id, "sk": f"{SK_BALANCE}{traveler_id}#{balance_id}"})


# =============================================================================
# CONTRIBUTION PREFERENCE
# =============================================================================

def put_contribution_preference(group_trip_id: str, pref: Dict[str, Any]) -> None:
    traveler_id = pref["travelerProfileId"]
    item = {**pref, "groupTripId": group_trip_id, "sk": f"{SK_PREF}{traveler_id}"}
    put_item(t, item)


def get_contribution_preference(group_trip_id: str, traveler_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"groupTripId": group_trip_id, "sk": f"{SK_PREF}{traveler_id}"})


def get_all_preferences_for_trip(group_trip_id: str) -> List[Dict[str, Any]]:
    return _query_sk_prefix(group_trip_id, SK_PREF)


# =============================================================================
# ITINERARY ASSIGNMENT
# =============================================================================

def put_itinerary_assignment(group_trip_id: str, assignment: Dict[str, Any]) -> None:
    assignment_id = assignment["assignmentId"]
    item = {**assignment, "groupTripId": group_trip_id, "sk": f"{SK_ASSIGNMENT}{assignment_id}"}
    put_item(t, item)


def get_assignments_for_trip(group_trip_id: str) -> List[Dict[str, Any]]:
    return _query_sk_prefix(group_trip_id, SK_ASSIGNMENT)


def _delete_sk_prefix(group_trip_id: str, sk_prefix: str) -> int:
    """Delete every item for a trip whose sort key starts with ``sk_prefix``."""
    items = _query_sk_prefix(group_trip_id, sk_prefix)
    count = 0
    with t.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={"groupTripId": group_trip_id, "sk": item["sk"]})
            count += 1
    return count


def delete_assignments_for_trip(group_trip_id: str) -> int:
    """Remove prior itinerary assignments so a re-optimization fully replaces
    them (rather than accumulating stale, duplicate flight/hotel rows)."""
    return _delete_sk_prefix(group_trip_id, SK_ASSIGNMENT)


# =============================================================================
# CONTRIBUTION LEDGER
# =============================================================================

def put_ledger_entry(group_trip_id: str, entry: Dict[str, Any]) -> None:
    entry_id = entry["entryId"]
    item = {**entry, "groupTripId": group_trip_id, "sk": f"{SK_LEDGER}{entry_id}"}
    put_item(t, item)


def get_ledger_for_trip(group_trip_id: str) -> List[Dict[str, Any]]:
    return _query_sk_prefix(group_trip_id, SK_LEDGER)


def delete_ledger_for_trip(group_trip_id: str) -> int:
    """Remove prior contribution-ledger entries before a re-optimization writes
    fresh ones (keeps them in sync with the replaced assignments)."""
    return _delete_sk_prefix(group_trip_id, SK_LEDGER)


# =============================================================================
# SETTLEMENT SUMMARY
# =============================================================================

def put_settlement_summary(group_trip_id: str, summary: Dict[str, Any]) -> None:
    traveler_id = summary["travelerProfileId"]
    version = summary.get("calculationVersion", 1)
    item = {**summary, "groupTripId": group_trip_id, "sk": f"{SK_SETTLEMENT}{traveler_id}#{version}"}
    put_item(t, item)


def get_settlements_for_trip(group_trip_id: str) -> List[Dict[str, Any]]:
    return _query_sk_prefix(group_trip_id, SK_SETTLEMENT)


# =============================================================================
# BULK DELETE (for group trip cleanup)
# =============================================================================

def delete_all_for_trip(group_trip_id: str) -> int:
    """Delete all items for a group trip. Returns count of deleted items."""
    resp = t.query(
        KeyConditionExpression=Key("groupTripId").eq(group_trip_id),
        ProjectionExpression="groupTripId, sk",
    )
    items = resp.get("Items", [])
    count = 0
    with t.batch_writer() as batch:
        for item in items:
            batch.delete_item(Key={"groupTripId": item["groupTripId"], "sk": item["sk"]})
            count += 1
    return count
