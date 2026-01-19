"""
DynamoDB Repository for City Image Mappings

Table Schema:
- Partition Key: city (string)
- Attributes:
  - images: List[str] - List of image filenames
  - updatedAt: string - ISO timestamp
"""

from typing import Dict, Any, List, Optional
from boto3.dynamodb.conditions import Key
import boto3
import os

CITY_IMAGES_TABLE = os.environ.get("CITY_IMAGES_TABLE", "tripy-city-images")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
table = dynamodb.Table(CITY_IMAGES_TABLE)


def get_city_images(city: str) -> Optional[Dict[str, Any]]:
    """Get image mappings for a city."""
    try:
        response = table.get_item(Key={"city": city.lower().strip()})
        return response.get("Item")
    except Exception as e:
        print(f"Error getting city images: {str(e)}")
        return None


def put_city_images(city: str, images: List[str], country: str = None, region: str = None) -> bool:
    """Store image mappings for a city."""
    from datetime import datetime
    
    try:
        item = {
            "city": city.lower().strip(),
            "images": images,
            "updatedAt": datetime.utcnow().isoformat(),
        }
        
        # Add optional metadata
        if country:
            item["country"] = country
        if region:
            item["region"] = region
        
        table.put_item(Item=item)
        return True
    except Exception as e:
        print(f"Error storing city images: {str(e)}")
        return False


def list_all_cities() -> List[str]:
    """List all cities with images."""
    try:
        response = table.scan(ProjectionExpression="city")
        return [item["city"] for item in response.get("Items", [])]
    except Exception as e:
        print(f"Error listing cities: {str(e)}")
        return []
