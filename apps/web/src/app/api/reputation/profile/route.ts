/**
 * GET /api/reputation/profile?cid=<ipfs-cid>
 * Fetches and verifies an IPFS plug profile server-side (avoids CORS on gateways).
 */
import { fetchProfile } from '@/lib/reputation/profile';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cid = searchParams.get('cid') ?? '';
  if (!cid) return Response.json({ error: 'cid required' }, { status: 400 });

  const profile = await fetchProfile(cid);
  if (!profile) return Response.json({ error: 'profile not found or invalid' }, { status: 404 });

  return Response.json(profile, { headers: { 'cache-control': 'public, max-age=3600' } });
}
