# Fix "USER_POOL_ID not configured" Error

## 🚨 Error: `USER_POOL_ID not configured`

This error occurs because the Cognito credentials are not set in `backend/apprunner.yaml`.

---

## ✅ Quick Fix Steps

### Step 1: Get Your Cognito Credentials

You have two options:

#### Option A: Use the Helper Script (Easiest)
```bash
cd backend
./get_cognito_credentials.sh
```

This will guide you through finding your credentials.

#### Option B: Get Them Manually

1. **Go to AWS Cognito Console**:
   - https://console.aws.amazon.com/cognito/home
   - Select your region (e.g., `us-east-1`)

2. **Get USER_POOL_ID**:
   - Click on your User Pool name
   - Look at the top of the page
   - Copy the **User pool ID** (format: `us-east-1_XXXXXXXXX`)
   - Example: `us-east-1_A1B2C3D4E`

3. **Get USER_POOL_CLIENT_ID**:
   - Click **App integration** tab (left sidebar)
   - Scroll to **App client list**
   - Click on your app client name
   - Copy the **Client ID** value
   - Example: `1a2b3c4d5e6f7g8h9i0j1k2l3m`

4. **Get AWS_REGION**:
   - Note the region shown in the URL or top of page
   - Common: `us-east-1`, `us-west-2`, `eu-west-1`

---

### Step 2: Update `backend/apprunner.yaml`

Open `backend/apprunner.yaml` and find lines 33-37:

```yaml
# REQUIRED FOR AUTH - Cognito Configuration
- name: USER_POOL_ID
  value: us-east-1_XXXXXXXXX  # REPLACE WITH YOUR ACTUAL USER POOL ID
- name: USER_POOL_CLIENT_ID
  value: xxxxxxxxxxxxxxxxxxxxxx  # REPLACE WITH YOUR ACTUAL CLIENT ID
```

**Replace the placeholder values** with your actual credentials:

```yaml
# REQUIRED FOR AUTH - Cognito Configuration
- name: USER_POOL_ID
  value: us-east-1_A1B2C3D4E  # Your actual User Pool ID
- name: USER_POOL_CLIENT_ID
  value: 1a2b3c4d5e6f7g8h9i0j1k2l3m  # Your actual Client ID
```

---

### Step 3: Deploy to App Runner

After updating `apprunner.yaml`:

1. **Commit the changes**:
   ```bash
   git add backend/apprunner.yaml
   git commit -m "Add Cognito credentials to App Runner config"
   git push
   ```

2. **App Runner will auto-deploy**:
   - If you have auto-deployment enabled, App Runner will rebuild automatically
   - If not, manually trigger a new deployment in AWS Console

3. **Verify the deployment**:
   - Check App Runner logs to ensure no errors
   - Test the `/auth/login` endpoint

---

## 📋 Example Configuration

After updating, your `apprunner.yaml` should look like:

```yaml
run:
  env:
    - name: AWS_REGION
      value: us-east-1
    - name: PYTHONPATH
      value: /app/backend
    # ... DynamoDB tables ...
    # REQUIRED FOR AUTH - Cognito Configuration
    - name: USER_POOL_ID
      value: us-east-1_A1B2C3D4E5F6G7H8I9J0
    - name: USER_POOL_CLIENT_ID
      value: 1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p7q8r9s0t
```

---

## 🔍 Verify Your Setup

### Check if credentials are set correctly:

```bash
# In App Runner logs, you should NOT see:
# ValueError: USER_POOL_ID not configured

# Instead, you should see:
# Starting FastAPI server on http://0.0.0.0:8000
```

### Test the authentication endpoint:

```bash
# This should work (replace with your App Runner URL)
curl -X POST https://xezfenhu6t.us-east-1.awsapprunner.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123456"}'

# Should return tokens or an authentication error (not "USER_POOL_ID not configured")
```

---

## ⚠️ Troubleshooting

### Error persists after updating `apprunner.yaml`

1. **Check App Runner deployment status**:
   - Go to AWS App Runner Console
   - Check if deployment succeeded
   - View logs to see if new config is loaded

2. **Verify YAML syntax**:
   - Make sure there are no extra spaces or indentation issues
   - The `value:` line should have the actual ID, not placeholder

3. **Check environment variables in App Runner Console**:
   - Go to your App Runner service
   - Click **Configuration** tab
   - Click **Edit**
   - Check **Environment variables** section
   - Verify `USER_POOL_ID` and `USER_POOL_CLIENT_ID` are set

### "User pool not found" error

- Verify the `USER_POOL_ID` is correct (check for typos)
- Verify the `AWS_REGION` matches your User Pool region
- Ensure the User Pool exists in the specified region

### "Invalid client ID" error

- Verify the `USER_POOL_CLIENT_ID` is correct
- Ensure the Client ID belongs to the specified User Pool
- Check if the app client is enabled

---

## 📝 Quick Reference

**File to update**: `backend/apprunner.yaml`

**Lines to modify**: 33-37

**Required values**:
- `USER_POOL_ID`: Format `us-east-1_XXXXXXXXX`
- `USER_POOL_CLIENT_ID`: Long alphanumeric string
- `AWS_REGION`: Should match your User Pool region

**Where to find them**:
- AWS Cognito Console → Your User Pool → Top of page (Pool ID)
- AWS Cognito Console → App integration → App client list (Client ID)

---

## 🎯 Next Steps After Fix

Once the credentials are set:

1. ✅ App Runner will rebuild automatically (or trigger manual deployment)
2. ✅ Backend should start without the `USER_POOL_ID not configured` error
3. ✅ Frontend can now authenticate users via Cognito
4. ✅ Test login/signup from the frontend

---

**Need help?** Run `cd backend && ./get_cognito_credentials.sh` for guided setup.
