# AWS Amplify Deployment Guide

This guide walks you through deploying your Next.js frontend to AWS Amplify.

## Prerequisites

1. ✅ AWS Account
2. ✅ GitHub repository with your code
3. ✅ `amplify.yml` file in repository root (already created)
4. ✅ Backend API URL (where your FastAPI backend is deployed)

## Step 1: Push Code to GitHub

Make sure your code is committed and pushed to GitHub:

```bash
git add .
git commit -m "Prepare for Amplify deployment"
git push origin main
```

**Important**: Make sure `amplify.yml` is committed to your repository root.

## Step 2: Create Amplify App

1. **Go to AWS Amplify Console**:
   - Navigate to [AWS Console](https://console.aws.amazon.com/)
   - Search for "Amplify"
   - Click **"AWS Amplify"**

2. **Create New App**:
   - Click **"New app"** → **"Host web app"**
   - Choose **"GitHub"** as your source
   - Authorize AWS Amplify to access your GitHub (first time only)
   - Select your repository: `tripy-team/tripy`
   - Select branch: `main` (or your default branch)
   - Click **"Next"**

## Step 3: Configure Build Settings

AWS Amplify will auto-detect `amplify.yml` in your repository. Verify the settings:

- **App root**: Should auto-detect `frontend/`
- **Build command**: `npm run build`
- **Start command**: (Not needed for static export)

The `amplify.yml` file already configured should work automatically.

## Step 4: Configure Environment Variables

This is **critical** - you need to set environment variables in Amplify Console:

1. In Amplify Console, click on your app
2. Go to **"App settings"** → **"Environment variables"**
3. Click **"Manage variables"** or **"Add variable"**

### Required Environment Variables:

```
NEXT_PUBLIC_BACKEND_URL=https://your-backend-api.com
```

**Replace** `https://your-backend-api.com` with your actual backend URL:
- If using AWS App Runner: `https://xxxxx.us-east-1.awsapprunner.com`
- If using Elastic Beanstalk: `https://xxxxx.elasticbeanstalk.com`
- If using EC2/ALB: `https://your-domain.com`
- If using API Gateway + Lambda: `https://xxxxx.execute-api.us-east-1.amazonaws.com`

### Optional Environment Variables:

```
NEXT_PUBLIC_AWS_REGION=us-east-1
NODE_ENV=production
```

## Step 5: Review and Deploy

1. **Review settings**:
   - Verify build settings
   - Check environment variables
   - Confirm app root is `frontend/`

2. **Click "Save and deploy"**

3. **Watch the build**:
   - Build process will start automatically
   - You can see logs in real-time
   - Build typically takes 3-5 minutes

## Step 6: Access Your App

After deployment succeeds:

1. **Get your app URL**:
   - In Amplify Console, you'll see: `https://xxxxx.amplifyapp.com`
   - Click the URL to open your app

2. **Test your app**:
   - Navigate to the registration page
   - Try signing up/login
   - Verify it connects to your backend API

## Troubleshooting

### Build Fails: "Module not found"

**Fix**: Make sure all dependencies are in `frontend/package.json`
```bash
cd frontend
npm install
# Commit package-lock.json
git add package-lock.json
git commit -m "Add package-lock.json"
git push
```

### Build Fails: "Cannot find .env.local"

**Fix**: This is normal! `.env.local` is for local development only. Set environment variables in Amplify Console instead.

### Build Fails: Environment variables not working

**Fix**: 
- Variables must start with `NEXT_PUBLIC_` to be accessible in browser
- After adding/changing variables, rebuild the app
- Variables are available at build time, not runtime

### "Cannot connect to backend server"

**Fix**:
1. Verify `NEXT_PUBLIC_BACKEND_URL` is set correctly in Amplify
2. Check backend CORS allows your Amplify domain
3. Test backend URL directly: `curl https://your-backend-api.com/healthz`

### Backend CORS Issues

Update your backend CORS configuration to include Amplify domain:

In `backend/src/app.py`, update `ALLOWED_ORIGINS`:
```python
ALLOWED_ORIGINS = [
    "https://your-app-id.amplifyapp.com",  # Your Amplify app
    "https://main.your-app-id.amplifyapp.com",  # Branch deployments
    "http://localhost:3000",  # Local development
]
```

Or use environment variable:
```bash
CORS_ORIGINS=https://your-app-id.amplifyapp.com,http://localhost:3000
```

## Continuous Deployment

Amplify automatically:
- ✅ Deploys on every push to `main` branch
- ✅ Creates preview deployments for pull requests
- ✅ Runs builds automatically
- ✅ Shows build logs in console

## Custom Domain (Optional)

To use a custom domain:

1. In Amplify Console → **"Domain management"**
2. Click **"Add domain"**
3. Enter your domain: `example.com`
4. Follow DNS configuration instructions
5. Amplify will provision SSL certificate automatically

## Environment-Specific Deployments

You can set up different environments:

1. **Production**: `main` branch → `https://app.amplifyapp.com`
2. **Staging**: `develop` branch → `https://develop.app.amplifyapp.com`
3. **Preview**: Pull requests → Auto-generated URLs

Each environment can have different environment variables.

## Monitoring

1. **Build logs**: View in Amplify Console → **"Build history"**
2. **App logs**: View in **"Monitoring"** section
3. **Errors**: Check CloudWatch Logs for detailed error logs

## Performance Optimization

Amplify automatically:
- ✅ CDN caching for static assets
- ✅ Image optimization (if using Next.js Image component)
- ✅ Code splitting
- ✅ Compression

## Next Steps After Deployment

1. ✅ Test all functionality with production backend
2. ✅ Set up custom domain (optional)
3. ✅ Configure monitoring/alerts
4. ✅ Set up staging environment
5. ✅ Document deployment process for team

## Quick Reference

**Amplify Console**: https://console.aws.amazon.com/amplify

**Your App URL**: Check in Amplify Console after first deployment

**Build Settings**: Auto-detected from `amplify.yml`

**Environment Variables**: Set in Amplify Console → App settings → Environment variables

**Backend URL**: Update `NEXT_PUBLIC_BACKEND_URL` to your production backend
