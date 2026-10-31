/**
 * Per-plug reputation stats, derived from the contract event log.
 * Called inside the keeper's tick after the event scan so stats are always
 * up-to-date without an extra RPC pass.
 */
import { formatUnits, type Address } from 'viem';
import type { PlugStats } from '@plug360/shared';

/** One raw event entry as the keeper sees it from the event scan. */
export type RawEvent = {
  eventName: string;
  blockNumber: bigint;
  transactionHash: string;
  args: Record<string, unknown>;
  /** Unix seconds from the block header. Filled in by the caller. */
  timestamp?: number;
};

/** Per-plug working state, accumulated during the event scan. */
type PlugWork = {
  address: Address;
  totalDeals: number;
  dealPaidAts: number[];
  totalPrices: bigint;
  /** dealIds that went to dispute (from DisputeOpened, attributed via dealToPlug). */
  disputedDealIds: Set<string>;
  /** dealId → disputedAt timestamp */
  disputeOpenedAt: Map<string, number>;
  /** dealId → { forBuyer, ruledAt } */
  rulings: Map<string, { forBuyer: boolean; ruledAt: number }>;
  firstDealAt: number | null;
};

/**
 * Module-level cache of DisputeOpened timestamps (keyed by dealId string).
 * NOTE: this is intentionally NOT a module singleton — it is owned by the
 * caller (createKeeper) and passed in, so multiple keeper instances stay isolated.
 * Exported as a type so callers can construct it.
 */
export type DisputeTimestamps = Map<string, number>;

function getWork(map: Map<string, PlugWork>, address: string): PlugWork {
  const key = address.toLowerCase();
  let w = map.get(key);
  if (!w) {
    w = {
      address: address as Address,
      totalDeals: 0,
      dealPaidAts: [],
      totalPrices: 0n,
      disputedDealIds: new Set(),
      disputeOpenedAt: new Map(),
      rulings: new Map(),
      firstDealAt: null,
    };
    map.set(key, w);
  }
  return w;
}

/**
 * Incrementally updates plug stats from a batch of events (the current scan window).
 * Mutates `statsMap`, `disputeTimestamps`, and `dealToPlug` in place.
 * All three maps must be owned by the caller (e.g. createKeeper) — never module-level.
 *
 * `dealToPlug` maps dealId → plug address so DisputeOpened events (which carry
 * only dealId) can be attributed to the correct plug.
 */
export function updatePlugStatsFromEvents(
  statsMap: Map<string, PlugWork>,
  events: RawEvent[],
  blockTimestamps: Map<bigint, number>,
  disputeTimestamps: DisputeTimestamps,
  dealToPlug: Map<string, string> = new Map(),
) {
  for (const ev of events) {
    const ts = blockTimestamps.get(ev.blockNumber) ?? ev.timestamp ?? 0;
    const args = ev.args;

    if (ev.eventName === 'DealFunded') {
      const plug = String(args.plug ?? '');
      const price = BigInt(String(args.price ?? '0'));
      const dealId = String(args.dealId ?? '');
      if (!plug) continue;
      // Remember which plug is associated with this deal.
      dealToPlug.set(dealId, plug.toLowerCase());
      const w = getWork(statsMap, plug);
      w.totalDeals++;
      w.dealPaidAts.push(ts);
      w.totalPrices += price;
      if (w.firstDealAt === null || ts < w.firstDealAt) w.firstDealAt = ts;
    }

    if (ev.eventName === 'DisputeOpened') {
      const dealId = String(args.dealId ?? '');
      // First DisputeOpened wins; subsequent (e.g. from a re-scan) are ignored.
      if (!disputeTimestamps.has(dealId)) disputeTimestamps.set(dealId, ts);
      // Attribute this dispute to the plug who is handling the deal.
      const plugKey = dealToPlug.get(dealId);
      if (plugKey) {
        const w = getWork(statsMap, plugKey);
        if (!w.disputedDealIds.has(dealId)) {
          w.disputedDealIds.add(dealId);
          w.disputeOpenedAt.set(dealId, ts);
        }
      }
    }

    if (ev.eventName === 'PlugRuled') {
      const plug = String(args.plug ?? '');
      const dealId = String(args.dealId ?? '');
      const forBuyer = Boolean(args.forBuyer);
      if (!plug) continue;
      const w = getWork(statsMap, plug);
      // Ensure the deal is in disputedDealIds even if DisputeOpened was missed.
      w.disputedDealIds.add(dealId);
      const disputedAt = disputeTimestamps.get(dealId) ?? w.disputeOpenedAt.get(dealId) ?? 0;
      w.disputeOpenedAt.set(dealId, disputedAt);
      w.rulings.set(dealId, { forBuyer, ruledAt: ts });
    }
  }
}

/** Finalises the accumulated work into the PlugStats shape the API returns. */
export function finalisePlugStats(work: Map<string, PlugWork>, now: number): Map<string, PlugStats> {
  const out = new Map<string, PlugStats>();
  const cutoff90 = now - 90 * 24 * 60 * 60;

  for (const [key, w] of work.entries()) {
    const recentDeals = w.dealPaidAts.filter((t) => t >= cutoff90).length;

    // All disputed deals for this plug (from PlugRuled events).
    const totalDisputes = w.disputedDealIds.size;
    let ruledForBuyer = 0;
    let ruledForSeller = 0;
    const rulingTimes: number[] = [];

    for (const [dealId, ruling] of w.rulings.entries()) {
      if (ruling.forBuyer) ruledForBuyer++;
      else ruledForSeller++;
      const openedAt = w.disputeOpenedAt.get(dealId) ?? 0;
      if (openedAt > 0 && ruling.ruledAt > openedAt) {
        rulingTimes.push((ruling.ruledAt - openedAt) / 3600);
      }
    }

    const timedOut = totalDisputes - w.rulings.size;

    rulingTimes.sort((a, b) => a - b);
    const medianRulingHours =
      rulingTimes.length > 0 ? rulingTimes[Math.floor(rulingTimes.length / 2)]! : null;

    out.set(key, {
      address: w.address,
      totalDeals: w.totalDeals,
      recentDeals,
      totalUsdcRefereed: w.totalPrices.toString(),
      totalDisputes,
      ruledForBuyer,
      ruledForSeller,
      timedOut,
      medianRulingHours: medianRulingHours !== undefined ? medianRulingHours : null,
      firstDealAt: w.firstDealAt,
      computedAt: now,
    });
  }

  return out;
}
