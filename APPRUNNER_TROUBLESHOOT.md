# App Runner Troubleshooting Guide

## Build Succeeded but Deployment Failed?

If your build succeeds but deployment fails, check the **deployment logs** for runtime errors.

### Common Runtime Errors:

1. **ModuleNotFoundError: No module named 'services'**
   - **Fix**: Ensure PYTHONPATH is set correctly
   - **Current config**: `--app-dir /app/backend/src` should fix this

2. **ModuleNotFoundError: No module named 'src'**
   - **Fix**: Use `src.app:app` instead of `app:app`

3. **Import errors**
   - **Fix**: Verify Python path includes the `src/` directory

### Check Deployment Logs:

In App Runner Console:
1. Go to your service
2. Click **"Deployments"** tab
3. Click on the failed deployment
4. Scroll to **"Deployment logs"**
5. Look for error messages at the end

### Current Run Command:

```yaml
run:
  command: cd backend && python -m uvicorn app:app --app-dir /app/backend/src --host 0.0.0.0 --port 8000
```

This should:
- Change to `/app/backend` directory
- Set app directory to `/app/backend/src` (for imports)
- Run `app:app` (since we're using `--app-dir`)

### Alternative: If `--app-dir` doesn't work

Try this instead:

```yaml
run:
  command: cd backend/src && PYTHONPATH=/app/backend/src:$PYTHONPATH python -m uvicorn app:app --host 0.0.0.0 --port 8000
```

This:
- Changes to `/app/backend/src` directory
- Sets PYTHONPATH to `/app/backend/src`
- Runs `app:app` directly
