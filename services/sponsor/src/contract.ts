import { z } from 'zod';

/**
 * HTTP contract between the web app and the gas sponsor. POST /api/sponsor/<op> with a JSON body.
 * Nothing here needs the caller to hold USDC or to sign anything for the sponsor.
 */
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected an address');
const hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, 'expected even-length hex');
const uint = z.string().regex(/^\d{1,78}$/, 'expected a whole number');

export const termsWire = z.object({
  seller: address,
  plug: address,
  orderId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  price: uint,
  plugFee: uint,
  windowSeconds: z.number().int().nonnegative().max(2 ** 32 - 1),
  expiry: uint,
  metadataHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
export type TermsWire = z.infer<typeof termsWire>;

export const SPONSORED_ACTIONS = ['openDispute', 'release', 'refund', 'plugRefund', 'plugReject'] as const;
export type SponsoredAction = (typeof SPONSORED_ACTIONS)[number];

export const ops = {
  /**
   * Makes a seller's or plug's signature usable by the escrow. A smart wallet that has not made its first
   * transaction signs with an ERC-6492 wrapper; the sponsor deploys the wallet and returns the plain
   * signature to submit. Signatures from plain keys or deployed wallets come back unchanged.
   */
  'prepare-signer': {
    input: z.object({ kind: z.enum(['terms', 'accept']), terms: termsWire, signature: hex.max(20_000) }),
  },
  /** Sends a deal party just enough gas for the action they are allowed to take right now. */
  gas: {
    input: z.object({ account: address, dealId: uint, action: z.enum(SPONSORED_ACTIONS) }),
  },
} as const;

export type Op = keyof typeof ops;
export type OpInput<O extends Op> = z.infer<(typeof ops)[O]['input']>;
export type OpOutput = {
  'prepare-signer': { signature: `0x${string}`; deployed: boolean; tx?: `0x${string}` };
  gas: { funded: boolean; amount: string; tx?: `0x${string}` };
};
export type OpError = { error: string; reason?: string };

export const isOp = (s: string): s is Op => Object.hasOwn(ops, s);
