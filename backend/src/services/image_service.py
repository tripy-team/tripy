"""
Image Service for City/Destination Images

Architecture:
- Curated images stored in S3
- CloudFront CDN for fast delivery
- DynamoDB for city-image mappings
- Pre-selected 3-5 images per city
"""

import boto3
import os
import json
from typing import Dict, List, Optional, Any
from botocore.exceptions import ClientError
import logging

logger = logging.getLogger(__name__)

# AWS Configuration
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
S3_BUCKET = os.environ.get("CITY_IMAGES_BUCKET", "tripy-city-images")
CLOUDFRONT_DOMAIN = os.environ.get("CLOUDFRONT_DOMAIN", "")  # e.g., d1234567890.cloudfront.net

# DynamoDB table for city-image mappings
CITY_IMAGES_TABLE = os.environ.get("CITY_IMAGES_TABLE", "tripy-city-images")

# Presigned URL expiry: 24h to align with frontend cache. S3 buckets are typically private.
PRESIGNED_EXPIRY = 86400  # seconds

# Initialize AWS clients
s3_client = boto3.client("s3", region_name=AWS_REGION)
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
city_images_table = dynamodb.Table(CITY_IMAGES_TABLE)


def _get_s3_presigned_url(s3_key: str, expires_in: int = PRESIGNED_EXPIRY) -> str:
    """
    Generate a presigned URL for a private S3 object.
    Use when CLOUDFRONT_DOMAIN is not set and the bucket blocks public access.
    """
    try:
        return s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET, "Key": s3_key},
            ExpiresIn=expires_in,
        )
    except ClientError as e:
        logger.error(f"Error generating presigned URL for {s3_key}: {e}")
        # Fallback to direct URL (may 403 if bucket is private)
        return f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{s3_key}"


def get_city_image_urls(city_name: str, size: str = "800", trigger_background: bool = True) -> List[str]:
    """
    Get curated image URLs for a city.
    
    If city doesn't exist, returns "coming soon" placeholder and triggers background curation.
    
    Args:
        city_name: Name of the city (normalized)
        size: Image size (400, 800, 1600)
        trigger_background: If True, trigger background curation for new cities
    
    Returns:
        List of image URLs (3-5 images) or ["coming_soon_url"] if not curated yet
    """
    try:
        # Normalize city name (lowercase, remove special chars)
        normalized_city = city_name.lower().strip()
        
        # Get from DynamoDB
        response = city_images_table.get_item(
            Key={"city": normalized_city}
        )
        
        if "Item" not in response:
            logger.info(f"City {city_name} not found in database - generating coming soon image and triggering background curation")
            
            # Generate and upload "coming soon" placeholder
            from .coming_soon_image import get_coming_soon_image_url
            coming_soon_url = get_coming_soon_image_url(city_name, size)
            
            # Trigger background curation if enabled
            if trigger_background:
                try:
                    # Try to use Lambda for background tasks if available
                    import boto3
                    lambda_client = boto3.client("lambda", region_name=AWS_REGION)
                    background_function_name = os.environ.get("BACKGROUND_TASKS_FUNCTION_NAME", "tripy-background-tasks")
                    
                    try:
                        # Invoke Lambda asynchronously for background task
                        lambda_client.invoke(
                            FunctionName=background_function_name,
                            InvocationType="Event",  # Async invocation
                            Payload=json.dumps({
                                "task": "curate_city_images",
                                "city_name": city_name,
                                "country": None,
                                "region": None,
                            }),
                        )
                        logger.info(f"Triggered Lambda background task for {city_name}")
                    except Exception as lambda_error:
                        # Fallback to direct subprocess if Lambda not available
                        logger.warning(f"Lambda invocation failed, using fallback: {str(lambda_error)}")
                        from .background_image_curation import curate_city_images_background, add_city_to_json
                        country = None
                        region = None
                        curate_city_images_background(city_name, country, region)
                        add_city_to_json(city_name, country, region)
                except Exception as e:
                    logger.warning(f"Failed to trigger background curation: {str(e)}")
            
            # Return coming soon placeholder
            return [coming_soon_url]
        
        item = response["Item"]
        image_filenames = item.get("images", [])
        
        # Return metadata along with URLs (for future use)
        # Currently just returning URLs, but item also contains country, region if stored
        
        # Build image URLs: CloudFront if configured, otherwise presigned S3 (bucket is private)
        if CLOUDFRONT_DOMAIN:
            base_url = f"https://{CLOUDFRONT_DOMAIN}"
            urls = []
            for filename in image_filenames:
                base_name = filename.rsplit(".", 1)[0]
                s3_key = f"{base_name}_{size}.webp"
                urls.append(f"{base_url}/{s3_key}")
            return urls
        else:
            # Use presigned URLs for private S3 (BlockPublicAccess blocks direct URLs)
            urls = []
            for filename in image_filenames:
                base_name = filename.rsplit(".", 1)[0]
                s3_key = f"{base_name}_{size}.webp"
                urls.append(_get_s3_presigned_url(s3_key))
            return urls
    
    except ClientError as e:
        logger.error(f"Error fetching city images: {str(e)}")
        return []
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return []


