# Coming Soon Image Caching Optimization

## Overview

The "coming soon" placeholder images are now cached in S3 to avoid regenerating them on every request, significantly reducing costs and improving performance.

## How It Works

### 1. S3 Cache Check
Before generating any image, the system checks if it already exists in S3:
- **S3 Key Format**: `coming_soon/{city_name}_{size}.webp`
- **Example**: `coming_soon/paris_800.webp`
- **Check Method**: Uses `head_object` API call (fast, no data transfer)

### 2. Cache Hit (Image Exists)
- ✅ Returns cached S3 URL immediately
- ✅ No image generation
- ✅ No S3 upload
- ✅ Minimal cost (just S3 GET request)

### 3. Cache Miss (Image Doesn't Exist)
- 🔄 Generates image with PIL
- 🔄 Uploads to S3
- 🔄 Stores with 1-year cache header
- 🔄 Returns URL for immediate use

## Customizable Text

The system supports customizable text while maintaining efficient caching:

### Default Behavior
```python
# Uses city_name for both cache key and display text
get_coming_soon_image_url("Paris", "800")
# Cache key: coming_soon/paris_800.webp
# Display: "Paris"
```

### Custom Text
```python
# Uses city_name for cache key, custom_text for display
get_coming_soon_image_url("Paris", "800", custom_text="Paris, France")
# Cache key: coming_soon/paris_{hash}_800.webp
# Display: "Paris, France"
```

### Text Variations
- Different custom text = different cache entry
- Same custom text = reuses cached version
- Hash-based key prevents collisions

## Cost Savings

### Before (No Caching)
- **Every request**: Generate image (~100ms CPU)
- **Every request**: Upload to S3 (~50ms + data transfer)
- **Cost**: Lambda compute + S3 PUT operations
- **Example**: 1000 requests = 1000 generations

### After (With Caching)
- **First request**: Generate + upload (one time)
- **Subsequent requests**: S3 HEAD check (~10ms)
- **Cost**: One-time generation, then just S3 GET
- **Example**: 1000 requests = 1 generation + 999 cache hits

**Estimated Savings**: ~99% reduction in generation costs after first request

## S3 Storage Structure

```
s3://tripy-city-images/
  └── coming_soon/
      ├── paris_400.webp
      ├── paris_800.webp
      ├── paris_1600.webp
      ├── london_800.webp
      ├── new_york_a1b2c3d4_800.webp  (custom text variation)
      └── ...
```

## Cache Invalidation

Images are cached indefinitely with:
- **Cache-Control**: `max-age=31536000, immutable`
- **Reason**: Images are immutable (same city + size = same image)
- **Manual cleanup**: Delete from S3 if needed

## API Usage

### Basic Usage
```python
from backend.src.services.coming_soon_image import get_coming_soon_image_url

# Standard (city name as text)
url = get_coming_soon_image_url("Paris", "800")

# Custom text
url = get_coming_soon_image_url("Paris", "800", custom_text="Paris, France")
```

### In Image Service
The image service automatically uses caching:
```python
# In image_service.py
coming_soon_url = get_coming_soon_image_url(city_name, size)
# Automatically checks cache first
```

## Performance Metrics

### Cache Hit (Image Exists)
- **S3 HEAD request**: ~10-50ms
- **Total latency**: ~50-100ms
- **Cost**: ~$0.0004 per 1000 requests (S3 GET)

### Cache Miss (Generate New)
- **Image generation**: ~50-200ms
- **S3 upload**: ~50-100ms
- **Total latency**: ~100-300ms
- **Cost**: ~$0.0001 (Lambda) + ~$0.005 (S3 PUT)

## Monitoring

### CloudWatch Metrics
- Check S3 access logs for cache hit/miss patterns
- Monitor Lambda duration for generation operations
- Track S3 storage costs for cached images

### Logs
- `"Using cached coming soon image"` = Cache hit
- `"Generated and uploaded coming soon image"` = Cache miss

## Best Practices

1. **Pre-generate common cities**: Generate images for popular cities during deployment
2. **Monitor storage**: Coming soon images are small (~10-50KB each)
3. **Cleanup old images**: If a city gets curated, you can delete its coming soon image
4. **Use CloudFront**: CDN caching adds another layer of performance

## Troubleshooting

### Images Not Caching
- Check S3 permissions (read/write access)
- Verify bucket name is correct
- Check CloudWatch logs for errors

### Custom Text Not Working
- Ensure `custom_text` parameter is passed correctly
- Check that text hash is being generated
- Verify S3 key includes hash when custom text is used

### High Costs
- Check if images are being regenerated unnecessarily
- Verify S3 cache is working (check logs)
- Consider pre-generating common cities
