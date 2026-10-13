import { describe, expect, it } from 'vitest';
import { DealStatus, PLUG_WINDOW_SECONDS, type Deal } from '@plug360/shared';
import { getAddress } from 'viem';
import { gasEligibility, topUpAmount } from '../src/policy.js';

const buyer = getAddress('0x1111111111111111111111111111111111111111');
const seller = getAddress('0x2222222222222222222222222222222222222222');
const plug = getAddress('0x3333333333333333333333333333333333333333');
const stranger = getAddress('0x4444444444444444444444444444444444444444');
const base: Deal = {
  buyer, seller, plug, refundTo: buyer, price: 10_000_000n, plugFee: 200_000n, paidAt: 100, releaseAt: 1_000, disputedAt: 0,
  status: DealStatus.Held, payoutPending: false, orderId: `0x${'00'.repeat(32)}`, evidenceHash: `0x${'00'.repeat(32)}`,
};
const disputed: Deal = { ...base, status: DealStatus.Disputed, disputedAt: 500 };

describe('gasEligibility', () => {
  it('pays only the party the escrow lets act', () => {
    expect(gasEligibility(base, buyer, 'openDispute', 999)).toEqual({ ok: true });
    expect(gasEligibility(base, buyer, 'release', 5_000)).toEqual({ ok: true });
    expect(gasEligibility(base, seller, 'refund', 5_000)).toEqual({ ok: true });
    expect(gasEligibility(disputed, plug, 'plugRefund', 501)).toEqual({ ok: true });
    expect(gasEligibility(disputed, plug, 'plugReject', 501)).toEqual({ ok: true });
  });

  it('refuses strangers and the wrong party', () => {
    for (const action of ['openDispute', 'release', 'refund', 'plugRefund', 'plugReject'] as const) {
      expect(gasEligibility(disputed, stranger, action, 600).ok).toBe(false);
    }
    expect(gasEligibility(base, seller, 'openDispute', 10).ok).toBe(false);
    expect(gasEligibility(disputed, buyer, 'plugRefund', 600).ok).toBe(false);
  });

  it('follows the contract clock', () => {
    expect(gasEligibility(base, buyer, 'openDispute', 1_000).ok).toBe(false);
    expect(gasEligibility(disputed, plug, 'plugRefund', 500 + PLUG_WINDOW_SECONDS).ok).toBe(false);
    expect(gasEligibility(base, plug, 'plugRefund', 600).ok).toBe(false);
  });

  it('pays nothing on missing or finished deals', () => {
    expect(gasEligibility({ ...base, status: DealStatus.None }, buyer, 'release', 0).ok).toBe(false);
    for (const status of [DealStatus.Released, DealStatus.Refunded, DealStatus.Settled]) {
      expect(gasEligibility({ ...base, status }, seller, 'refund', 0).ok).toBe(false);
      expect(gasEligibility({ ...base, status }, buyer, 'release', 0).ok).toBe(false);
    }
  });
});

describe('topUpAmount', () => {
  it('fills to 150% of the gas cost, minus the balance, capped', () => {
    expect(topUpAmount(0n, 100n, 1_000n)).toBe(150n);
    expect(topUpAmount(40n, 100n, 1_000n)).toBe(110n);
    expect(topUpAmount(150n, 100n, 1_000n)).toBe(0n);
    expect(topUpAmount(0n, 10_000n, 1_000n)).toBe(1_000n);
  });
});
