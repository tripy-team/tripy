from typing import Optional, Dict, Any
from botocore.exceptions import ClientError
from src.config import USERS_TABLE
from .ddb import table, get_item, put_item, query_gsi, sanitize_for_dynamodb
import logging

logger = logging.getLogger(__name__)

t = table(USERS_TABLE)


def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    return get_item(t, {"userId": user_id})


def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    items = query_gsi(t, "email-index", "email", email)
    return items[0] if items else None


def create_user(user: Dict[str, Any], condition_expression: Optional[str] = None) -> bool:
    """
    Create user with optional conditional write to prevent race conditions.
    Returns True if user was created, False if user already exists.
    """
    from botocore.exceptions import ClientError
    
    try:
        if condition_expression:
            # Use conditional put_item
            t.put_item(
                Item=sanitize_for_dynamodb(user),
                ConditionExpression=condition_expression
            )
        else:
            put_item(t, user)
        return True
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code == "ConditionalCheckFailedException":
            # User already exists (race condition handled)
            return False
        raise
    except Exception as e:
        error_msg = str(e)
        if "condition not met" in error_msg.lower() or "ConditionalCheckFailedException" in error_msg:
            # User already exists (race condition handled)
            return False
        raise


def update_user(user_id: str, updates: Dict[str, Any]) -> None:
    """
    Update user using DynamoDB update_item for atomic updates.
    This prevents race conditions from concurrent updates.
    """
    from botocore.exceptions import ClientError
    
    try:
        # Build UpdateExpression dynamically
        update_expr_parts = []
        expr_attr_names = {}
        expr_attr_values = {}
        
        for key, value in updates.items():
            # Map key to expression attribute name (handles reserved words)
            attr_name = f"#attr_{key}"
            attr_value = f":val_{key}"
            
            update_expr_parts.append(f"{attr_name} = {attr_value}")
            expr_attr_names[attr_name] = key
            expr_attr_values[attr_value] = sanitize_for_dynamodb(value)
        
        if not update_expr_parts:
            return  # No updates to perform
        
        update_expression = "SET " + ", ".join(update_expr_parts)
        
        # Use update_item for atomic operation
        t.update_item(
            Key={"userId": user_id},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values,
        )
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        logger.error(f"DynamoDB update_user error: {error_code} - {error_message}")
        raise Exception(f"Failed to update user: {error_message}")
    except Exception as e:
        logger.error(f"Unexpected error in update_user: {str(e)}")
        raise Exception(f"Failed to update user: {str(e)}")
