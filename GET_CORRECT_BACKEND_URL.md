# How to Get Your Correct Backend URL

The error "Could not resolve host" means the backend URL is incorrect or the service isn't deployed.

## Step 1: Check if App Runner Service Exists

1. **Go to AWS Console**: https://console.aws.amazon.com/apprunner
2. **Select your region** (e.g., `us-east-1`)
3. **Look for your service** in the list

**If you don't see a service:**
- The backend hasn't been deployed yet
- See `BACKEND_DEPLOYMENT_GUIDE.md` to deploy it

**If you see a service:**
- Continue to Step 2

## Step 2: Get the Correct URL

1. **Click on your App Runner service**
2. **Look at the "Default domain"** section
3. **Copy the URL** - it should look like:
   ```
   https://xxxxx.us-east-1.awsapprunner.com
   ```

**Important**: The URL format is:
- `https://[random-string].us-east-1.awsapprunner.com`
- Each service gets a unique random string
- The URL in your code might be outdated

## Step 3: Test the URL

Once you have the correct URL, test it:

```bash
curl https://YOUR-ACTUAL-URL.us-east-1.awsapprunner.com/healthz
```

Should return: `{"ok":true}`

## Step 4: Update Configuration

### Update Frontend

**Local Development** (`frontend/.env.local`):
```env
NEXT_PUBLIC_BACKEND_URL=https://YOUR-ACTUAL-URL.us-east-1.awsapprunner.com
```

**Production (AWS Amplify)**:
1. Go to AWS Amplify Console
2. App settings → Environment variables
3. Update `NEXT_PUBLIC_BACKEND_URL` with the correct URL
4. Save and redeploy

### Update Documentation

Update these files with the correct URL:
- `frontend/env.example`
- `PRODUCTION_SETUP.md`
- `ENVIRONMENT_SETUP.md`

## Common Issues

### Issue: Service doesn't exist

**Solution**: Deploy the backend first
- See `BACKEND_DEPLOYMENT_GUIDE.md`
- Make sure `backend/apprunner.yaml` is committed
- Connect App Runner to your GitHub repository

### Issue: Service exists but URL is different

**Solution**: 
- App Runner generates a unique URL for each service
- Always get the URL from the App Runner Console
- Don't use example URLs from documentation

### Issue: Service is "Paused" or "Stopped"

**Solution**:
1. Go to App Runner Console
2. Select your service
3. Click "Resume" or "Start"
4. Wait for service to become "Running"

### Issue: Service deployment failed

**Solution**:
1. Check deployment logs in App Runner Console
2. Fix any errors (see `APPRUNNER_TROUBLESHOOT.md`)
3. Redeploy the service

## Quick Checklist

- [ ] App Runner service exists in AWS Console
- [ ] Service status is "Running"
- [ ] Copied the correct "Default domain" URL
- [ ] Tested URL with `curl /healthz`
- [ ] Updated `NEXT_PUBLIC_BACKEND_URL` in frontend
- [ ] Updated Amplify environment variables (if using Amplify)
- [ ] Restarted frontend dev server (if local)

## Next Steps

Once you have the correct URL:

1. **Test the backend**:
   ```bash
   curl https://YOUR-URL/healthz
   ```

2. **Update frontend configuration**:
   - Local: Update `frontend/.env.local`
   - Production: Update Amplify environment variables

3. **Test frontend connection**:
   - Open browser console
   - Check for "Backend URL: ..." log
   - Try logging in or making an API call

4. **Verify CORS** (if needed):
   - Set `CORS_ORIGINS` in App Runner with your frontend domain
   - Or leave unset to allow all origins (development only)
