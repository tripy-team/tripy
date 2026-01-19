# Step-by-Step Implementation Guide

This guide walks you through implementing all the recent changes:
1. **Lambda Migration** (cost reduction)
2. **Coming Soon Image Caching** (cost optimization)
3. **Automatic Background Image Curation** (auto-expanding database)

## Prerequisites Checklist

- [ ] AWS CLI configured (`aws configure`)
- [ ] AWS CDK installed (`npm install -g aws-cdk`)
- [ ] Node.js and npm installed
- [ ] Python 3.12+ installed
- [ ] Access to AWS Console
- [ ] Your Cognito User Pool ID and Client ID

---

## Step 1: Install Backend Dependencies

### 1.1 Install Python Dependencies

```bash
cd backend
pip install -r requirements.txt
```

**Key new dependencies:**
- `mangum>=0.17.0` (Lambda adapter for FastAPI)
- `Pillow>=10.0.0` (for image generation)

**Verify installation:**
```bash
python -c "import mangum; import PIL; print('Dependencies OK')"
```

---

## Step 2: Set Up Lambda Infrastructure

### 2.1 Install CDK Dependencies

```bash
cd infra
npm install
```

### 2.2 Build TypeScript

```bash
npm run build
```

**Expected output:** Creates `dist/` folder with compiled JavaScript

### 2.3 Configure Environment Variables

Create or update `infra/.env` (optional, or set in CDK stack):

```bash
# Optional: Set these if you want them in CDK
export CITY_IMAGES_BUCKET=tripy-city-images
export CITY_IMAGES_TABLE=tripy-city-images
export CLOUDFRONT_DOMAIN=your-cloudfront-domain.cloudfront.net
export CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

**Note:** Most variables are auto-configured by CDK, but you can override them here.

---

## Step 3: Deploy Lambda Stack

### 3.1 Bootstrap CDK (First Time Only)

```bash
cdk bootstrap
```

**Expected output:** Creates CDK bootstrap stack in your AWS account

### 3.2 Review Stack Changes

```bash
cdk diff --app "node bin/app-lambda.js"
```

**What to check:**
- Lambda functions will be created
- API Gateway will be set up
- IAM roles and permissions
- No unexpected deletions

### 3.3 Deploy Lambda Stack

```bash
cdk deploy --app "node bin/app-lambda.js" TripyApiStack
```

**During deployment:**
- CDK will ask for confirmation: Type `y` and press Enter
- Deployment takes 5-10 minutes
- Watch for any errors

**Expected outputs:**
```
TripyApiStack.API_URL = https://xxxxx.execute-api.us-east-1.amazonaws.com
TripyApiStack.API_FUNCTION_NAME = tripy-api
TripyApiStack.BACKGROUND_TASKS_FUNCTION_NAME = tripy-background-tasks
```

**Save the API_URL** - you'll need it in Step 5!

### 3.4 Verify Deployment

```bash
# Get the API URL
cdk output --app "node bin/app-lambda.js" API_URL

# Test health endpoint
curl https://YOUR_API_URL/health
```

**Expected response:**
```json
{"ok": true}
```

---

## Step 4: Configure Lambda Environment Variables

### 4.1 Set Required Environment Variables

Go to AWS Lambda Console:
1. Navigate to **Lambda** → **Functions** → `tripy-api`
2. Click **Configuration** → **Environment variables**
3. Add/verify these variables:

**Required:**
```
USER_POOL_ID=us-east-1_zCMCjyTLJ  # Your Cognito User Pool ID
USER_POOL_CLIENT_ID=2rehpmlssbivmlo6468rcsd0kq  # Your Client ID
AWS_REGION=us-east-1
```

**DynamoDB Tables** (auto-set by CDK, but verify):
```
USERS_TABLE=tripy-users
TRIPS_TABLE=tripy-trips
TRIP_MEMBERS_TABLE=tripy-trip-members
POINTS_TABLE=tripy-points
DESTINATIONS_TABLE=tripy-destinations
DESTINATION_VOTES_TABLE=tripy-destination-votes
ITINERARY_TABLE=tripy-itinerary
```

**Optional (for image service):**
```
CITY_IMAGES_BUCKET=tripy-city-images
CITY_IMAGES_TABLE=tripy-city-images
CLOUDFRONT_DOMAIN=your-cloudfront-domain.cloudfront.net
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### 4.2 Set Background Tasks Environment Variables

1. Navigate to **Lambda** → **Functions** → `tripy-background-tasks`
2. Set environment variables:
```
AWS_REGION=us-east-1
CITY_IMAGES_BUCKET=tripy-city-images
CITY_IMAGES_TABLE=tripy-city-images
CITIES_JSON_PATH=scripts/cities.json
```

---

## Step 5: Update Frontend Configuration

### 5.1 Update Backend URL

Edit `frontend/.env` or `frontend/.env.local`:

```bash
# Replace with your Lambda API Gateway URL from Step 3.3
NEXT_PUBLIC_BACKEND_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com
```

**Get the URL:**
```bash
cd infra
cdk output --app "node bin/app-lambda.js" API_URL
```

### 5.2 Restart Frontend Development Server

```bash
cd frontend
npm run dev
```

**Or if using production build:**
```bash
npm run build
npm start
```

---

## Step 6: Test the Implementation

### 6.1 Test Health Endpoint

```bash
curl https://YOUR_API_URL/health
```

**Expected:** `{"ok": true}`

### 6.2 Test Authentication

```bash
# Login
curl -X POST https://YOUR_API_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@example.com","password":"your-password"}'
```

**Expected:** Returns access_token and id_token

