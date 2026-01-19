# CloudFront Setup Alternatives

## Issue: Domain Already in Use

If you're getting "domain already in use by another CloudFront distribution", here are your options:

## Option 1: Use Existing CloudFront Distribution (Recommended)

If you already have a CloudFront distribution, you can add the S3 bucket as an **additional origin**.

### Steps:

1. **Go to your existing CloudFront distribution**
2. **Add a new origin:**
   - Origin Domain: `tripy-city-images.s3.amazonaws.com`
   - Origin Path: (leave empty)
   - Name: `tripy-city-images-s3`
   - Origin Access: Public (or use OAC if you prefer)

3. **Add a new cache behavior:**
   - Path Pattern: `/city-images/*` (or whatever path you want)
   - Origin: Select the new S3 origin
   - Viewer Protocol Policy: Redirect HTTP to HTTPS
   - Cache Policy: CachingOptimized
   - Compress Objects: Yes

4. **Update your backend code** to use the path:
   ```python
   # Instead of: https://d1234567890.cloudfront.net/paris_1_800.webp
   # Use: https://your-existing-cdn.com/city-images/paris_1_800.webp
   ```

## Option 2: Use S3 Direct URLs (Simpler, Still Fast)

You can skip CloudFront entirely and use S3 direct URLs. S3 is already fast and has built-in CDN-like capabilities.

### Update Backend Code:

```python
# backend/src/services/image_service.py

def get_city_image_urls(city_name: str, size: str = "800") -> List[str]:
    # ... existing code ...
    
    # Use S3 direct URL instead of CloudFront
    base_url = f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com"
    
    # Rest of the code stays the same
```

### Benefits:
- ✅ No CloudFront setup needed
- ✅ Still fast (S3 has edge locations)
- ✅ Simpler configuration
- ✅ Free tier: 5GB storage, 20,000 GET requests/month

### Drawbacks:
- ⚠️ Slightly slower than CloudFront (but still very fast)
- ⚠️ No automatic compression
- ⚠️ Higher costs at scale (but fine for MVP)

## Option 3: Create New Distribution with Different Domain

If you want a separate CloudFront distribution:

1. **Use a subdomain:**
   - Instead of: `d1234567890.cloudfront.net`
   - Use: `images.traveltripy.com` (requires custom domain setup)

2. **Or use a different S3 bucket name:**
   - Create: `tripy-city-images-cdn` (different bucket)
   - Create new CloudFront distribution for this bucket

## Option 4: Use Cloudflare (Alternative CDN)

If CloudFront is causing issues, use Cloudflare instead:

1. **Sign up for Cloudflare** (free tier)
2. **Add your domain** to Cloudflare
3. **Create a subdomain** like `images.traveltripy.com`
4. **Point it to S3** using CNAME
5. **Enable Cloudflare features:**
   - Polish (image optimization)
   - Caching
   - Compression

### Update Code:

```python
# Use Cloudflare domain instead
CLOUDFRONT_DOMAIN = os.environ.get("CLOUDFRONT_DOMAIN", "images.traveltripy.com")
```

## Recommended: Option 2 (S3 Direct) for MVP

For MVP/development, **Option 2 (S3 Direct)** is the simplest:

### Quick Setup:

1. **Create S3 bucket:**
   ```bash
   aws s3 mb s3://tripy-city-images --region us-east-1
   ```

2. **Set bucket policy for public read:**
   ```json
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
   ```

3. **Update backend code** (already handles S3 fallback)

4. **Set environment variable:**
   ```bash
   CLOUDFRONT_DOMAIN=  # Leave empty to use S3 direct
   ```

## Code Update for S3 Direct

The code already supports S3 direct URLs as a fallback. Just make sure:

```python
# backend/src/services/image_service.py (line ~50)
if CLOUDFRONT_DOMAIN:
    base_url = f"https://{CLOUDFRONT_DOMAIN}"
else:
    # Fallback to S3 direct URL
    base_url = f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com"
```

This means:
- If `CLOUDFRONT_DOMAIN` is set → use CloudFront
- If empty → use S3 direct URLs

## Performance Comparison

| Solution | Speed | Cost | Setup Complexity |
|----------|-------|------|------------------|
| **S3 Direct** | Fast | $0.023/GB | ⭐ Easy |
| **CloudFront** | Very Fast | $0.085/GB | ⭐⭐ Medium |
| **Cloudflare** | Very Fast | $0/month | ⭐⭐ Medium |

For MVP: **S3 Direct is perfectly fine** and much simpler!

## Next Steps

1. **Use S3 Direct for now** (simplest)
2. **Add CloudFront later** if needed (when you have more traffic)
3. **Or use existing CloudFront** distribution (Option 1)

The code will work with any of these options! 🚀
