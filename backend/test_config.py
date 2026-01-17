#!/usr/bin/env python3
"""
Simple test to verify backend configuration loads correctly
"""

import sys
import os

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

try:
    print("Testing backend configuration...")
    print()
    
    # Try to import config - this will validate all required vars
    from src.config import (
        USERS_TABLE, TRIPS_TABLE, TRIP_MEMBERS_TABLE,
        POINTS_TABLE, DESTINATIONS_TABLE, DESTINATION_VOTES_TABLE,
        ITINERARY_TABLE, USER_POOL_ID, USER_POOL_CLIENT_ID, AWS_REGION
    )
    
    print("✅ All required environment variables are set!")
    print()
    print("DynamoDB Tables:")
    print(f"  ✅ USERS_TABLE = {USERS_TABLE}")
    print(f"  ✅ TRIPS_TABLE = {TRIPS_TABLE}")
    print(f"  ✅ TRIP_MEMBERS_TABLE = {TRIP_MEMBERS_TABLE}")
    print(f"  ✅ POINTS_TABLE = {POINTS_TABLE}")
    print(f"  ✅ DESTINATIONS_TABLE = {DESTINATIONS_TABLE}")
    print(f"  ✅ DESTINATION_VOTES_TABLE = {DESTINATION_VOTES_TABLE}")
    print(f"  ✅ ITINERARY_TABLE = {ITINERARY_TABLE}")
    print()
    print("AWS Cognito Configuration:")
    if USER_POOL_ID:
        print(f"  ✅ USER_POOL_ID = {USER_POOL_ID[:15]}...")
    else:
        print(f"  ⚠️  USER_POOL_ID = (not set - auth will not work)")
    
    if USER_POOL_CLIENT_ID:
        print(f"  ✅ USER_POOL_CLIENT_ID = {USER_POOL_CLIENT_ID[:10]}...")
    else:
        print(f"  ⚠️  USER_POOL_CLIENT_ID = (not set - auth will not work)")
    
    print(f"  ✅ AWS_REGION = {AWS_REGION}")
    print()
    
    if USER_POOL_ID and USER_POOL_CLIENT_ID:
        print("✅ Configuration is complete! Ready to start server.")
    else:
        print("⚠️  Cognito not configured - signup/login won't work until USER_POOL_ID and USER_POOL_CLIENT_ID are set")
    
    sys.exit(0)
    
except ValueError as e:
    print(f"❌ Configuration Error: {e}")
    print()
    print("Please check your .env file and ensure all required variables are set.")
    sys.exit(1)
except ImportError as e:
    print(f"❌ Import Error: {e}")
    print()
    print("You may need to install dependencies:")
    print("  pip install python-dotenv")
    sys.exit(1)
except Exception as e:
    print(f"❌ Unexpected Error: {e}")
    print()
    import traceback
    traceback.print_exc()
    sys.exit(1)
