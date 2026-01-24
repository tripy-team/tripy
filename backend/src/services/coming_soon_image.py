"""
Generate "Coming Soon" placeholder images for cities not yet curated.

Creates a simple placeholder image that can be stored in S3 or generated on-the-fly.
"""

import os
from PIL import Image, ImageDraw, ImageFont
from typing import Optional
import io
import boto3
from botocore.exceptions import ClientError
import logging

logger = logging.getLogger(__name__)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
S3_BUCKET = os.environ.get("CITY_IMAGES_BUCKET", "tripy-city-images")
CLOUDFRONT_DOMAIN = os.environ.get("CLOUDFRONT_DOMAIN", "")

s3_client = boto3.client("s3", region_name=AWS_REGION)


def generate_coming_soon_image(
    city_name: str,
    width: int = 800,
    height: int = 600,
    text_color: str = "#1e40af",
    bg_color: str = "#e0e7ff"
) -> bytes:
    """
    Generate a "Coming Soon" placeholder image.
    
    Args:
        city_name: Name of the city
        width: Image width
        height: Image height
        text_color: Text color (hex)
        bg_color: Background color (hex)
    
    Returns:
        Image bytes in WebP format
    """
    # Create image with gradient background
    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)
    
    # Try to use a nice font, fallback to default
    font_large = None
    font_small = None
    
    try:
        # Try to use a system font (macOS)
        font_large = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 48)
        font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
    except:
        try:
            # Try Linux fonts
            font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
            font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
        except:
            try:
                # Try Windows fonts
                font_large = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 48)
                font_small = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 24)
            except:
                # Fallback to default font
                try:
                    font_large = ImageFont.load_default()
                    font_small = ImageFont.load_default()
                except:
                    # Last resort: use built-in default
                    pass
    
    # Draw city name
    city_text = city_name
    if font_large:
        bbox = draw.textbbox((0, 0), city_text, font=font_large)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
    else:
        # Estimate text size if font not available
        text_width = len(city_text) * 20
        text_height = 50
    
    x = (width - text_width) // 2
    y = (height - text_height) // 2 - 30
    
    if font_large:
        draw.text((x, y), city_text, fill=text_color, font=font_large)
    else:
        draw.text((x, y), city_text, fill=text_color)
    
    # Draw "Coming Soon" text
    coming_soon_text = "Coming Soon"
    if font_small:
        bbox = draw.textbbox((0, 0), coming_soon_text, font=font_small)
        text_width = bbox[2] - bbox[0]
    else:
        text_width = len(coming_soon_text) * 12
    
    x = (width - text_width) // 2
    y = y + text_height + 20
    
    if font_small:
        draw.text((x, y), coming_soon_text, fill=text_color, font=font_small)
    else:
        draw.text((x, y), coming_soon_text, fill=text_color)
    
    # Convert to WebP bytes
    img_bytes = io.BytesIO()
    img.save(img_bytes, format="WEBP", quality=85)
    img_bytes.seek(0)
    
    return img_bytes.getvalue()


def _get_s3_key(city_name: str, size: str, text_hash: Optional[str] = None) -> str:
    """
    Generate S3 key for coming soon image.
    
    Args:
        city_name: Name of the city (base identifier)
        size: Image size (400, 800, 1600)
        text_hash: Optional hash of custom text for caching different text variations
    
    Returns:
        S3 key string
    """
    # Normalize city name for consistent key generation
    base_name = city_name.lower().strip().replace(" ", "_").replace("/", "_")
    
    # If text_hash is provided, include it in the key for custom text variations
    if text_hash:
        return f"coming_soon/{base_name}_{text_hash}_{size}.webp"
    else:
        return f"coming_soon/{base_name}_{size}.webp"


def _image_exists_in_s3(s3_key: str) -> bool:
    """
    Check if an image already exists in S3.
    
    Args:
        s3_key: S3 object key
    
    Returns:
        True if image exists, False otherwise
    """
    try:
        s3_client.head_object(Bucket=S3_BUCKET, Key=s3_key)
        return True
    except ClientError as e:
        # 404 means object doesn't exist
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code == "404" or error_code == "NoSuchKey":
            return False
        # Other errors (permissions, etc.) - log and return False
        logger.warning(f"Error checking S3 object existence: {str(e)}")
        return False
    except Exception as e:
        logger.warning(f"Unexpected error checking S3: {str(e)}")
        return False


