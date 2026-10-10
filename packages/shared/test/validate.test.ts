import { describe, expect, it } from 'vitest';
import { parseUnits, zeroAddress, type Address } from 'viem';
import {
  escrowedAmount,
  levelCap,
  MAX_TOTAL_HELD,
  splitFee,
  validateTerms,
  type TermsContext,
  type Terms,
} from '../src/index.js';
import { ZERO32 } from './helpers.js';

const SELLER: Address = '0x1111111111111111111111111111111111111111';
const PLUG: Address = '0x2222222222222222222222222222222222222222';
const BUYER: Address = '0x3333333333333333333333333333333333333333';
const REFUND: Address = '0x4444444444444444444444444444444444444444';
const NOW = 1_800_000_000n;
const DAY = 86_400;

const base: Terms = {
  seller: SELLER,
  plug: PLUG,
  orderId: `0x${'ab'.repeat(32)}`,
  price: parseUnits('20', 6),
  plugFee: parseUnits('1', 6),
  windowSeconds: 7 * DAY,
  expiry: NOW + 3600n,
  metadataHash: ZERO32,
};
const ctx: TermsContext = { now: NOW, plugLevel: 5, buyer: BUYER, refundTo: REFUND };

const errors = (terms: Partial<Terms>, c: Partial<TermsContext> = {}) =>
  validateTerms({ ...base, ...terms }, { ...ctx, ...c }).map((v) => v.error);

