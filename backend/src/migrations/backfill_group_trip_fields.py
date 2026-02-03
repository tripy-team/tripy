#!/usr/bin/env python3
"""
TASK 15: Migration + Backfill Script for Group Trip Fields

This script backfills existing trips and members with new fields:
- Trip.poolingScope -> defaults to 'individual_only'
- Member.lifecycle_state -> inferred from wallet presence

Run this script after deploying the new code to update existing data.

Usage:
    python -m src.migrations.backfill_group_trip_fields [--dry-run]

Flags:
    --dry-run: Preview changes without modifying data
"""

import argparse
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def get_all_trips() -> List[Dict[str, Any]]:
    """Get all trips from the database."""
    try:
        from src.repos import trip_repo
        # This would be a scan in production - for now return empty
        # trips = trip_repo.scan_all_trips()
        logger.info("Fetching all trips from database...")
        return []  # Placeholder - implement actual scan
    except ImportError:
        logger.warning("Could not import trip_repo - using mock data")
        return []


def get_all_members() -> List[Dict[str, Any]]:
    """Get all trip members from the database."""
    try:
        from src.repos import trip_member_repo
        logger.info("Fetching all members from database...")
        return []  # Placeholder - implement actual scan
    except ImportError:
        logger.warning("Could not import trip_member_repo - using mock data")
        return []


def backfill_trip_pooling_scope(trip: Dict[str, Any], dry_run: bool = True) -> Dict[str, Any]:
    """
    Backfill poolingScope for a trip.
    
    Default: individual_only (safest default - no unexpected point sharing)
    """
    trip_id = trip.get("tripId") or trip.get("trip_id")
    current_scope = trip.get("poolingScope") or trip.get("pooling_scope")
    
    if current_scope:
        logger.debug(f"Trip {trip_id} already has poolingScope: {current_scope}")
        return {"trip_id": trip_id, "action": "skipped", "reason": "already_set"}
    
    new_scope = "individual_only"
    
    if dry_run:
        logger.info(f"[DRY RUN] Would set poolingScope={new_scope} for trip {trip_id}")
        return {"trip_id": trip_id, "action": "would_update", "new_value": new_scope}
    
    try:
        from src.repos import trip_repo
        trip_repo.update_trip(trip_id, {"poolingScope": new_scope})
        logger.info(f"Updated trip {trip_id} with poolingScope={new_scope}")
        return {"trip_id": trip_id, "action": "updated", "new_value": new_scope}
    except Exception as e:
        logger.error(f"Failed to update trip {trip_id}: {e}")
        return {"trip_id": trip_id, "action": "error", "error": str(e)}


def infer_lifecycle_state(member: Dict[str, Any]) -> str:
    """
    Infer lifecycle state based on member data.
    
    Logic:
    - Has wallet/points connected -> wallet_connected
    - Has joined but no wallet -> joined_no_wallet
    - Only invited (status=pending) -> invited
    """
    status = member.get("status", "").lower()
    has_wallet = bool(member.get("points") or member.get("walletConnected"))
    
    if status == "pending" or status == "invited":
        return "invited"
    elif has_wallet:
        return "wallet_connected"
    else:
        return "joined_no_wallet"


def backfill_member_lifecycle_state(member: Dict[str, Any], dry_run: bool = True) -> Dict[str, Any]:
    """
    Backfill lifecycle_state for a member.
    
    State is inferred from existing data.
    """
    user_id = member.get("userId") or member.get("user_id")
    trip_id = member.get("tripId") or member.get("trip_id")
    current_state = member.get("lifecycle_state")
    
    if current_state:
        logger.debug(f"Member {user_id} already has lifecycle_state: {current_state}")
        return {"user_id": user_id, "trip_id": trip_id, "action": "skipped", "reason": "already_set"}
    
    new_state = infer_lifecycle_state(member)
    
    if dry_run:
        logger.info(f"[DRY RUN] Would set lifecycle_state={new_state} for member {user_id} in trip {trip_id}")
        return {"user_id": user_id, "trip_id": trip_id, "action": "would_update", "new_value": new_state}
    
    try:
        from src.repos import trip_member_repo
        trip_member_repo.update_member(trip_id, user_id, {"lifecycle_state": new_state})
        logger.info(f"Updated member {user_id} in trip {trip_id} with lifecycle_state={new_state}")
        return {"user_id": user_id, "trip_id": trip_id, "action": "updated", "new_value": new_state}
    except Exception as e:
        logger.error(f"Failed to update member {user_id}: {e}")
        return {"user_id": user_id, "trip_id": trip_id, "action": "error", "error": str(e)}


