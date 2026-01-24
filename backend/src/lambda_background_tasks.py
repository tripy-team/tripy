"""
Lambda function for background tasks that may take longer than API Gateway timeout.

This includes:
- Image curation for new cities
- Batch processing
- Long-running operations

Can be invoked asynchronously or via EventBridge/Step Functions.
"""

import os
import json
import logging
from typing import Dict, Any
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def lambda_handler(event: Dict[str, Any], context) -> Dict[str, Any]:
    """
    Lambda handler for background tasks.
    
    Event structure:
    {
        "task": "curate_city_images",
        "city_name": "NewCity",
        "country": "CountryName",
        "region": "RegionName"
    }
    """
    try:
        task = event.get("task")
        
        if task == "curate_city_images":
            return handle_curate_city_images(event)
        else:
            logger.warning(f"Unknown task: {task}")
            return {
                "statusCode": 400,
                "body": json.dumps({"error": f"Unknown task: {task}"})
            }
    
    except Exception as e:
        logger.error(f"Background task error: {str(e)}", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }


def handle_curate_city_images(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle city image curation task.
    """
    from .services.background_image_curation import (
        curate_city_images_background,
        add_city_to_json
    )
    
    city_name = event.get("city_name")
    country = event.get("country")
    region = event.get("region")
    
    if not city_name:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "city_name is required"})
        }
    
    logger.info(f"Starting image curation for {city_name}")
    
    # Trigger curation
    curation_started = curate_city_images_background(city_name, country, region)
    
    # Add to cities.json
    json_added = add_city_to_json(city_name, country, region)
    
    return {
        "statusCode": 200,
        "body": json.dumps({
            "task": "curate_city_images",
            "city_name": city_name,
            "curation_started": curation_started,
            "added_to_json": json_added,
        })
    }
