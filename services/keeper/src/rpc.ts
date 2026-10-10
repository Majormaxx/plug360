import {
  BaseError,
  createPublicClient,
  http,
  HttpRequestError,
  TimeoutError,
  type Chain,
  type PublicClient,
} from 'viem';
import type { Logger } from './log.js';

/** Arc returns this when a request touches state the node has not caught up with yet. */
export const ARC_HEAD_LAG_CODE = -32014;
/** Generic "limit exceeded" from rate-limited public RPCs. */
const LIMIT_EXCEEDED_CODE = -32005;

const RETRY_CODES = new Set([ARC_HEAD_LAG_CODE, LIMIT_EXCEEDED_CODE]);

function codeOf(e: unknown): number | undefined {
  if (e === null || typeof e !== 'object') return undefined;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

/** The JSON-RPC error code in an error chain. A retryable code wins over wrapper codes such as viem's -1. */
export function rpcErrorCode(err: unknown): number | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const retryable = err.walk((e) => RETRY_CODES.has(codeOf(e) ?? 0));
  if (retryable) return codeOf(retryable);
  return codeOf(err.walk((e) => codeOf(e) !== undefined));
}

/** Transient failures worth retrying: Arc's head-lag error, rate limits, HTTP failures and timeouts. */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  if (err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) return true;
  return err.walk((e) => RETRY_CODES.has(codeOf(e) ?? 0)) !== null;
}

export class RpcExhaustedError extends Error {
  constructor(
    readonly label: string,
    override readonly cause: unknown,
  ) {
    super(`${label}: RPC retries exhausted: ${cause instanceof Error ? cause.message.split('\n')[0] : String(cause)}`);
    this.name = 'RpcExhaustedError';
  }
}

export type RpcPoolOptions = {
  primaryUrl: string;
  fallbackUrl?: string;
  chain: Chain;
  logger: Logger;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  requestTimeoutMs?: number;
};

/**
 * Runs read calls against the primary RPC, retrying transient errors with exponential backoff.
 * After two failures in a row on one endpoint it switches to the other (when a fallback is set) and
 * stays there until reset() is called at the start of the next tick. URLs are never logged, since
 * they can carry API keys.
 */
export class RpcPool {
  readonly clients: PublicClient[];
  private active = 0;
  private failures = 0;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(private readonly opts: RpcPoolOptions) {
    const urls = [opts.primaryUrl, ...(opts.fallbackUrl ? [opts.fallbackUrl] : [])];
    this.clients = urls.map((url) =>
      createPublicClient({
        chain: opts.chain,
        // No block-number caching: every tick must see the real head.
        cacheTime: 0,
        transport: http(url, { retryCount: 0, timeout: opts.requestTimeoutMs ?? 15_000 }),
      }),
    );
    this.maxAttempts = opts.maxAttempts ?? 6;
    this.baseDelayMs = opts.baseDelayMs ?? 250;
    this.maxDelayMs = opts.maxDelayMs ?? 4_000;
  }

  get endpoint(): 'primary' | 'fallback' {
    return this.active === 0 ? 'primary' : 'fallback';
  }

  reset(): void {
    this.active = 0;
    this.failures = 0;
  }

  async call<T>(label: string, fn: (client: PublicClient) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const client = this.clients[this.active]!;
      try {
        const result = await fn(client);
        this.failures = 0;
        return result;
      } catch (err) {
        if (!isRetryable(err)) throw err;
        lastError = err;
        this.failures++;
        this.opts.logger({
          level: 'warn',
          job: 'rpc',
          outcome: 'retry',
          call: label,
          attempt,
          endpoint: this.endpoint,
          code: rpcErrorCode(err),
        });
        if (this.failures >= 2 && this.clients.length > 1) {
          this.active = (this.active + 1) % this.clients.length;
          this.failures = 0;
          this.opts.logger({ level: 'warn', job: 'rpc', outcome: 'switched', call: label, endpoint: this.endpoint });
        }
        if (attempt < this.maxAttempts) {
          const delay = Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw new RpcExhaustedError(label, lastError);
  }
}
