from typing import Dict, Any, Optional, List
from src.repos import user_repo, trip_repo, itinerary_repo
from botocore.exceptions import ClientError
import logging
import boto3
from boto3.dynamodb.conditions import Key
from src.config import TRIPS_TABLE, ITINERARY_TABLE
import os

logger = logging.getLogger(__name__)

# Default points value (cents per point) - same as in calculate_savings.py
DEFAULT_POINTS_VALUE = 0.01  # $0.01 per point


def ensure_user_exists(user_id: str, email: Optional[str] = None) -> Dict[str, Any]:
    """
    Ensure user exists in database. Uses conditional write to prevent race conditions.
    """
    u = user_repo.get_user_by_id(user_id)
    if u:
        # Update email if provided and different
        if email and u.get("email") != email:
            update_profile(user_id, {"email": email})
            u["email"] = email
        # Ensure total_savings exists and defaults to 0
        if "total_savings" not in u or u["total_savings"] is None:
            u["total_savings"] = 0
        return u
    
    # User doesn't exist, create with conditional write to prevent race condition
    from datetime import datetime
    from boto3.dynamodb.conditions import Attr
    
    new_user = {
        "userId": user_id,
        "email": email or "",
        "name": "",
        "total_savings": 0,
        "createdAt": datetime.utcnow().isoformat(),
    }
    
    # Use conditional write: only create if userId doesn't exist
    # This prevents race condition where two requests try to create the same user
    condition_expr = "attribute_not_exists(userId)"
    
    try:
        created = user_repo.create_user(new_user, condition_expression=condition_expr)
        if not created:
            # User was created by another request (race condition handled)
            # Fetch the existing user
            u = user_repo.get_user_by_id(user_id)
            if u:
                # Ensure total_savings exists
                if "total_savings" not in u or u["total_savings"] is None:
                    u["total_savings"] = 0
                return u
            # Fallback: return the user we tried to create
            return new_user
        return new_user
    except Exception as e:
        error_msg = str(e)
        if "condition not met" in error_msg.lower() or "ConditionalCheckFailedException" in error_msg:
            # User was created by another request, fetch it
            u = user_repo.get_user_by_id(user_id)
            if u:
                # Ensure total_savings exists
                if "total_savings" not in u or u["total_savings"] is None:
                    u["total_savings"] = 0
                return u
        # If we can't fetch, re-raise the exception
        logger.error(f"Error ensuring user exists: {str(e)}")
        raise


def update_profile(user_id: str, updates: Dict[str, Any]) -> None:
    """Update user profile using atomic DynamoDB update"""
    user_repo.update_user(user_id, updates)


def calculate_trip_savings(trip_id: str, itinerary_items: List[Dict[str, Any]]) -> float:
    """
    Calculate savings for a single trip based on itinerary items.
    
    Savings = Cash price - Actual cash paid (when using points)
    
    For each itinerary item:
    - totalCost: Full cash price if paying with cash
    - pointsCost: Points needed if using points
    - If points were used: actual cash paid = surcharges/fees only (typically 5-10%)
    """
    total_savings = 0.0
    
    for item in itinerary_items:
        # Get cost information
        cash_price = float(item.get('totalCost') or item.get('cost') or 0)
        points_needed = int(item.get('pointsCost') or item.get('points') or 0)
        actual_cash_paid = float(item.get('actualCashPaid') or 0)
        surcharge = float(item.get('surcharge') or item.get('pointsSurcharge') or 0)
        
        if cash_price == 0:
            continue  # Skip items with no cost data
        
        # Calculate savings for this itinerary item
        if points_needed > 0:
            # Points were used
            # Actual cash paid = surcharges/fees (usually 5-10% of cash price)
            if actual_cash_paid > 0:
                cash_spent = actual_cash_paid
            else:
                # Estimate: surcharges are typically 5-10% of cash price
                cash_spent = surcharge if surcharge > 0 else (cash_price * 0.05)
            
            # Savings = cash price - actual cash paid
            # We consider points as "free" money (earned from credit cards)
            savings = cash_price - cash_spent
            total_savings += savings
    
    return total_savings


def calculate_and_update_user_savings(user_id: str) -> Dict[str, Any]:
    """
    Calculate total savings from all user's trips and update user profile.
    
    Returns:
        Dict with total_savings and trips_count
    """
    from .trip_service import list_trips_for_user
    
    # Get all trips for user
    trips = list_trips_for_user(user_id)
    
    total_savings = 0.0
    trips_with_savings = 0
    
    # Calculate savings for each trip
    for trip in trips:
        trip_id = trip.get('tripId')
        if not trip_id:
            continue
        
        # Get itinerary items for this trip
        itinerary_items = itinerary_repo.list_items(trip_id)
        
        if not itinerary_items:
            continue
        
        # Calculate savings for this trip
        trip_savings = calculate_trip_savings(trip_id, itinerary_items)
        
        if trip_savings > 0:
            total_savings += trip_savings
            trips_with_savings += 1
            logger.info(f"Trip {trip_id}: ${trip_savings:.2f} saved")
    
    # Update user profile with total savings
    update_profile(user_id, {"total_savings": round(total_savings, 2)})
    
    logger.info(f"User {user_id}: Total savings ${total_savings:.2f} from {trips_with_savings} trips")
    
    return {
        "total_savings": round(total_savings, 2),
        "trips_count": len(trips),
        "trips_with_savings": trips_with_savings
    }
