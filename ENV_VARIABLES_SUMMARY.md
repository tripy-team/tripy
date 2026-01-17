# Environment Variables Summary

This document summarizes all environment variables needed for both frontend and backend.

## 📱 Frontend Environment Variables

**File**: `frontend/.env.local` (create from `frontend/env.example`)

```bash
# Backend API URL
# Development: http://localhost:8000
# Production: https://xezfenhu6t.us-east-1.awsapprunner.com
NEXT_PUBLIC_BACKEND_URL=https://xezfenhu6t.us-east-1.awsapprunner.com
```

**For Amplify**: Set `NEXT_PUBLIC_BACKEND_URL` in Amplify Console → Environment variables

---

## 🔧 Backend Environment Variables

**File**: `backend/.env` (create from `backend/env_template.txt`)

### ✅ REQUIRED - DynamoDB Table Names

```bash
USERS_TABLE=tripy-users
TRIPS_TABLE=tripy-trips
TRIP_MEMBERS_TABLE=tripy-trip-members
POINTS_TABLE=tripy-points
DESTINATIONS_TABLE=tripy-destinations
DESTINATION_VOTES_TABLE=tripy-destination-votes
ITINERARY_TABLE=tripy-itinerary
```

**How to get**: 
- AWS DynamoDB Console → List tables
- Or run: `cd backend && ./get_dynamodb_tables_simple.sh`

### ✅ REQUIRED FOR AUTH - AWS Cognito

```bash
USER_POOL_ID=us-east-1_XXXXXXXXX
USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=us-east-1
```

**How to get**:
- AWS Cognito Console → Your User Pool → Copy User Pool ID
- App integration → App client list → Copy Client ID
- Or run: `cd backend && ./get_cognito_credentials.sh`

### ⚙️ OPTIONAL - CORS Origins

```bash
# Comma-separated list of allowed origins
CORS_ORIGINS=https://your-app.amplifyapp.com,http://localhost:3000
```

### ⚙️ OPTIONAL - Analytics

```bash
ANALYTICS_FIREHOSE_STREAM=tripy-analytics
```

### ⚙️ OPTIONAL - Third-party APIs

```bash
AMADEUS_CLIENT_ID=your_amadeus_client_id
AMADEUS_CLIENT_SECRET=your_amadeus_client_secret
SERP_API_KEY=your_serpapi_key
AWARDTOOL_API_KEY=your_awardtool_api_key
```

---

## 🚀 For App Runner Deployment

All backend environment variables are configured in `backend/apprunner.yaml`:

- ✅ DynamoDB table names (already set)
- ⚠️ **Cognito credentials** (need to uncomment and set):
  ```yaml
  - name: USER_POOL_ID
    value: us-east-1_XXXXXXXXX  # Replace with your actual User Pool ID
  - name: USER_POOL_CLIENT_ID
    value: xxxxxxxxxxxxxxxxxxxxxx  # Replace with your actual Client ID
  ```

---

## 📋 Quick Setup Commands

### Frontend
```bash
cd frontend
cp env.example .env.local
# Edit .env.local with your backend URL
```

### Backend (Local Development)
```bash
cd backend
cp env_template.txt .env
# Edit .env with your actual values
```

### Backend (App Runner)
Edit `backend/apprunner.yaml` and uncomment/set:
- `USER_POOL_ID`
- `USER_POOL_CLIENT_ID`
- `CORS_ORIGINS` (optional but recommended for production)

---

## 🔍 Verification

### Check Frontend Config
```bash
cd frontend
cat .env.local
```

### Check Backend Config (Local)
```bash
cd backend
python3 check_env.py
```

### Check Backend Config (App Runner)
- Go to AWS App Runner Console
- Your Service → Configuration → Environment variables
- Verify all variables are set
