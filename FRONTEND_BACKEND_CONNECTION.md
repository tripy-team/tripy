# Frontend-Backend Connection Troubleshooting

## ✅ Backend Status
Your App Runner deployment is **successful** and running at:
```
https://xezfenhu6t.us-east-1.awsapprunner.com
```

## ❌ Issue: "Cannot connect to backend server"

This error occurs when the frontend doesn't have the correct `NEXT_PUBLIC_BACKEND_URL` environment variable set.

## 🔧 Solution: Set Environment Variable in Amplify

The frontend needs `NEXT_PUBLIC_BACKEND_URL` to know where the backend is. Follow these steps:

### Option 1: Set in Amplify Console (Recommended)

1. **Go to AWS Amplify Console**:
   - Navigate to [AWS Amplify Console](https://console.aws.amazon.com/amplify)
   - Select your app

2. **Go to Environment Variables**:
   - Click **"App settings"** → **"Environment variables"**
   - Click **"Manage variables"** or **"Add variable"**

3. **Add the Backend URL**:
   - **Variable name**: `NEXT_PUBLIC_BACKEND_URL`
   - **Value**: `https://xezfenhu6t.us-east-1.awsapprunner.com`
   - Click **"Save"**

4. **Redeploy**:
   - Go to **"Deployments"** tab
   - Click **"Redeploy this version"** (or push a new commit to trigger redeployment)
   - Wait for deployment to complete (~3-5 minutes)

### Option 2: Set in Amplify YAML (Alternative)

You can also add it to `amplify.yml`:

```yaml
version: 1
applications:
  - appRoot: frontend
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci --cache .npm --prefer-offline
        build:
          commands:
            - npm run build
          env:
            - name: NEXT_PUBLIC_BACKEND_URL
              value: https://xezfenhu6t.us-east-1.awsapprunner.com
      artifacts:
        baseDirectory: .next
        files:
          - '**/*'
      cache:
        paths:
          - .next/cache/**/*
          - .npm/**/*
          - node_modules/**/*
```

Then commit and push:
```bash
git add amplify.yml
git commit -m "Add NEXT_PUBLIC_BACKEND_URL to Amplify config"
git push origin main
```

## 🧪 Verify Backend is Running

Test the backend health endpoint:
```bash
curl https://xezfenhu6t.us-east-1.awsapprunner.com/healthz
```

Expected response: `{"status": "ok"}`

## 🔍 Verify Frontend Configuration

After setting the environment variable and redeploying, check the browser console:
1. Open your app in a browser
2. Open Developer Tools (F12)
3. Go to Console tab
4. In development mode, you should see: `Backend URL: https://xezfenhu6t.us-east-1.awsapprunner.com`

## 📋 Quick Checklist

- [ ] Set `NEXT_PUBLIC_BACKEND_URL` in Amplify Console
- [ ] Redeploy the frontend (push new commit or use "Redeploy" button)
- [ ] Verify backend is accessible: `curl https://xezfenhu6t.us-east-1.awsapprunner.com/healthz`
- [ ] Check browser console for any CORS errors
- [ ] Try signing in again

## 🚨 Common Issues

### Issue: Environment variable not working
**Cause**: Variables must start with `NEXT_PUBLIC_` to be accessible in the browser
**Solution**: Make sure the variable name is exactly `NEXT_PUBLIC_BACKEND_URL` (case-sensitive)

### Issue: CORS errors in browser console
**Cause**: Backend CORS not configured for your Amplify domain
**Solution**: Add your Amplify domain to `CORS_ORIGINS` in `backend/apprunner.yaml`:
```yaml
- name: CORS_ORIGINS
  value: https://your-app-id.amplifyapp.com,https://main.your-app-id.amplifyapp.com
```

### Issue: Still can't connect after setting variable
**Cause**: Frontend not redeployed with new environment variable
**Solution**: Redeploy the frontend (environment variables are read at build time, not runtime)

## 📞 Need Help?

If you're still having issues:
1. Check Amplify deployment logs for any errors
2. Check browser console for specific error messages
3. Verify the backend URL is correct and accessible
4. Check CORS settings in backend
