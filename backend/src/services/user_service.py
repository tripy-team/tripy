from typing import Dict, Any, Optional
from src.repos import user_repo
from botocore.exceptions import ClientError
import logging

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
