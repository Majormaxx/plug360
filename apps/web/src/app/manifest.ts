import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

/** Lets people add Plug360 to their home screen; icons come from scripts/brand.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Plug360',
    short_name: 'Plug360',
    description: 'USDC escrow for deals between people who know each other.',
    start_url: '/',
    display: 'standalone',
    background_color: BRAND.cream,
    theme_color: BRAND.cream,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
