# Curated Image Architecture - Production Guide

## 🎯 Architecture Overview

**Key Principle: Curate once, serve fast**

Instead of fetching images on every page load, we:
1. **Pre-select** 3-5 high-quality images per city
2. **Store** them in S3 (optimized WebP format)
3. **Serve** via CloudFront CDN
4. **Map** city → images in DynamoDB

## 📊 Benefits

| Aspect | Live API Fetch | Curated + CDN |
|--------|---------------|---------------|
| **Speed** | ~500-1000ms | ~50-100ms (CDN cache) |
| **Consistency** | Random images | Same images every time |
| **Cost** | API rate limits | ~$0.01/month per 1000 images |
| **UX** | Unpredictable | Predictable, branded |
| **Legal** | Attribution needed | Pre-licensed/attributed |

## 🏗️ Architecture Components

### 1. S3 Bucket (`tripy-city-images`)
```
s3://tripy-city-images/
├── paris_1_400.webp
├── paris_1_800.webp
├── paris_1_1600.webp
├── paris_2_400.webp
├── paris_2_800.webp
└── ...
```

### 2. CloudFront Distribution
- **Origin**: S3 bucket
- **Cache**: 1 year (immutable)
- **Compression**: Gzip/Brotli
- **Cost**: ~$0.085/GB (first 10TB)

### 3. DynamoDB Table (`tripy-city-images`)
```json
{
  "city": "paris",
  "images": [
    "paris_1.webp",
    "paris_2.webp",
    "paris_3.webp",
    "paris_4.webp",
    "paris_5.webp"
  ],
  "updatedAt": "2024-01-19T12:00:00Z"
}
```

## 🚀 Setup Instructions

### Step 1: Create S3 Bucket

```bash
aws s3 mb s3://tripy-city-images --region us-east-1

# Enable versioning (optional)
aws s3api put-bucket-versioning \
  --bucket tripy-city-images \
  --versioning-configuration Status=Enabled

# Set CORS (for CloudFront)
aws s3api put-bucket-cors \
  --bucket tripy-city-images \
  --cors-configuration file://cors-config.json
```

### Step 2: Create CloudFront Distribution

1. Go to CloudFront Console
2. Create Distribution
3. **Origin**: `tripy-city-images.s3.amazonaws.com`
4. **Viewer Protocol Policy**: Redirect HTTP to HTTPS
5. **Cache Policy**: CachingOptimized
6. **Compress Objects**: Yes
7. **Default Root Object**: (leave empty)

**Cache Behavior:**
- **TTL**: 1 year (31536000 seconds)
- **Headers**: Cache-Control, Origin
- **Query Strings**: None

### Step 3: Create DynamoDB Table

```bash
aws dynamodb create-table \
  --table-name tripy-city-images \
  --attribute-definitions AttributeName=city,AttributeType=S \
  --key-schema AttributeName=city,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### Step 4: Set Environment Variables

**Backend (.env):**
```bash
CITY_IMAGES_BUCKET=tripy-city-images
CLOUDFRONT_DOMAIN=d1234567890.cloudfront.net
CITY_IMAGES_TABLE=tripy-city-images
AWS_REGION=us-east-1
```

**Frontend (.env.local):**
```bash
NEXT_PUBLIC_BACKEND_URL=https://api.traveltripy.com
```

## 🎨 Image Curation Workflow

### Step 1: Find High-Quality Images

**Use optimized search terms:**
- ✅ "Paris street life"
- ✅ "Paris neighborhood"
- ✅ "Paris morning light"
- ✅ "Paris aerial editorial"
- ❌ "Paris city" (too generic)

**Sources:**
- Pexels (free, high quality)
- Unsplash (free, curated)
- Pixabay (free, large library)

### Step 2: Curate Images

Run the curation script:

```bash
# Single city
python scripts/curate_city_images.py --city "Paris" --count 5

# Batch process
python scripts/curate_city_images.py --batch cities.json --count 5
```

**What it does:**
1. Searches for images using optimized terms
2. Downloads 5 best images
3. Converts to WebP format
4. Generates 3 sizes: 400px, 800px, 1600px
5. Uploads to S3
6. Stores mapping in DynamoDB

### Step 3: Verify

Check DynamoDB:
```bash
aws dynamodb get-item \
  --table-name tripy-city-images \
  --key '{"city": {"S": "paris"}}'
```

Check S3:
```bash
aws s3 ls s3://tripy-city-images/paris_1
```

## 💻 Frontend Usage

### Basic Usage

```tsx
import Image from 'next/image';
import { getCityImageUrl } from '@/lib/image-utils';

const imageUrl = await getCityImageUrl('Paris', '800', 0);
```

### Responsive Images

```tsx
import { getCityImageSrcSet } from '@/lib/image-utils';

const srcsetData = await getCityImageSrcSet('Paris');

<img
  src={srcsetData.src}
  srcSet={srcsetData.srcset}
  sizes={srcsetData.sizes}
  alt="Paris"
  loading="lazy"
/>
```

### With Next.js Image Component

```tsx
import Image from 'next/image';
import { getCityImageUrl } from '@/lib/image-utils';

const HeroImage = async ({ city }: { city: string }) => {
  const imageUrl = await getCityImageUrl(city, '1600', 0);
  
  return (
    <Image
      src={imageUrl}
      alt={city}
      width={1600}
      height={1200}
      priority
      placeholder="blur"
    />
  );
};
```

## 📈 Performance Metrics

### Expected Performance

| Metric | Live API | Curated + CDN |
|--------|----------|--------------|
| **First Load** | 500-1000ms | 50-100ms |
| **Cached Load** | 200-500ms | 10-50ms |
| **Bandwidth** | ~2MB/image | ~200KB/image (WebP) |
| **Cache Hit Rate** | 0% | 95%+ |

### Cost Example

**1,000 cities × 5 images × 3 sizes = 15,000 images**

- **S3 Storage**: ~15GB × $0.023 = **$0.35/month**
- **CloudFront**: ~100GB transfer × $0.085 = **$8.50/month**
- **DynamoDB**: ~1,000 items = **$0.25/month**

**Total: ~$9/month** for 1,000 cities

## 🔧 Maintenance

### Adding New Cities

1. Run curation script
2. Images automatically uploaded to S3
3. DynamoDB updated automatically

### Updating Images

1. Delete old images from S3
2. Run curation script again
3. CloudFront cache will expire (or invalidate manually)

### Cache Invalidation

```bash
aws cloudfront create-invalidation \
  --distribution-id E1234567890 \
  --paths "/paris_1_*.webp"
```

## 🎯 Best Practices

1. **Curate 5 images per city** (variety for different use cases)
2. **Use WebP format** (30% smaller than JPEG)
3. **Generate 3 sizes** (400, 800, 1600px)
4. **Optimize quality** (85% is usually sufficient)
5. **Cache aggressively** (1 year TTL)
6. **Use CDN** (CloudFront for AWS, Cloudflare for others)

## 🚨 Troubleshooting

### Images not loading
- Check CloudFront distribution status
- Verify S3 bucket permissions
- Check DynamoDB item exists

### Slow loading
- Check CloudFront cache hit rate
- Verify images are WebP format
- Check image sizes (should be optimized)

### High costs
- Review CloudFront transfer logs
- Check for unnecessary cache invalidations
- Optimize image sizes further

## 📚 Additional Resources

- [AWS S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
- [WebP Optimization Guide](https://developers.google.com/speed/webp)
- [Image Optimization Best Practices](https://web.dev/fast/#optimize-your-images)
