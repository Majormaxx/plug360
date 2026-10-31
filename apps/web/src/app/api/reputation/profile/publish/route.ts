/**
 * POST /api/reputation/profile/publish
 *
 * Accepts { profile, signature }, verifies EIP-191 ownership, then pins the
 * completed profile JSON to IPFS via web3.storage (w3up) or, as a fallback
 * when PINATA_JWT is set, Pinata.
 *
 * Returns { cid: string } on success.
 *
 * When no IPFS credentials are configured, stores the profile on disk under
 * /tmp/plug360-profiles/<address>.json and returns a synthetic "local:<address>"
 * CID — useful for development without a pinning account.
 */
import { NextResponse } from 'next/server';
import { verifyMessage, getAddress, type Address } from 'viem';
import type { PlugProfile } from '@plug360/shared';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setCid } from '@/lib/reputation/cid-store';

// ─── Rate limit (per IP) ──────────────────────────────────────────────────────

const calls = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = calls.get(ip);
  if (!entry || now > entry.reset) {
    calls.set(ip, { count: 1, reset: now + RATE_WINDOW });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

// ─── IPFS pin via Pinata ───────────────────────────────────────────────────

async function pinToPinata(json: string, name: string): Promise<string> {
  const jwt = process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not set');

  const body = JSON.stringify({
    pinataContent: JSON.parse(json) as unknown,
    pinataMetadata: { name },
  });

  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Pinata error: ${err}`);
  }

  const data = await res.json() as { IpfsHash?: string };
  if (!data.IpfsHash) throw new Error('Pinata returned no CID');
  return data.IpfsHash;
}

// ─── Local dev fallback ──────────────────────────────────────────────────────

async function saveLocally(json: string, address: Address): Promise<string> {
  const dir = process.env.PROFILES_DIR ?? '/tmp/plug360-profiles';
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${address.toLowerCase()}.json`), json, 'utf8');
  return `local:${address.toLowerCase()}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: { profile?: unknown; signature?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { profile: rawProfile, signature } = body;

  if (!rawProfile || typeof rawProfile !== 'object' || typeof signature !== 'string') {
    return NextResponse.json({ error: 'Missing profile or signature' }, { status: 400 });
  }

  const profile = rawProfile as Partial<PlugProfile>;
  if (!profile.address || !profile.name) {
    return NextResponse.json({ error: 'Profile must have address and name' }, { status: 400 });
  }

  let address: Address;
  try {
    address = getAddress(profile.address as string);
  } catch {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  // The signed payload is the full profile JSON without the signature field.
  // publishedAt was stamped client-side before signing — the server keeps it verbatim.
  const { signature: _sig, ...profileBody } = profile;
  const message = JSON.stringify(profileBody);

  try {
    const valid = await verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    });
    if (!valid) return NextResponse.json({ error: 'Signature does not match address' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 });
  }

  // Final document: profileBody (which already has publishedAt) + signature.
  const finalProfile: PlugProfile = {
    ...(profileBody as Omit<PlugProfile, 'signature'>),
    signature,
  };
  const json = JSON.stringify(finalProfile, null, 2);
  const pinName = `plug360-profile-${address.toLowerCase()}`;

  try {
    let cid: string;
    if (process.env.PINATA_JWT) {
      cid = await pinToPinata(json, pinName);
    } else {
      // Dev fallback: store locally.
      cid = await saveLocally(json, address);
    }
    // Register the CID so /api/reputation/profile/lookup can find it immediately,
    // before the keeper picks it up from onchain events.
    await setCid(address, cid);
    return NextResponse.json({ cid });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'internal error';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
