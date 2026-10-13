import { BaseError, HttpRequestError, TimeoutError } from 'viem';

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
  if (err.walk((e) => RETRY_CODES.has(codeOf(e) ?? 0)) !== null) return true;
  // Some providers rate-limit with their own codes; dRPC's public plan says "You reached Public endpoint rate limit".
  return err.walk((e) => RATE_LIMIT_MESSAGE.test(`${(e as { message?: unknown }).message ?? ''} ${(e as { details?: unknown }).details ?? ''}`)) !== null;
}

const RATE_LIMIT_MESSAGE = /rate limit|too many requests/i;

/** Arc's code for an eth_getLogs range over 10,000 blocks. */
export const ARC_LOG_RANGE_CODE = -32012;
const RANGE_MESSAGE = /block range|range too large|ranges? over \d+ blocks|too many blocks|blocks? (are|is) not supported|exceed(s|ed)? .*blocks|limited to .*blocks|timeout on the free plan/i;

/**
 * True when a provider refused an eth_getLogs call because the block range is too wide. Providers enforce
 * their own limits with their own codes (Arc -32012, dRPC 35), and their messages can name a limit they do
 * not actually apply, so the scan shrinks the range until the provider accepts it. dRPC's free plan also
 * answers a range it cannot finish in time with "Request timeout on the free plan", which a smaller range fixes.
 */
export function isRangeLimit(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  return (
    err.walk((e) => {
      if (codeOf(e) === ARC_LOG_RANGE_CODE) return true;
      const msg = (e as { message?: unknown; details?: unknown }) ?? {};
      const text = `${typeof msg.message === 'string' ? msg.message : ''} ${typeof msg.details === 'string' ? msg.details : ''}`;
      return RANGE_MESSAGE.test(text);
    }) !== null
  );
}
