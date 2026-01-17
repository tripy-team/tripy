# App Runner Build Fix

## Problem

The build is failing because App Runner is running from the repository root (`/`), but your backend code is in the `backend/` subdirectory.

## Solution

I've created two options:

### Option 1: Use Root `apprunner.yaml` (Recommended)

I created `apprunner.yaml` in the **root directory** that properly handles the subdirectory structure.

**In App Runner Console**:
1. Go to your service → **"Configuration"** tab
2. Click **"Edit"**
3. **Source**: Make sure it's set to repository root `/`
4. **Configuration file**: Set to `apprunner.yaml` (root level)
5. **Save and redeploy**

This will use the root `apprunner.yaml` which has `cd backend` commands.

### Option 2: Update App Runner Source Directory

**In App Runner Console**:
1. Go to your service → **"Configuration"** tab  
2. Click **"Edit"**
3. **Source directory**: Set to `backend/`
4. **Configuration file**: Set to `apprunner.yaml`
5. **Save and redeploy**

This tells App Runner to use `backend/` as the root directory.

## What Was Fixed

Both `apprunner.yaml` files now:
- ✅ Include `cd backend` in build commands
- ✅ Include `cd backend` in run command
- ✅ Properly reference `src.app:app` and `requirements.txt`

## Next Steps

1. **Update App Runner configuration** (use one of the options above)
2. **Trigger a new deployment**
3. **Watch the build logs** - it should succeed now
4. **Get your URL** from the service details page

## Testing

After deployment succeeds, test:
```bash
curl https://your-apprunner-url.com/healthz
```

Should return: `{"ok":true}`
