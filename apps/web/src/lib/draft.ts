import { MAX_FEE_BPS, type Terms } from '@plug360/shared';
import { bytesToHex, getAddress, isAddressEqual, keccak256, stringToBytes, zeroAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';

/**
 * A deal before it is funded. It lives only in the URL fragment of the deal link, so no server ever stores
 * it: the seller signs, the plug signs, and the buyer pays straight from the link. Every field is checked
 * again on decode, and signatures are verified against the chain before Pay is enabled.
 */
export type Draft = {
  chainId: number;
  escrow: Address;
  terms: Terms;
  job: Job;
  sellerSig?: Hex;
  plugSig?: Hex;
  /**
   * Who the seller invited to the open plug seat: a hash of their Google email (never the email itself,
   * so the buyer and anyone else holding the link cannot read it) and the name the seller typed. This is
   * an off-chain gate in the app; the contract only knows addresses and the seller still confirms the plug.
   */
  invite?: PlugInvite;
};

export type PlugInvite = { emailHash: Hex; name?: string };
export const INVITE_NAME_MAX = 40;

/** What the deal is for. Hashed into terms.metadataHash, so editing it after signing breaks the signatures. */
export type Job = { title: string; note: string };

export const TITLE_MAX = 80;
export const NOTE_MAX = 500;

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected 32 bytes of hex');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected an address');
const uint = z.string().regex(/^\d{1,78}$/, 'expected a whole number');
const signature = z.string().regex(/^0x[0-9a-fA-F]{130,}$/, 'expected a signature');

const wireSchema = z.object({
  v: z.literal(1),
  c: z.number().int().positive(),
  e: address,
  t: z.object({
    s: address,
    /** Absent while the seat is open: the plug fills it in from the link. */
    p: address.optional(),
    o: hex32,
    a: uint,
    f: uint,
    w: z.number().int().nonnegative().max(2 ** 32 - 1),
    x: uint,
  }),
  j: z.object({ t: z.string().max(TITLE_MAX), n: z.string().max(NOTE_MAX) }),
  ss: signature.optional(),
  ps: signature.optional(),
  pi: z.object({ h: hex32, n: z.string().max(INVITE_NAME_MAX).optional() }).optional(),
});
type Wire = z.infer<typeof wireSchema>;

export class DraftError extends Error {
  constructor(
    readonly reason: 'malformed' | 'wrong-network' | 'job-edited',
    message: string,
  ) {
    super(message);
    this.name = 'DraftError';
  }
}

/** keccak256 over a fixed JSON shape, so anyone holding the link can recompute it. */
export function jobHash(job: Job): Hex {
  return keccak256(stringToBytes(JSON.stringify({ v: 1, title: job.title, note: job.note })));
}