def run_backfill(dry_run: bool = True) -> Dict[str, Any]:
    """
    Run the complete backfill process.
    
    Returns summary of changes.
    """
    start_time = datetime.utcnow()
    logger.info(f"Starting backfill (dry_run={dry_run})...")
    
    results = {
        "dry_run": dry_run,
        "start_time": start_time.isoformat(),
        "trips": {"total": 0, "updated": 0, "skipped": 0, "errors": 0},
        "members": {"total": 0, "updated": 0, "skipped": 0, "errors": 0},
        "details": {"trips": [], "members": []},
    }
    
    # Backfill trips
    logger.info("=== Backfilling Trips ===")
    trips = get_all_trips()
    results["trips"]["total"] = len(trips)
    
    for trip in trips:
        result = backfill_trip_pooling_scope(trip, dry_run)
        results["details"]["trips"].append(result)
        
        if result["action"] == "updated" or result["action"] == "would_update":
            results["trips"]["updated"] += 1
        elif result["action"] == "skipped":
            results["trips"]["skipped"] += 1
        elif result["action"] == "error":
            results["trips"]["errors"] += 1
    
    # Backfill members
    logger.info("=== Backfilling Members ===")
    members = get_all_members()
    results["members"]["total"] = len(members)
    
    for member in members:
        result = backfill_member_lifecycle_state(member, dry_run)
        results["details"]["members"].append(result)
        
        if result["action"] == "updated" or result["action"] == "would_update":
            results["members"]["updated"] += 1
        elif result["action"] == "skipped":
            results["members"]["skipped"] += 1
        elif result["action"] == "error":
            results["members"]["errors"] += 1
    
    end_time = datetime.utcnow()
    results["end_time"] = end_time.isoformat()
    results["duration_seconds"] = (end_time - start_time).total_seconds()
    
    # Summary
    logger.info("=== Backfill Summary ===")
    logger.info(f"Trips: {results['trips']['updated']} updated, {results['trips']['skipped']} skipped, {results['trips']['errors']} errors")
    logger.info(f"Members: {results['members']['updated']} updated, {results['members']['skipped']} skipped, {results['members']['errors']} errors")
    logger.info(f"Duration: {results['duration_seconds']:.2f} seconds")
    
    if dry_run:
        logger.info("This was a DRY RUN - no data was modified. Run without --dry-run to apply changes.")
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description="Backfill group trip fields for existing data"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without modifying data"
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose logging"
    )
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    results = run_backfill(dry_run=args.dry_run)
    
    # Print summary
    print("\n" + "=" * 60)
    print("BACKFILL RESULTS")
    print("=" * 60)
    print(f"Mode: {'DRY RUN' if results['dry_run'] else 'LIVE'}")
    print(f"Duration: {results['duration_seconds']:.2f}s")
    print()
    print("Trips:")
    print(f"  Total: {results['trips']['total']}")
    print(f"  Updated: {results['trips']['updated']}")
    print(f"  Skipped: {results['trips']['skipped']}")
    print(f"  Errors: {results['trips']['errors']}")
    print()
    print("Members:")
    print(f"  Total: {results['members']['total']}")
    print(f"  Updated: {results['members']['updated']}")
    print(f"  Skipped: {results['members']['skipped']}")
    print(f"  Errors: {results['members']['errors']}")
    print("=" * 60)
    
    return 0 if results['trips']['errors'] == 0 and results['members']['errors'] == 0 else 1


if __name__ == "__main__":
    exit(main())
