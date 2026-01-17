# Backend Connection Troubleshooting Guide

If you're seeing "Cannot connect to backend server" errors, follow these steps:

## Step 1: Verify Backend is Running

**IMPORTANT**: The URL `https://xezfenhu6t.us-east-1.awsapprunner.com` appears to be incorrect or the service doesn't exist.

### Get the Correct Backend URL

1. **Go to AWS App Runner Console**: https://console.aws.amazon.com/apprunner
2. **Select your region** (e.g., `us-east-1`)
3. **Find your service** in the list
4. **Click on the service**
5. **Copy the "Default domain" URL** - it will look like:
   ```
   https://xxxxx.us-east-1.awsapprunner.com
   ```

### Test the Backend

Once you have the correct URL:

```bash
curl https://YOUR-ACTUAL-URL.us-east-1.awsapprunner.com/healthz
```

**Expected response**: `{"ok":true}`

**If this fails:**
- Backend might not be deployed yet → See `BACKEND_DEPLOYMENT_GUIDE.md`
- Backend URL might be incorrect → Get correct URL from App Runner Console
- Backend might be down → Check App Runner service status

**Solution:**
1. Verify service exists in App Runner Console
2. Get the correct "Default domain" URL from the console
3. Verify the service status is "Running"
4. Check deployment logs for errors
5. Test the correct URL with curl

## Step 2: Check CORS Configuration

CORS (Cross-Origin Resource Sharing) must allow your frontend domain.

### Option A: Allow All Origins (Development/Testing)

The backend is currently configured to allow all origins if `CORS_ORIGINS` is not set.

### Option B: Restrict to Specific Domains (Production)

Set `CORS_ORIGINS` environment variable in AWS App Runner:

1. Go to **AWS App Runner Console**
2. Select your service
3. Go to **Configuration** → **Environment variables**
4. Add variable:
   ```
   Name: CORS_ORIGINS
   Value: https://your-frontend-domain.amplifyapp.com,http://localhost:3000
   ```
5. **Save** and wait for service to update

**Important**: Replace `your-frontend-domain.amplifyapp.com` with your actual Amplify domain.

## Step 3: Verify Frontend Configuration

### Local Development

Check `frontend/.env.local`:
```env
NEXT_PUBLIC_BACKEND_URL=https://xezfenhu6t.us-east-1.awsapprunner.com
```

### Production (AWS Amplify)

1. Go to **AWS Amplify Console**
2. Select your app
3. Go to **App settings** → **Environment variables**
4. Verify `NEXT_PUBLIC_BACKEND_URL` is set:
   ```
   NEXT_PUBLIC_BACKEND_URL=https://xezfenhu6t.us-east-1.awsapprunner.com
   ```
5. **Redeploy** after adding/changing variables

## Step 4: Test Backend Health Endpoint

### From Command Line

```bash
# Test health endpoint
curl https://xezfenhu6t.us-east-1.awsapprunner.com/healthz

# Test with verbose output
curl -v https://xezfenhu6t.us-east-1.awsapprunner.com/healthz
```

### From Browser

Open in browser:
```
https://xezfenhu6t.us-east-1.awsapprunner.com/healthz
```

Should show: `{"ok":true}`

## Step 5: Check Browser Console

1. Open browser DevTools (F12)
2. Go to **Console** tab
3. Look for:
   - `Backend URL: https://xezfenhu6t.us-east-1.awsapprunner.com`
   - Any CORS errors
   - Network errors

4. Go to **Network** tab
5. Try making a request (e.g., login)
6. Check the failed request:
   - Status code
   - Error message
   - Response headers

## Common Issues

### Issue: "Cannot resolve host"

**Cause**: Backend URL is incorrect or backend isn't deployed

**Solution**:
- Verify URL in AWS App Runner Console
- Check if service is running
- Test URL with curl

### Issue: CORS Error

**Error**: `Access to fetch at '...' from origin '...' has been blocked by CORS policy`

**Solution**:
1. Set `CORS_ORIGINS` in App Runner with your frontend domain
2. Or temporarily allow all origins (not recommended for production)
3. Restart backend service

### Issue: 401 Unauthorized

**Cause**: Authentication token is missing or invalid

**Solution**:
- This is expected for unauthenticated requests
- Try logging in first
- Check if tokens are being stored correctly

### Issue: 500 Internal Server Error

**Cause**: Backend error

**Solution**:
- Check App Runner logs
- Verify environment variables are set
- Check DynamoDB table names
- Verify Cognito credentials

### Issue: Network Error / Failed to Fetch

**Cause**: 
- Backend is down
- Network connectivity issue
- Wrong URL

**Solution**:
1. Test backend URL directly
2. Check App Runner service status
3. Verify network connectivity
4. Check if URL is correct

## Step 6: Verify Environment Variables

### Backend (App Runner)

Required environment variables:
- `AWS_REGION` (should be set)
- `USERS_TABLE`
- `TRIPS_TABLE`
- `TRIP_MEMBERS_TABLE`
- `POINTS_TABLE`
- `DESTINATIONS_TABLE`
- `DESTINATION_VOTES_TABLE`
- `ITINERARY_TABLE`
- `USER_POOL_ID` (for authentication)
- `USER_POOL_CLIENT_ID` (for authentication)
- `CORS_ORIGINS` (optional, but recommended)

### Frontend (Amplify)

Required environment variables:
- `NEXT_PUBLIC_BACKEND_URL` (must be set)

## Step 7: Check App Runner Logs

1. Go to **AWS App Runner Console**
2. Select your service
3. Go to **Logs** tab
4. Check for:
   - Startup errors
   - Module import errors
   - Environment variable errors
   - Application errors

## Step 8: Test with curl

Test different endpoints:

```bash
# Health check
curl https://xezfenhu6t.us-east-1.awsapprunner.com/healthz

# Test login (will fail without credentials, but should return 400/401, not connection error)
curl -X POST https://xezfenhu6t.us-east-1.awsapprunner.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test1234"}'
```

## Quick Checklist

- [ ] Backend URL is correct: `https://xezfenhu6t.us-east-1.awsapprunner.com`
- [ ] Backend health endpoint responds: `curl https://xezfenhu6t.us-east-1.awsapprunner.com/healthz`
- [ ] `NEXT_PUBLIC_BACKEND_URL` is set in frontend (Amplify or `.env.local`)
- [ ] `CORS_ORIGINS` is set in backend (App Runner) OR backend allows all origins
- [ ] App Runner service is running (check console)
- [ ] No errors in App Runner logs
- [ ] Browser console shows correct backend URL
- [ ] Network tab shows requests to backend (even if they fail)

## Still Having Issues?

1. **Check App Runner Service Status**:
   - Service should be "Running"
   - No deployment failures
   - Health checks passing

2. **Verify URL**:
   - Check App Runner Console for the correct default domain
   - URL format: `https://xxxxx.us-east-1.awsapprunner.com`

3. **Test from Different Network**:
   - Try from different network
   - Check if firewall is blocking

4. **Check DNS**:
   - `nslookup xezfenhu6t.us-east-1.awsapprunner.com`
   - Should resolve to an IP address

5. **Contact Support**:
   - Check AWS App Runner documentation
   - Review App Runner service logs
   - Check AWS Service Health Dashboard
