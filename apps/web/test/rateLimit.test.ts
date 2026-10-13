import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/lib/rateLimit';

describe('createRateLimiter', () => {
  it('allows up to the limit per window, per key', () => {
    let t = 0;
    const allow = createRateLimiter(3, 1_000, () => t);
    expect([allow('a'), allow('a'), allow('a'), allow('a')]).toEqual([true, true, true, false]);
    expect(allow('b')).toBe(true);
    t = 1_000;
    expect(allow('a')).toBe(true);
  });
});
