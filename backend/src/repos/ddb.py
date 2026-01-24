import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from decimal import Decimal
from typing import Any, Dict, Optional, List
import logging

logger = logging.getLogger(__name__)


def sanitize_for_dynamodb(obj: Any) -> Any:
    """
    Recursively convert floats to Decimal for DynamoDB compatibility.
    DynamoDB does not accept Python float; use Decimal for numbers.
    """
    if isinstance(obj, dict):
        return {k: sanitize_for_dynamodb(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_dynamodb(v) for v in obj]
    if isinstance(obj, set):
        return {sanitize_for_dynamodb(v) for v in obj}
    if isinstance(obj, float):
        return Decimal(str(obj))
    return obj

# Configure boto3 session with connection pooling
session = boto3.Session()
ddb = session.resource(
    "dynamodb",
    config=boto3.session.Config(
        connect_timeout=5,
        read_timeout=5,
        retries={"max_attempts": 3, "mode": "standard"},
    ),
)


def table(name: str):
    return ddb.Table(name)


def get_item(t, key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Get item from DynamoDB table with error handling"""
    try:
        resp = t.get_item(Key=key)
        return resp.get("Item")
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        logger.error(f"DynamoDB get_item error: {error_code} - {error_message}")
        
        if error_code == "ProvisionedThroughputExceededException":
            raise Exception("Database temporarily unavailable. Please try again.")
        elif error_code == "ResourceNotFoundException":
            raise Exception(f"Database table not found: {t.table_name}")
        else:
            raise Exception(f"Database error: {error_message}")
    except Exception as e:
        logger.error(f"Unexpected error in get_item: {str(e)}")
        raise Exception(f"Database operation failed: {str(e)}")


def put_item(t, item: Dict[str, Any]) -> None:
    """Put item in DynamoDB table with error handling"""
    try:
        t.put_item(Item=sanitize_for_dynamodb(item))
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        logger.error(f"DynamoDB put_item error: {error_code} - {error_message}")
        
        if error_code == "ProvisionedThroughputExceededException":
            raise Exception("Database temporarily unavailable. Please try again.")
        elif error_code == "ResourceNotFoundException":
            raise Exception(f"Database table not found: {t.table_name}")
        elif error_code == "ConditionalCheckFailedException":
            raise Exception("Operation failed: condition not met")
        else:
            raise Exception(f"Database error: {error_message}")
    except Exception as e:
        logger.error(f"Unexpected error in put_item: {str(e)}")
        raise Exception(f"Database operation failed: {str(e)}")


def query_gsi(
    t, index_name: str, key_name: str, key_value: str
) -> List[Dict[str, Any]]:
    """Query Global Secondary Index with error handling"""
    try:
        resp = t.query(
            IndexName=index_name, KeyConditionExpression=Key(key_name).eq(key_value)
        )
        return resp.get("Items", [])
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        logger.error(f"DynamoDB query_gsi error: {error_code} - {error_message}")
        
        if error_code == "ProvisionedThroughputExceededException":
            raise Exception("Database temporarily unavailable. Please try again.")
        elif error_code == "ResourceNotFoundException":
            raise Exception(f"Database table or index not found: {t.table_name}/{index_name}")
        else:
            raise Exception(f"Database error: {error_message}")
    except Exception as e:
        logger.error(f"Unexpected error in query_gsi: {str(e)}")
        raise Exception(f"Database operation failed: {str(e)}")


def delete_item(t, key: Dict[str, Any]) -> None:
    """Delete item from DynamoDB table with error handling"""
    try:
        t.delete_item(Key=key)
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        error_message = e.response.get("Error", {}).get("Message", "")
        logger.error(f"DynamoDB delete_item error: {error_code} - {error_message}")
        
        if error_code == "ProvisionedThroughputExceededException":
            raise Exception("Database temporarily unavailable. Please try again.")
        elif error_code == "ResourceNotFoundException":
            raise Exception(f"Database table not found: {t.table_name}")
        elif error_code == "ConditionalCheckFailedException":
            raise Exception("Operation failed: condition not met")
        else:
            raise Exception(f"Database error: {error_message}")
    except Exception as e:
        logger.error(f"Unexpected error in delete_item: {str(e)}")
        raise Exception(f"Database operation failed: {str(e)}")
