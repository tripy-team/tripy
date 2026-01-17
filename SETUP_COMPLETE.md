# ✅ Complete Setup Guide

## Quick Setup (All at Once)

Run these commands to set up everything:

> 📖 **New to AWS Cognito?** See `backend/AWS_COGNITO_SETUP.md` for detailed step-by-step instructions.

### 1. Backend Environment Setup

```bash
cd backend
./setup_env.sh
```

This will create a `.env` file with all required variables. You'll need to edit it to add your Cognito credentials.

### 2. Fill in Cognito Credentials (Required for Auth)

Edit `backend/.env` and add your AWS Cognito credentials:

```bash
USER_POOL_ID=us-west-2_YOUR_POOL_ID
USER_POOL_CLIENT_ID=YOUR_CLIENT_ID
```

**How to get these:**
1. Go to AWS Console → Cognito → User Pools
2. Select your User Pool (or create a new one)
3. Copy the **User Pool ID** (format: `us-west-2_XXXXXXXXX`)
4. Click **App clients** tab
5. Copy the **Client ID**

**If you don't have Cognito yet:**
- You can leave these empty for now
- The server will start, but signup/login won't work
- You'll need to set them up later for authentication

### 3. Verify Backend Configuration

```bash
cd backend
python3 check_env.py
```

This will show you:
- ✅ Which variables are set correctly
- ❌ Which variables are missing
- ⚠️ Warnings about optional configurations

### 4. Install Backend Dependencies (if needed)

```bash
cd backend
pip install -r requirements.txt
```

### 5. Start Backend Server

```bash
cd backend
./start_server.sh
```

Or manually:
```bash
cd backend
uvicorn src.app:app --reload --host 0.0.0.0 --port 8000
```

**Keep this terminal window open!** The backend needs to be running.

### 6. Verify Backend is Running

In a new terminal, test the health endpoint:

```bash
curl http://localhost:8000/healthz
```

Should return: `{"ok":true}`

### 7. Frontend Configuration (Already Done)

Your frontend `.env.local` already exists with:
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### 8. Start Frontend (if not already running)

```bash
cd frontend
npm run dev
```

### 9. Test Signup

1. Go to http://localhost:3000/register
2. Fill in the form
3. Click "Get Started"
4. Should connect to backend and create user

## What You Need for Full Functionality

### Required (Must Have):
- ✅ **DynamoDB Tables**: Backend expects these table names
  - Create them in AWS DynamoDB or update `.env` to match your table names
- ✅ **Cognito User Pool**: Required for signup/login
  - Get `USER_POOL_ID` and `USER_POOL_CLIENT_ID` from AWS Cognito Console

### Optional (Nice to Have):
- **Amadeus API**: For city search functionality
- **SERP API**: For flight search
- **AwardTool API**: For award flight data
- **Kinesis Firehose**: For analytics tracking

## Troubleshooting

### Backend won't start
- Check: `python3 check_env.py` - shows missing variables
- Ensure all required DynamoDB table variables are set

### "Cannot connect to backend" error
- Verify backend is running: `curl http://localhost:8000/healthz`
- Check `frontend/.env.local` has `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000`

### Signup/Login errors
- Verify Cognito credentials in `backend/.env`
- Check Cognito User Pool is configured correctly
- Ensure `USER_POOL_ID` and `USER_POOL_CLIENT_ID` are correct

### Port already in use
- Change port: `uvicorn src.app:app --reload --host 0.0.0.0 --port 8001`
- Update `frontend/.env.local`: `NEXT_PUBLIC_BACKEND_URL=http://localhost:8001`

## Summary

✅ **Backend**: `.env` file with all required variables
✅ **Frontend**: `.env.local` already configured
✅ **Scripts**: `setup_env.sh`, `check_env.py`, `start_server.sh` created
✅ **Documentation**: Setup guides created

**Next**: Run `./backend/setup_env.sh`, edit `.env` with Cognito credentials, start the server!
