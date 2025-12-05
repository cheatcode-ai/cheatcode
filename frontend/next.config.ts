import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Turbopack config (Next.js 16 default bundler)
  turbopack: {},
  productionBrowserSourceMaps: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/lobehub/lobe-icons/**',
      },
    ],
  },
};

export default nextConfig;
