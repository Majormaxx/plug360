import { isRangeLimit, isRetryable, MAX_LOG_BLOCKS } from '@plug360/shared';

export type ScanOptions<T> = {
  from: bigint;
  to: bigint;
  /** One getLogs per RPC endpoint, tried in order. */
  fetchers: Array<(from: bigint, to: bigint) => Promise<T[]>>;
  onProgress?: (done: bigint, total: bigint) => void;
  /** Called after every accepted chunk with its logs and last block, so a caller can persist progress. */
  onChunk?: (logs: T[], to: bigint) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  /** Successful calls in a row before the span doubles again. */
  growAfter?: number;
};

export const MIN_SPAN = 64n;
const MAX_RETRIES = 4;

export class ScanError extends Error {
  constructor(
    message: string,
    readonly scannedTo: bigint,
    override readonly cause: unknown,
  ) {
    super(message);
    this.name = 'ScanError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Reads logs over [from, to] in chunks. Providers cap eth_getLogs differently (Arc 10,000 blocks, some
 * free plans a few hundred, sometimes with a message naming the wrong limit), so the span halves on a range
 * refusal and grows back after a run of successes. Rate limits back off, then fall through to the next RPC.
 * On failure, ScanError.scannedTo says how far the scan got so a caller can keep what it has.
 */
export async function scanLogs<T>(opts: ScanOptions<T>): Promise<T[]> {
  const sleep = opts.sleep ?? defaultSleep;
  const growAfter = opts.growAfter ?? 8;
  const total = opts.to >= opts.from ? opts.to - opts.from + 1n : 0n;
  const out: T[] = [];
  let span = BigInt(MAX_LOG_BLOCKS);
  let cursor = opts.from;
  let rpc = 0;
  let streak = 0;
  let retries = 0;

  while (cursor <= opts.to) {
    if (opts.signal?.aborted) throw new ScanError('Scan cancelled', cursor - 1n, opts.signal.reason);
    const fetcher = opts.fetchers[rpc];
    if (!fetcher) throw new ScanError('Every RPC refused the log scan', cursor - 1n, undefined);
    const end = cursor + span - 1n > opts.to ? opts.to : cursor + span - 1n;
    try {
      const logs = await fetcher(cursor, end);
      out.push(...logs);
      opts.onChunk?.(logs, end);
      cursor = end + 1n;
      retries = 0;
      opts.onProgress?.(cursor - opts.from, total);
      if (++streak >= growAfter && span < BigInt(MAX_LOG_BLOCKS)) {
        span = span * 2n > BigInt(MAX_LOG_BLOCKS) ? BigInt(MAX_LOG_BLOCKS) : span * 2n;
        streak = 0;
      }
    } catch (err) {
      streak = 0;
      if (isRangeLimit(err)) {
        if (span > MIN_SPAN) {
          span = span / 2n < MIN_SPAN ? MIN_SPAN : span / 2n;
        } else {
          rpc += 1;
          span = BigInt(MAX_LOG_BLOCKS);
        }
      } else if (isRetryable(err) && retries < MAX_RETRIES) {
        await sleep(400 * 2 ** retries);
        retries += 1;
      } else if (rpc + 1 < opts.fetchers.length) {
        rpc += 1;
        retries = 0;
      } else {
        throw new ScanError('The Arc RPCs did not answer the log scan', cursor - 1n, err);
      }
    }
  }
  return out;
}
