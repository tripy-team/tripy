from typing import Dict, Any, Optional
from src.repos import user_repo
from botocore.exceptions import ClientError
import logging
import boto3
from boto3.dynamodb.conditions import Key
from src.config import TRIPS_TABLE, ITINERARY_TABLE
import os

logger = logging.getLogger(__name__)


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
        return u
    
    # User doesn't exist, create with conditional write to prevent race condition
    from datetime import datetime
    from boto3.dynamodb.conditions import Attr
    
    new_user = {
        "userId": user_id,
        "email": email or "",
        "name": "",
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
                return u
        # If we can't fetch, re-raise the exception
        logger.error(f"Error ensuring user exists: {str(e)}")
        raise


def update_profile(user_id: str, updates: Dict[str, Any]) -> None:
    """Update user profile using atomic DynamoDB update"""
    user_repo.update_user(user_id, updates)


def calculate_cash_saved(user_id: str) -> float:
    """
    Calculate total cash saved from using points across all user's trips.

    Savings = Cash price - (Actual cash paid + Value of points used)
    For simplicity, we consider points as "free" so: Savings = Cash price - Actual cash paid
    """
    try:
        dynamodb = boto3.resource(
            'dynamodb',
            region_name=os.environ.get('AWS_REGION', 'us-west-2')
        )

        trips_table = dynamodb.Table(TRIPS_TABLE)
        itinerary_table = dynamodb.Table(ITINERARY_TABLE)

        # Get all trips created by this user
        response = trips_table.scan(
            FilterExpression='createdBy = :uid',
            ExpressionAttributeValues={':uid': user_id}
        )
        trips = response.get('Items', [])

        total_savings = 0.0

        for trip in trips:
            trip_id = trip.get('tripId', '')
            if not trip_id:
                continue

            # Get itinerary items for this trip
            itinerary_response = itinerary_table.query(
                KeyConditionExpression=Key('tripId').eq(trip_id)
            )
            itinerary_items = itinerary_response.get('Items', [])

            # Calculate savings for each itinerary item
            for item in itinerary_items:
                # Get cost information
                cash_price = float(item.get('totalCost') or item.get('cost') or 0)
                points_needed = int(item.get('pointsCost') or item.get('points') or 0)
                actual_cash_paid = float(item.get('actualCashPaid') or 0)
                surcharge = float(item.get('surcharge') or item.get('pointsSurcharge') or 0)

                if cash_price == 0:
                    continue  # Skip items with no cost data

                # Calculate savings for this itinerary
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

        return round(total_savings, 2)

    except Exception as e:
        logger.error(f"Error calculating cash saved for user {user_id}: {str(e)}")
        return 0.0
