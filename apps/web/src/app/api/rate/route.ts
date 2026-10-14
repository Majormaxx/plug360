import { NextResponse } from 'next/server';
import { fetchNgnRate, type NgnRate } from '@/lib/fx';

export const dynamic = 'force-dynamic';

const FRESH_MS = 60_000;
/** After this long without a successful refresh, the old rate is dropped rather than shown. */
const MAX_STALE_MS = 15 * 60_000;
let cached: { value: NgnRate; fetchedAt: number } | undefined;

/** USDC to naira for display. Vercel's CDN shares one answer per minute across visitors; this instance also remembers it. */
export async function GET() {
  const now = Date.now();
  if (!cached || now - cached.fetchedAt > FRESH_MS) {
    const value = await fetchNgnRate(fetch, { onSkip: (source, reason) => console.warn(`[rate] skipped ${source}: ${reason}`) });
    if (value) cached = { value, fetchedAt: now };
    else if (cached && now - cached.fetchedAt > MAX_STALE_MS) cached = undefined;
  }
  if (!cached) {
    console.warn('[rate] every naira source failed');
    return NextResponse.json({ error: 'No rate available' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return NextResponse.json(cached.value, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}
