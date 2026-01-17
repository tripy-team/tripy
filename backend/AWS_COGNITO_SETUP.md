# AWS Cognito Setup Guide

This guide walks you through setting up AWS Cognito for user authentication.

## Option 1: Create New Cognito User Pool (Recommended for First Time)

### Step 1: Open AWS Cognito Console

1. Go to [AWS Console](https://console.aws.amazon.com/)
2. Sign in to your AWS account
3. Search for "Cognito" in the top search bar
4. Click on **Amazon Cognito**

### Step 2: Create User Pool

1. Click **"Create user pool"** button
2. **Sign-in options**: Select:
   - ✅ Email
   - ✅ Allow users to sign in with preferred username (optional)
3. Click **"Next"**

### Step 3: Configure Security

1. **Password policy**:
   - Minimum length: `8` (or your preference)
   - ✅ Require uppercase letters
   - ✅ Require lowercase letters  
   - ✅ Require numbers
   - ✅ Require special characters

2. **Multi-factor authentication**: 
   - Choose **"No MFA"** for development (or **"Optional MFA"** for production)

3. **User account recovery**:
   - ✅ Enable self-service account recovery
   - Select **"Email only"**

4. Click **"Next"**

### Step 4: Configure Sign-up Experience

1. **Self-service sign-up**:
   - ✅ Enable self-registration

2. **Cognito-assisted verification**:
   - ✅ Send email verification code
   - Or: ✅ Send email with verification link

3. **Required attributes**:
   - ✅ Email (should already be selected)
   - You can add `given_name` and `family_name` if you want

4. Click **"Next"**

### Step 5: Configure Message Delivery

1. **Send email**:
   - Choose **"Send email with Cognito"** (free tier) for development
   - Or configure SES for production

2. Click **"Next"**

### Step 6: Integrate Your App

1. **User pool name**: Enter `tripy-user-pool` (or any name you prefer)

2. **App client name**: Enter `tripy-webapp`

3. **Client secret**: 
   - ✅ **DO NOT generate a client secret** (uncheck this box)
   - FastAPI uses `USER_PASSWORD_AUTH` flow which requires no client secret

4. Click **"Next"**

### Step 7: Review and Create

1. Review all settings
2. Click **"Create user pool"**

### Step 8: Get Your Credentials

After creation, you'll see the User Pool details page:

1. **User Pool ID**: 
   - Look at the top of the page
   - Format: `us-west-2_XXXXXXXXX` (or your region)
   - **Copy this!**

2. **App Client ID**:
   - Click on **"App integration"** tab (left sidebar)
   - Scroll down to **"App client list"**
   - Click on your app client (`tripy-webapp`)
   - Copy the **Client ID** value

3. **Region**:
   - Note the AWS region shown at the top (e.g., `us-west-2`, `us-east-1`)

## Option 2: Use Existing Cognito User Pool

If you already have a Cognito User Pool:

1. Go to AWS Cognito Console
2. Click on your User Pool
3. **User Pool ID**: Copy from the top of the page
4. Click **"App integration"** tab → **"App client list"** → Click your app client → Copy **Client ID**

## Add Credentials to .env File

Once you have the credentials, edit `backend/.env`:

```bash
USER_POOL_ID=us-west-2_ABC123XYZ      # Your User Pool ID
USER_POOL_CLIENT_ID=1a2b3c4d5e6f7g8h  # Your Client ID
AWS_REGION=us-west-2                   # Your AWS region
```

## Verify Configuration

Run the config checker:

```bash
cd backend
python3 check_env.py
```

You should see:
```
✅ USER_POOL_ID = us-west-2_ABC...
✅ USER_POOL_CLIENT_ID = 1a2b3c...
✅ AWS_REGION = us-west-2
```

## Test Authentication

After starting the backend server, you can test signup:

1. Start backend: `./start_server.sh`
2. Test signup via frontend at http://localhost:3000/register
3. Check your email for verification code (if enabled)
4. Verify user was created in AWS Cognito Console → Users tab

## Troubleshooting

### "USER_POOL_ID not configured"
- Make sure you've added `USER_POOL_ID` to `backend/.env`
- No quotes needed: `USER_POOL_ID=us-west-2_ABC123` (not `USER_POOL_ID="us-west-2_ABC123"`)

### "Invalid client id"
- Verify `USER_POOL_CLIENT_ID` is correct
- Make sure there's no client secret generated (should be unchecked during app client creation)

### "User pool does not exist"
- Verify `USER_POOL_ID` is correct
- Check `AWS_REGION` matches the region where your User Pool was created

### "UnauthorizedException" when signing up
- Check that self-service sign-up is enabled in User Pool settings
- Verify email verification is configured correctly

## AWS Credentials for Local Development

If running locally, you need AWS credentials configured:

**Option 1: AWS CLI (Recommended)**
```bash
aws configure
```
Enter your Access Key ID and Secret Access Key.

**Option 2: Environment Variables**
Add to `backend/.env`:
```bash
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

**Option 3: IAM Role (for EC2/Lambda)**
If running on AWS infrastructure, use IAM roles instead of credentials.

## Next Steps

Once Cognito is configured:

1. ✅ Start backend server: `./start_server.sh`
2. ✅ Test signup: http://localhost:3000/register
3. ✅ Test login: http://localhost:3000/login
4. ✅ Verify users in Cognito Console → Users tab
