#!/usr/bin/env python3
"""
City Image Curation Script

This script helps you curate high-quality images for cities.

Workflow:
1. Search for images using optimized search terms
2. Download and convert to WebP
3. Generate multiple sizes (400, 800, 1600)
4. Upload to S3
5. Store mappings in DynamoDB

Usage:
    python scripts/curate_city_images.py --city "Paris" --count 5
"""

import argparse
import os
import sys
from pathlib import Path
from typing import List, Dict
import json

import requests
from PIL import Image
import boto3
from dotenv import load_dotenv

# Ensure both the repo root and backend package are on sys.path so that
# imports like `backend.src...` and `src...` work regardless of CWD.
ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_ROOT = ROOT_DIR / "backend"

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Load environment variables from a .env file at the repo root (if present)
load_dotenv(ROOT_DIR / ".env")

from backend.src.services.image_service import upload_image_to_s3, add_city_images
from backend.src.repos.city_image_repo import put_city_images

# Configuration
UNSPLASH_ACCESS_KEY = os.environ.get("UNSPLASH_ACCESS_KEY", "")
PEXELS_API_KEY = os.environ.get("PEXELS_API_KEY", "")
S3_BUCKET = os.environ.get("CITY_IMAGES_BUCKET", "tripy-city-images")
TEMP_DIR = Path("/tmp/city_images")


def get_optimized_search_terms(city: str) -> List[str]:
    """
    Generate optimized search terms for better image results.
    
    Avoids cliché tourist shots by using more specific terms.
    """
    base_terms = [
        f"{city} street life",
        f"{city} neighborhood",
        f"{city} morning light",
        f"{city} aerial editorial",
        f"{city} local culture",
        f"{city} architecture",
        f"{city} cityscape",
    ]
    return base_terms


def search_pexels(query: str, per_page: int = 5) -> List[Dict]:
    """Search Pexels for images."""
    if not PEXELS_API_KEY:
        print("Warning: PEXELS_API_KEY not set. Skipping Pexels search.")
        return []
    
    url = "https://api.pexels.com/v1/search"
    headers = {"Authorization": PEXELS_API_KEY}
    params = {"query": query, "per_page": per_page, "orientation": "landscape"}
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        return data.get("photos", [])
    except Exception as e:
        print(f"Error searching Pexels: {str(e)}")
        return []


def search_unsplash(query: str, per_page: int = 5) -> List[Dict]:
    """Search Unsplash for images."""
    if not UNSPLASH_ACCESS_KEY:
        print("Warning: UNSPLASH_ACCESS_KEY not set. Skipping Unsplash search.")
        return []
    
    url = "https://api.unsplash.com/search/photos"
    headers = {"Authorization": f"Client-ID {UNSPLASH_ACCESS_KEY}"}
    params = {"query": query, "per_page": per_page, "orientation": "landscape"}
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        return data.get("results", [])
    except Exception as e:
        print(f"Error searching Unsplash: {str(e)}")
        return []


