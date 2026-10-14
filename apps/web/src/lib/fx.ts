/**
 * Naira price of USDC for display only. Nothing settles in naira, so no oracle: public price APIs tried in
 * order, the first sane answer wins, and if none answers the app shows no naira figure at all.
 */

export type RateKind = 'market' | 'official';
export type NgnRate = { rate: number; source: string; kind: RateKind; at: number };

type Source = { name: string; kind: RateKind; url: string; parse: (body: unknown) => { rate: number; at?: number } };

const num = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN);

/** Market rates first: they match what people get when they sell USDC in Nigeria. The official rate is the last resort and is labelled as such. */
export const SOURCES: Source[] = [
  {
    name: 'Quidax',
    kind: 'market',
    url: 'https://app.quidax.io/api/v1/markets/tickers/usdtngn',
    parse: (b) => {
      const t = (b as { data?: { at?: number; ticker?: { last?: unknown } } }).data;
      return { rate: num(t?.ticker?.last), ...(t?.at ? { at: t.at * 1000 } : {}) };
    },
  },
  {
    name: 'CoinGecko',
    kind: 'market',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=ngn&include_last_updated_at=true',
    parse: (b) => {
      const c = (b as { 'usd-coin'?: { ngn?: unknown; last_updated_at?: number } })['usd-coin'];
      return { rate: num(c?.ngn), ...(c?.last_updated_at ? { at: c.last_updated_at * 1000 } : {}) };
    },
  },
  {
    name: 'ExchangeRate-API',
    kind: 'official',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse: (b) => {
      const d = b as { rates?: { NGN?: unknown }; time_last_update_unix?: number };
      return { rate: num(d.rates?.NGN), ...(d.time_last_update_unix ? { at: d.time_last_update_unix * 1000 } : {}) };
    },
  },
];

/** Anything outside this band is a broken feed, not a real naira rate. */
export const SANE_RATE = { min: 200, max: 20_000 } as const;

type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Tries each source in order with its own timeout; returns the first sane rate, or undefined if every source failed. */
export async function fetchNgnRate(
  fetcher: Fetcher,
  { sources = SOURCES, timeoutMs = 3_500, now = Date.now, onSkip = (_source: string, _reason: string) => {} } = {},
): Promise<NgnRate | undefined> {
  for (const s of sources) {
    try {
      const res = await fetcher(s.url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json', 'user-agent': 'plug360/1.0' } });
      if (!res.ok) {
        onSkip(s.name, 'http error');
        continue;
      }
      const { rate, at } = s.parse(await res.json());
      if (!Number.isFinite(rate) || rate < SANE_RATE.min || rate > SANE_RATE.max) {
        onSkip(s.name, `rate out of range: ${rate}`);
        continue;
      }
      return { rate, source: s.name, kind: s.kind, at: at ?? now() };
    } catch (err) {
      // Timeout, network error or bad JSON: try the next source.
      onSkip(s.name, err instanceof Error ? err.name : 'error');
    }
  }
  return undefined;
}

/** Naira for a USDC amount, rounded to whole naira, e.g. "₦34,075". */
export function formatNaira(usdc: number, rate: number): string {
  return `₦${Math.round(usdc * rate).toLocaleString('en-NG')}`;
}
