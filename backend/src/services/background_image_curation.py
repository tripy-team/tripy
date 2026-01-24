"""
Background task for automatically curating images for new cities.

This module handles:
1. Curating images for a city that wasn't in the database
2. Updating DynamoDB with curated images
3. Updating cities.json file (if accessible)
"""

import os
import sys
import subprocess
import logging
from pathlib import Path
from typing import Optional, Dict, Any
import json

logger = logging.getLogger(__name__)

# Path to cities.json (relative to project root)
CITIES_JSON_PATH = os.environ.get("CITIES_JSON_PATH", "scripts/cities.json")


def curate_city_images_background(city_name: str, country: Optional[str] = None, region: Optional[str] = None) -> bool:
    """
    Background task to curate images for a new city.
    
    This runs the curation script in the background.
    
    Args:
        city_name: Name of the city
        country: Country name (optional)
        region: Region name (optional)
    
    Returns:
        True if curation was initiated successfully
    """
    try:
        # Get script path
        script_path = Path(__file__).parent.parent.parent / "scripts" / "curate_city_images.py"
        
        if not script_path.exists():
            logger.warning(f"Curation script not found at {script_path}")
            # Try alternative path (if running from different location)
            script_path = Path("scripts/curate_city_images.py")
            if not script_path.exists():
                logger.warning(f"Curation script not found at alternative path either")
                return False
        
        # Build command
        cmd = [
            sys.executable,
            str(script_path),
            "--city", city_name,
            "--count", "5"
        ]
        
        if country:
            cmd.extend(["--country", country])
        
        # Run in background (non-blocking)
        # Use subprocess.Popen to run asynchronously
        # Detach from parent process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(script_path.parent.parent),
            start_new_session=True  # Detach from parent
        )
        
        # Don't wait for completion
        logger.info(f"Started background curation for {city_name} (PID: {process.pid})")
        return True
    
    except Exception as e:
        logger.error(f"Error starting background curation: {str(e)}")
        return False


def add_city_to_json(city_name: str, country: Optional[str] = None, region: Optional[str] = None) -> bool:
    """
    Add a city to cities.json file.
    
    Args:
        city_name: Name of the city
        country: Country name
        region: Region name
    
    Returns:
        True if successful
    """
    try:
        # Get absolute path to cities.json
        project_root = Path(__file__).parent.parent.parent
        cities_file = project_root / CITIES_JSON_PATH
        
        # Try alternative path if not found
        if not cities_file.exists():
            cities_file = Path(CITIES_JSON_PATH)
            if not cities_file.exists():
                logger.warning(f"cities.json not found at {cities_file} or {CITIES_JSON_PATH}")
                # Don't fail - cities.json might not be accessible in production
                return False
        
        # Read existing cities
        try:
            with open(cities_file, "r") as f:
                cities = json.load(f)
        except Exception as e:
            logger.warning(f"Could not read cities.json: {str(e)}")
            return False
        
        # Check if city already exists
        city_exists = False
        for city_entry in cities:
            if isinstance(city_entry, dict):
                if city_entry.get("city", "").lower() == city_name.lower():
                    city_exists = True
                    break
            elif isinstance(city_entry, str):
                if city_entry.lower() == city_name.lower():
                    city_exists = True
                    break
        
        if city_exists:
            logger.info(f"City {city_name} already in cities.json")
            return True
        
        # Add new city
        new_entry = {
            "city": city_name,
        }
        
        if country:
            new_entry["country"] = country
        if region:
            new_entry["region"] = region
        
        cities.append(new_entry)
        
        # Write back
        try:
            with open(cities_file, "w") as f:
                json.dump(cities, f, indent=2)
            
            logger.info(f"Added {city_name} to cities.json")
            return True
        except Exception as e:
            logger.warning(f"Could not write to cities.json: {str(e)}")
            # Don't fail - file might be read-only in production
            return False
    
    except Exception as e:
        logger.warning(f"Error adding city to cities.json: {str(e)}")
        # Don't fail - this is a nice-to-have feature
        return False
