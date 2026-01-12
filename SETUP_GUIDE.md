# Setup Guide - Making Tripy Functional

This guide explains all the configuration needed to make the Tripy application fully functional.

## 1. Environment Variables

### Backend Configuration

Create a `.env` file in the `backend/` directory (or set environment variables in your deployment environment):

```bash
# ============================================
# AWS Configuration (Required for Analytics)
# ============================================
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=your_aws_access_key_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_key_here

# Kinesis Firehose Stream Name (for analytics)
ANALYTICS_FIREHOSE_STREAM=tripy-analytics

# ============================================
# Database Tables (Required)
# ============================================
USERS_TABLE=tripy-users
TRIPS_TABLE=tripy-trips
TRIP_MEMBERS_TABLE=tripy-trip-members
POINTS_TABLE=tripy-points
DESTINATIONS_TABLE=tripy-destinations
DESTINATION_VOTES_TABLE=tripy-destination-votes
ITINERARY_TABLE=tripy-itinerary

# ============================================
# Amadeus API (Optional - for City Search)
# ============================================
AMADEUS_CLIENT_ID=your_amadeus_client_id
AMADEUS_CLIENT_SECRET=your_amadeus_client_secret

# ============================================
# Authentication (Optional)
# ============================================
USER_POOL_ID=your_cognito_user_pool_id

# ============================================
# Other API Keys (if using other features)
# ============================================
SERP_API_KEY=your_serpapi_key
AWARDTOOL_API_KEY=your_awardtool_key
```

### Frontend Configuration

Create a `.env.local` file in the `frontend/` directory:

```bash
# Backend API URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
# For production, use your deployed backend URL:
# NEXT_PUBLIC_BACKEND_URL=https://your-backend-api.com
```

## 2. AWS Setup

### Step 1: Create DynamoDB Tables

Create the following DynamoDB tables in AWS Console or using AWS CLI/CDK:

**Required Tables:**
1. **tripy-users** (or your USERS_TABLE name)
   - Primary Key: `userId` (String)
   - Optional GSI: `email-index` on `email` field

2. **tripy-trips** (or your TRIPS_TABLE name)
   - Primary Key: `tripId` (String)
   - Optional GSI: `inviteCode-index` on `inviteCode` field

3. **tripy-trip-members** (or your TRIP_MEMBERS_TABLE name)
   - Primary Key: `tripId` (String)
   - Sort Key: `userId` (String)

4. **tripy-points** (or your POINTS_TABLE name)
   - Primary Key: `tripId` (String)
   - Sort Key: `userProgram` (String)

5. **tripy-destinations** (or your DESTINATIONS_TABLE name)
   - Primary Key: `tripId` (String)
   - Sort Key: `destinationId` (String)

6. **tripy-destination-votes** (or your DESTINATION_VOTES_TABLE name)
   - Primary Key: `tripId` (String)
   - Sort Key: `destinationUser` (String)

7. **tripy-itinerary** (or your ITINERARY_TABLE name)
   - Primary Key: `tripId` (String)
   - Sort Key: `itemId` (String)

### Step 2: Create Kinesis Firehose Stream (for Analytics)

**Option A: AWS Console**
1. Go to AWS Kinesis Console
2. Click "Create delivery stream"
3. Stream name: `tripy-analytics` (or match ANALYTICS_FIREHOSE_STREAM)
4. Source: Direct PUT
5. Destination: Choose one:
   - **S3** (recommended for analytics): Select/create an S3 bucket
   - **Redshift**: Configure your Redshift cluster
   - **Elasticsearch**: Configure your ES domain
6. Set up IAM role with permissions to write to Firehose
7. Create the stream

**Option B: AWS CLI**
```bash
aws firehose create-delivery-stream \
  --delivery-stream-name tripy-analytics \
  --s3-destination-configuration RoleARN=arn:aws:iam::YOUR_ACCOUNT:role/firehose-delivery-role,BucketARN=arn:aws:s3:::your-analytics-bucket,Prefix=analytics/
```

**Option C: AWS CDK (if using infrastructure as code)**
Add to your CDK stack:
```python
from aws_cdk import aws_kinesisfirehose as firehose
from aws_cdk import aws_s3 as s3

bucket = s3.Bucket(self, "AnalyticsBucket")
delivery_stream = firehose.CfnDeliveryStream(
    self, "AnalyticsStream",
    delivery_stream_name="tripy-analytics",
    s3_destination_configuration=firehose.CfnDeliveryStream.S3DestinationConfigurationProperty(
        bucket_arn=bucket.bucket_arn,
        role_arn=delivery_role.role_arn
    )
)
```

### Step 3: IAM Permissions

