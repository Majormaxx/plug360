import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const nextConfig: NextConfig = {
  // Circle's server SDK (axios) stays a Node dependency of the API route instead of being bundled.
  serverExternalPackages: ['@circle-fin/user-controlled-wallets'],
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages are consumed as built JS; `predev` and `prebuild` rebuild them first so they are never stale.
  turbopack: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
