"""
Analytics data collection using AWS Kinesis Firehose
"""
import os
import json
import boto3
from datetime import datetime
from typing import Dict, Any, Optional
from dotenv import load_dotenv
import logging

# Configure logging
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

FIREHOSE_STREAM_NAME = os.environ.get("ANALYTICS_FIREHOSE_STREAM", "tripy-analytics")
_firehose_client = None


def get_firehose_client():
    """Get or create Kinesis Firehose client"""
    global _firehose_client
    if _firehose_client is None:
        # boto3 automatically uses AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from environment
        region = os.environ.get("AWS_REGION", "us-west-2")
        _firehose_client = boto3.client("firehose", region_name=region)
    return _firehose_client


def track_event(event_type: str, user_id: Optional[str], data: Dict[str, Any]) -> None:
    """
    Send analytics event to AWS Kinesis Firehose
    
    Args:
        event_type: Type of event (e.g., 'user_login', 'trip_created', 'destination_added')
        user_id: User ID (optional)
        data: Event data dictionary
    """
    try:
        event = {
            "event_type": event_type,
            "user_id": user_id,
            "timestamp": datetime.utcnow().isoformat(),
            "data": data,
        }
        
        client = get_firehose_client()
        client.put_record(
            DeliveryStreamName=FIREHOSE_STREAM_NAME,
            Record={"Data": json.dumps(event) + "\n"},
        )
    except Exception as e:
        # Log error but don't break application flow
        logger.error(
            f"Analytics tracking failed for event '{event_type}': {str(e)}",
            extra={"event_type": event_type, "user_id": user_id, "error": str(e)}
        )


def track_user_login(user_id: str, email: str, metadata: Optional[Dict[str, Any]] = None) -> None:
    """Track user login event"""
    track_event(
        "user_login",
        user_id,
        {
            "email": email,
            **(metadata or {}),
        },
    )


def track_trip_created(user_id: str, trip_id: str, title: str, start_date: str, end_date: str) -> None:
    """Track trip creation event"""
    track_event(
        "trip_created",
        user_id,
        {
            "trip_id": trip_id,
            "title": title,
            "start_date": start_date,
            "end_date": end_date,
        },
    )


def track_destination_added(user_id: str, trip_id: str, destination_name: str) -> None:
    """Track destination addition event"""
    track_event(
        "destination_added",
        user_id,
        {
            "trip_id": trip_id,
            "destination_name": destination_name,
        },
    )


def track_itinerary_generated(user_id: str, trip_id: str, route_count: int) -> None:
    """Track itinerary generation event"""
    track_event(
        "itinerary_generated",
        user_id,
        {
            "trip_id": trip_id,
            "route_count": route_count,
        },
    )
