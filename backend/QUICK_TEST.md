# Quick Test Guide

After adding credentials to `backend/.env`, verify everything works:

## 1. Test Configuration

Try to import the config module:

```bash
cd backend
python3 -c "from src.config import *; print('✅ Config loaded successfully')"
```

Or use the test script:
```bash
cd backend
python3 test_config.py
```

This will show:
- ✅ Which variables are set correctly
- ❌ Any missing required variables
- ⚠️ Warnings about optional configurations

## 2. Test Backend Startup

Start the server:

```bash
cd backend
./start_server.sh
```

Or manually:
```bash
cd backend
uvicorn src.app:app --reload --host 0.0.0.0 --port 8000
```

**Expected output:**
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
```

If you see errors about missing environment variables, check your `.env` file.

## 3. Test Health Endpoint

In a **new terminal** (keep server running):

```bash
curl http://localhost:8000/healthz
```

**Expected response:**
```json
{"ok":true}
```

## 4. Test Signup (via Frontend)

1. Make sure backend is running
2. Make sure frontend is running: `cd frontend && npm run dev`
3. Go to: http://localhost:3000/register
4. Fill in the form and click "Get Started"
5. Should create user in Cognito and redirect to points-setup

## Troubleshooting

### "Required environment variable 'XXX' is not set"
- Check `.env` file exists in `backend/` directory
- Verify variable name matches exactly (case-sensitive)
- Check for typos or extra spaces

### "Cannot connect to backend"
- Verify backend is running: `curl http://localhost:8000/healthz`
- Check `frontend/.env.local` has `NEXT_PUBLIC_BACKEND_URL=http://localhost:8000`

### "Invalid User Pool ID" or Cognito errors
- Verify `USER_POOL_ID` format: `us-west-2_XXXXXXXXX` (region_prefix)
- Verify `USER_POOL_CLIENT_ID` is correct
- Check `AWS_REGION` matches your Cognito User Pool region
- Ensure AWS credentials are configured (for local development)

### Port already in use
- Change backend port: `uvicorn src.app:app --reload --host 0.0.0.0 --port 8001`
- Update frontend `.env.local`: `NEXT_PUBLIC_BACKEND_URL=http://localhost:8001`