def get_city_hero_image(city_name: str, size: str = "800", trigger_background: bool = True) -> Optional[str]:
    """
    Get the primary/hero image for a city.
    
    Returns the first image from the curated list, or "coming soon" placeholder if not curated.
    """
    urls = get_city_image_urls(city_name, size, trigger_background)
    return urls[0] if urls else None


def get_city_image_srcset(city_name: str) -> Dict[str, Any]:
    """
    Get responsive image srcset for a city.
    Uses per-size URLs so presigned S3 URLs work (they cannot be derived by string replace).
    """
    url_400 = get_city_hero_image(city_name, "400")
    url_800 = get_city_hero_image(city_name, "800")
    url_1600 = get_city_hero_image(city_name, "1600")
    if not url_800:
        return {}
    srcset = f"{url_400} 400w, {url_800} 800w, {url_1600} 1600w"
    return {
        "src": url_800,
        "srcset": srcset,
        "sizes": "(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw",
    }


def add_city_images(city_name: str, image_filenames: List[str]) -> bool:
    """
    Add curated images for a city.
    
    Args:
        city_name: Name of the city
        image_filenames: List of image filenames (e.g., ["paris_hero.webp", "paris_street.webp"])
    
    Returns:
        True if successful
    """
    try:
        normalized_city = city_name.lower().strip()
        
        city_images_table.put_item(
            Item={
                "city": normalized_city,
                "images": image_filenames,
                "updatedAt": str(os.environ.get("TIMESTAMP", "")),
            }
        )
        
        logger.info(f"Added {len(image_filenames)} images for {city_name}")
        return True
    
    except Exception as e:
        logger.error(f"Error adding city images: {str(e)}")
        return False


def list_cities_with_images() -> List[str]:
    """
    List all cities that have curated images.
    """
    try:
        response = city_images_table.scan(
            ProjectionExpression="city"
        )
        
        return [item["city"] for item in response.get("Items", [])]
    
    except Exception as e:
        logger.error(f"Error listing cities: {str(e)}")
        return []


def upload_image_to_s3(
    file_path: str, 
    s3_key: str, 
    content_type: str = "image/webp"
) -> bool:
    """
    Upload an image file to S3.
    
    Args:
        file_path: Local file path
        s3_key: S3 object key (e.g., "paris_hero_800.webp")
        content_type: MIME type
    
    Returns:
        True if successful
    """
    try:
        s3_client.upload_file(
            file_path,
            S3_BUCKET,
            s3_key,
            ExtraArgs={
                "ContentType": content_type,
                "CacheControl": "max-age=31536000, immutable",  # 1 year cache
            }
        )
        
        logger.info(f"Uploaded {s3_key} to S3")
        return True
    
    except Exception as e:
        logger.error(f"Error uploading to S3: {str(e)}")
        return False
