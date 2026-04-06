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
  // Allow direct access to the Tripy S3 bucket used for curated city images
  {
    protocol: 'https',
    hostname: 'tripy-city-images.s3.us-east-1.amazonaws.com',
    pathname: '/**',
  },
  // Also allow S3 URL without region (used for signed URLs)
  {
    protocol: 'https',
    hostname: 'tripy-city-images.s3.amazonaws.com',
    pathname: '/**',
  },
  // Google favicon service for loyalty program icons
  {
    protocol: 'https',
    hostname: 'www.google.com',
    pathname: '/s2/favicons/**',
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

const serverEnv: Record<string, string> = {};
if (process.env.DATABASE_URL) serverEnv.DATABASE_URL = process.env.DATABASE_URL;
if (process.env.JWT_SECRET) serverEnv.JWT_SECRET = process.env.JWT_SECRET;
if (process.env.OPENAI_API_KEY) serverEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const nextConfig: NextConfig = {
  env: serverEnv,
  assetPrefix: process.env.ASSET_PREFIX || undefined,
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
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.json': ['.json'],
    };
    return config;
  },
};

export default nextConfig;
