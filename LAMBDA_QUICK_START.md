# Lambda Quick Start Guide

## Prerequisites

1. AWS CLI configured
2. CDK installed: `npm install -g aws-cdk`
3. Node.js and npm installed

## Quick Deployment

### Option 1: Use Lambda Stack (Recommended)

```bash
# 1. Install dependencies
cd infra
npm install

# 2. Build TypeScript
npm run build

# 3. Deploy Lambda stack
cdk deploy --app "node bin/app-lambda.js" TripyApiStack

# 4. Get API URL
cdk output --app "node bin/app-lambda.js" API_URL
```

### Option 2: Update Existing Stack

Edit `infra/bin/app.ts`:
```typescript
// Replace
import { ApiStack } from "../lib/apiStack";
// With
import { ApiStackLambda } from "../lib/apiStackLambda";

// Replace
new ApiStack(app, "TripyApiStack", {
// With
new ApiStackLambda(app, "TripyApiStack", {
```

Then deploy:
```bash
cd infra
npm run build
cdk deploy TripyApiStack
```

## Update Frontend

After deployment, update `frontend/.env`:
```bash
NEXT_PUBLIC_BACKEND_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com
```

## Test

```bash
# Health check
curl https://YOUR_API_URL/health

# Should return: {"ok":true}
```

## Cost Monitoring

Check Lambda costs:
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=tripy-api \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-31T23:59:59Z \
  --period 86400 \
  --statistics Sum
```

## Troubleshooting

### Cold Start Issues
- First request may be slow (1-3 seconds)
- Subsequent requests are fast
- Consider health check endpoint to keep warm

### Timeout Errors
- API Gateway max: 30 seconds
- Background tasks: 15 minutes
- Check CloudWatch logs for slow operations

### CORS Errors
- Verify `CORS_ORIGINS` environment variable
- Check API Gateway CORS settings
- Ensure frontend URL is in allowed origins

## Rollback

If you need to rollback to App Runner:
1. Keep App Runner running
2. Update frontend `.env` back to App Runner URL
3. Investigate Lambda issues in CloudWatch
4. Fix and redeploy

## Next Steps

1. Monitor costs in AWS Cost Explorer
2. Set up CloudWatch alarms for errors
3. Optimize Lambda memory based on usage
4. Consider provisioned concurrency if cold starts are an issue
