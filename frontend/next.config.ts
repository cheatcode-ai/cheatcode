import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.com https://clerk.trycheatcode.com https://www.googletagmanager.com https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://*.supabase.co https://*.trycheatcode.com https://*.clerk.com https://clerk.trycheatcode.com https://www.google-analytics.com",
      "img-src 'self' data: blob: https://*.clerk.com https://raw.githubusercontent.com",
      "frame-src 'self' https://*.clerk.com https://clerk.trycheatcode.com",
      "worker-src 'self' blob:",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  // Turbopack config (Next.js 16 default bundler)
  turbopack: {
    resolveAlias: {
      '@codemirror/lang-jinja': './src/lib/stubs/codemirror-lang-jinja.ts',
    },
  },
  productionBrowserSourceMaps: false,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/lobehub/lobe-icons/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
