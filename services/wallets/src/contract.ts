import { z } from 'zod';

/**
 * The HTTP contract between the web app and the wallets service. Every operation is a POST to
 * /api/wallets/<op> with a JSON body; operations marked `user` also need the X-User-Token header that
 * Circle's web SDK returns after sign-in.
 */
const hex = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, 'expected even-length hex');
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected an address');
const id = z.string().min(1).max(100);

export const ops = {
  'social-token': { user: false, input: z.object({ deviceId: id }) },
  'email-token': { user: false, input: z.object({ deviceId: id, email: z.email().max(254) }) },
  init: { user: true, input: z.object({}) },
  wallets: { user: true, input: z.object({}) },
  'sign-typed-data': { user: true, input: z.object({ walletId: id, data: z.string().min(2).max(20_000), memo: z.string().max(200).optional() }) },
  'contract-call': { user: true, input: z.object({ walletId: id, contractAddress: address, callData: hex.max(20_000) }) },
  /** Finds the transaction a contract-call challenge created, by the refId the service gave it. */
  transaction: { user: true, input: z.object({ walletId: id, refId: id }) },
} as const;

export type Op = keyof typeof ops;
export type OpInput<O extends Op> = z.infer<(typeof ops)[O]['input']>;

export type WalletInfo = { id: string; address: string; blockchain: string; accountType: string };

export type OpOutput = {
  'social-token': { deviceToken: string; deviceEncryptionKey: string };
  'email-token': { deviceToken: string; deviceEncryptionKey: string; otpToken: string };
  /** `challengeId` creates the wallet; absent when the user already has one. */
  init: { challengeId?: string };
  wallets: { wallets: WalletInfo[] };
  'sign-typed-data': { challengeId: string };
  'contract-call': { challengeId: string; refId: string };
  /** `state` is `NOT_FOUND` until the user approves the challenge and Circle creates the transaction. */
  transaction: { state: string; txHash?: string; errorReason?: string };
};

/** Error body for every non-2xx response. */
export type OpError = { error: string; code?: number };

export const isOp = (s: string): s is Op => Object.hasOwn(ops, s);