describe('validateTerms', () => {
  it('accepts valid terms', () => {
    expect(errors({})).toEqual([]);
  });

  it('accepts a draft without buyer or refund address', () => {
    expect(validateTerms(base, { now: NOW, plugLevel: 5 })).toEqual([]);
    expect(validateTerms({ ...base, seller: PLUG }, { now: NOW, plugLevel: 5 }).map((v) => v.error)).toEqual(['SameParty']);
  });

  it('ZeroAddress for seller, plug and refund address', () => {
    expect(errors({ seller: zeroAddress })).toContain('ZeroAddress');
    expect(errors({ plug: zeroAddress })).toContain('ZeroAddress');
    expect(errors({}, { refundTo: zeroAddress })).toEqual(['ZeroAddress']);
  });

  it('SameParty for each pair', () => {
    expect(errors({ plug: SELLER })).toEqual(['SameParty']);
    expect(errors({}, { buyer: PLUG })).toEqual(['SameParty']);
    expect(errors({}, { buyer: SELLER })).toEqual(['SameParty']);
  });

  it('address comparison ignores case', () => {
    expect(errors({}, { buyer: SELLER.toLowerCase() as Address })).toEqual(['SameParty']);
  });

  it('InvalidRefundTo when refunds would go to the seller or the plug', () => {
    expect(errors({}, { refundTo: SELLER })).toEqual(['InvalidRefundTo']);
    expect(errors({}, { refundTo: PLUG })).toEqual(['InvalidRefundTo']);
    // A refund address that is the buyer is fine.
    expect(errors({}, { refundTo: BUYER })).toEqual([]);
  });

  it('PlugNotListed for level 0 and nothing about the cap', () => {
    expect(errors({}, { plugLevel: 0 })).toEqual(['PlugNotListed']);
  });

  it('AmountOutOfRange below 1 USDC, exact boundary accepted', () => {
    expect(errors({ price: 999_999n, plugFee: 0n })).toEqual(['AmountOutOfRange']);
    expect(errors({ price: 1_000_000n, plugFee: 0n })).toEqual([]);
    expect(errors({ price: 0n, plugFee: 0n })).toEqual(['AmountOutOfRange']);
  });

  it('ExceedsPlugLevel at every level cap boundary', () => {
    const caps = [5, 10, 25, 50, 100];
    caps.forEach((usdc, i) => {
      const level = i + 1;
      const cap = parseUnits(String(usdc), 6);
      expect(errors({ price: cap, plugFee: 0n }, { plugLevel: level })).toEqual([]);
      expect(errors({ price: cap + 1n, plugFee: 0n }, { plugLevel: level })).toEqual(['ExceedsPlugLevel']);
    });
  });

  it('FeeTooHigh above 5%, exact 5% accepted', () => {
    const price = parseUnits('100', 6);
    expect(errors({ price, plugFee: parseUnits('5', 6) })).toEqual([]);
    expect(errors({ price, plugFee: parseUnits('5', 6) + 2n })).toEqual(['FeeTooHigh']);
    // 5% of 1.000001 USDC is 50,000.05 base units; 50,000 fits, 50,002 does not.
    expect(errors({ price: 1_000_001n, plugFee: 50_000n })).toEqual([]);
    expect(errors({ price: 1_000_001n, plugFee: 50_002n })).toEqual(['FeeTooHigh']);
  });

  it('FeeTooHigh when the fee is larger than the price', () => {
    expect(errors({ price: 1_000_000n, plugFee: 1_000_002n })).toEqual(['FeeTooHigh']);
  });

  it('FeeNotEven for odd base units, zero fee accepted', () => {
    expect(errors({ plugFee: 999_999n })).toEqual(['FeeNotEven']);
    expect(errors({ plugFee: 1n })).toEqual(['FeeNotEven']);
    expect(errors({ plugFee: 0n })).toEqual([]);
    expect(errors({ plugFee: 2n })).toEqual([]);
  });

  it('WindowTooLong above 14 days, 0 and 14 days accepted', () => {
    expect(errors({ windowSeconds: 0 })).toEqual([]);
    expect(errors({ windowSeconds: 14 * DAY })).toEqual([]);
    expect(errors({ windowSeconds: 14 * DAY + 1 })).toEqual(['WindowTooLong']);
  });

  it('TermsExpired when now >= expiry', () => {
    expect(errors({ expiry: NOW })).toEqual(['TermsExpired']);
    expect(errors({ expiry: NOW - 1n })).toEqual(['TermsExpired']);
    expect(errors({ expiry: NOW + 1n })).toEqual([]);
  });

  it('TermsLifetimeTooLong beyond 30 days, exact 30 days accepted', () => {
    expect(errors({ expiry: NOW + BigInt(30 * DAY) })).toEqual([]);
    expect(errors({ expiry: NOW + BigInt(30 * DAY) + 1n })).toEqual(['TermsLifetimeTooLong']);
  });

  it('HeldCapExceeded only when totalHeld is given', () => {
    const escrowed = escrowedAmount(base.price, base.plugFee);
    expect(errors({}, { totalHeld: MAX_TOTAL_HELD - escrowed })).toEqual([]);
    expect(errors({}, { totalHeld: MAX_TOTAL_HELD - escrowed + 1n })).toEqual(['HeldCapExceeded']);
    expect(errors({})).toEqual([]);
  });

  it('reports every violation at once', () => {
    expect(errors({ price: 999_999n, plugFee: 999_999n, windowSeconds: 15 * DAY, expiry: NOW })).toEqual([
      'AmountOutOfRange',
      'FeeTooHigh',
      'FeeNotEven',
      'WindowTooLong',
      'TermsExpired',
    ]);
  });

  it('InvalidValue for values the ABI cannot encode, and stops there', () => {
    expect(errors({ seller: '0x1234' as Address })).toEqual(['InvalidValue']);
    expect(errors({ orderId: '0x12' })).toEqual(['InvalidValue']);
    expect(errors({ price: -1n })).toEqual(['InvalidValue']);
    expect(errors({ plugFee: -2n })).toEqual(['InvalidValue']);
    expect(errors({ windowSeconds: 1.5 })).toEqual(['InvalidValue']);
    expect(errors({ windowSeconds: 2 ** 32 })).toEqual(['InvalidValue']);
    expect(errors({ expiry: 2n ** 64n })).toEqual(['InvalidValue']);
    expect(errors({}, { refundTo: 'nope' as Address })).toEqual(['InvalidValue']);
  });

  it('names the field and gives a readable message', () => {
    const [v] = validateTerms({ ...base, price: parseUnits('30', 6), plugFee: 0n }, { ...ctx, plugLevel: 3 });
    expect(v).toEqual({ error: 'ExceedsPlugLevel', field: 'price', message: 'a level 3 plug can referee up to 25 USDC' });
  });
});

describe('fee helpers', () => {
  it('escrowedAmount adds the buyer half of the fee', () => {
    expect(escrowedAmount(20_000_000n, 1_000_000n)).toBe(20_500_000n);
    expect(escrowedAmount(20_000_000n, 0n)).toBe(20_000_000n);
  });

  it('splitFee rounds the buyer half down, as the contract does', () => {
    expect(splitFee(1_000_000n)).toEqual({ buyerHalf: 500_000n, sellerHalf: 500_000n });
    expect(splitFee(3n)).toEqual({ buyerHalf: 1n, sellerHalf: 2n });
    expect(splitFee(0n)).toEqual({ buyerHalf: 0n, sellerHalf: 0n });
  });

  it('levelCap matches the published caps and rejects other levels', () => {
    expect([0, 1, 2, 3, 4, 5].map(levelCap)).toEqual([0n, 5_000_000n, 10_000_000n, 25_000_000n, 50_000_000n, 100_000_000n]);
    expect(() => levelCap(6)).toThrow(/InvalidLevel/);
    expect(() => levelCap(-1)).toThrow(/InvalidLevel/);
    expect(() => levelCap(1.5)).toThrow(/InvalidLevel/);
  });
});
