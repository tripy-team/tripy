# Fix "Unable to locate credentials" Error in App Runner

## 🚨 Error: `Database operation failed: Unable to locate credentials`

This error occurs because App Runner doesn't have an IAM role configured with permissions to access DynamoDB and Cognito.

---

## ✅ Solution: Create IAM Role Manually (App Runner Not in Dropdown)

Since "App Runner" may not appear in the AWS service dropdown, we'll create the role manually with the correct trust relationship.

---

## 📋 Step-by-Step Setup

### Step 1: Create IAM Role Manually

1. **Go to IAM Console**:
   - https://console.aws.amazon.com/iam/
   - Click **Roles** (left sidebar)
   - Click **Create role**

2. **Select Trust Entity** (Workaround):
   - **Trusted entity type**: `AWS service`
   - **Use case**: Select **EC2** or **Lambda** (we'll edit this later)
   - Click **Next**

3. **Add Permissions**:
   - Search for and select: `AmazonDynamoDBFullAccess`
   - Search for and select: `AmazonCognitoPowerUser`
   - (Optional) Search for and select: `AmazonKinesisFirehoseFullAccess`
   - Click **Next**

4. **Name the Role**:
   - **Role name**: `TripyAppRunnerRole` (or your preferred name)
   - **Description**: `IAM role for Tripy App Runner service to access DynamoDB and Cognito`
   - Click **Create role**

5. **Edit Trust Relationship** (CRITICAL STEP):
   - After creating, click on the role name
   - Click **Trust relationships** tab
   - Click **Edit trust policy**
   - **Delete** the existing JSON and replace with:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Service": "tasks.apprunner.amazonaws.com"
         },
         "Action": "sts:AssumeRole"
       }
     ]
   }
   ```
   - Click **Update policy**
   - ✅ You should see: "Trust policy updated successfully"

6. **Verify Permissions**:
   - Click **Permissions** tab
   - Verify you see:
     - `AmazonDynamoDBFullAccess`
     - `AmazonCognitoPowerUser`
     - (Optional) `AmazonKinesisFirehoseFullAccess`

---

### Step 2: Attach IAM Role to App Runner Service

1. **Go to App Runner Console**:
   - https://console.aws.amazon.com/apprunner/
   - Click on your service name (e.g., `tripy-backend`)

2. **Edit Configuration**:
   - Click **Configuration** tab
   - Click **Edit**

3. **Set IAM Role**:
   - Scroll down to find **Security** section (may be near the bottom)
   - Look for **Access role** or **Instance role** field
   - Click the dropdown and select your role: `TripyAppRunnerRole`
   - If you don't see it, make sure the trust policy was updated correctly

4. **Save Configuration**:
   - Scroll to bottom and click **Save changes**
   - App Runner will start a new deployment
   - ⏱️ Wait 3-5 minutes for deployment to complete

5. **Check Deployment Status**:
   - Go to **Overview** tab
   - Check **Deployment status** shows "Running" (green)
   - If errors, check **Logs** tab

---

### Step 3: Verify It Works

After deployment completes, test:

```bash
# Test health endpoint
curl https://xezfenhu6t.us-east-1.awsapprunner.com/healthz
# Should return: {"status":"ok"}

# Test database operation (signup)
curl -X POST https://xezfenhu6t.us-east-1.awsapprunner.com/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123456","firstName":"Test","lastName":"User"}'
# Should work (or return Cognito error, NOT "Unable to locate credentials")
```

---

## 🔧 Alternative: Create Role via AWS CLI

If you prefer using AWS CLI:

```bash
# 1. Create role with trust policy
aws iam create-role \
  --role-name TripyAppRunnerRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "tasks.apprunner.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'

# 2. Attach DynamoDB permissions
aws iam attach-role-policy \
  --role-name TripyAppRunnerRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess

# 3. Attach Cognito permissions
aws iam attach-role-policy \
  --role-name TripyAppRunnerRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonCognitoPowerUser

# 4. Verify
aws iam get-role --role-name TripyAppRunnerRole
aws iam list-attached-role-policies --role-name TripyAppRunnerRole
```

---

## 🚨 Troubleshooting

### "App Runner" not in service dropdown

**Solution**: This is normal! Use the manual steps above:
1. Select **EC2** or **Lambda** as placeholder
2. After creating, edit the **Trust relationships** tab
3. Update trust policy to use `tasks.apprunner.amazonaws.com`

### "Access role" field not visible in App Runner Console

**Solution**: 
- Look for **Security** section (may be collapsed)
- If still not visible, check App Runner service is in a supported region
- Try refreshing the page or using a different browser

### "Unable to assume role" error

**Issue**: Trust relationship not correct

**Fix**:
- Go to IAM Console → Roles → Your role → **Trust relationships** tab
- Verify the JSON uses `"Service": "tasks.apprunner.amazonaws.com"`
- Make sure there are no typos in the service name

### Role attached but still "Unable to locate credentials"

**Solutions**:
1. **Wait for deployment**: Changes take 3-5 minutes to apply
2. **Check role permissions**: Verify DynamoDB and Cognito policies are attached
3. **Verify trust relationship**: Must be `tasks.apprunner.amazonaws.com`
4. **Check logs**: App Runner Console → Logs tab for detailed errors

---

## 📝 Quick Checklist

- [ ] IAM role created (`TripyAppRunnerRole`)
- [ ] Trust relationship updated to `tasks.apprunner.amazonaws.com`
- [ ] `AmazonDynamoDBFullAccess` policy attached
- [ ] `AmazonCognitoPowerUser` policy attached
- [ ] Role selected in App Runner Configuration → Security → Access role
- [ ] Configuration saved and deployment completed
- [ ] Tested `/healthz` endpoint (works)
- [ ] Tested database operation (no credential errors)

---

## 📋 Trust Policy Template

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "tasks.apprunner.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

**Important**: The service principal must be exactly `tasks.apprunner.amazonaws.com` (not `apprunner.amazonaws.com`)

---

## ✅ After Setup

Once the IAM role is attached and deployment completes:
- ✅ Backend can access DynamoDB tables
- ✅ Backend can authenticate users via Cognito
- ✅ No more "Unable to locate credentials" errors

---

**Need help?** Check App Runner logs in the AWS Console for detailed error messages.