Your application needs IAM permissions. Create an IAM user or role with:

**Required Policies:**
1. **DynamoDB Access:**
   - `dynamodb:PutItem`
   - `dynamodb:GetItem`
   - `dynamodb:Query`
   - `dynamodb:Scan`
   - On all your tables

2. **Kinesis Firehose Access:**
   - `firehose:PutRecord`
   - `firehose:PutRecordBatch`
   - On your delivery stream

**Example IAM Policy:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ],
      "Resource": [
        "arn:aws:dynamodb:*:*:table/tripy-*",
        "arn:aws:dynamodb:*:*:table/tripy-*/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "firehose:PutRecord",
        "firehose:PutRecordBatch"
      ],
      "Resource": "arn:aws:firehose:*:*:deliverystream/tripy-analytics"
    }
  ]
}
```

## 3. API Keys Setup

### Amadeus API (Optional - for City Search)

1. **Sign up**: Go to https://developers.amadeus.com/
2. **Create account**: Register for a free account
3. **Create app**: Create a new app to get credentials
4. **Get credentials**: Copy `Client ID` and `Client Secret`
5. **Add to .env**:
   ```
   AMADEUS_CLIENT_ID=your_client_id_here
   AMADEUS_CLIENT_SECRET=your_client_secret_here
   ```

**Note**: City search will gracefully degrade if Amadeus credentials are not provided (returns empty results).

### Other APIs (if using additional features)

- **SERP API**: For flight search (if using SERP features)
- **AwardTool API**: For award flight data (if using award features)

## 4. Install Dependencies

### Backend

```bash
cd backend
pip install -r requirements.txt
# If not in requirements.txt, also install:
pip install amadeus fastapi uvicorn
```

### Frontend

```bash
cd frontend
npm install
```

## 5. Running the Application

### Backend (Development)

```bash
cd backend
# Make sure .env file is in backend/ directory
uvicorn src.app:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at: `http://localhost:8000`

### Frontend (Development)

```bash
cd frontend
# Make sure .env.local file is in frontend/ directory
npm run dev
```

The frontend will be available at: `http://localhost:3000`

## 6. Verification

### Test Backend Endpoints

1. **Health Check:**
   ```bash
   curl http://localhost:8000/healthz
   ```

2. **Login:**
   ```bash
   curl -X POST http://localhost:8000/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email": "test@example.com"}'
   ```

3. **City Search (if Amadeus configured):**
   ```bash
   curl "http://localhost:8000/cities/search?query=Paris&max_results=5"
   ```

### Check Analytics

1. Check your Kinesis Firehose destination (S3 bucket, etc.)
2. Events should appear after a few minutes
3. Events are sent asynchronously, so failures won't break the app

## 7. Production Deployment

### Backend Deployment

- Set environment variables in your deployment platform (AWS App Runner, ECS, Lambda, etc.)
- Ensure IAM roles have the required permissions
- Point frontend to production backend URL

### Frontend Deployment

- Set `NEXT_PUBLIC_BACKEND_URL` to your production backend URL
- Build and deploy using your platform (Vercel, AWS Amplify, etc.)

## 8. Troubleshooting

### Analytics Not Working

- Check IAM permissions for Kinesis Firehose
- Verify `ANALYTICS_FIREHOSE_STREAM` matches your stream name
- Check CloudWatch Logs for errors
- Verify AWS credentials are set correctly

### City Search Not Working

- Verify Amadeus credentials are set
- Check Amadeus API status
- Review backend logs for API errors
- City search gracefully degrades if credentials are missing

### Database Errors

- Verify DynamoDB tables exist
- Check table names match environment variables
- Verify IAM permissions for DynamoDB
- Check AWS region matches your tables

### Frontend Can't Connect to Backend

- Verify `NEXT_PUBLIC_BACKEND_URL` is set correctly
- Check CORS settings in backend
- Verify backend is running and accessible
- Check browser console for errors

## Quick Start Checklist

- [ ] Create `.env` file in `backend/` with AWS credentials
- [ ] Create DynamoDB tables
- [ ] Create Kinesis Firehose stream (optional but recommended)
- [ ] Set up IAM permissions
- [ ] (Optional) Get Amadeus API credentials for city search
- [ ] Create `.env.local` in `frontend/` with backend URL
- [ ] Install backend dependencies: `pip install -r requirements.txt`
- [ ] Install frontend dependencies: `npm install`
- [ ] Run backend: `uvicorn src.app:app --reload`
- [ ] Run frontend: `npm run dev`
- [ ] Test endpoints to verify setup

## Need Help?

- Check the `FEATURES_IMPLEMENTED.md` file for feature documentation
- Review AWS documentation for services you're using
- Check application logs for specific error messages
