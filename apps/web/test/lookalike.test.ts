import { describe, expect, it } from 'vitest';
import { lookalikeOf } from '../src/lib/lookalike';

const real = '0xc98AA1601B5c088EFc73Ae71706A10343a5c642c';
const poisoned = `0xc98a${'0'.repeat(32)}642c`;

describe('lookalikeOf', () => {
  it('flags an address that matches a known one at both ends but is different', () => {
    expect(lookalikeOf(poisoned, [real])).toBe(real);
  });
  it('accepts the known address itself, in any case', () => {
    expect(lookalikeOf(real.toLowerCase(), [real])).toBeUndefined();
  });
  it('accepts an exact match even when another known address looks similar', () => {
    expect(lookalikeOf(real, [poisoned, real])).toBeUndefined();
  });
  it('ignores unrelated addresses and junk', () => {
    expect(lookalikeOf('0x1111111111111111111111111111111111111111', [real])).toBeUndefined();
    expect(lookalikeOf('0x12', [real])).toBeUndefined();
    expect(lookalikeOf(poisoned, ['not-an-address'])).toBeUndefined();
  });
});
