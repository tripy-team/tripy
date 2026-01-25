# AppRunner Deployment Fix

## Issue Summary
Your AppRunner deployment is failing after a successful build. The build phase completed successfully, but the deployment phase failed with "Failed to deploy your application source code."

## Root Causes

### 1. **Health Check Endpoint Mismatch** (Primary Issue)
- **Problem**: Your app has a health check at `/healthz`, but AppRunner's default health check path is `/`
- **Impact**: AppRunner can't verify the application is running, causing deployment to fail
- **Status**: ✅ **FIXED** - Added root `/` health check endpoint

### 2. **IAM Role Permissions** (Potential Issue)
- **Problem**: The DynamoDB resource is initialized at module import time (`ddb.py` line 27-35)
- **Impact**: If the App Runner service doesn't have proper IAM permissions, the app will fail to start
- **Required Permissions**:
  - `dynamodb:GetItem`
  - `dynamodb:PutItem`
  - `dynamodb:Query`
  - `dynamodb:Scan`
  - `dynamodb:UpdateItem`
  - `dynamodb:DeleteItem`
  - Access to all tables: `tripy-users`, `tripy-trips`, `tripy-trip-members`, `tripy-points`, `tripy-destinations`, `tripy-destination-votes`, `tripy-itinerary`
  - `cognito-idp:*` for authentication

### 3. **DynamoDB Tables Must Exist** (Potential Issue)
- **Problem**: If the DynamoDB tables don't exist, the app will fail when trying to access them
- **Required Tables** (as configured in `apprunner.yaml`):
  - `tripy-users`
  - `tripy-trips`
  - `tripy-trip-members`
  - `tripy-points`
  - `tripy-destinations`
  - `tripy-destination-votes`
  - `tripy-itinerary`

## Solutions Applied

### ✅ 1. Added Root Health Check Endpoint
Added a root `/` endpoint to `backend/src/app.py` to match AppRunner's default health check path:

```python
@app.get("/")
def root_health():
    """Root health check endpoint for AppRunner"""
    return {"status": "ok", "service": "tripy-api"}
```

## Additional Steps Required

### Step 1: Verify IAM Role Permissions

1. Go to AWS AppRunner Console
2. Select your service
3. Go to **Configuration** → **Security**
4. Verify the **Instance role** has permissions to:
   - Access DynamoDB tables
   - Access Cognito User Pool
   - (Optional) Write to CloudWatch Logs

If no role is attached, create one with these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:DescribeTable"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:*:table/tripy-*",
        "arn:aws:dynamodb:us-east-1:*:table/tripy-*/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cognito-idp:InitiateAuth",
        "cognito-idp:SignUp",
        "cognito-idp:ConfirmSignUp",
        "cognito-idp:GetUser",
        "cognito-idp:ForgotPassword",
        "cognito-idp:ConfirmForgotPassword"
      ],
      "Resource": "arn:aws:cognito-idp:us-east-1:*:userpool/us-east-1_zCMCjyTLJ"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

### Step 2: Verify DynamoDB Tables Exist

Run this command to check if tables exist:

```bash
cd backend
./get_dynamodb_tables_simple.sh
```

Or manually check in AWS Console:
1. Go to DynamoDB Console
2. Verify all tables exist: `tripy-users`, `tripy-trips`, etc.
3. Ensure they're in the `us-east-1` region

### Step 3: Deploy the Fix

Commit and push the changes:

```bash
git add backend/src/app.py
git commit -m "Fix AppRunner health check endpoint"
git push
```

AppRunner will automatically detect the changes and redeploy.

### Step 4: Monitor Deployment

Watch the deployment logs in AppRunner Console:
1. Go to AWS AppRunner Console
2. Select your service
3. Go to **Logs** tab
4. Watch for:
   - ✅ "Uvicorn running on http://0.0.0.0:8000"
   - ✅ Health check success messages
   - ❌ Any error messages about missing tables, permissions, or configuration

## Alternative: Configure Custom Health Check Path

Instead of adding a root endpoint, you can configure AppRunner to use `/healthz`:

1. Go to AWS AppRunner Console
2. Select your service
3. Go to **Configuration** → **Health check**
4. Change **Health check path** to `/healthz`
5. Click **Save**
6. Redeploy the service

## Troubleshooting

### If deployment still fails:

1. **Check CloudWatch Logs**:
   - Go to CloudWatch → Log groups
   - Find your AppRunner service log group
   - Look for Python stack traces or error messages

2. **Check Application Logs**:
   - In AppRunner Console → Logs
   - Look for startup errors like:
     - `ModuleNotFoundError` (missing dependencies)
     - `ValueError: Required environment variable` (missing config)
     - `botocore.exceptions.NoCredentialsError` (IAM role issue)
     - `ResourceNotFoundException` (DynamoDB table doesn't exist)

3. **Test Locally with Docker**:
   ```bash
   cd backend
   docker build -t tripy-backend .
   docker run -p 8000:8000 --env-file .env tripy-backend
   ```
   
   Then visit http://localhost:8000 and http://localhost:8000/healthz

4. **Check Environment Variables**:
   - Verify all variables in `apprunner.yaml` are correct
   - Especially `USER_POOL_ID`, `USER_POOL_CLIENT_ID`, and table names

## Expected Behavior After Fix

Once deployed successfully, you should see:

1. **In AppRunner Console**:
   - Status: Running ✅
   - Health check: Passing ✅
   - Application endpoint: Active and responding

2. **When accessing your API**:
   - `GET /` → `{"status": "ok", "service": "tripy-api"}`
   - `GET /healthz` → `{"status": "ok"}`
   - Other endpoints working correctly

## Security Notes

⚠️ **API Keys Exposed in `apprunner.yaml`**: The file contains sensitive API keys:
- `OPENAI_ADMIN_KEY`
- `SERP_API_KEY`
- `AWARDTOOL_API_KEY`
- `UNSPLASH_ACCESS_KEY`
- `UNSPLASH_SECRET_KEY`
- `PEXELS_API_KEY`

**Recommendation**: Store these in AWS Secrets Manager and reference them in AppRunner configuration instead of hardcoding them in the YAML file.
