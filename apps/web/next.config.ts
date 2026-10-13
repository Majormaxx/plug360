import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const sharedSource = fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Read the shared package from source so the app never runs against a stale dist build.
  transpilePackages: ['@plug360/shared'],
  turbopack: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    resolveAlias: { '@plug360/shared': sharedSource },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
