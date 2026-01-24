#!/usr/bin/env python3
"""
Check backend environment configuration
Validates that all required environment variables are set
"""

import os
import sys
from dotenv import load_dotenv

# Load .env file
load_dotenv()

# Required variables
REQUIRED_VARS = [
    "USERS_TABLE",
    "TRIPS_TABLE",
    "TRIP_MEMBERS_TABLE",
    "POINTS_TABLE",
    "DESTINATIONS_TABLE",
    "DESTINATION_VOTES_TABLE",
    "ITINERARY_TABLE",
]

# Optional but recommended for auth
AUTH_VARS = [
    "USER_POOL_ID",
    "USER_POOL_CLIENT_ID",
]

# AWS Region
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")

def check_config():
    """Check configuration and print status"""
    print("🔍 Checking backend configuration...\n")
    
    # Check .env file exists
    if not os.path.exists(".env"):
        print("❌ .env file not found in backend/ directory")
        print("   Run: cp .env.template .env (or create it manually)")
        return False
    
    print("✅ .env file found\n")
    
    # Check required variables
    missing = []
    print("Required DynamoDB Table Variables:")
    for var in REQUIRED_VARS:
        value = os.environ.get(var)
        if value:
            print(f"  ✅ {var} = {value}")
        else:
            print(f"  ❌ {var} = (not set)")
            missing.append(var)
    
    print()
    
    # Check auth variables
    print("AWS Cognito Configuration (Required for Authentication):")
    auth_configured = True
    for var in AUTH_VARS:
        value = os.environ.get(var)
        if value:
            # Mask sensitive values
            if "POOL_ID" in var:
                display = value[:10] + "..." if len(value) > 10 else value
            else:
                display = value[:8] + "..." if len(value) > 8 else value
            print(f"  ✅ {var} = {display}")
        else:
            print(f"  ⚠️  {var} = (not set - auth will not work)")
            auth_configured = False
    
    print(f"\n  AWS_REGION = {AWS_REGION}")
    print()
    
    # Summary
    if missing:
        print(f"❌ Missing required variables: {', '.join(missing)}")
        print("   Please set them in your .env file")
        return False
    
    if not auth_configured:
        print("⚠️  Warning: Cognito not configured")
        print("   Signup/login will not work until USER_POOL_ID and USER_POOL_CLIENT_ID are set")
        print("   Get these from AWS Cognito Console")
        print()
    
    print("✅ All required environment variables are set!")
    if auth_configured:
        print("✅ Cognito is configured - authentication should work")
    else:
        print("⚠️  Cognito not configured - you can still test other endpoints")
    
    return True

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    success = check_config()
    sys.exit(0 if success else 1)
