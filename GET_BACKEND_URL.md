# How to Get Your Production Backend URL

## Quick Answer: Use AWS App Runner (Easiest)

Since you already have `backend/apprunner.yaml`, **AWS App Runner** is the fastest way to get your backend URL.

## Step-by-Step: Deploy with App Runner

### Step 1: Fix Your App Runner Config (Already Done ✅)

Your `apprunner.yaml` has been fixed to use the correct paths.

### Step 2: Deploy to App Runner

1. **Go to AWS App Runner Console**:
   - [AWS Console](https://console.aws.amazon.com/) → Search "App Runner"
   - Click **"Create service"**

2. **Connect Repository**:
   - Source: **"Source code repository"**
   - Provider: **GitHub**
   - Repository: `tripy-team/tripy`
   - Branch: `main`
   - Deployment trigger: **"Automatic"**

3. **Configure Build**:
   - Build type: **"Use a configuration file"**
   - Configuration file: `backend/apprunner.yaml`
   - App Runner will automatically detect it

4. **Configure Service**:
   - Service name: `tripy-backend`
   - Environment variables: **Add all your `.env` variables**:
     ```
     USERS_TABLE=tripy-users
     TRIPS_TABLE=tripy-trips
     TRIP_MEMBERS_TABLE=tripy-trip-members
     POINTS_TABLE=tripy-points
     DESTINATIONS_TABLE=tripy-destinations
     DESTINATION_VOTES_TABLE=tripy-destination-votes
     ITINERARY_TABLE=tripy-itinerary
     USER_POOL_ID=your-pool-id
     USER_POOL_CLIENT_ID=your-client-id
     AWS_REGION=us-east-1
     CORS_ORIGINS=https://your-amplify-url.amplifyapp.com,http://localhost:3000
     ```
     **Important**: Copy all variables from `backend/.env`

5. **Create Service**: Click "Create & deploy"

### Step 3: Get Your URL

After deployment (5-10 minutes):

1. In App Runner Console → Click your service: `tripy-backend`
2. Look for **"Default domain"**: `https://xxxxx.us-east-1.awsapprunner.com`
3. **This is your production backend URL!** ✅

**Test it**:
```bash
curl https://xxxxx.us-east-1.awsapprunner.com/healthz
```

Should return: `{"ok":true}`

---

## Alternative: Check if Already Deployed

If you think your backend might already be deployed, check these places:

### 1. Check App Runner Services

```bash
# Using AWS CLI
aws apprunner list-services --region us-east-1

# Or in AWS Console
# App Runner → Services → Look for services with "tripy" in the name
```

### 2. Check Elastic Beanstalk

```bash
# AWS CLI
aws elasticbeanstalk describe-environments --region us-east-1

# Or in AWS Console
# Elastic Beanstalk → Applications → Environments
```

### 3. Check API Gateway (if using CDK/Lambda)

If you have `infra/` directory with CDK code:

```bash
cd infra
# Check CDK outputs
aws cloudformation describe-stacks --region us-east-1 --stack-name tripy-*

# Or check API Gateway directly
aws apigateway get-rest-apis --region us-east-1
```

### 4. Check EC2 Instances

```bash
# AWS CLI
aws ec2 describe-instances --region us-east-1 --filters "Name=tag:Name,Values=*tripy*"

# Or in AWS Console
# EC2 → Instances → Look for instances with "tripy" in tags
```

---

## Quick Reference: URL Formats

Once deployed, your URL will look like:

| Service | URL Format |
|---------|------------|
| **App Runner** | `https://xxxxx.us-east-1.awsapprunner.com` |
| **Elastic Beanstalk** | `https://xxxxx.elasticbeanstalk.com` |
| **API Gateway** | `https://xxxxx.execute-api.us-east-1.amazonaws.com/prod` |
| **EC2** | `http://your-ec2-ip:8000` or custom domain |
| **Load Balancer** | `http://xxxxx.us-east-1.elb.amazonaws.com` |

---

## After You Get Your URL

1. **Update Amplify Environment Variable**:
   - Go to Amplify Console → App settings → Environment variables
   - Set: `NEXT_PUBLIC_BACKEND_URL=https://your-apprunner-url.com`

2. **Update Backend CORS** (if needed):
   - Add your Amplify URL to App Runner environment variables:
     ```
     CORS_ORIGINS=https://your-amplify-url.amplifyapp.com,http://localhost:3000
     ```
   - Or it's already in your default list if using `backend/src/app.py` defaults

3. **Redeploy Amplify**:
   - Trigger a new build to pick up the environment variable

---

## Recommended: Use App Runner

**Why App Runner?**
- ✅ Easiest setup (you already have the config file)
- ✅ Fully managed (no servers to manage)
- ✅ Auto-scaling
- ✅ Built-in HTTPS
- ✅ GitHub integration
- ✅ Automatic deployments on push

**Your `apprunner.yaml` is ready!** Just:
1. Go to App Runner Console
2. Create service → Connect GitHub
3. It will auto-detect `backend/apprunner.yaml`
4. Add environment variables
5. Deploy → Get your URL ✅
