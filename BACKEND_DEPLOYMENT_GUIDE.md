# Backend Deployment Guide - Getting Your Production URL

This guide shows you how to deploy your FastAPI backend to AWS and get the production URL.

## Quick Options Overview

| Method | Best For | URL Format | Complexity |
|--------|----------|------------|------------|
| **AWS App Runner** | Easy, managed | `https://xxxxx.us-east-1.awsapprunner.com` | ⭐ Easy |
| **Elastic Beanstalk** | Managed, scalable | `https://xxxxx.elasticbeanstalk.com` | ⭐⭐ Medium |
| **EC2 + ALB** | Full control | Custom domain or ALB DNS | ⭐⭐⭐ Advanced |
| **API Gateway + Lambda** | Serverless | `https://xxxxx.execute-api.region.amazonaws.com` | ⭐⭐ Medium |
| **ECS/Fargate** | Containerized | ALB URL or custom domain | ⭐⭐⭐ Advanced |

## Option 1: AWS App Runner (Recommended - Easiest)

AWS App Runner is the **easiest** way to deploy a FastAPI backend.

### Step 1: Prepare App Runner Configuration

Your `backend/apprunner.yaml` already exists. Check it:

```yaml
version: 1.0
runtime: python3
build:
  commands:
    build:
      - pip install -r requirements.txt
run:
  runtime-version: 3.13
  command: uvicorn src.app:app --host 0.0.0.0 --port 8000
  network:
    port: 8000
  env:
    - name: AWS_REGION
      value: us-east-1
```

### Step 2: Create App Runner Service

