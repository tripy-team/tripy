# Quick Start Checklist

Follow these steps in order to implement all changes.

## ✅ Step 1: Install Dependencies (5 minutes)

```bash
# Install Python dependencies
cd backend
pip install -r requirements.txt

# Verify key dependencies
python -c "import mangum; import PIL; print('✓ Dependencies OK')"
```

**Expected:** No errors, dependencies installed

---

## ✅ Step 2: Set Up CDK (5 minutes)

```bash
# Install CDK dependencies
cd infra
npm install

# Build TypeScript
npm run build
```

**Expected:** `dist/` folder created with compiled files

---

## ✅ Step 3: Deploy Lambda Stack (10-15 minutes)

```bash
# Bootstrap CDK (first time only)
cdk bootstrap

# Review changes
cdk diff --app "node bin/app-lambda.js"

# Deploy
cdk deploy --app "node bin/app-lambda.js" TripyApiStack
```

**During deployment:**
- Type `y` when prompted
- Wait 5-10 minutes
- **Save the API_URL output!**

**Expected outputs:**
```
TripyApiStack.API_URL = https://xxxxx.execute-api.us-east-1.amazonaws.com
TripyApiStack.API_FUNCTION_NAME = tripy-api
TripyApiStack.BACKGROUND_TASKS_FUNCTION_NAME = tripy-background-tasks
```

---

## ✅ Step 4: Configure Lambda Environment Variables (5 minutes)

### 4.1 Main API Function (`tripy-api`)

Go to **AWS Console** → **Lambda** → **tripy-api** → **Configuration** → **Environment variables**

**Add/Verify:**
```
USER_POOL_ID=us-east-1_zCMCjyTLJ
USER_POOL_CLIENT_ID=2rehpmlssbivmlo6468rcsd0kq
AWS_REGION=us-east-1
CITY_IMAGES_BUCKET=tripy-city-images
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### 4.2 Background Tasks Function (`tripy-background-tasks`)

Go to **Lambda** → **tripy-background-tasks** → **Configuration** → **Environment variables**

**Add:**
```
AWS_REGION=us-east-1
CITY_IMAGES_BUCKET=tripy-city-images
CITY_IMAGES_TABLE=tripy-city-images
```

---

## ✅ Step 5: Update Frontend (2 minutes)

```bash
# Get API URL
cd infra
cdk output --app "node bin/app-lambda.js" API_URL

# Update frontend/.env
# Set: NEXT_PUBLIC_BACKEND_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com
```

**Edit `frontend/.env`:**
```bash
NEXT_PUBLIC_BACKEND_URL=https://YOUR_API_URL_FROM_STEP_3
```

---

## ✅ Step 6: Test Everything (5 minutes)

### 6.1 Health Check
```bash
curl https://YOUR_API_URL/health
```
**Expected:** `{"ok": true}`

### 6.2 Test Login
```bash
curl -X POST https://YOUR_API_URL/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@example.com","password":"your-password"}'
```
**Expected:** Returns tokens

### 6.3 Test Frontend
1. Open your frontend
2. Sign in
3. Navigate to "My Trips"
4. Verify it works

---

## ✅ Step 7: Verify Features

### 7.1 Coming Soon Image Caching
```bash
# Request image for new city (first time)
curl https://YOUR_API_URL/images/city/TestCity/hero?size=800 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Request again (should use cache)
curl https://YOUR_API_URL/images/city/TestCity/hero?size=800 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Check CloudWatch logs:**
- First request: `"Generated and uploaded coming soon image"`
- Second request: `"Using cached coming soon image"`

**Check S3:**
- Go to S3 → `tripy-city-images` → `coming_soon/`
- Should see `testcity_800.webp`

### 7.2 Background Tasks
- Request image for new city
- Check CloudWatch logs for `tripy-background-tasks`
- Should see curation started

---

## ✅ Step 8: Monitor (Ongoing)

### Check Lambda Metrics
- **CloudWatch** → **Metrics** → **Lambda**
- Check invocations, duration, errors

### Check Costs
- **AWS Cost Explorer** → Filter by **Lambda**
- Should see significant reduction vs App Runner

---

## 🎉 Done!

Your application is now:
- ✅ Running on Lambda (cost-optimized)
- ✅ Caching "coming soon" images (no regeneration)
- ✅ Auto-curating new cities in background

---

## 🆘 Troubleshooting

### Deployment fails?
```bash
# Check AWS credentials
aws sts get-caller-identity

# Check CDK version
cdk --version
```

### Lambda errors?
- Check CloudWatch logs: `/aws/lambda/tripy-api`
- Verify environment variables
- Check IAM permissions

### Images not caching?
- Check S3 bucket permissions
- Verify `CITY_IMAGES_BUCKET` environment variable
- Check CloudWatch logs

---

## 📚 Full Documentation

- **Detailed steps**: See `IMPLEMENTATION_STEPS.md`
- **Lambda migration**: See `LAMBDA_MIGRATION_GUIDE.md`
- **Image caching**: See `COMING_SOON_IMAGE_CACHING.md`
- **Quick start**: See `LAMBDA_QUICK_START.md`
