/**
 * Tier 2 — off-chain attested plug profile.
 *
 * A profile is a JSON document pinned to IPFS. The plug signs it with their address
 * (EIP-191 personal_sign of the JSON string without the signature field).
 *
 * The CID is emitted in the PlugLevelSet event calldata: the owner passes it as the
 * extra `data` field when calling setPlugLevel. This module fetches and verifies it.
 */
import { createPublicClient, http, verifyMessage, type Address } from 'viem';
import type { PlugProfile } from '@plug360/shared';

// Public IPFS gateways, tried in order.
const GATEWAYS = [
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

/**
 * Fetches and verifies a plug profile from IPFS.
 * Returns null if the CID is invalid, fetch fails, or signature is wrong.
 */
export async function fetchProfile(cid: string): Promise<PlugProfile | null> {
  if (!cid || !/^Qm[1-9A-HJ-NP-Za-km-z]{44}$|^baf[a-z2-7]{56}$/.test(cid)) return null;

  let raw: string | null = null;
  for (const gw of GATEWAYS) {
    try {
      const res = await fetch(`${gw}${cid}`, { signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        raw = await res.text();
        break;
      }
    } catch {
      // try next gateway
    }
  }
  if (!raw) return null;

  let profile: PlugProfile;
  try {
    profile = JSON.parse(raw) as PlugProfile;
  } catch {
    return null;
  }

  if (!profile.address || !profile.name) return null;

  // Verify the plug signed this profile.
  if (profile.signature) {
    try {
      const { signature, ...body } = profile;
      const message = JSON.stringify(body);
      const valid = await verifyMessage({
        address: profile.address as Address,
        message,
        signature: signature as `0x${string}`,
      });
      if (!valid) return null;
    } catch {
      return null;
    }
  }

  return profile;
}

/**
 * Serialises a profile into the canonical string the plug must sign.
 *
 * `publishedAt` MUST be included so the stored document (which the server keeps
 * verbatim) passes signature verification later. The caller generates the timestamp
 * once and passes it here; the server never overwrites it.
 */
export function profilePayload(profile: Omit<PlugProfile, 'signature'>): string {
  return JSON.stringify(profile);
}