def upload_coming_soon_image(city_name: str, size: str = "800") -> Optional[str]:
    """
    Generate and upload a "Coming Soon" placeholder image to S3.
    Only generates if the image doesn't already exist (cached).
    
    This is a convenience function that uses the default behavior.
    For custom text, use get_coming_soon_image_url() with custom_text parameter.
    
    Args:
        city_name: Name of the city (displayed text)
        size: Image size (400, 800, 1600)
    
    Returns:
        S3 URL of the uploaded image, or None if upload failed
    """
    # Use the main function which handles caching
    return get_coming_soon_image_url(city_name, size, custom_text=None)


def get_coming_soon_image_url(city_name: str, size: str = "800", custom_text: Optional[str] = None) -> str:
    """
    Get URL for "Coming Soon" placeholder image.
    Checks S3 cache first, only generates if missing.
    
    Args:
        city_name: Name of the city (used as base identifier for caching)
        size: Image size (400, 800, 1600)
        custom_text: Optional custom text to display on the image.
                     If provided and different from city_name, a hash is used
                     in the S3 key to cache different text variations separately.
    
    Returns:
        URL to the placeholder image
    """
    import hashlib
    
    # Determine display text and cache key
    display_text = custom_text if custom_text else city_name
    
    # If custom_text is provided and different, create a hash for the cache key
    # This allows different text variations to be cached separately
    text_hash = None
    if custom_text and custom_text != city_name:
        # Create a short hash of the custom text for the cache key
        text_hash = hashlib.md5(custom_text.encode()).hexdigest()[:8]
    
    # Get S3 key (includes text_hash if custom text is provided)
    s3_key = _get_s3_key(city_name, size, text_hash)
    
    # Check if cached image exists
    if _image_exists_in_s3(s3_key):
        # Image exists in cache, return cached URL
        logger.debug(f"Using cached coming soon image for {city_name} (text: {display_text})")
        if CLOUDFRONT_DOMAIN:
            url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"
        else:
            url = f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{s3_key}"
        return url
    
    # Image doesn't exist, generate with display_text (customizable)
    # Note: upload_coming_soon_image uses the display_text for generation
    # but we need to ensure it uses the correct S3 key
    url = _upload_coming_soon_image_with_key(display_text, size, s3_key)
    
    if url:
        return url
    
    # Fallback: return expected URL even if upload failed
    if CLOUDFRONT_DOMAIN:
        return f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"
    else:
        return f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{s3_key}"


def _upload_coming_soon_image_with_key(display_text: str, size: str, s3_key: str) -> Optional[str]:
    """
    Internal function to upload coming soon image with a specific S3 key.
    
    Args:
        display_text: Text to display on the image
        size: Image size
        s3_key: Specific S3 key to use
    
    Returns:
        URL to the uploaded image
    """
    try:
        # Map size to dimensions
        size_map = {
            "400": (400, 300),
            "800": (800, 600),
            "1600": (1600, 1200),
        }
        
        width, height = size_map.get(size, (800, 600))
        
        # Generate image with customizable display text
        image_bytes = generate_coming_soon_image(display_text, width, height)
        
        # Upload to S3 with the specified key
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=image_bytes,
            ContentType="image/webp",
            CacheControl="max-age=31536000, immutable",  # Cache for 1 year (immutable)
            Metadata={
                "display_text": display_text,
                "size": size,
                "type": "coming_soon",
            },
        )
        
        # Build URL
        if CLOUDFRONT_DOMAIN:
            url = f"https://{CLOUDFRONT_DOMAIN}/{s3_key}"
        else:
            url = f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{s3_key}"
        
        logger.info(f"Generated and uploaded coming soon image: {s3_key} (text: {display_text})")
        return url
    
    except Exception as e:
        logger.error(f"Error generating/uploading coming soon image: {str(e)}")
        return None
