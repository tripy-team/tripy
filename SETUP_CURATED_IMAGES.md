# Quick Setup Guide - Curated Images

## 🚀 Quick Start (5 minutes)

### 1. Create S3 Bucket

```bash
aws s3 mb s3://tripy-city-images --region us-east-1
```

### 2. Create CloudFront Distribution

1. Go to [CloudFront Console](https://console.aws.amazon.com/cloudfront/)
2. Click "Create Distribution"
3. **Origin Domain**: `tripy-city-images.s3.amazonaws.com`
4. **Viewer Protocol Policy**: Redirect HTTP to HTTPS
5. **Cache Policy**: CachingOptimized
6. Click "Create Distribution"
7. **Copy the Distribution Domain Name** (e.g., `d1234567890.cloudfront.net`)

### 3. Create DynamoDB Table

```bash
aws dynamodb create-table \
  --table-name tripy-city-images \
  --attribute-definitions AttributeName=city,AttributeType=S \
  --key-schema AttributeName=city,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 4. Set Environment Variables

**Backend `.env`:**
```bash
CITY_IMAGES_BUCKET=tripy-city-images
CLOUDFRONT_DOMAIN=d1234567890.cloudfront.net  # Your CloudFront domain
CITY_IMAGES_TABLE=tripy-city-images
```

**App Runner Environment Variables:**
Add the same variables in your App Runner service configuration.

### 5. Install Dependencies for Curation Script

```bash
cd backend
pip install pillow requests boto3
```

### 6. Get API Keys (Optional but Recommended)

**Pexels** (free, 10,000 requests/hour):
1. Sign up at https://www.pexels.com/api/
2. Get your API key
3. Set: `export PEXELS_API_KEY=your_key`

**Unsplash** (free, unlimited):
1. Sign up at https://unsplash.com/developers
2. Create an app
3. Get your Access Key
4. Set: `export UNSPLASH_ACCESS_KEY=your_key`

### 7. Curate Your First City

```bash
python scripts/curate_city_images.py --city "Paris" --count 5
```

This will:
- ✅ Search for 5 high-quality images
- ✅ Convert to WebP format
- ✅ Generate 3 sizes (400, 800, 1600px)
- ✅ Upload to S3
- ✅ Store mapping in DynamoDB

### 8. Test the API

```bash
# Get all images for a city
curl https://api.traveltripy.com/images/city/Paris

# Get hero image
curl https://api.traveltripy.com/images/city/Paris/hero

# Get responsive srcset
curl https://api.traveltripy.com/images/city/Paris/srcset
```

## 📦 Batch Curate Multiple Cities

Create `cities.json`:
```json
[
  "Paris",
  "Tokyo",
  "New York",
  "London",
  "Barcelona"
]
```

Run:
```bash
python scripts/curate_city_images.py --batch cities.json --count 5
```

## ✅ Verify Setup

1. **Check S3:**
   ```bash
   aws s3 ls s3://tripy-city-images/ | head -20
   ```

2. **Check DynamoDB:**
   ```bash
   aws dynamodb get-item \
     --table-name tripy-city-images \
     --key '{"city": {"S": "paris"}}'
   ```

3. **Check CloudFront:**
   - Go to CloudFront Console
   - Check distribution status (should be "Deployed")
   - Test URL: `https://d1234567890.cloudfront.net/paris_1_800.webp`

## 🎯 Next Steps

1. **Curate top 20-50 cities** your users visit most
2. **Update frontend** to use new image endpoints
3. **Monitor CloudFront** cache hit rates
4. **Add more cities** as needed

## 💰 Cost Estimate

For **100 cities × 5 images × 3 sizes = 1,500 images**:

- **S3 Storage**: ~1.5GB × $0.023 = **$0.03/month**
- **CloudFront**: ~10GB transfer × $0.085 = **$0.85/month**
- **DynamoDB**: ~100 items = **$0.03/month**

**Total: ~$1/month** for 100 cities! 🎉

## 🐛 Troubleshooting

**Images not uploading:**
- Check AWS credentials
- Verify S3 bucket permissions
- Check IAM role has S3 write access

**Images not loading:**
- Verify CloudFront distribution is deployed
- Check DynamoDB item exists
- Test S3 URL directly

**Script errors:**
- Install dependencies: `pip install pillow requests boto3`
- Check API keys are set
- Verify AWS region matches

## 📚 Full Documentation

See `CURATED_IMAGE_ARCHITECTURE.md` for complete details.