/** A fresh random order id. The deal id is derived from (seller, orderId), so it must never repeat. */
export function newOrderId(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** True while nobody has taken the plug seat. Open drafts use the zero address, which the contract rejects. */
export function isOpenSeat(d: Pick<Draft, 'terms'>): boolean {
  return isAddressEqual(d.terms.plug, zeroAddress);
}

/**
 * The plug takes an open seat. Signatures are dropped because they would cover the old terms; in the
 * open-seat flow the seller has not signed yet anyway.
 */
export function claimSeat(d: Draft, plug: Address): Draft {
  const { sellerSig: _s, plugSig: _p, ...rest } = d;
  return { ...rest, terms: { ...d.terms, plug: getAddress(plug) } };
}

/** Undo a claim: the seller frees the seat again if the wrong person took it. */
export function reopenSeat(d: Draft): Draft {
  return claimSeat(d, zeroAddress);
}

export function encodeDraft(d: Draft): string {
  const wire: Wire = {
    v: 1,
    c: d.chainId,
    e: d.escrow,
    t: {
      s: d.terms.seller,
      ...(isOpenSeat(d) ? {} : { p: d.terms.plug }),
      o: d.terms.orderId,
      a: d.terms.price.toString(),
      f: d.terms.plugFee.toString(),
      w: d.terms.windowSeconds,
      x: d.terms.expiry.toString(),
    },
    j: { t: d.job.title, n: d.job.note },
    ...(d.sellerSig ? { ss: d.sellerSig } : {}),
    ...(d.plugSig ? { ps: d.plugSig } : {}),
    ...(d.invite ? { pi: { h: d.invite.emailHash, ...(d.invite.name ? { n: d.invite.name } : {}) } } : {}),
  };
  return toBase64Url(JSON.stringify(wire));
}

/**
 * Parses a deal link fragment. Rejects anything malformed, any link for another chain or escrow, and any
 * link whose job text no longer matches the hash the parties signed.
 */
export function decodeDraft(fragment: string, expect: { chainId: number; escrow: Address }): Draft {
  const payload = fragment.replace(/^#/, '').trim();
  let wire: Wire;
  try {
    wire = wireSchema.parse(JSON.parse(fromBase64Url(payload)));
  } catch {
    throw new DraftError('malformed', 'This deal link is incomplete or damaged. Ask for the link again.');
  }
  if (wire.c !== expect.chainId || !isAddressEqual(wire.e as Address, expect.escrow)) {
    throw new DraftError('wrong-network', 'This deal link was made for a different network or escrow contract.');
  }
  const job = { title: wire.j.t, note: wire.j.n };
  const terms: Terms = {
    seller: getAddress(wire.t.s),
    plug: wire.t.p ? getAddress(wire.t.p) : zeroAddress,
    orderId: wire.t.o as Hex,
    price: BigInt(wire.t.a),
    plugFee: BigInt(wire.t.f),
    windowSeconds: wire.t.w,
    expiry: BigInt(wire.t.x),
    metadataHash: jobHash(job),
  };
  return {
    chainId: wire.c,
    escrow: getAddress(wire.e),
    terms,
    job,
    ...(wire.ss ? { sellerSig: wire.ss as Hex } : {}),
    ...(wire.ps ? { plugSig: wire.ps as Hex } : {}),
    ...(wire.pi ? { invite: { emailHash: wire.pi.h as Hex, ...(wire.pi.n ? { name: wire.pi.n } : {}) } } : {}),
  };
}

/** Hash used to reserve a plug seat for an email. Case and surrounding spaces do not matter. */
export function emailHash(email: string): Hex {
  return keccak256(stringToBytes(`plug360:plug-email:${email.trim().toLowerCase()}`));
}

/** True when there is no invite, or the signed-in email is the one the seller invited. */
export function inviteAllows(d: Pick<Draft, 'invite'>, email: string | undefined): boolean {
  if (!d.invite) return true;
  return !!email && emailHash(email) === d.invite.emailHash;
}

/**
 * Parses a USDC amount typed by a person into base units (6 decimals). Returns undefined for anything that
 * is not a plain non-negative decimal with at most 6 fraction digits.
 */
export function parseUsdcInput(input: string): bigint | undefined {
  const s = input.trim().replace(/,/g, '');
  const m = /^(\d{0,12})(?:\.(\d{0,6}))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return undefined;
  return BigInt(m[1] || '0') * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
}

/** Plug fee for a percentage in basis points, rounded down to an even number of base units as the contract requires. */
export function feeForBps(price: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps < 0 || BigInt(bps) > MAX_FEE_BPS) throw new RangeError(`fee bps out of range: ${bps}`);
  return ((price * BigInt(bps)) / 10_000n) & ~1n;
}

export const FEE_PRESETS_BPS = [0, 100, 200, 300, 500] as const;

export const WINDOW_PRESETS = [
  { label: 'None', seconds: 0, hint: 'Pays out as soon as it is funded' },
  { label: '1 day', seconds: 86_400, hint: '' },
  { label: '3 days', seconds: 3 * 86_400, hint: '' },
  { label: '7 days', seconds: 7 * 86_400, hint: '' },
  { label: '14 days', seconds: 14 * 86_400, hint: 'The longest the contract allows' },
] as const;

export const EXPIRY_PRESETS = [
  { label: '1 day', seconds: 86_400 },
  { label: '3 days', seconds: 3 * 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
  { label: '30 days', seconds: 30 * 86_400 - 600 },
] as const;
