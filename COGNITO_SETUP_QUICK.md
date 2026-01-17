# Quick Cognito Setup for App Runner

## ⚠️ Error: "USER_POOL_ID not configured"

You're getting this error because authentication requires AWS Cognito credentials.

## 🔧 Quick Fix: Add Cognito Credentials to App Runner

### Step 1: Get Your Cognito Credentials

1. **Go to AWS Cognito Console**:
   - https://console.aws.amazon.com/cognito/home
   - Select your region (e.g., us-east-1)

2. **If you DON'T have a User Pool yet**:
   - Click "Create user pool"
   - Use the "Federated identity" or "User pool" option
   - Follow the wizard:
     - **Sign-in options**: Email ✅
     - **Password policy**: Minimum 8 characters
     - **MFA**: No MFA (for development)
     - **Self-service sign-up**: Enabled ✅
     - **Email verification**: Send code ✅
   - **Important**: When creating app client, **uncheck "Generate client secret"**
   - Complete the setup

3. **Get USER_POOL_ID**:
   - Click on your User Pool
   - Look at the top of the page
   - Copy the "User pool ID" (format: `us-east-1_XXXXXXXXX`)

4. **Get USER_POOL_CLIENT_ID**:
   - Click "App integration" tab (left sidebar)
   - Scroll to "App client list"
   - Click on your app client name
   - Copy the "Client ID" value

### Step 2: Add to apprunner.yaml

Edit `backend/apprunner.yaml` and uncomment these lines:

```yaml
# Change from:
# - name: USER_POOL_ID
#   value: us-east-1_XXXXXXXXX

# To:
- name: USER_POOL_ID
  value: us-east-1_XXXXXXXXX  # Replace with your actual User Pool ID

- name: USER_POOL_CLIENT_ID
  value: xxxxxxxxxxxxxxxxxxxxxx  # Replace with your actual Client ID
```

### Step 3: Commit and Push

```bash
git add backend/apprunner.yaml
git commit -m "Add Cognito credentials for authentication"
git push origin main
```

### Step 4: Wait for App Runner to Redeploy

App Runner will automatically redeploy with the new environment variables (~2-3 minutes).

## ✅ Verify It Works

After redeployment, try signing in again. The authentication should work now.

## 📋 Alternative: Use Existing Cognito Pool

If you already have a Cognito User Pool:

1. Go to AWS Cognito Console
2. Select your User Pool
3. Copy the User Pool ID and Client ID
4. Add them to `apprunner.yaml` as shown above

## 🆘 Still Having Issues?

If you get errors like "User not found" or "Invalid credentials":
- Make sure the User Pool is in the same AWS region (us-east-1)
- Verify the Client ID is correct (no client secret needed)
- Check that the app client has "USER_PASSWORD_AUTH" flow enabled