### 6.3 Test Protected Endpoint

```bash
# Replace YOUR_TOKEN with token from Step 6.2
curl https://YOUR_API_URL/trips \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected:** Returns your trips list

### 6.4 Test Coming Soon Image (New City)

```bash
# Request image for a city not in database
curl https://YOUR_API_URL/images/city/TestCity/hero?size=800 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected:**
- First request: Generates and uploads "coming soon" image
- Second request: Returns cached image (faster)

**Check logs:**
- First request: `"Generated and uploaded coming soon image"`
- Second request: `"Using cached coming soon image"`

### 6.5 Test Frontend

1. Open your frontend URL
2. Sign in
3. Navigate to "My Trips"
4. Create a trip with a new city
5. Verify images load correctly

---

## Step 7: Monitor and Verify

### 7.1 Check Lambda Metrics

Go to **CloudWatch** → **Metrics** → **Lambda**:
- Check `Invocations` (should see requests)
- Check `Duration` (should be < 1 second for most requests)
- Check `Errors` (should be 0 or minimal)

### 7.2 Check Lambda Logs

Go to **CloudWatch** → **Log Groups** → `/aws/lambda/tripy-api`:
- Look for successful requests
- Check for any errors
- Verify "coming soon" image caching logs

### 7.3 Check S3 for Cached Images

Go to **S3** → `tripy-city-images` → `coming_soon/`:
- Should see generated "coming soon" images
- Each city + size combination should have one file
- Files should be small (~10-50KB)

### 7.4 Check Costs

Go to **AWS Cost Explorer**:
- Filter by **Lambda** service
- Compare with previous App Runner costs
- Should see significant reduction

---

## Step 8: Optional - Pre-generate Common Cities

To reduce first-request latency, pre-generate "coming soon" images for popular cities:

```python
# Create a script: backend/pre_generate_coming_soon.py
from src.services.coming_soon_image import get_coming_soon_image_url

cities = ["Paris", "London", "New York", "Tokyo", "Sydney", "Rome", "Barcelona"]
sizes = ["400", "800", "1600"]

for city in cities:
    for size in sizes:
        url = get_coming_soon_image_url(city, size)
        print(f"Generated: {city} ({size})")
```

Run it:
```bash
cd backend
python pre_generate_coming_soon.py
```

---

## Step 9: Decommission App Runner (Optional)

**⚠️ Only do this after verifying Lambda works correctly!**

### 9.1 Keep App Runner Running Initially

- Keep both running for 24-48 hours
- Monitor Lambda for any issues
- Compare performance and costs

### 9.2 Switch Traffic Gradually

1. Update frontend to use Lambda URL
2. Monitor for errors
3. Keep App Runner as backup

### 9.3 Decommission App Runner

Once confident Lambda is working:
1. Go to **App Runner** → Your service
2. Click **Delete service**
3. Confirm deletion

**Cost savings:** ~$50-100/month

---

## Troubleshooting

### Issue: Lambda deployment fails

**Solution:**
```bash
# Check CDK version
cdk --version

# Verify AWS credentials
aws sts get-caller-identity

# Check for syntax errors
cd infra
npm run build
```

### Issue: "ModuleNotFoundError: No module named 'mangum'"

**Solution:**
```bash
cd backend
pip install mangum>=0.17.0
pip install -r requirements.txt
```

### Issue: Coming soon images not caching

**Solution:**
1. Check S3 permissions for Lambda role
2. Verify `CITY_IMAGES_BUCKET` environment variable
3. Check CloudWatch logs for errors

### Issue: CORS errors in frontend

**Solution:**
1. Update `CORS_ORIGINS` in Lambda environment variables
2. Include your frontend domain(s)
3. Restart Lambda function (or wait for next request)

### Issue: Background tasks not working

**Solution:**
1. Check `tripy-background-tasks` Lambda function exists
2. Verify it has S3 and DynamoDB permissions
3. Check CloudWatch logs for the background function

---

## Verification Checklist

After completing all steps, verify:

- [ ] Lambda functions deployed successfully
- [ ] API Gateway URL accessible
- [ ] Health endpoint returns `{"ok": true}`
- [ ] Authentication works (login endpoint)
- [ ] Protected endpoints work (with token)
- [ ] Frontend connects to Lambda API
- [ ] Coming soon images are cached (check S3)
- [ ] Background tasks trigger (check logs)
- [ ] No errors in CloudWatch logs
- [ ] Costs reduced (check Cost Explorer)

---

## Next Steps

1. **Monitor for 24-48 hours** before decommissioning App Runner
2. **Set up CloudWatch alarms** for errors and high latency
3. **Optimize Lambda memory** based on actual usage
4. **Consider provisioned concurrency** if cold starts are an issue
5. **Set up cost alerts** to track savings

---

## Support

- **CDK Issues**: Check `infra/lib/apiStackLambda.ts`
- **Lambda Issues**: Check CloudWatch logs
- **API Issues**: Check API Gateway logs
- **Cost Questions**: Use AWS Cost Calculator

---

## Quick Reference Commands

```bash
# Deploy Lambda stack
cd infra && cdk deploy --app "node bin/app-lambda.js" TripyApiStack

# Get API URL
cd infra && cdk output --app "node bin/app-lambda.js" API_URL

# Test health
curl https://YOUR_API_URL/health

# View Lambda logs
aws logs tail /aws/lambda/tripy-api --follow

# Check S3 coming soon images
aws s3 ls s3://tripy-city-images/coming_soon/
```

---

**You're all set!** Your application is now running on Lambda with optimized image caching and automatic background curation. 🚀
