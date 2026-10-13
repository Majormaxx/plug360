import { describe, expect, it } from 'vitest';
import { addressChunks, dealIdToHex, duration, parseDealId, shortAddress, usdc } from '../src/lib/format';

describe('usdc', () => {
  it.each([
    [0n, '0.00'],
    [1n, '0.000001'],
    [1_000_000n, '1.00'],
    [12_500_000n, '12.50'],
    [102_500_000n, '102.50'],
    [2_500_000_000n, '2,500.00'],
    [1_234_567n, '1.234567'],
  ])('%s -> %s', (v, want) => expect(usdc(v)).toBe(want));
});

describe('addresses', () => {
  const a = '0x3df58eFFC292D5043075d71e6705dF6b7348171D';
  it('chunks every character of a full address', () => {
    const c = addressChunks(a);
    expect(c).toHaveLength(10);
    expect(`0x${c.join('')}`).toBe(a);
  });
  it('shortens for compact places only', () => expect(shortAddress(a)).toBe('0x3df5…171D'));
});

describe('duration', () => {
  it.each([
    [0, 'none'],
    [42, '42 s'],
    [60, '1 min'],
    [3_600, '1 h'],
    [3_660, '1 h 1 min'],
    [86_400, '1 day'],
    [90_000, '1 d 1 h'],
    [7 * 86_400, '7 days'],
    [-5, 'none'],
  ])('%s s -> %s', (s, want) => expect(duration(s)).toBe(want));
});

describe('deal ids', () => {
  it('round-trips through hex', () => {
    const id = 2n ** 255n + 12345n;
    expect(parseDealId(dealIdToHex(id))).toBe(id);
    expect(dealIdToHex(1n)).toHaveLength(66);
  });
  it('accepts decimal and rejects junk or overflow', () => {
    expect(parseDealId('42')).toBe(42n);
    expect(parseDealId('0xzz')).toBeUndefined();
    expect(parseDealId((2n ** 256n).toString())).toBeUndefined();
    expect(parseDealId('')).toBeUndefined();
  });
});
