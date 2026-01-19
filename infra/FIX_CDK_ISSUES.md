# Fix CDK Deployment Issues

## Issues Fixed

1. ✅ Updated `cdk.json` to use `app-lambda.ts` directly
2. ✅ Updated `package.json` with compatible ts-node version
3. ✅ Fixed TypeScript configuration

## Quick Fix Steps

### Step 1: Install Updated Dependencies

Run this in your terminal (not in the sandbox):

```bash
cd infra
npm install
```

This will install the updated `ts-node@^10.9.2` and `@types/node@^20.0.0`.

### Step 2: Try CDK Commands Again

Now you can use CDK commands normally:

```bash
# Bootstrap (first time only)
cdk bootstrap

# See what will be deployed
cdk diff

# Deploy
cdk deploy TripyApiStack
```

## What Changed

1. **`cdk.json`**: Now points to `bin/app-lambda.ts` instead of `bin/app.ts`
2. **`package.json`**: Updated `ts-node` from `^1.7.1` to `^10.9.2` (compatible with TypeScript 5.4)
3. **`tsconfig.json`**: Improved configuration for better compatibility

## Alternative: Use Compiled JavaScript

If TypeScript still has issues, you can compile first:

```bash
# Build TypeScript
npm run build

# Use compiled version
cdk deploy TripyApiStack --app "node dist/bin/app-lambda.js"
```

## If Still Having Issues

1. **Clean install:**
   ```bash
   cd infra
   rm -rf node_modules package-lock.json
   npm install
   ```

2. **Check Node version:**
   ```bash
   node --version  # Should be 18+ or 20+
   ```

3. **Use npx directly:**
   ```bash
   npx ts-node bin/app-lambda.ts
   cdk deploy TripyApiStack --app "npx ts-node bin/app-lambda.ts"
   ```

## Current Configuration

- **CDK App**: `bin/app-lambda.ts` (Lambda-based stack)
- **TypeScript**: 5.4.0
- **ts-node**: 10.9.2 (updated)
- **Node types**: 20.0.0 (updated)

The configuration is now correct. Just run `npm install` in the `infra` directory to update dependencies.
