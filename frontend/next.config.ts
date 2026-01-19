import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable image optimization
  images: {
    // Allow images from Unsplash and other sources
    remotePatterns: [
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
      // Add your CDN domain here when configured
      ...(process.env.NEXT_PUBLIC_CDN_DOMAIN
        ? [
            {
              protocol: 'https',
              hostname: new URL(process.env.NEXT_PUBLIC_CDN_DOMAIN).hostname,
              pathname: '/**',
            },
          ]
        : []),
    ],
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
