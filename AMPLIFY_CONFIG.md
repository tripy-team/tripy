# AWS Amplify Configuration Guide

## File Location

Place `amplify.yml` at the **root of your repository** (same level as `frontend/` and `backend/` directories).

## Configuration Explained

### `appRoot: frontend`
- Tells Amplify to treat `frontend/` as the application root
- All commands run from `frontend/` directory
- All paths are relative to `frontend/`

### `preBuild` Phase
- `npm ci` installs dependencies from `package-lock.json`
- `--cache .npm` caches npm packages for faster builds
- `--prefer-offline` uses cache when available

### `build` Phase
- `npm run build` runs Next.js build (defined in `frontend/package.json`)
- Creates `.next/` directory with built files

### `artifacts`
- `baseDirectory: .next` - Path relative to `appRoot` (frontend)
- `files: ['**/*']` - Include all files in `.next/` directory

### `cache`
- `.next/cache/**/*` - Cache Next.js build cache
- `.npm/**/*` - Cache npm packages
- `node_modules/**/*` - Cache installed dependencies

## Environment Variables

Set these in **AWS Amplify Console → App Settings → Environment Variables**:

```
NEXT_PUBLIC_BACKEND_URL=https://your-backend-api.com
NEXT_PUBLIC_AWS_REGION=us-east-1
```

**Important**: All frontend environment variables must start with `NEXT_PUBLIC_` to be accessible in the browser.

## Troubleshooting

### Build Fails with "Module not found"
- Check that `package-lock.json` is committed
- Verify all dependencies are in `frontend/package.json`

### Build Output Not Found
- Ensure `baseDirectory: .next` is correct (relative to `appRoot`)
- Check that `npm run build` completes successfully

### Cache Not Working
- Verify cache paths are correct (relative to `appRoot`)
- Check Amplify Console → Build history for cache hit/miss

### Environment Variables Not Working
- Must start with `NEXT_PUBLIC_` prefix
- Rebuild required after adding/changing env vars
- Check build logs to verify variables are loaded

## Next.js Specific Notes

- Next.js 15 uses `.next/` as build output directory
- Static files are in `.next/static/`
- Server files are in `.next/server/`
- Amplify automatically handles routing with Next.js rewrites
