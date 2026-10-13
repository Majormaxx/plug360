import { randomUUID } from 'node:crypto';
import { ops, type Op, type OpInput, type OpOutput, type WalletInfo } from './contract.js';

/** Circle's names for Arc. Contract calls are supported on testnet; check mainnet support before launch. */
export type ArcChain = 'ARC-TESTNET' | 'ARC';

/** The slice of Circle's user-controlled wallets client this service uses; tests pass a fake. */
export type CircleClient = {
  createDeviceTokenForSocialLogin(i: { deviceId: string; idempotencyKey?: string }): Promise<{ data?: { deviceToken?: string; deviceEncryptionKey?: string } }>;
  createDeviceTokenForEmailLogin(i: { deviceId: string; email: string; idempotencyKey?: string }): Promise<{ data?: { deviceToken?: string; deviceEncryptionKey?: string; otpToken?: string } }>;
  createUserPinWithWallets(i: { userToken: string; blockchains: ArcChain[]; accountType: 'SCA' | 'EOA'; idempotencyKey?: string }): Promise<{ data?: { challengeId?: string } }>;
  listWallets(i: { userToken: string; blockchain?: ArcChain }): Promise<{ data?: { wallets?: Array<{ id?: string; address?: string; blockchain?: string; accountType?: string }> } }>;
  signTypedData(i: { userToken: string; walletId: string; data: string; memo?: string }): Promise<{ data?: { challengeId?: string } }>;
  createUserTransactionContractExecutionChallenge(i: {
    userToken: string;
    walletId: string;
    contractAddress: string;
    callData: `0x${string}`;
    fee: { type: 'level'; config: { feeLevel: 'LOW' | 'MEDIUM' | 'HIGH' } };
    refId?: string;
    idempotencyKey?: string;
  }): Promise<{ data?: { challengeId?: string } }>;
  listTransactions(i: { userToken: string; walletIds?: string[] }): Promise<{ data?: { transactions?: Array<{ refId?: string; state?: string; txHash?: string; errorReason?: string }> } }>;
};

export class WalletsError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'WalletsError';
  }
}

/** Circle's code for "this user already initialized"; signing in again is not an error. */
export const USER_ALREADY_INITIALIZED = 155106;

function circleCode(err: unknown): number | undefined {
  const e = err as { response?: { data?: { code?: unknown } }; code?: unknown };
  const c = e?.response?.data?.code ?? e?.code;
  return typeof c === 'number' ? c : undefined;
}

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined || v === null) throw new WalletsError(502, `Circle returned no ${what}`);
  return v;
}

export type ServiceOptions = { blockchain: ArcChain; idempotencyKey?: () => string };

/**
 * Runs one wallets operation. Validates input against the contract, calls Circle, and returns only the
 * fields the app needs. The API key never leaves the server, and nothing here can sign: every signature
 * and transaction becomes a challenge the user approves in Circle's web SDK.
 */
export async function runOp<O extends Op>(
  client: CircleClient,
  op: O,
  rawInput: unknown,
  userToken: string | undefined,
  opts: ServiceOptions,
): Promise<OpOutput[O]> {
  const spec = ops[op];
  const parsed = spec.input.safeParse(rawInput ?? {});
  if (!parsed.success) throw new WalletsError(400, parsed.error.issues[0]?.message ?? 'invalid input');
  if (spec.user && !userToken) throw new WalletsError(401, 'Sign in first');
  const key = opts.idempotencyKey ?? randomUUID;
  const token = userToken ?? '';
  const input = parsed.data as OpInput<Op>;

  try {
    switch (op) {
      case 'social-token': {
        const { deviceId } = input as OpInput<'social-token'>;
        const r = need((await client.createDeviceTokenForSocialLogin({ deviceId, idempotencyKey: key() })).data, 'device token');
        return { deviceToken: need(r.deviceToken, 'device token'), deviceEncryptionKey: need(r.deviceEncryptionKey, 'encryption key') } as OpOutput[O];
      }
      case 'email-token': {
        const { deviceId, email } = input as OpInput<'email-token'>;
        const r = need((await client.createDeviceTokenForEmailLogin({ deviceId, email, idempotencyKey: key() })).data, 'device token');
        return { deviceToken: need(r.deviceToken, 'device token'), deviceEncryptionKey: need(r.deviceEncryptionKey, 'encryption key'), otpToken: need(r.otpToken, 'OTP token') } as OpOutput[O];
      }
      case 'init': {
        try {
          const r = need(
            (await client.createUserPinWithWallets({ userToken: token, blockchains: [opts.blockchain], accountType: 'SCA', idempotencyKey: key() })).data,
            'challenge',
          );
          return { challengeId: need(r.challengeId, 'challenge') } as OpOutput[O];
        } catch (err) {
          if (circleCode(err) === USER_ALREADY_INITIALIZED) return {} as OpOutput[O];
          throw err;
        }
      }
      case 'wallets': {
        const r = (await client.listWallets({ userToken: token, blockchain: opts.blockchain })).data;
        const wallets: WalletInfo[] = (r?.wallets ?? [])
          .filter((w): w is { id: string; address: string; blockchain: string; accountType?: string } => !!w.id && !!w.address && w.blockchain === opts.blockchain)
          .map((w) => ({ id: w.id, address: w.address, blockchain: w.blockchain, accountType: w.accountType ?? 'SCA' }));
        return { wallets } as OpOutput[O];
      }
      case 'sign-typed-data': {
        const { walletId, data, memo } = input as OpInput<'sign-typed-data'>;
        try {
          JSON.parse(data);
        } catch {
          throw new WalletsError(400, 'typed data must be JSON');
        }
        const r = need((await client.signTypedData({ userToken: token, walletId, data, ...(memo ? { memo } : {}) })).data, 'challenge');
        return { challengeId: need(r.challengeId, 'challenge') } as OpOutput[O];
      }
      case 'contract-call': {
        const { walletId, contractAddress, callData } = input as OpInput<'contract-call'>;
        const refId = key();
        const r = need(
          (
            await client.createUserTransactionContractExecutionChallenge({
              userToken: token,
              walletId,
              contractAddress,
              callData: callData as `0x${string}`,
              fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
              refId,
              idempotencyKey: key(),
            })
          ).data,
          'challenge',
        );
        return { challengeId: need(r.challengeId, 'challenge'), refId } as OpOutput[O];
      }
      case 'transaction': {
        const { walletId, refId } = input as OpInput<'transaction'>;
        const list = (await client.listTransactions({ userToken: token, walletIds: [walletId] })).data?.transactions ?? [];
        const t = list.find((x) => x.refId === refId);
        if (!t) return { state: 'NOT_FOUND' } as OpOutput[O];
        return { state: need(t.state, 'transaction state'), ...(t.txHash ? { txHash: t.txHash } : {}), ...(t.errorReason ? { errorReason: t.errorReason } : {}) } as OpOutput[O];
      }
    }
  } catch (err) {
    if (err instanceof WalletsError) throw err;
    const status = (err as { response?: { status?: number } })?.response?.status;
    const code = circleCode(err);
    // Expired or revoked user tokens come back as 401/403; the app then asks the person to sign in again.
    if (status === 401 || status === 403) throw new WalletsError(401, 'Your sign-in expired. Sign in again.', code);
    throw new WalletsError(502, 'Circle did not accept the request', code);
  }
  throw new WalletsError(400, 'unknown operation');
}
