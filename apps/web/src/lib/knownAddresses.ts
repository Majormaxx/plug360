import { listedPlugs } from './plugs';
import { loadScan, recentPlugs } from './storage';

/** Addresses this person has really dealt with: the yardstick for spotting look-alikes they might paste. */
export function knownAddresses(account: string | undefined): string[] {
  const me = account?.toLowerCase();
  const fromDeals = (loadScan()?.deals ?? [])
    .filter((d) => me && [d.buyer, d.seller, d.plug].some((a) => a.toLowerCase() === me))
    .flatMap((d) => [d.buyer, d.seller, d.plug]);
  return [...new Set([...(account ? [account] : []), ...recentPlugs(), ...listedPlugs.map((p) => p.address), ...fromDeals])];
}

export const lookalikeMessage = (real: string) =>
  `This looks like ${real.slice(0, 6)}…${real.slice(-4)}, an address you've used, but it is a different address. Scammers send tiny payments from look-alike addresses so they show up in your history. Check every character with the person.`;
