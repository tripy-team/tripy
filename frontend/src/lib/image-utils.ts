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

// Backend API URL
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

/**
 * Get curated city image from backend (S3 + CloudFront)
 * 
 * This is the primary method - uses pre-curated images stored in S3.
 * 
 * @param city - City name
 * @param size - Image size (400, 800, 1600)
 * @param index - Which image to use (0-4, default 0 for hero)
 */
export async function getCityImageUrl(
  city: string,
  size: '400' | '800' | '1600' = '800',
  index: number = 0
): Promise<{ url: string | null; isComingSoon: boolean }> {
  try {
    const response = await fetch(`${BACKEND_URL}/images/city/${encodeURIComponent(city)}?size=${size}`);

    if (!response.ok) {
      // Fallback to hero image endpoint
      const heroResponse = await fetch(`${BACKEND_URL}/images/city/${encodeURIComponent(city)}/hero?size=${size}`);
      if (heroResponse.ok) {
        const data = await heroResponse.json();
        return {
          url: data.url,
          isComingSoon: data.is_coming_soon || false
        };
      }
      return { url: null, isComingSoon: false };
    }

    const data = await response.json();
    const url = data.images[index] || data.images[0] || null;
    return {
      url: url,
      isComingSoon: data.is_coming_soon || false
    };
  } catch (error) {
    console.error('Error fetching city image:', error);
    return { url: null, isComingSoon: false };
  }
}


/**
 * Get optimized image URL with caching strategy
 * 
 * This function:
 * 1. Checks local cache (localStorage)
 * 2. Fetches from backend (S3 + CloudFront)
 * 3. Caches the result
 * 4. Returns "coming soon" placeholder if city not yet curated
 */
export async function getOptimizedImageUrl(
  destination: string,
  size: keyof typeof IMAGE_SIZES = 'thumbnail'
): Promise<string> {
  // Map size preset to actual size
  const sizeMap: Record<keyof typeof IMAGE_SIZES, '400' | '800' | '1600'> = {
    thumbnail: '400',
    medium: '800',
    large: '1600',
    full: '1600',
  };

  const actualSize = sizeMap[size];

  // Check cache first
  const cached = getCachedImageUrl(destination, size);
  if (cached) {
    return cached;
  }

  // Fetch from backend
  const result = await getCityImageUrl(destination, actualSize, 0);

  if (result.url) {
    // Cache the result (even if coming soon, cache it for a shorter time)
    cacheImageUrl(destination, size, result.url);

    // Log if coming soon (for debugging)
    if (result.isComingSoon) {
      console.log(`City ${destination} is being curated - showing coming soon placeholder`);
    }

    return result.url;
  }

  // Fallback: return placeholder or empty
  return '';
}

/**
 * Get responsive image srcset for a city
 * 
 * Fetches srcset data from backend (includes src, srcset, sizes)
 */
export async function getCityImageSrcSet(city: string): Promise<{
  src: string;
  srcset: string;
  sizes: string;
} | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/images/city/${encodeURIComponent(city)}/srcset`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      src: data.src,
      srcset: data.srcset,
      sizes: data.sizes,
    };
  } catch (error) {
    console.error('Error fetching city image srcset:', error);
    return null;
  }
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
  } catch (_e) {
    return null;
  }
}
