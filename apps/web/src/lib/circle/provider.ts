import type { WalletsApi } from './api';
import { WalletsApiError } from './api';
import type { CircleSession } from './session';

/** Result of approving a challenge in Circle's UI. */
export type ChallengeOutcome = { signature?: string };
export type RunChallenge = (auth: Pick<CircleSession, 'userToken' | 'encryptionKey'>, challengeId: string) => Promise<ChallengeOutcome>;

export class ProviderRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderRpcError';
  }
}

export type CircleProviderDeps = {
  chainId: number;
  api: WalletsApi;
  getSession: () => CircleSession | undefined;
  runChallenge: RunChallenge;
  /** Forwards read-only JSON-RPC calls to Arc. */
  rpc: (method: string, params: unknown) => Promise<unknown>;
  onExpired: () => void;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for Circle to broadcast an approved transaction. */
  txTimeoutMs?: number;
};

const FAILED_STATES = new Set(['FAILED', 'DENIED', 'CANCELLED']);

/**
 * EIP-1193 provider backed by a Circle user-controlled wallet. Signing and sending become Circle
 * challenges the user approves; everything else goes to the Arc RPC. The app's wagmi code paths stay the
 * same as for a browser wallet.
 */
export function createCircleProvider(deps: CircleProviderDeps) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const hexChain = `0x${deps.chainId.toString(16)}`;

  const session = () => {
    const s = deps.getSession();
    if (!s) throw new ProviderRpcError(4100, 'Sign in with Google or email first');
    return s;
  };

  async function guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof WalletsApiError && err.status === 401) {
        deps.onExpired();
        throw new ProviderRpcError(4100, 'Your sign-in expired. Sign in again.');
      }
      throw err;
    }
  }

  const sameAddress = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    const p = (Array.isArray(params) ? params : []) as unknown[];
    switch (method) {
      case 'eth_accounts':
      case 'eth_requestAccounts': {
        const s = deps.getSession();
        return s ? [s.address] : [];
      }
      case 'eth_chainId':
        return hexChain;
      case 'net_version':
        return String(deps.chainId);
      case 'wallet_switchEthereumChain': {
        const want = (p[0] as { chainId?: string } | undefined)?.chainId;
        if (want?.toLowerCase() !== hexChain) throw new ProviderRpcError(4902, 'This wallet only works on Arc');
        return null;
      }
      case 'wallet_addEthereumChain':
        return null;
      case 'eth_signTypedData_v4': {
        const s = session();
        if (!sameAddress(p[0], s.address)) throw new ProviderRpcError(4100, 'Asked to sign for a different address');
        const data = typeof p[1] === 'string' ? p[1] : JSON.stringify(p[1]);
        return guard(async () => {
          const { challengeId } = await deps.api('sign-typed-data', { walletId: s.walletId, data }, s.userToken);
          const out = await deps.runChallenge(s, challengeId);
          if (!out.signature) throw new ProviderRpcError(-32603, 'Circle returned no signature');
          return out.signature;
        });
      }
      case 'eth_sendTransaction': {
        const s = session();
        const tx = (p[0] ?? {}) as { from?: string; to?: string; data?: string; value?: string };
        if (tx.from && !sameAddress(tx.from, s.address)) throw new ProviderRpcError(4100, 'Asked to send from a different address');
        if (!tx.to) throw new ProviderRpcError(-32602, 'Contract deployment is not supported');
        if (tx.value && BigInt(tx.value) !== 0n) throw new ProviderRpcError(-32602, 'Sending native value is not supported');
        return guard(async () => {
          const { challengeId, refId } = await deps.api('contract-call', { walletId: s.walletId, contractAddress: tx.to!, callData: tx.data ?? '0x' }, s.userToken);
          await deps.runChallenge(s, challengeId);
          const deadline = Date.now() + (deps.txTimeoutMs ?? 120_000);
          for (let i = 0; ; i++) {
            const t = await deps.api('transaction', { walletId: s.walletId, refId }, s.userToken);
            if (t.txHash) return t.txHash;
            if (FAILED_STATES.has(t.state)) throw new ProviderRpcError(-32603, t.errorReason ? `Transaction failed: ${t.errorReason}` : 'Transaction failed');
            if (Date.now() > deadline) throw new ProviderRpcError(-32603, 'Circle has not broadcast the transaction yet');
            await sleep(Math.min(500 * (i + 1), 2_000));
          }
        });
      }
      case 'personal_sign':
      case 'eth_sign':
      case 'eth_signTransaction':
        throw new ProviderRpcError(4200, `${method} is not supported by this wallet`);
      default:
        return deps.rpc(method, params);
    }
  }

  return {
    request,
    on(event: string, fn: (...a: unknown[]) => void) {
      (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(fn);
    },
    removeListener(event: string, fn: (...a: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
    },
    emit(event: string, ...args: unknown[]) {
      listeners.get(event)?.forEach((fn) => fn(...args));
    },
  };
}

export type CircleProvider = ReturnType<typeof createCircleProvider>;
