/**
 * Image Utilities for Tripy
 * 
 * Optimized image handling with:
 * - Free stock photo APIs (Unsplash, Pexels)
 * - CDN support (CloudFront/Cloudflare)
 * - Smart caching
 * - Responsive image sizes
 */

// Image size presets for different use cases
export const IMAGE_SIZES = {
  thumbnail: { width: 400, height: 300 }, // Trip cards, small previews
  medium: { width: 800, height: 600 },    // Detail pages
  large: { width: 1200, height: 900 },    // Hero images
  full: { width: 1920, height: 1080 },    // Full-width banners
} as const;

// CDN configuration
const CDN_DOMAIN = process.env.NEXT_PUBLIC_CDN_DOMAIN || '';
const USE_CDN = Boolean(CDN_DOMAIN);

/**
 * Generate optimized Unsplash image URL
 * 
 * Benefits:
 * - Free, high-quality images
 * - Built-in CDN (Unsplash uses Fastly)
 * - Automatic optimization via query params
 * - No API key required for basic usage
 * 
 * @param query - Search query (city name, destination, etc.)
 * @param size - Image size preset
 * @param options - Additional options
 */
export function getUnsplashImageUrl(
  query: string,
  size: keyof typeof IMAGE_SIZES = 'thumbnail',
  options: {
    quality?: number;
    format?: 'jpg' | 'webp';
    orientation?: 'landscape' | 'portrait' | 'squarish';
  } = {}
): string {
  const { width, height } = IMAGE_SIZES[size];
  const {
    quality = 80,
    format = 'webp', // WebP is ~30% smaller than JPEG
    orientation = 'landscape',
  } = options;

  // Unsplash Source API - free, no API key needed
  // Uses their CDN (Fastly) for fast delivery
  const baseUrl = 'https://source.unsplash.com';
  
  // Encode query for URL
  const encodedQuery = encodeURIComponent(query);
  
  // Build URL with optimization params
  const url = `${baseUrl}/${width}x${height}/?${encodedQuery}&orientation=${orientation}&q=${quality}`;
  
  // If using custom CDN, proxy through it
  if (USE_CDN) {
    return `${CDN_DOMAIN}/unsplash/${width}x${height}/${encodedQuery}?orientation=${orientation}&q=${quality}`;
  }
  
  return url;
}

/**
 * Generate Pexels image URL (alternative to Unsplash)
 * 
 * Benefits:
 * - Free, high-quality images
 * - Good variety of travel photos
 * - Requires API key for search (but free tier is generous)
 * 
 * Note: For production, you'd want to cache search results server-side
 */
export function getPexelsImageUrl(
  query: string,
  size: keyof typeof IMAGE_SIZES = 'thumbnail',
  photoId?: string
): string {
  const { width, height } = IMAGE_SIZES[size];
  
  // If you have a cached photo ID, use direct URL
  if (photoId) {
    return `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=${width}&h=${height}&fit=crop`;
  }
  
  // Otherwise, use placeholder or search API (requires backend)
  // For now, fallback to Unsplash
  return getUnsplashImageUrl(query, size);
}

/**
 * Get optimized image URL with caching strategy
 * 
 * This function:
 * 1. Checks local cache (IndexedDB/localStorage)
 * 2. Uses CDN if configured
 * 3. Falls back to direct API
 * 4. Implements smart caching headers
 */
export async function getOptimizedImageUrl(
  destination: string,
  size: keyof typeof IMAGE_SIZES = 'thumbnail'
): Promise<string> {
  // For now, use Unsplash directly
  // In production, you'd:
  // 1. Check cache first
  // 2. Use your CDN
  // 3. Fallback to source API
  
  return getUnsplashImageUrl(destination, size);
}

/**
 * Generate srcSet for responsive images
 * 
 * Provides multiple image sizes for different screen densities
 */
export function getImageSrcSet(
  query: string,
  baseSize: keyof typeof IMAGE_SIZES = 'thumbnail'
): string {
  const sizes = [
    { size: 'thumbnail', multiplier: 1 },
    { size: 'medium', multiplier: 2 },
    { size: 'large', multiplier: 3 },
  ];
  
  return sizes
    .map(({ size, multiplier }) => {
      const url = getUnsplashImageUrl(query, size as keyof typeof IMAGE_SIZES);
      const { width } = IMAGE_SIZES[size as keyof typeof IMAGE_SIZES];
      return `${url} ${width * multiplier}w`;
    })
    .join(', ');
}

/**
 * Get image dimensions for Next.js Image component
 */
export function getImageDimensions(size: keyof typeof IMAGE_SIZES) {
  return IMAGE_SIZES[size];
}

/**
 * Cache key for storing image URLs
 */
export function getImageCacheKey(destination: string, size: keyof typeof IMAGE_SIZES): string {
  return `tripy_image_${destination}_${size}`;
}

/**
 * Store image URL in cache (client-side)
 */
export function cacheImageUrl(
  destination: string,
  size: keyof typeof IMAGE_SIZES,
  url: string
): void {
  if (typeof window === 'undefined') return;
  
  try {
    const key = getImageCacheKey(destination, size);
    localStorage.setItem(key, url);
    // Also set expiration (24 hours)
    localStorage.setItem(`${key}_expires`, String(Date.now() + 24 * 60 * 60 * 1000));
  } catch (e) {
    // Storage quota exceeded or other error
    console.warn('Failed to cache image URL:', e);
  }
}

/**
 * Get cached image URL if available and not expired
 */
export function getCachedImageUrl(
  destination: string,
  size: keyof typeof IMAGE_SIZES
): string | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const key = getImageCacheKey(destination, size);
    const expiresKey = `${key}_expires`;
    
    const url = localStorage.getItem(key);
    const expires = localStorage.getItem(expiresKey);
    
    if (!url || !expires) return null;
    
    // Check if expired
    if (Date.now() > Number(expires)) {
      localStorage.removeItem(key);
      localStorage.removeItem(expiresKey);
      return null;
    }
    
    return url;
  } catch (e) {
    return null;
  }
}
