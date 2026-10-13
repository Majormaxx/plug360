import { formatUnits } from 'viem';

/** "12.5" style USDC from base units: trims trailing zeros, keeps at least two decimals for cents. */
export function usdc(amount: bigint): string {
  const [whole = '0', frac = ''] = formatUnits(amount, 6).split('.');
  const trimmed = frac.replace(/0+$/, '');
  const decimals = trimmed.length <= 2 ? trimmed.padEnd(2, '0') : trimmed;
  return `${Number(whole).toLocaleString('en-US')}.${decimals}`;
}

/** Splits an address into groups of four so a full address can be read and compared at a glance. */
export function addressChunks(address: string): string[] {
  const body = address.slice(2);
  const out: string[] = [];
  for (let i = 0; i < body.length; i += 4) out.push(body.slice(i, i + 4));
  return out;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Whole-unit duration for windows and countdowns: "3 days", "5 h 12 min", "42 s". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s === 0) return 'none';
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return h > 0 && d < 3 ? `${d} d ${h} h` : `${d} ${d === 1 ? 'day' : 'days'}`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

export function dateTime(unixSeconds: number | bigint): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Deal ids are uint256; links carry them as 0x-prefixed 64-digit hex. */
export function dealIdToHex(id: bigint): `0x${string}` {
  return `0x${id.toString(16).padStart(64, '0')}`;
}

export function parseDealId(raw: string): bigint | undefined {
  const s = decodeURIComponent(raw).trim();
  if (/^0x[0-9a-fA-F]{1,64}$/.test(s)) return BigInt(s);
  if (/^\d{1,78}$/.test(s)) {
    const v = BigInt(s);
    return v < 2n ** 256n ? v : undefined;
  }
  return undefined;
}
