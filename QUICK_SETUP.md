# Quick Setup Reference

## Essential Steps to Make Code Functional

### 1. Backend Environment Variables

Create `backend/.env` file with:

```bash
# REQUIRED - AWS Credentials (get from AWS IAM Console)
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=your_key_here
AWS_SECRET_ACCESS_KEY=your_secret_here

# REQUIRED - Database Table Names (create these in DynamoDB)
USERS_TABLE=tripy-users
TRIPS_TABLE=tripy-trips
TRIP_MEMBERS_TABLE=tripy-trip-members
POINTS_TABLE=tripy-points
DESTINATIONS_TABLE=tripy-destinations
DESTINATION_VOTES_TABLE=tripy-destination-votes
ITINERARY_TABLE=tripy-itinerary

# REQUIRED - Analytics Stream (create in Kinesis Firehose)
ANALYTICS_FIREHOSE_STREAM=tripy-analytics

# OPTIONAL - City Search (get from https://developers.amadeus.com/)
AMADEUS_CLIENT_ID=your_client_id
AMADEUS_CLIENT_SECRET=your_client_secret
```

### 2. Frontend Environment Variables

Create `frontend/.env.local` file with:

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### 3. AWS Resources to Create

**DynamoDB Tables** (7 tables needed):
1. `tripy-users` - Primary key: `userId`
2. `tripy-trips` - Primary key: `tripId`
3. `tripy-trip-members` - Primary key: `tripId`, Sort key: `userId`
4. `tripy-points` - Primary key: `tripId`, Sort key: `userProgram`
5. `tripy-destinations` - Primary key: `tripId`, Sort key: `destinationId`
6. `tripy-destination-votes` - Primary key: `tripId`, Sort key: `destinationUser`
7. `tripy-itinerary` - Primary key: `tripId`, Sort key: `itemId`

**Kinesis Firehose Stream**:
- Name: `tripy-analytics`
- Destination: S3 bucket (recommended)
- IAM role with write permissions

**IAM Permissions Needed**:
- DynamoDB: PutItem, GetItem, Query, Scan on all tables
- Kinesis Firehose: PutRecord on the stream

### 4. Install Dependencies

```bash
# Backend
cd backend
pip install -r requirements.txt
pip install amadeus fastapi uvicorn  # if not in requirements.txt

# Frontend
cd frontend
npm install
```

### 5. Run the Application

```bash
# Terminal 1 - Backend
cd backend
uvicorn src.app:app --reload --port 8000

# Terminal 2 - Frontend
cd frontend
npm run dev
```

## What Each Component Does

| Component | Purpose | Required? |
|-----------|---------|-----------|
| AWS Credentials | Access AWS services (DynamoDB, Kinesis) | ✅ Yes |
| DynamoDB Tables | Store user data, trips, destinations | ✅ Yes |
| Kinesis Firehose | Analytics data collection | ⚠️ Recommended |
| Amadeus API | City/airport search autocomplete | ❌ Optional |

## Minimum Setup (Core Functionality)

To get the app running with minimal features:

1. ✅ AWS credentials
2. ✅ DynamoDB tables
3. ✅ Backend `.env` file
4. ✅ Frontend `.env.local` file
5. ❌ Kinesis Firehose (analytics won't work, but app runs)
6. ❌ Amadeus API (city search won't work, but app runs)

## Full Setup (All Features)

Everything from minimum setup, plus:
1. ✅ Kinesis Firehose stream
2. ✅ Amadeus API credentials

## Where to Get Credentials

- **AWS Credentials**: AWS Console → IAM → Users → Create/Select User → Security Credentials → Create Access Key
- **Amadeus API**: https://developers.amadeus.com/ → Sign up → Create App → Get credentials
- **DynamoDB Tables**: AWS Console → DynamoDB → Create Table
- **Kinesis Firehose**: AWS Console → Kinesis → Firehose → Create Delivery Stream

## Testing After Setup

```bash
# Test backend is running
curl http://localhost:8000/healthz

# Test login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

For detailed instructions, see `SETUP_GUIDE.md`
