import { describe, expect, it } from 'vitest';
import { DealStatus, PLUG_WINDOW_SECONDS, type Deal } from '@plug360/shared';
import { getAddress } from 'viem';
import { payoutSplit, phaseOf, roleOf, viewDeal } from '../src/lib/deal';

const buyer = getAddress('0x1111111111111111111111111111111111111111');
const seller = getAddress('0x2222222222222222222222222222222222222222');
const plug = getAddress('0x3333333333333333333333333333333333333333');

const base: Deal = {
  buyer,
  seller,
  plug,
  refundTo: buyer,
  price: 10_000_000n,
  plugFee: 200_000n,
  paidAt: 1_000,
  releaseAt: 1_000 + 86_400,
  disputedAt: 0,
  status: DealStatus.Held,
  payoutPending: false,
  orderId: `0x${'00'.repeat(32)}`,
  evidenceHash: `0x${'00'.repeat(32)}`,
};
const at = (patch: Partial<Deal>) => ({ ...base, ...patch });

describe('roleOf', () => {
  it('matches addresses case-insensitively', () => {
    expect(roleOf(base, buyer.toLowerCase() as `0x${string}`)).toBe('buyer');
    expect(roleOf(base, seller)).toBe('seller');
    expect(roleOf(base, plug)).toBe('plug');
    expect(roleOf(base, getAddress('0x4444444444444444444444444444444444444444'))).toBe('viewer');
    expect(roleOf(base, undefined)).toBe('viewer');
  });
});

describe('phaseOf', () => {
  it('splits Held at releaseAt, exactly as the contract does', () => {
    expect(phaseOf(base, base.releaseAt - 1)).toBe('window');
    expect(phaseOf(base, base.releaseAt)).toBe('payable');
  });

  it('splits Disputed at disputedAt + 7 days', () => {
    const d = at({ status: DealStatus.Disputed, disputedAt: 5_000 });
    expect(phaseOf(d, 5_000 + PLUG_WINDOW_SECONDS - 1)).toBe('disputed');
    expect(phaseOf(d, 5_000 + PLUG_WINDOW_SECONDS)).toBe('dispute-expired');
  });

  it('maps final and missing states', () => {
    expect(phaseOf(at({ status: DealStatus.Released }), 0)).toBe('released');
    expect(phaseOf(at({ status: DealStatus.Refunded }), 0)).toBe('refunded');
    expect(phaseOf(at({ status: DealStatus.Settled }), 0)).toBe('settled');
    expect(phaseOf(at({ status: DealStatus.None }), 0)).toBe('missing');
  });
});

describe('viewDeal actions mirror the contract guards', () => {
  const t = base.releaseAt - 10;

  it('window: buyer releases or disputes, seller refunds, nobody withdraws', () => {
    expect(viewDeal(base, 'buyer', t).actions).toEqual(['release', 'dispute']);
    expect(viewDeal(base, 'seller', t).actions).toEqual(['refund']);
    expect(viewDeal(base, 'plug', t).actions).toEqual([]);
    expect(viewDeal(base, 'viewer', t).actions).toEqual([]);
  });

  it('payable: anyone withdraws, the buyer can no longer dispute', () => {
    const now = base.releaseAt;
    expect(viewDeal(base, 'viewer', now).actions).toEqual(['withdraw']);
    expect(viewDeal(base, 'buyer', now).actions).not.toContain('dispute');
    expect(viewDeal(base, 'seller', now).actions).toEqual(['withdraw', 'refund']);
  });

  it('disputed: only the plug rules, before its deadline', () => {
    const d = at({ status: DealStatus.Disputed, disputedAt: 2_000 });
    expect(viewDeal(d, 'plug', 2_001).actions).toEqual(['plugRefund', 'plugReject']);
    expect(viewDeal(d, 'seller', 2_001).actions).toEqual(['refund']);
    expect(viewDeal(d, 'buyer', 2_001).actions).toEqual(['release']);
    expect(viewDeal(d, 'viewer', 2_001).actions).toEqual([]);
    expect(viewDeal(d, 'plug', 2_001).plugDeadline).toBe(2_000 + PLUG_WINDOW_SECONDS);
  });

  it('dispute-expired: anyone finalizes, the plug can no longer rule', () => {
    const d = at({ status: DealStatus.Disputed, disputedAt: 2_000 });
    const now = 2_000 + PLUG_WINDOW_SECONDS;
    expect(viewDeal(d, 'viewer', now).actions).toEqual(['finalize']);
    expect(viewDeal(d, 'plug', now).actions).toEqual(['finalize']);
  });

  it('released: anyone pays out', () => {
    expect(viewDeal(at({ status: DealStatus.Released }), 'viewer', 0).actions).toEqual(['withdraw']);
  });

  it('final states offer nothing unless a payout is parked', () => {
    expect(viewDeal(at({ status: DealStatus.Settled }), 'seller', 0)).toMatchObject({ actions: [], final: true });
    expect(viewDeal(at({ status: DealStatus.Refunded, payoutPending: true }), 'viewer', 0).actions).toEqual(['retry']);
  });
});

describe('payoutSplit', () => {
  it('matches the contract split, odd halves included', () => {
    expect(payoutSplit(10_000_000n, 200_000n)).toEqual({
      escrowed: 10_100_000n,
      toSeller: 9_900_000n,
      toPlug: 200_000n,
      plugRefundToBuyer: 10_000_000n,
      plugRefundToPlug: 100_000n,
    });
    const s = payoutSplit(1_000_000n, 0n);
    expect(s.escrowed).toBe(1_000_000n);
    expect(s.toSeller + s.toPlug).toBe(1_000_000n);
  });

  it('conserves funds: every payout path pays out exactly what the buyer escrowed', () => {
    for (const [p, f] of [[5_000_000n, 250_000n], [100_000_000n, 5_000_000n], [1_000_000n, 2n]] as const) {
      const s = payoutSplit(p, f);
      expect(s.toSeller + s.toPlug).toBe(s.escrowed);
      expect(s.plugRefundToBuyer + s.plugRefundToPlug).toBe(s.escrowed);
    }
  });
});
