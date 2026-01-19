# Image Optimization Guide for Tripy

## Overview

This guide covers the best practices for handling images of cities/destinations in Tripy, balancing speed, cost, and user experience.

## Recommended Architecture

### 1. **Image Sources (Free Stock Photos)**

#### Option A: Unsplash Source API (Recommended for MVP)
- **Cost**: Free, unlimited
- **CDN**: Built-in (Fastly CDN)
- **Quality**: High-quality, curated photos
- **API**: No key required for basic usage
- **URL Format**: `https://source.unsplash.com/{width}x{height}/?{query}`

**Pros:**
- Zero cost
- Fast delivery (Fastly CDN)
- No API key needed
- Good for travel photos

**Cons:**
- Less control over specific images
- May show different images on refresh
- No search API without key

#### Option B: Pexels API
- **Cost**: Free (10,000 requests/hour)
- **CDN**: Built-in
- **Quality**: High-quality photos
- **API**: Free API key required
- **Better for**: Specific image selection

**Pros:**
- Search API for specific images
- Can cache photo IDs
- Good variety

**Cons:**
- Requires API key
- Rate limits (though generous)

#### Option C: Pixabay API
- **Cost**: Free (5,000 requests/day)
- Similar to Pexels

### 2. **CDN Strategy**

#### Option A: AWS CloudFront (Recommended for AWS stack)
- **Cost**: ~$0.085/GB for first 10TB
- **Benefits**:
  - Integrates with S3
  - Edge locations worldwide
  - Automatic compression
  - Custom cache headers

**Setup:**
1. Create S3 bucket for image cache
2. Set up CloudFront distribution
3. Configure cache behaviors
4. Use Lambda@Edge for image optimization

#### Option B: Cloudflare (Recommended for cost savings)
- **Cost**: Free tier available, $20/month Pro
- **Benefits**:
  - Free CDN
  - Image optimization included
  - Automatic WebP conversion
  - Polish (image optimization) feature

**Setup:**
1. Add domain to Cloudflare
2. Enable "Polish" feature
3. Configure cache rules

#### Option C: Next.js Image Optimization (Built-in)
- **Cost**: Free (hosted on Vercel) or self-hosted
- **Benefits**:
  - Automatic optimization
  - Responsive images
  - Lazy loading
  - WebP conversion

### 3. **Caching Strategy**

#### Multi-Layer Caching:

1. **Browser Cache** (Client-side)
   - Cache-Control headers: `max-age=31536000, immutable`
   - Store image URLs in localStorage/IndexedDB
   - Cache for 24 hours client-side

2. **CDN Cache** (Edge)
   - CloudFront/Cloudflare: Cache for 7-30 days
   - Cache key: `{destination}_{size}_{format}`

3. **Application Cache** (Server-side)
   - Cache photo IDs/URLs in DynamoDB or Redis
   - Store mapping: `destination -> photo_id`
   - Update cache when new images needed

4. **Service Worker Cache** (PWA)
   - Cache frequently viewed images
   - Offline support

## Implementation Recommendations

### Phase 1: Quick Win (Current Implementation)
```typescript
// Use Unsplash Source API directly
const imageUrl = `https://source.unsplash.com/400x300/?${destination}`;
```

**Pros:**
- Zero setup
- Free
- Fast (Fastly CDN)

**Cons:**
- No image consistency
- No control over specific images

### Phase 2: Optimized (Recommended)
```typescript
// Use utility functions with caching
import { getOptimizedImageUrl } from '@/lib/image-utils';

const imageUrl = await getOptimizedImageUrl(destination, 'thumbnail');
```

**Features:**
- Client-side caching
- Responsive image sizes
- WebP format support
- Smart cache invalidation

### Phase 3: Production (Full Optimization)
1. **Backend Image Service**
   - Search and cache photo IDs from Pexels/Unsplash
   - Store in DynamoDB: `destination -> photo_id`
   - API endpoint: `GET /images/{destination}`

2. **CDN Setup**
   - CloudFront or Cloudflare
   - Image optimization at edge
   - Custom cache headers

3. **Image Optimization Pipeline**
   - Convert to WebP
   - Generate multiple sizes
   - Lazy loading
   - Blur placeholder

## Cost Comparison

### Unsplash Source API (Direct)
- **Cost**: $0
- **Bandwidth**: Unlimited
- **CDN**: Included (Fastly)
- **Best for**: MVP, low traffic

### CloudFront + S3
- **Storage**: ~$0.023/GB/month
- **Transfer**: ~$0.085/GB (first 10TB)
- **Requests**: ~$0.0075/10,000
- **Best for**: High traffic, AWS stack

### Cloudflare (Free Tier)
- **Cost**: $0/month
- **Bandwidth**: Unlimited
- **Image Optimization**: Included
- **Best for**: Cost-conscious, medium traffic

### Cloudflare Pro
- **Cost**: $20/month
- **All free features +**
- **Better image optimization**
- **Best for**: Production, high traffic

## Performance Optimization Tips

1. **Use Next.js Image Component**
   ```tsx
   import Image from 'next/image';
   
   <Image
     src={imageUrl}
     alt={destination}
     width={400}
     height={300}
     loading="lazy"
     placeholder="blur"
   />
   ```

2. **Implement Responsive Images**
   - Use `srcSet` for different screen sizes
   - Serve appropriate size for device

3. **Lazy Loading**
   - Load images only when in viewport
   - Use Intersection Observer API

4. **Image Format Priority**
   - WebP (best compression)
   - JPEG (fallback)
   - AVIF (future, best compression)

5. **Preload Critical Images**
   - Hero images above the fold
   - First trip card images

## Recommended Setup for Tripy

### For MVP/Development:
1. Use Unsplash Source API directly (current approach)
2. Add client-side caching (localStorage)
3. Use Next.js Image component

### For Production:
1. **Backend**: Create image service to cache photo IDs
   - Endpoint: `GET /images/destination/{name}`
   - Cache photo IDs in DynamoDB
   - Fallback to Unsplash if not cached

2. **CDN**: Use Cloudflare (free tier)
   - Enable Polish feature
   - Configure cache rules
   - Set up custom domain

3. **Frontend**: 
   - Use `image-utils.ts` functions
   - Implement lazy loading
   - Add blur placeholders
   - Use responsive images

## Example Implementation

See `frontend/src/lib/image-utils.ts` for utility functions.

## Monitoring

Track:
- Image load times
- Cache hit rates
- Bandwidth usage
- User experience metrics (LCP, CLS)

## Future Enhancements

1. **User-Uploaded Images**
   - Allow users to upload trip photos
   - Store in S3, serve via CloudFront

2. **AI-Generated Placeholders**
   - Generate blur placeholders
   - Improve perceived performance

3. **Image CDN with Transformation**
   - Use Cloudinary or ImageKit
   - On-the-fly optimization
   - Advanced transformations