1. **Go to AWS App Runner Console**:
   - Navigate to [AWS Console](https://console.aws.amazon.com/)
   - Search for "App Runner"
   - Click **"Create service"**

2. **Source Configuration**:
   - Select **"Source code repository"** → GitHub
   - Connect your repository: `tripy-team/tripy`
   - Branch: `main` or `backend`
   - Deployment trigger: **"Automatic"**

3. **Build Settings**:
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn src.app:app --host 0.0.0.0 --port 8000`
   - Or use your `apprunner.yaml` file

4. **Service Settings**:
   - Service name: `tripy-backend`
   - Port: `8000`
   - Environment variables: Add all from your `.env`:
     ```
     USERS_TABLE=tripy-users
     TRIPS_TABLE=tripy-trips
     USER_POOL_ID=your-pool-id
     USER_POOL_CLIENT_ID=your-client-id
     AWS_REGION=us-east-1
     ... (all other env vars)
     ```

5. **Create Service**

### Step 3: Get Your URL

After deployment (5-10 minutes):

1. In App Runner Console → Click your service
2. **Default domain** shows: `https://xxxxx.us-east-1.awsapprunner.com`
3. This is your **production backend URL**! ✅

**Test it**:
```bash
curl https://xxxxx.us-east-1.awsapprunner.com/healthz
```

Should return: `{"ok":true}`

---

## Option 2: Elastic Beanstalk

### Step 1: Create Elastic Beanstalk Application

1. **Go to Elastic Beanstalk Console**:
   - Search for "Elastic Beanstalk"
   - Click **"Create application"**

2. **Application Configuration**:
   - Application name: `tripy-backend`
   - Platform: **Python**
   - Platform branch: **Python 3.13**
   - Platform version: Latest

3. **Configure Environment**:
   - Environment type: **Web server**
   - Application code: **Upload your code** or connect to GitHub

### Step 2: Configure Environment Variables

In Environment configuration → Software → Environment variables:
- Add all your `.env` variables
- Same as App Runner above

### Step 3: Deploy

1. Upload your code or connect GitHub
2. Click **"Create environment"**
3. Wait 5-10 minutes

### Step 4: Get Your URL

After deployment:

1. In Elastic Beanstalk Console → Click your environment
2. **URL** shows: `https://xxxxx.elasticbeanstalk.com`
3. This is your **production backend URL**! ✅

---

## Option 3: EC2 Instance

### Step 1: Launch EC2 Instance

1. **Go to EC2 Console** → **Launch Instance**
2. **Choose AMI**: Ubuntu 22.04 LTS or Amazon Linux 2023
3. **Instance Type**: `t3.small` or larger
4. **Security Group**: Allow HTTP (80) and HTTPS (443)

### Step 2: Connect and Setup

```bash
# SSH into instance
ssh -i your-key.pem ubuntu@your-instance-ip

# Install Python and dependencies
sudo apt update
sudo apt install python3-pip -y
pip3 install -r requirements.txt

# Setup environment variables
nano .env
# Paste your .env file contents

# Install and run with systemd
sudo nano /etc/systemd/system/tripy-backend.service
```

Service file:
```ini
[Unit]
Description=Tripy Backend API
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/tripy/backend
Environment="PATH=/usr/bin"
ExecStart=/usr/bin/python3 -m uvicorn src.app:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl start tripy-backend
sudo systemctl enable tripy-backend
```

### Step 3: Get Your URL

- **Public IP**: `http://your-instance-ip:8000`
- **Or use Application Load Balancer (ALB)**: `http://xxxxx.region.elb.amazonaws.com`
- **Or use custom domain**: Point DNS to ALB

---

## Option 4: API Gateway + Lambda

### Step 1: Create Lambda Function

1. **Go to Lambda Console** → **Create function**
2. **Function name**: `tripy-backend`
3. **Runtime**: Python 3.13
4. **Architecture**: x86_64

### Step 2: Package and Deploy

Use AWS SAM or Serverless Framework, or create a ZIP:

```bash
cd backend
zip -r lambda-deployment.zip . -x "*.pyc" -x "__pycache__/*"
```

Upload to Lambda.

### Step 3: Create API Gateway

1. **Go to API Gateway** → **Create API** → **REST API**
2. **Create resources and methods** pointing to Lambda
3. **Deploy API** → Stage: `prod`

### Step 4: Get Your URL

After deployment:

1. In API Gateway → Stages → `prod`
2. **Invoke URL**: `https://xxxxx.execute-api.us-east-1.amazonaws.com/prod`
3. This is your **production backend URL**! ✅

---

## Option 5: Check Existing Deployment

If you already have a backend deployed somewhere, find it:

### AWS Resources

1. **App Runner**: 
   - Console → App Runner → Services
   - Look for service with your app name

2. **Elastic Beanstalk**:
   - Console → Elastic Beanstalk → Environments
   - Click environment → See URL

3. **EC2**:
   - Console → EC2 → Instances
   - Check Public IP or DNS

4. **API Gateway**:
   - Console → API Gateway → APIs
   - Click API → Stages → See Invoke URL

5. **CloudFormation/CDK**:
   - Check outputs stack for API URLs

### Check Your Infrastructure Code

Look in `infra/` directory:
```bash
cd infra
cat *.ts *.js | grep -i "url\|endpoint\|output"
```

---

## After Getting Your URL

1. **Test the health endpoint**:
   ```bash
   curl https://your-backend-url.com/healthz
   ```

2. **Update Amplify environment variable**:
   - Go to Amplify Console → App settings → Environment variables
   - Set: `NEXT_PUBLIC_BACKEND_URL=https://your-backend-url.com`

3. **Update backend CORS**:
   - Add your Amplify URL to `CORS_ORIGINS` environment variable
   - Or update `backend/src/app.py` default origins

4. **Redeploy Amplify** (if needed):
   - Trigger a new build to pick up the environment variable

---

## Quick Reference: Where to Find URLs

| Service | Where to Find URL |
|---------|------------------|
| **App Runner** | Service → Default domain |
| **Elastic Beanstalk** | Environment → URL |
| **EC2** | Instance → Public IPv4 address |
| **API Gateway** | API → Stages → Invoke URL |
| **Load Balancer** | Load Balancer → DNS name |

---

## Recommended: Use App Runner

For fastest deployment, use **AWS App Runner**:
- ✅ Fully managed
- ✅ Auto-scaling
- ✅ Built-in load balancing
- ✅ Automatic HTTPS
- ✅ Environment variable management
- ✅ GitHub integration

Your `apprunner.yaml` is already configured!
