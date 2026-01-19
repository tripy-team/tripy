# Automatic Image Curation Feature

## Overview

When a user requests images for a city that doesn't exist in the database, the system:

1. **Immediately** returns a "Coming Soon" placeholder image
2. **In the background** automatically curates real images
3. **Updates** DynamoDB with curated images when ready
4. **Adds** the city to `cities.json` for future reference

## How It Works

### 1. Request Flow

```
User requests image for "NewCity"
    ↓
Check DynamoDB for "NewCity"
    ↓
Not found? 
    ↓
Generate "Coming Soon" placeholder
    ↓
Upload placeholder to S3
    ↓
Return placeholder URL immediately
    ↓
[Background] Trigger curation script
    ↓
[Background] Add to cities.json
    ↓
[Background] When ready, real images replace placeholder
```

### 2. "Coming Soon" Placeholder

- **Generated on-the-fly** using PIL (Python Imaging Library)
- **Styled** with city name and "Coming Soon" text
- **Uploaded to S3** for fast delivery
- **Cached** for 1 hour (shorter than curated images)

### 3. Background Curation

- **Non-blocking**: Doesn't slow down the API response
- **Automatic**: Runs the same curation script used manually
- **Silent**: Logs progress but doesn't affect user experience
- **Idempotent**: Safe to run multiple times

## API Response

### When City Doesn't Exist

```json
{
  "city": "NewCity",
  "images": ["https://.../newcity_coming_soon_800.webp"],
  "count": 1,
  "is_coming_soon": true,
  "status": "coming_soon"
}
```

### When City Exists

```json
{
  "city": "Paris",
  "images": ["url1", "url2", "url3", "url4", "url5"],
  "count": 5,
  "is_coming_soon": false,
  "status": "curated",
  "country": "France",
  "region": "Europe"
}
```

## Frontend Usage

The frontend automatically handles "coming soon" images:

```typescript
const result = await getCityImageUrl("NewCity", "800", 0);
// result.url = "https://.../newcity_coming_soon_800.webp"
// result.isComingSoon = true
```

The component can optionally show a badge or message:

```tsx
{result.isComingSoon && (
  <div className="badge">Images being curated...</div>
)}
```

## Configuration

### Environment Variables

```bash
# Required
CITY_IMAGES_BUCKET=tripy-city-images
CITY_IMAGES_TABLE=tripy-city-images
AWS_REGION=us-east-1

# Optional
CLOUDFRONT_DOMAIN=your-cloudfront-domain.cloudfront.net
CITIES_JSON_PATH=scripts/cities.json  # Path to cities.json
```

### Dependencies

The curation script requires:
- `pillow` (PIL) - for image generation
- `requests` - for API calls
- `boto3` - for S3 uploads

Install:
```bash
pip install pillow requests boto3
```

## Benefits

1. **No Broken Images**: Always returns a valid image URL
2. **Automatic Expansion**: Database grows organically
3. **Better UX**: Users see something immediately
4. **Self-Healing**: System automatically fixes missing cities

## Monitoring

Check logs for:
- `"City {city} not found in database"` - New city requested
- `"Started background curation for {city}"` - Curation started
- `"Added {city} to cities.json"` - City added to list
- `"Uploaded coming soon image"` - Placeholder created

## Future Enhancements

1. **Geocoding API**: Auto-detect country from city name
2. **Webhook**: Notify when curation completes
3. **Status Endpoint**: Check curation progress
4. **Priority Queue**: Curate popular cities first
5. **Batch Processing**: Curate multiple cities at once
