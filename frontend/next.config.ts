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
  // Redirect www to non-www for Clerk compatibility
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'host',
            value: 'www.trycheatcode.com',
          },
        ],
        destination: 'https://trycheatcode.com/:path*',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
