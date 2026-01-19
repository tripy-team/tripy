# Quick Setup: S3 Direct URLs (No CloudFront Needed)

## Why S3 Direct?

- ✅ **Simpler** - No CloudFront distribution needed
- ✅ **Still Fast** - S3 has edge locations worldwide
- ✅ **Free Tier** - 5GB storage, 20k GET requests/month
- ✅ **Works Now** - No domain conflicts

## Setup (5 Minutes)

### 1. Create S3 Bucket

```bash
aws s3 mb s3://tripy-city-images --region us-east-1
```

### 2. Make Bucket Public (for image access)

```bash
# Create bucket policy file
cat > bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::tripy-city-images/*"
    }
  ]
}
EOF

# Apply policy
aws s3api put-bucket-policy \
  --bucket tripy-city-images \
  --policy file://bucket-policy.json
```

### 3. Disable Block Public Access (Required)

```bash
aws s3api put-public-access-block \
  --bucket tripy-city-images \
  --public-access-block-configuration \
  "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
```

### 4. Create DynamoDB Table

```bash
aws dynamodb create-table \
  --table-name tripy-city-images \
  --attribute-definitions AttributeName=city,AttributeType=S \
  --key-schema AttributeName=city,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 5. Set Environment Variables

**In App Runner or `.env`:**
```bash
CITY_IMAGES_BUCKET=tripy-city-images
CLOUDFRONT_DOMAIN=  # Leave empty to use S3 direct
CITY_IMAGES_TABLE=tripy-city-images
AWS_REGION=us-east-1
```

**That's it!** The code will automatically use S3 direct URLs when `CLOUDFRONT_DOMAIN` is empty.

### 6. Test

```bash
# Curate a city
python scripts/curate_city_images.py --city "Paris" --count 5

# Test API
curl https://api.traveltripy.com/images/city/Paris
```

## Image URLs Will Look Like:

```
https://tripy-city-images.s3.us-east-1.amazonaws.com/paris_1_800.webp
```

Still fast! S3 has edge locations and will serve images quickly.

## Add CloudFront Later (Optional)

When you're ready:
1. Create CloudFront distribution pointing to S3
2. Set `CLOUDFRONT_DOMAIN` environment variable
3. Code automatically switches to CloudFront URLs

No code changes needed! 🎉
