import { DealStatus, PLUG_WINDOW_SECONDS, type Deal } from '@plug360/shared';
import { isAddressEqual, type Address } from 'viem';
import type { SponsoredAction } from './contract.js';

export type Eligibility = { ok: true } | { ok: false; reason: string };

/**
 * Who the sponsor pays gas for: only the party the escrow allows to take `action` right now, on a real
 * funded deal. Mirrors the contract's guards, so sponsored gas can only ever be spent on a call that
 * would succeed. Permissionless calls (payout, expired disputes, retries) are the keeper's job instead.
 */
export function gasEligibility(deal: Deal, account: Address, action: SponsoredAction, now: number): Eligibility {
  if (deal.status === DealStatus.None) return { ok: false, reason: 'no such deal' };
  const is = (who: Address) => isAddressEqual(account, who);
  const live = deal.status === DealStatus.Held || deal.status === DealStatus.Disputed;
  switch (action) {
    case 'openDispute':
      if (!is(deal.buyer)) return { ok: false, reason: 'only the buyer can open a dispute' };
      if (deal.status !== DealStatus.Held || now >= deal.releaseAt) return { ok: false, reason: 'the money-back window is closed' };
      return { ok: true };
    case 'release':
      if (!is(deal.buyer)) return { ok: false, reason: 'only the buyer can release' };
      return live ? { ok: true } : { ok: false, reason: 'the deal is not open' };
    case 'refund':
      if (!is(deal.seller)) return { ok: false, reason: 'only the seller can refund' };
      return live ? { ok: true } : { ok: false, reason: 'the deal is not open' };
    case 'plugRefund':
    case 'plugReject':
      if (!is(deal.plug)) return { ok: false, reason: 'only the plug can rule' };
      if (deal.status !== DealStatus.Disputed) return { ok: false, reason: 'there is no open dispute' };
      if (now >= deal.disputedAt + PLUG_WINDOW_SECONDS) return { ok: false, reason: 'the ruling deadline has passed' };
      return { ok: true };
  }
}

/**
 * How much native gas to send: enough for the call with 50% headroom, minus what the account already
 * holds, never more than `cap`. Zero when the account can already pay, which makes repeated requests free.
 */
export function topUpAmount(balance: bigint, gasCost: bigint, cap: bigint): bigint {
  const target = (gasCost * 3n) / 2n;
  if (balance >= target) return 0n;
  const need = target - balance;
  return need > cap ? cap : need;
}
