# Lambda Deployment Guide

## Quick Fix for CDK Issues

The CDK deployment has been fixed. Here's how to use it:

## Option 1: Use Lambda Stack (Recommended)

### Step 1: Install/Update Dependencies

```bash
cd infra
npm install
```

### Step 2: Deploy with Lambda Stack

```bash
# Set environment variable to use Lambda stack
USE_LAMBDA=true cdk deploy TripyApiStack

# Or use the flag
cdk deploy TripyApiStack --context useLambda=true
```

### Step 3: Or Use Direct Command

```bash
# Use ts-node directly with the lambda app file
npx ts-node bin/app-lambda.ts
cdk deploy TripyApiStack --app "npx ts-node bin/app-lambda.ts"
```

## Option 2: Compile First, Then Deploy

```bash
# Build TypeScript
npm run build

# Deploy using compiled JavaScript
cdk deploy TripyApiStack --app "node dist/bin/app-lambda.js"
```

## Option 3: Update cdk.json (Permanent Fix)

Edit `infra/cdk.json`:

```json
{
  "app": "npx ts-node bin/app-lambda.ts"
}
```

Then just run:
```bash
cdk deploy TripyApiStack
```

## Troubleshooting

### Issue: TypeScript version mismatch

```bash
cd infra
npm install ts-node@^10.9.2 --save-dev
npm install typescript@^5.4.0 --save-dev
```

### Issue: Module not found

```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Issue: Still getting errors

Try using the compiled version:

```bash
npm run build
cdk deploy TripyApiStack --app "node dist/bin/app-lambda.js"
```

## Recommended Approach

The easiest way is to update `cdk.json` to point to `app-lambda.ts`:

```json
{
  "app": "npx ts-node bin/app-lambda.ts"
}
```

Then all CDK commands will use the Lambda stack automatically.
