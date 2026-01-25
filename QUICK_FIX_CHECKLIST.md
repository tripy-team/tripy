# Quick Fix Checklist for AppRunner Deployment

## ✅ Changes Already Applied

- [x] Added root `/` health check endpoint to `backend/src/app.py`

## 🔧 Steps You Need to Take

### 1. Deploy the Fix (Required)

```bash
# Commit the health check fix
git add backend/src/app.py
git commit -m "Add root health check endpoint for AppRunner"
git push
```

AppRunner will automatically redeploy when it detects the push.

### 2. Verify IAM Permissions (Required)

**Check in AWS Console:**

1. Go to **AWS AppRunner** Console
2. Click on your service
3. Go to **Configuration** → **Security** tab
4. Under **Instance role**, verify a role is attached
5. Click on the role name to view permissions in IAM
6. Ensure the role has:
   - ✅ DynamoDB access to `tripy-*` tables
   - ✅ Cognito access to your user pool
   - ✅ CloudWatch Logs access (for debugging)

**If no role is attached or permissions are missing:**

1. In AppRunner Console → Configuration → Security
2. Click **Edit**
3. Under **Instance role**, select or create a role with DynamoDB and Cognito permissions
4. Click **Save**

### 3. Verify DynamoDB Tables Exist (Required)

**Quick check:**

```bash
# From your project root
cd backend
aws dynamodb list-tables --region us-east-1 | grep tripy
```

**Expected output:**
```
tripy-users
tripy-trips
tripy-trip-members
tripy-points
tripy-destinations
tripy-destination-votes
tripy-itinerary
```

**If tables are missing:**
- Run your CDK deployment to create infrastructure
- OR create tables manually in DynamoDB Console

### 4. Monitor Deployment (Watch for Success)

**In AppRunner Console:**

1. Go to **Deployments** tab
2. Wait for deployment to complete (usually 5-10 minutes)
3. Check status:
   - ✅ **Running** = Success!
   - ❌ **Failed** = See troubleshooting below

**Check the logs:**

1. Go to **Logs** tab
2. Look for these success indicators:
   ```
   ✅ "Uvicorn running on http://0.0.0.0:8000"
   ✅ "Application startup complete"
   ✅ Health check responses returning 200
   ```

### 5. Test Your Deployed API (Verify It Works)

Once deployment succeeds:

```bash
# Replace with your actual AppRunner service URL
export API_URL="https://your-service.us-east-1.awsapprunner.com"

# Test health check
curl $API_URL/
# Expected: {"status":"ok","service":"tripy-api"}

curl $API_URL/healthz
# Expected: {"status":"ok"}

# Test city search (no auth required)
curl "$API_URL/cities/search?query=paris&max_results=3"
# Expected: JSON with city results
```

## 🚨 Troubleshooting

### If deployment still fails:

#### Check Application Logs
```bash
# View recent logs
aws logs tail /aws/apprunner/your-service-name --follow
```

#### Common Errors and Solutions

| Error Message | Solution |
|---------------|----------|
| `Required environment variable '...' is not set` | Add missing variable to `apprunner.yaml` |
| `ResourceNotFoundException: Table not found` | Create DynamoDB tables or fix table names |
| `An error occurred (AccessDenied)` | Fix IAM role permissions |
| `No module named '...'` | Add missing package to `requirements.txt` |
| `botocore.exceptions.NoCredentialsError` | Attach IAM instance role to AppRunner service |

#### Still stuck?

1. **Check CloudWatch Logs**: AppRunner Console → Logs → View full logs
2. **Test locally with Docker**:
   ```bash
   cd backend
   docker build -t tripy-backend .
   docker run -p 8000:8000 --env-file .env tripy-backend
   ```
3. **Verify Python dependencies**: Check that all packages in `requirements.txt` are compatible with Python 3.8/3.9

## ⏱️ Timeline

- **Step 1-2**: 5 minutes (commit and verify IAM)
- **Step 3**: 2 minutes (verify tables)
- **Step 4**: 5-10 minutes (deployment)
- **Step 5**: 2 minutes (testing)

**Total**: ~15-20 minutes to deploy and verify

## ✨ Success Indicators

You'll know it worked when:

1. ✅ AppRunner Console shows status: **Running**
2. ✅ Health check shows: **Passing**
3. ✅ API responds to curl commands
4. ✅ No error messages in logs
5. ✅ Frontend can connect to backend API

## 📞 Need Help?

If you're still stuck after following these steps:

1. Check `DEPLOYMENT_FIX.md` for detailed troubleshooting
2. Share the exact error message from CloudWatch Logs
3. Verify all environment variables match your actual AWS resources
