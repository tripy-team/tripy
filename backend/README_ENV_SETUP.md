# Backend Environment Setup Guide

## Quick Start

1. **Copy the template:**
   ```bash
   cp .env.template .env
   ```

2. **Edit `.env` with your actual values:**
   - Fill in the REQUIRED DynamoDB table names
   - Fill in the REQUIRED Cognito configuration

3. **Start the server:**
   ```bash
   ./start_server.sh
   ```

## Required Environment Variables

### 1. DynamoDB Tables (REQUIRED)
These must match your DynamoDB table names in AWS:

```bash
USERS_TABLE=tripy-users
TRIPS_TABLE=tripy-trips
TRIP_MEMBERS_TABLE=tripy-trip-members
POINTS_TABLE=tripy-points
DESTINATIONS_TABLE=tripy-destinations
DESTINATION_VOTES_TABLE=tripy-destination-votes
ITINERARY_TABLE=tripy-itinerary
```

### 2. AWS Cognito (REQUIRED for Authentication)
Get these from AWS Cognito Console:

1. Go to AWS Cognito Console
2. Select your User Pool
3. Copy the **User Pool ID** (e.g., `us-west-2_ABC123XYZ`)
4. Go to **App clients** tab
5. Copy the **Client ID** (e.g., `1a2b3c4d5e6f7g8h9i0j`)

```bash
USER_POOL_ID=us-west-2_ABC123XYZ
USER_POOL_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j
AWS_REGION=us-west-2
```

## For Local Development (Without Real AWS)

If you want to test signup/login without real Cognito, you can temporarily:

1. **Comment out Cognito validation** in `backend/src/services/auth_service.py`
2. **Use development mode** - The JWT auth will skip verification if `USER_POOL_ID` is empty
3. **Use mock credentials** - The backend will work but won't actually authenticate with Cognito

**Note:** This is only for development. Production requires real Cognito setup.

## Verifying Your Setup

After creating `.env`, test it:

```bash
cd backend
python3 -c "from src.config import *; print('✅ Config loaded successfully')"
```

If you see an error, check which environment variables are missing.

## Common Issues

### "Required environment variable 'XXX' is not set"
- Check that `.env` file exists in `backend/` directory
- Check that the variable name matches exactly (case-sensitive)
- Check that there are no extra spaces in `.env` file

### "Cannot connect to Cognito"
- Verify `USER_POOL_ID` and `USER_POOL_CLIENT_ID` are correct
- Verify `AWS_REGION` matches your Cognito User Pool region
- Check AWS credentials are configured (via AWS CLI or environment variables)

### "Table does not exist" (DynamoDB errors)
- Verify table names in `.env` match actual DynamoDB table names
- Verify AWS credentials have permissions to access DynamoDB
- Check that tables are in the correct AWS region
