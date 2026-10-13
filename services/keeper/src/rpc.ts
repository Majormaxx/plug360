import { isRetryable, rpcErrorCode } from '@plug360/shared';
import { createPublicClient, http, type Chain, type PublicClient } from 'viem';
import type { Logger } from './log.js';

export { ARC_HEAD_LAG_CODE, ARC_LOG_RANGE_CODE, isRangeLimit, isRetryable, rpcErrorCode } from '@plug360/shared';

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
  private rangeSwitched = false;
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
    this.rangeSwitched = false;
  }

  /**
   * Moves to the other endpoint once per tick after a range-limit refusal, since another provider may accept
   * wider ranges. Returns false when there is no other endpoint or the switch was already used this tick.
   */
  switchForRange(): boolean {
    if (this.clients.length < 2 || this.rangeSwitched) return false;
    this.rangeSwitched = true;
    this.active = (this.active + 1) % this.clients.length;
    this.failures = 0;
    this.opts.logger({ level: 'warn', job: 'rpc', outcome: 'switched', call: 'getLogs', reason: 'range-limit', endpoint: this.endpoint });
    return true;
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
