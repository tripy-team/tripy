# Environment Variables Setup Guide

This guide explains how to configure environment variables for both frontend and backend to connect to your production App Runner backend.

## Backend URL

**Production Backend**: `https://xezfenhu6t.us-east-1.awsapprunner.com`

## Frontend Configuration

### Local Development

1. **Create `.env.local` file** in the `frontend/` directory:
   ```bash
   cd frontend
   cp env.example .env.local
   ```

2. **Edit `.env.local`** and set your backend URL:
   ```env
   # For local development with local backend
   NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
   
   # OR for local development with production backend
   NEXT_PUBLIC_BACKEND_URL=https://xezfenhu6t.us-east-1.awsapprunner.com
   ```

3. **Restart your development server**:
   ```bash
   npm run dev
   ```

### Production (AWS Amplify)

Environment variables must be set in **AWS Amplify Console**:

1. Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify)
2. Select your app
3. Navigate to **App settings** → **Environment variables**
4. Click **Manage variables** or **Add variable**
5. Add the following variable:

   ```
   Name: NEXT_PUBLIC_BACKEND_URL
   Value: https://xezfenhu6t.us-east-1.awsapprunner.com
   ```

6. **Save** and **redeploy** your app

### Important Notes

- ✅ **`.env.local` is in `.gitignore`** - it will never be committed to git
- ✅ **Never commit `.env.local`** - it contains sensitive configuration
- ✅ **Use `env.example`** as a template for what variables are needed
- ✅ **`NEXT_PUBLIC_` prefix** is required for variables accessible in the browser
- ✅ **Restart dev server** after changing `.env.local`

## Backend Configuration

### Local Development

1. **Create `.env` file** in the `backend/` directory:
   ```bash
   cd backend
   cp env_template.txt .env
   ```

2. **Fill in your values** (see `backend/env_template.txt` for required variables)

3. **Start the server**:
   ```bash
   ./start_server.sh
   ```

### Production (AWS App Runner)

Environment variables are set in **AWS App Runner Console**:

1. Go to [AWS App Runner Console](https://console.aws.amazon.com/apprunner)
2. Select your service
3. Navigate to **Configuration** → **Environment variables**
4. Add all required variables (see `backend/env_template.txt`)

## Security Best Practices

### ✅ DO:
- Use `.env.local` for local development
- Set environment variables in AWS Console for production
- Use `env.example` or `env_template.txt` as templates
- Keep `.env*` files in `.gitignore`
- Use different values for development and production

### ❌ DON'T:
- Commit `.env` or `.env.local` files to git
- Hardcode API URLs or secrets in code
- Share `.env` files in chat/email
- Use production credentials in local development

## Verifying Configuration

### Test Frontend Connection

1. Open browser console (F12)
2. Check for: `Backend URL: https://xezfenhu6t.us-east-1.awsapprunner.com`
3. Try logging in or making an API call
4. Check Network tab for requests to the backend URL

### Test Backend Health

```bash
curl https://xezfenhu6t.us-east-1.awsapprunner.com/healthz
```

Should return: `{"ok":true}`

## Troubleshooting

### Frontend can't connect to backend

1. **Check environment variable**:
   ```bash
   # In frontend directory
   cat .env.local
   ```

2. **Verify backend is running**:
   ```bash
   curl https://xezfenhu6t.us-east-1.awsapprunner.com/healthz
   ```

3. **Check CORS settings** in backend - make sure your frontend domain is allowed

4. **Check browser console** for CORS errors

### Environment variable not working in Amplify

1. **Variable must start with `NEXT_PUBLIC_`** for browser access
2. **Redeploy after adding/changing variables**
3. **Check build logs** in Amplify Console
4. **Variables are available at build time**, not runtime

## Quick Reference

| Environment | File Location | Where to Set |
|------------|---------------|--------------|
| Frontend Local | `frontend/.env.local` | Local file |
| Frontend Production | N/A | AWS Amplify Console |
| Backend Local | `backend/.env` | Local file |
| Backend Production | N/A | AWS App Runner Console |

## Current Production URLs

- **Backend API**: `https://xezfenhu6t.us-east-1.awsapprunner.com`
- **Frontend**: (Check AWS Amplify Console for your app URL)