def download_image(url: str, filepath: Path) -> bool:
    """Download an image from URL."""
    try:
        response = requests.get(url, timeout=30, stream=True)
        response.raise_for_status()
        
        with open(filepath, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        return True
    except Exception as e:
        print(f"Error downloading image: {str(e)}")
        return False


def convert_to_webp(input_path: Path, output_path: Path, size: tuple) -> bool:
    """Convert and resize image to WebP format."""
    try:
        img = Image.open(input_path)
        
        # Resize maintaining aspect ratio
        img.thumbnail(size, Image.Resampling.LANCZOS)
        
        # Convert to RGB if needed (for WebP)
        if img.mode in ("RGBA", "P"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = background
        
        # Save as WebP with quality optimization
        img.save(output_path, "WEBP", quality=85, method=6)
        return True
    except Exception as e:
        print(f"Error converting image: {str(e)}")
        return False


def process_city_images(city: str, country: str = None, count: int = 5) -> List[str]:
    """
    Main function to curate images for a city.
    
    Args:
        city: City name
        country: Country name (optional, used for better search terms)
        count: Number of images to curate
    
    Returns list of S3 keys for uploaded images.
    """
    print(f"\n🎨 Curating {count} images for {city}" + (f", {country}" if country else "") + "...")
    
    # Create temp directory
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    city_dir = TEMP_DIR / city.lower().replace(" ", "_")
    city_dir.mkdir(exist_ok=True)
    
    # Get search terms - include country for better results
    search_terms = get_optimized_search_terms(city)
    if country:
        # Add country-specific terms for better image results
        search_terms.extend([
            f"{city} {country}",
            f"{city} {country} travel",
            f"{city} {country} destination"
        ])
    
    # Search for images
    all_photos = []
    
    # Try Pexels first (usually better quality)
    for term in search_terms[:3]:  # Use first 3 terms
        photos = search_pexels(term, per_page=count)
        all_photos.extend(photos)
        if len(all_photos) >= count:
            break
    
    # Fallback to Unsplash if needed
    if len(all_photos) < count:
        for term in search_terms[:2]:
            photos = search_unsplash(term, per_page=count)
            all_photos.extend(photos)
            if len(all_photos) >= count:
                break
    
    if not all_photos:
        print(f"❌ No images found for {city}")
        return []
    
    # Download and process images
    uploaded_keys = []
    base_name = city.lower().replace(" ", "_")
    
    for i, photo in enumerate(all_photos[:count]):
        # Determine source and get URL
        if "src" in photo:  # Pexels
            image_url = photo["src"]["large"]
            photo_id = photo["id"]
        elif "urls" in photo:  # Unsplash
            image_url = photo["urls"]["regular"]
            photo_id = photo["id"]
        else:
            continue
        
        # Download original
        original_path = city_dir / f"{base_name}_{i+1}_original.jpg"
        if not download_image(image_url, original_path):
            continue
        
        # Generate multiple sizes
        sizes = {
            "400": (400, 300),
            "800": (800, 600),
            "1600": (1600, 1200),
        }
        
        image_keys = []
        for size_name, size_tuple in sizes.items():
            webp_path = city_dir / f"{base_name}_{i+1}_{size_name}.webp"
            
            if convert_to_webp(original_path, webp_path, size_tuple):
                # Upload to S3
                s3_key = f"{base_name}_{i+1}_{size_name}.webp"
                if upload_image_to_s3(str(webp_path), s3_key):
                    image_keys.append(s3_key)
                    print(f"  ✅ Uploaded {s3_key}")
        
        if image_keys:
            # Store base filename (without size suffix)
            base_filename = f"{base_name}_{i+1}.webp"
            uploaded_keys.append(base_filename)
    
    # Store in DynamoDB
    if uploaded_keys:
        # Extract region from country if not provided (basic mapping)
        region = None
        if country:
            # Basic region mapping (can be enhanced)
            region_map = {
                "United States": "North America",
                "Canada": "North America",
                "Mexico": "North America",
                "France": "Europe",
                "Germany": "Europe",
                "Italy": "Europe",
                "Spain": "Europe",
                "United Kingdom": "Europe",
                "Japan": "Asia",
                "China": "Asia",
                "India": "Asia",
                "Thailand": "Asia",
                "Australia": "Oceania",
                "New Zealand": "Oceania",
            }
            region = region_map.get(country)
        
        put_city_images(city, uploaded_keys, country=country, region=region)
        print(f"\n✅ Successfully curated {len(uploaded_keys)} images for {city}")
        if country:
            print(f"   Country: {country}")
        print(f"   Stored in DynamoDB: {uploaded_keys}")
    
    # Cleanup
    import shutil
    shutil.rmtree(city_dir, ignore_errors=True)
    
    return uploaded_keys


def main():
    parser = argparse.ArgumentParser(description="Curate city images")
    parser.add_argument("--city", help="City name (for single city)")
    parser.add_argument("--country", help="Country name (optional, for single city)")
    parser.add_argument("--count", type=int, default=5, help="Number of images to curate")
    parser.add_argument("--batch", help="JSON file with list of cities (supports both string array and object array)")
    
    args = parser.parse_args()
    
    if args.batch:
        # Batch process multiple cities
        with open(args.batch, "r") as f:
            cities_data = json.load(f)
        
        for city_entry in cities_data:
            # Handle both formats: string or object
            if isinstance(city_entry, str):
                # Old format: just city name
                city = city_entry
                country = None
            elif isinstance(city_entry, dict):
                # New format: object with city, country, etc.
                city = city_entry.get("city", "")
                country = city_entry.get("country")
            else:
                continue
            
            if city:
                process_city_images(city, country, args.count)
    elif args.city:
        # Single city
        process_city_images(args.city, args.country, args.count)
    else:
        parser.error("Either --city or --batch must be provided")


if __name__ == "__main__":
    main()
