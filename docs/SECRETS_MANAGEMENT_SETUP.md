# Tripy Secrets Management Setup Guide

This guide explains how to securely manage secrets for Tripy in both development and production environments.

## Table of Contents

1. [Overview](#overview)
2. [Local Development Setup](#local-development-setup)
3. [Production Setup with AWS Secrets Manager](#production-setup-with-aws-secrets-manager)
4. [IAM Role Setup (Recommended for Production)](#iam-role-setup-recommended-for-production)
5. [Migration Checklist](#migration-checklist)
6. [Troubleshooting](#troubleshooting)

---

## Overview

Tripy uses a **hybrid secrets management approach**:

| Environment | Method | Configuration |
|-------------|--------|---------------|
| Local Development | `.env` file | `USE_SECRETS_MANAGER=false` (default) |
| Production | AWS Secrets Manager | `USE_SECRETS_MANAGER=true` |

**Benefits:**
- 🔐 Secrets never stored in code or git
- 🔄 Easy secret rotation without redeployment
- 📝 Audit trail via AWS CloudTrail
- 🚀 Seamless local development experience

---

## Local Development Setup

### Step 1: Create Your `.env` File

```bash
# From the project root
cp .env.example .env
```

### Step 2: Fill in Your Secrets

Edit `.env` with your actual values:

```bash
# API Keys
SERP_API_KEY=your_actual_serp_api_key
AWARDTOOL_API_KEY=your_actual_awardtool_key
OPENAI_ADMIN_KEY=sk-your_actual_openai_key
CLAUDE_API_KEY=sk-ant-your_actual_claude_key
AMADEUS_CLIENT_ID=your_amadeus_client_id
AMADEUS_CLIENT_SECRET=your_amadeus_secret
```

### Step 3: Verify `.env` is Gitignored

```bash
# This should show .env is ignored
git check-ignore .env
# Output: .env
```

### Step 4: Start Development

```bash
./start-local.sh
```

The backend will log:
```
[CONFIG] SECRETS: Using environment variables (.env) for API keys
```

---

## Production Setup with AWS Secrets Manager

### Step 1: Create the Secret in AWS

#### Option A: Using AWS Console

1. Go to **AWS Secrets Manager** in the AWS Console
2. Click **Store a new secret**
3. Choose **Other type of secret**
4. Select **Plaintext** tab and paste this JSON:

```json
{
    "OPENAI_ADMIN_KEY": "sk-your-actual-openai-key",
    "CLAUDE_API_KEY": "sk-ant-your-actual-claude-key",
    "SERP_API_KEY": "your-actual-serp-key",
    "AWARDTOOL_API_KEY": "your-actual-awardtool-key",
    "AMADEUS_CLIENT_ID": "your-amadeus-client-id",
    "AMADEUS_CLIENT_SECRET": "your-amadeus-secret"
}
```

5. Click **Next**
6. Name the secret: `tripy/production/api-keys`
7. Add tags (optional but recommended):
   - `Environment`: `production`
   - `Application`: `tripy`
8. Complete the wizard

#### Option B: Using AWS CLI

```bash
# Create the secret
aws secretsmanager create-secret \
    --name "tripy/production/api-keys" \
    --description "API keys for Tripy production" \
    --secret-string '{
        "OPENAI_ADMIN_KEY": "sk-your-actual-openai-key",
        "CLAUDE_API_KEY": "sk-ant-your-actual-claude-key",
        "SERP_API_KEY": "your-actual-serp-key",
        "AWARDTOOL_API_KEY": "your-actual-awardtool-key",
        "AMADEUS_CLIENT_ID": "your-amadeus-client-id",
        "AMADEUS_CLIENT_SECRET": "your-amadeus-secret"
    }' \
    --region us-east-1

# Verify it was created
aws secretsmanager describe-secret \
    --secret-id "tripy/production/api-keys" \
    --region us-east-1
```

### Step 2: Grant IAM Permissions

Your application needs permission to read the secret. Create this IAM policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "ReadTripySecrets",
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret"
            ],
            "Resource": [
                "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:tripy/production/api-keys*"
            ]
        }
    ]
}
```

Attach this policy to:
- **App Runner**: Service's instance role
- **ECS**: Task execution role
- **Lambda**: Function execution role
- **EC2**: Instance profile

### Step 3: Configure Environment Variables

Set these environment variables in your production environment:

```bash
USE_SECRETS_MANAGER=true
SECRETS_MANAGER_SECRET_NAME=tripy/production/api-keys
AWS_REGION=us-east-1
```

**For AWS App Runner** (`apprunner.yaml`):
```yaml
services:
  backend:
    environment:
      USE_SECRETS_MANAGER: "true"
      SECRETS_MANAGER_SECRET_NAME: "tripy/production/api-keys"
      AWS_REGION: "us-east-1"
      # DynamoDB tables (non-sensitive)
      USERS_TABLE: "tripy-users"
      TRIPS_TABLE: "tripy-trips"
      # ... other non-sensitive config
```

### Step 4: Verify Production Setup

The backend will log:
```
[SECRETS] Using AWS Secrets Manager: tripy/production/api-keys (region: us-east-1)
[SECRETS] Loaded 6 secrets from AWS Secrets Manager
[CONFIG] SECRETS: Using AWS Secrets Manager for API keys
```

---

## IAM Role Setup (Recommended for Production)

**Remove AWS access keys entirely** by using IAM roles. This is more secure because:
- No static credentials to manage or rotate
- Credentials are automatically rotated by AWS
- No risk of credential leakage

### For AWS App Runner

1. Go to **IAM** → **Roles**
2. Create a new role with **App Runner** as trusted entity
3. Attach policies:
   - `AmazonDynamoDBFullAccess` (or a custom policy)
   - `AmazonSESFullAccess` (for email)
   - `AmazonS3ReadOnlyAccess` (for images)
   - The custom Secrets Manager policy from Step 2

4. In App Runner, configure the service to use this role

### For ECS/Fargate

```json
{
    "taskRoleArn": "arn:aws:iam::YOUR_ACCOUNT:role/tripy-ecs-task-role",
    "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT:role/tripy-ecs-execution-role"
}
```

### For Lambda

Attach the policy to your Lambda execution role via the console or:

```bash
aws iam attach-role-policy \
    --role-name tripy-lambda-role \
    --policy-arn arn:aws:iam::YOUR_ACCOUNT:policy/TripySecretsManagerRead
```

---

## Migration Checklist

### Before Migration

- [ ] Create `.env.example` template (already done)
- [ ] Implement secrets manager module (already done)
- [ ] Update config to use secrets manager (already done)

### AWS Setup

- [ ] Create secret in AWS Secrets Manager
- [ ] Create IAM policy for secret access
- [ ] Attach policy to your compute service's IAM role

### Production Deployment

- [ ] Set `USE_SECRETS_MANAGER=true` in production environment
- [ ] Set `SECRETS_MANAGER_SECRET_NAME=tripy/production/api-keys`
- [ ] Remove hardcoded secrets from `apprunner.yaml` or deployment configs
- [ ] Remove `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from production env
- [ ] Deploy and verify logs show "Using AWS Secrets Manager"

### Post-Migration

- [ ] Rotate all API keys that were previously in `.env` or config files
- [ ] Remove any old secrets from deployment configs
- [ ] Set up CloudWatch alarms for secret access errors

---

## Troubleshooting

### "Secret not found" Error

```
[SECRETS] Secret 'tripy/production/api-keys' not found
```

**Solution:** Verify the secret exists and name matches exactly:
```bash
aws secretsmanager list-secrets --region us-east-1 | grep tripy
```

### "Access denied" Error

```
[SECRETS] Access denied to secret 'tripy/production/api-keys'
```

**Solution:** Check IAM permissions:
```bash
# Test if your role can access the secret
aws secretsmanager get-secret-value \
    --secret-id "tripy/production/api-keys" \
    --region us-east-1
```

### Falling Back to Environment Variables

If AWS Secrets Manager fails, the system automatically falls back to environment variables. Check logs for:
```
[SECRETS] AWS Secrets Manager error: ...
```

### Testing Secrets Manager Locally

You can test AWS Secrets Manager locally if you have AWS credentials configured:

```bash
# In .env
USE_SECRETS_MANAGER=true
SECRETS_MANAGER_SECRET_NAME=tripy/dev/api-keys  # Use a dev secret

# Make sure AWS credentials are configured
aws configure list
```

---

## Secret Rotation

### Manual Rotation

```bash
# Update secret value
aws secretsmanager put-secret-value \
    --secret-id "tripy/production/api-keys" \
    --secret-string '{"OPENAI_ADMIN_KEY": "new-key-value", ...}'

# Restart your application to pick up new values
# Or call the refresh endpoint if implemented
```

### Automatic Rotation

For automatic rotation, configure a Lambda rotation function. See:
https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html

---

## Cost Considerations

AWS Secrets Manager pricing (as of 2024):
- $0.40 per secret per month
- $0.05 per 10,000 API calls

For Tripy with ~6 secrets and moderate traffic, expect ~$3-5/month.

**Cost optimization:**
- Secrets are cached in memory after first load
- Only refreshed on application restart
- Consider using AWS SSM Parameter Store for non-rotating secrets ($0/month for standard parameters)

---

## Files Modified

| File | Description |
|------|-------------|
| `.env.example` | Template for environment variables |
| `backend/src/utils/secrets_manager.py` | Centralized secrets management module |
| `backend/src/config/__init__.py` | Updated to use secrets manager |

---

## Next Steps

1. **Immediate:** Create the AWS Secrets Manager secret
2. **Before next deploy:** Update your deployment config to use secrets manager
3. **After deploy:** Rotate all API keys
4. **Ongoing:** Monitor CloudWatch for secret access patterns
