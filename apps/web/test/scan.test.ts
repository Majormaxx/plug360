import { describe, expect, it, vi } from 'vitest';
import { RpcRequestError } from 'viem';
import { MAX_LOG_BLOCKS } from '@plug360/shared';
import { MIN_SPAN, ScanError, scanLogs } from '../src/lib/scan';

const rangeErr = () => new RpcRequestError({ body: {}, url: 'x', error: { code: 35, message: 'ranges over 10000 blocks are not supported on freetier' } });
const rateErr = () => new RpcRequestError({ body: {}, url: 'x', error: { code: -32005, message: 'rate limited' } });
const noSleep = async () => {};

/** A fake RPC that returns one log per block and refuses ranges wider than `limit`. */
function rpc(limit: bigint, calls: Array<[bigint, bigint]> = []) {
  return async (from: bigint, to: bigint) => {
    calls.push([from, to]);
    if (to - from + 1n > limit) throw rangeErr();
    const out: bigint[] = [];
    for (let b = from; b <= to; b++) out.push(b);
    return out;
  };
}

describe('scanLogs', () => {
  it('covers every block exactly once in 10k chunks when the RPC allows it', async () => {
    const calls: Array<[bigint, bigint]> = [];
    const logs = await scanLogs({ from: 100n, to: 25_000n, fetchers: [rpc(10_000n, calls)], sleep: noSleep });
    expect(logs.length).toBe(24_901);
    expect(new Set(logs.map(String)).size).toBe(24_901);
    expect(calls[0]).toEqual([100n, 100n + BigInt(MAX_LOG_BLOCKS) - 1n]);
  });

  it('shrinks to fit a provider that caps ranges far below 10k (dRPC free plan)', async () => {
    const logs = await scanLogs({ from: 0n, to: 2_999n, fetchers: [rpc(500n)], sleep: noSleep });
    expect(logs.length).toBe(3_000);
  });

  it('grows the span back after a run of successes', async () => {
    // The provider refuses wide ranges for its first 10 calls, then accepts anything.
    const calls: Array<[bigint, bigint]> = [];
    const inner = rpc(100_000n, calls);
    let n = 0;
    const flaky = async (f: bigint, t: bigint) => {
      if (n++ < 10 && t - f + 1n > 300n) throw rangeErr();
      return inner(f, t);
    };
    const logs = await scanLogs({ from: 0n, to: 60_000n, fetchers: [flaky], sleep: noSleep, growAfter: 2 });
    expect(logs.length).toBe(60_001);
    const widest = calls.reduce((m, [f, t]) => (t - f + 1n > m ? t - f + 1n : m), 0n);
    expect(widest).toBe(BigInt(MAX_LOG_BLOCKS));
    expect(calls.some(([f, t]) => t - f + 1n <= 300n)).toBe(true);
  });

  it('backs off on rate limits and then succeeds', async () => {
    let fails = 2;
    const sleep = vi.fn(noSleep);
    const logs = await scanLogs({
      from: 0n,
      to: 9n,
      fetchers: [async (f, t) => (fails-- > 0 ? Promise.reject(rateErr()) : rpc(100n)(f, t))],
      sleep,
    });
    expect(logs.length).toBe(10);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('falls through to the next RPC when one refuses even the smallest span', async () => {
    const logs = await scanLogs({ from: 0n, to: 999n, fetchers: [rpc(MIN_SPAN - 1n), rpc(10_000n)], sleep: noSleep });
    expect(logs.length).toBe(1_000);
  });

  it('reports how far it got when every RPC fails', async () => {
    let n = 0;
    const dying = async (f: bigint, t: bigint) => {
      if (n++ > 0) throw new Error('boom');
      return rpc(10_000n)(f, t);
    };
    await expect(scanLogs({ from: 0n, to: 30_000n, fetchers: [dying], sleep: noSleep })).rejects.toMatchObject({
      name: 'ScanError',
      scannedTo: BigInt(MAX_LOG_BLOCKS) - 1n,
    });
  });

  it('reports each accepted chunk so progress survives a later failure', async () => {
    const seen: bigint[] = [];
    let n = 0;
    const dying = async (f: bigint, t: bigint) => {
      if (n++ > 1) throw new Error('boom');
      return rpc(10_000n)(f, t);
    };
    await expect(
      scanLogs({ from: 0n, to: 50_000n, fetchers: [dying], sleep: noSleep, onChunk: (_logs, to) => seen.push(to) }),
    ).rejects.toBeInstanceOf(ScanError);
    expect(seen).toEqual([BigInt(MAX_LOG_BLOCKS) - 1n, 2n * BigInt(MAX_LOG_BLOCKS) - 1n]);
  });

  it('stops on abort', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(scanLogs({ from: 0n, to: 10n, fetchers: [rpc(100n)], signal: ac.signal })).rejects.toBeInstanceOf(ScanError);
  });

  it('returns nothing for an empty range', async () => {
    expect(await scanLogs({ from: 10n, to: 9n, fetchers: [rpc(100n)] })).toEqual([]);
  });
});
