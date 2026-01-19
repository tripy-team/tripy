import type { NextConfig } from "next";

// Build remote patterns array with proper typing
const remotePatterns: Array<{
  protocol: 'https' | 'http';
  hostname: string;
  pathname: string;
}> = [
  {
    protocol: 'https',
    hostname: 'source.unsplash.com',
    pathname: '/**',
  },
  {
    protocol: 'https',
    hostname: 'images.unsplash.com',
    pathname: '/**',
  },
  {
    protocol: 'https',
    hostname: 'images.pexels.com',
    pathname: '/**',
  },
];

// Add CDN domain if configured
if (process.env.NEXT_PUBLIC_CDN_DOMAIN) {
  try {
    const cdnUrl = new URL(process.env.NEXT_PUBLIC_CDN_DOMAIN);
    remotePatterns.push({
      protocol: cdnUrl.protocol === 'https:' ? 'https' : 'http',
      hostname: cdnUrl.hostname,
      pathname: '/**',
    });
  } catch {
    // Invalid URL, skip
  }
}

// Add S3 bucket if configured (for direct S3 access)
if (process.env.NEXT_PUBLIC_S3_BUCKET) {
  const bucket = process.env.NEXT_PUBLIC_S3_BUCKET;
  const region = process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
  remotePatterns.push({
    protocol: 'https',
    hostname: `${bucket}.s3.${region}.amazonaws.com`,
    pathname: '/**',
  });
}

const nextConfig: NextConfig = {
  // Enable image optimization
  images: {
    // Allow images from Unsplash and other sources
    remotePatterns,
    // Image optimization settings
    formats: ['image/webp', 'image/avif'],
    // Device sizes for responsive images
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    // Image sizes for different breakpoints
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Minimum quality (1-100)
    minimumCacheTTL: 60 * 60 * 24 * 7, // 7 days
  },
};

export default nextConfig;
