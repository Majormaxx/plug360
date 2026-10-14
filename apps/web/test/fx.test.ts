import { describe, expect, it } from 'vitest';
import { fetchNgnRate, formatNaira, SOURCES } from '../src/lib/fx';

type Reply = { ok?: boolean; body?: unknown; throws?: boolean };
const fakeFetch = (replies: Record<string, Reply>) => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const r = replies[url];
    if (!r || r.throws) throw new Error('network');
    return { ok: r.ok ?? true, json: async () => r.body };
  };
  return { fetcher, calls };
};
const [quidax, gecko, official] = SOURCES.map((s) => s.url) as [string, string, string];
const quidaxBody = (last: unknown) => ({ data: { at: 1_791_990_000, ticker: { last } } });

describe('fetchNgnRate', () => {
  it('uses the first market source when it answers', async () => {
    const { fetcher, calls } = fakeFetch({ [quidax]: { body: quidaxBody('1363.1') } });
    expect(await fetchNgnRate(fetcher)).toEqual({ rate: 1363.1, source: 'Quidax', kind: 'market', at: 1_791_990_000_000 });
    expect(calls).toEqual([quidax]);
  });

  it('falls back in order when a source errors, times out or returns junk', async () => {
    const { fetcher, calls } = fakeFetch({
      [quidax]: { body: quidaxBody('not a number') },
      [gecko]: { ok: false },
      [official]: { body: { rates: { NGN: 1331.27 }, time_last_update_unix: 1_791_900_000 } },
    });
    const skipped: string[] = [];
    expect(await fetchNgnRate(fetcher, { onSkip: (s, why) => skipped.push(`${s}: ${why}`) })).toMatchObject({ rate: 1331.27, source: 'ExchangeRate-API', kind: 'official' });
    expect(skipped).toEqual(['Quidax: rate out of range: NaN', 'CoinGecko: http error']);
    expect(calls).toEqual([quidax, gecko, official]);
  });

  it('rejects rates outside the sane band instead of showing them', async () => {
    const { fetcher } = fakeFetch({ [quidax]: { body: quidaxBody('1.36') }, [gecko]: { body: { 'usd-coin': { ngn: 9_999_999 } } }, [official]: { throws: true } });
    expect(await fetchNgnRate(fetcher)).toBeUndefined();
  });

  it('returns undefined when every source is down, so the app shows no naira figure', async () => {
    expect(await fetchNgnRate(fakeFetch({}).fetcher)).toBeUndefined();
  });

  it('gives up on a source that hangs past the timeout', async () => {
    const hang = async (_url: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout'))));
    const started = Date.now();
    expect(await fetchNgnRate(hang, { timeoutMs: 50 })).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('formatNaira', () => {
  it('rounds to whole naira with thousands separators', () => {
    expect(formatNaira(25, 1363.1)).toBe('₦34,078');
    expect(formatNaira(0.5, 1363.1)).toBe('₦682');
  });
});
