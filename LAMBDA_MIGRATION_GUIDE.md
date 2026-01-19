# Lambda Migration Guide - Reducing Costs with Serverless

This guide explains how to migrate from App Runner (EC2-like) to AWS Lambda to reduce infrastructure costs.

## Cost Comparison

### App Runner (Current)
- **Always-on**: ~$0.007/vCPU-hour + $0.0008/GB-hour
- **Example**: 1 vCPU, 2GB RAM = ~$50-100/month (even with no traffic)
- **Minimum**: Always paying for running instance

### Lambda (Proposed)
- **Pay-per-use**: $0.20 per 1M requests + $0.0000166667 per GB-second
- **Example**: 1M requests/month, 512MB, 1s avg = ~$0.20 + ~$8.50 = **~$8.70/month**
- **Free tier**: 1M requests + 400K GB-seconds free per month

**Savings**: ~85-90% cost reduction for typical usage patterns!

## Architecture Changes

### Before (App Runner)
```
User Request → API Gateway → App Runner (always running) → FastAPI
```

### After (Lambda)
```
User Request → API Gateway → Lambda (on-demand) → FastAPI (via Mangum)
Background Tasks → Lambda (async) → Image Curation
```

## Migration Steps

### 1. Install Dependencies

```bash
cd backend
pip install mangum>=0.17.0
pip install -r requirements.txt
```

### 2. Update CDK Stack

The new stack (`infra/lib/apiStackLambda.ts`) includes:
- Single Lambda function for FastAPI (via Mangum)
- Separate Lambda for background tasks
- API Gateway HTTP API with Cognito auth
- Proper IAM permissions

**Option A: Replace existing stack**
```typescript
// In infra/bin/app.ts
import { ApiStackLambda } from "../lib/apiStackLambda";

new ApiStackLambda(app, "TripyApiStack", {
    env,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
    tables: db.tables,
});
```

**Option B: Keep both stacks (gradual migration)**
- Deploy Lambda stack alongside App Runner
- Test Lambda endpoints
- Switch frontend to Lambda URL
- Decommission App Runner

### 3. Deploy Lambda Stack

```bash
cd infra
npm install
npm run build
cdk deploy TripyApiStack
```

### 4. Update Frontend Environment

Update `frontend/.env`:
```bash
NEXT_PUBLIC_BACKEND_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com
```

Get the URL from CDK output:
```bash
cdk output API_URL
```

### 5. Test Migration

1. **Health check**:
   ```bash
   curl https://YOUR_API_URL/health
   ```

2. **Auth endpoints**:
   ```bash
   curl -X POST https://YOUR_API_URL/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"test123"}'
   ```

3. **Protected endpoints** (with token):
   ```bash
   curl https://YOUR_API_URL/trips \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```

## Key Differences

### Cold Starts
- **Lambda**: First request may take 1-3 seconds (cold start)
- **Mitigation**: 
  - Provisioned concurrency (extra cost)
  - Keep-alive pings (health checks)
  - Lambda SnapStart (Java only, not applicable)

### Timeout Limits
- **App Runner**: No hard limit (can run indefinitely)
- **Lambda**: 15 minutes max (API Gateway: 30 seconds)
- **Solution**: Background tasks use separate Lambda with 15min timeout

### Background Tasks
- **Before**: Subprocess in App Runner
- **After**: Async Lambda invocation
- **Benefits**: Better isolation, automatic retries, no resource contention

## Configuration

### Environment Variables

Set in CDK stack or Lambda console:
```bash
# Required
USER_POOL_ID=us-east-1_xxxxx
USER_POOL_CLIENT_ID=xxxxx
AWS_REGION=us-east-1

# DynamoDB (auto-set by CDK)
USERS_TABLE=tripy-users
TRIPS_TABLE=tripy-trips
# ... etc

# Optional
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
CITY_IMAGES_BUCKET=tripy-city-images
CLOUDFRONT_DOMAIN=xxxxx.cloudfront.net
ANALYTICS_FIREHOSE_STREAM=tripy-analytics
```

### Lambda Settings

**Main API Function**:
- Memory: 1024 MB (FastAPI overhead)
- Timeout: 30 seconds (API Gateway limit)
- Runtime: Python 3.12

**Background Tasks Function**:
- Memory: 1024 MB
- Timeout: 15 minutes
- Runtime: Python 3.12

## Monitoring

### CloudWatch Metrics
- **Invocations**: Number of requests
- **Duration**: Response time
- **Errors**: Failed requests
- **Throttles**: Rate limit hits

### CloudWatch Logs
- **Log Group**: `/aws/lambda/tripy-api`
- **Retention**: 7 days (configurable)

### Cost Monitoring
- **AWS Cost Explorer**: Filter by Lambda service
- **Billing Alerts**: Set up budget alerts

## Troubleshooting

### Cold Start Issues
```python
# Add to lambda_handler.py
import sys
# Pre-warm imports
from .app import app
```

### Timeout Errors
- Check CloudWatch logs for slow operations
- Consider moving long operations to background Lambda
- Increase timeout if needed (max 30s for API Gateway)

### Memory Issues
- Increase Lambda memory (also increases CPU)
- Check CloudWatch metrics for memory usage
- Optimize code if memory usage is high

### CORS Errors
- Verify `CORS_ORIGINS` environment variable
- Check API Gateway CORS configuration
- Ensure frontend URL matches allowed origins

## Rollback Plan

If issues occur:

1. **Keep App Runner running** during migration
2. **Switch frontend back** to App Runner URL
3. **Investigate Lambda logs** in CloudWatch
4. **Fix issues** and redeploy
5. **Re-test** before switching again

## Performance Optimization

### Reduce Cold Starts
1. **Keep Lambda warm**: Health check endpoint every 5 minutes
2. **Optimize imports**: Lazy load heavy dependencies
3. **Use Lambda Layers**: Share common code

### Reduce Costs
1. **Right-size memory**: Monitor actual usage
2. **Optimize code**: Faster = cheaper
3. **Use caching**: Reduce database calls
4. **Batch operations**: Combine multiple requests

## Next Steps

1. ✅ Deploy Lambda stack
2. ✅ Test all endpoints
3. ✅ Update frontend URL
4. ✅ Monitor for 24-48 hours
5. ✅ Decommission App Runner (if successful)

## Support

- **CDK Issues**: Check `infra/lib/apiStackLambda.ts`
- **Lambda Issues**: Check CloudWatch logs
- **API Issues**: Check API Gateway logs
- **Cost Questions**: Use AWS Cost Calculator
