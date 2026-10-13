import { isAddress, type Address } from 'viem';

/**
 * Address poisoning: bots send dust from addresses that share the first and last characters of one you
 * use, hoping you copy the fake from your history. This flags an address that looks like a known one at a
 * glance (same 4 leading and 4 trailing hex characters) but is not that address.
 */
export function lookalikeOf(candidate: string, known: readonly string[], edge = 4): Address | undefined {
  if (!isAddress(candidate, { strict: false })) return undefined;
  const c = candidate.toLowerCase().slice(2);
  for (const k of known) {
    if (!isAddress(k, { strict: false })) continue;
    const n = k.toLowerCase().slice(2);
    if (n === c) return undefined;
  }
  for (const k of known) {
    if (!isAddress(k, { strict: false })) continue;
    const n = k.toLowerCase().slice(2);
    if (n.slice(0, edge) === c.slice(0, edge) && n.slice(-edge) === c.slice(-edge)) return k as Address;
  }
  return undefined;
}
