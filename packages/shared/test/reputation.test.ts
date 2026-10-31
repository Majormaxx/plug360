import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { reviewPayload } from '../src/reputation.js';

const DEAL_ID = '0x' + 'ab'.repeat(32);
const PLUG = getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
const BUYER = getAddress('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');

describe('reviewPayload', () => {
  it('produces the exact expected format', () => {
    const p = reviewPayload({ dealId: DEAL_ID, plugAddress: PLUG, buyerAddress: BUYER, rating: 4, text: 'Great plug', wasDisputed: false });
    expect(p).toBe(
      `plug360-review:${DEAL_ID}:${PLUG.toLowerCase()}:${BUYER.toLowerCase()}:4:Great plug`,
    );
  });

  it('always lowercases addresses regardless of input casing', () => {
    const upper = reviewPayload({ dealId: DEAL_ID, plugAddress: PLUG, buyerAddress: BUYER, rating: 1, text: 'ok', wasDisputed: false });
    const lower = reviewPayload({
      dealId: DEAL_ID,
      plugAddress: PLUG.toLowerCase() as `0x${string}`,
      buyerAddress: BUYER.toLowerCase() as `0x${string}`,
      rating: 1,
      text: 'ok',
      wasDisputed: false,
    });
    expect(upper).toBe(lower);
  });

  it('changing any single field produces a different payload', () => {
    const base = { dealId: DEAL_ID, plugAddress: PLUG, buyerAddress: BUYER, rating: 3 as const, text: 'mid', wasDisputed: false };
    const ref = reviewPayload(base);
    expect(reviewPayload({ ...base, dealId: DEAL_ID.replace('ab', 'cd') })).not.toBe(ref);
    expect(reviewPayload({ ...base, plugAddress: getAddress('0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC') })).not.toBe(ref);
    expect(reviewPayload({ ...base, buyerAddress: getAddress('0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD') })).not.toBe(ref);
    expect(reviewPayload({ ...base, rating: 5 })).not.toBe(ref);
    expect(reviewPayload({ ...base, text: 'different' })).not.toBe(ref);
    expect(reviewPayload({ ...base, wasDisputed: true })).toBe(ref); // wasDisputed not in payload
  });

  it('text with colons does not confuse the prefix split', () => {
    const p = reviewPayload({ dealId: DEAL_ID, plugAddress: PLUG, buyerAddress: BUYER, rating: 2, text: 'a:b:c', wasDisputed: false });
    // The payload must start with the known prefix; colons in text don't bleed into earlier fields.
    expect(p.startsWith('plug360-review:')).toBe(true);
    expect(p.endsWith(':2:a:b:c')).toBe(true);
  });

  it('each rating value 1-5 produces a distinct payload', () => {
    const payloads = ([1, 2, 3, 4, 5] as const).map((r) =>
      reviewPayload({ dealId: DEAL_ID, plugAddress: PLUG, buyerAddress: BUYER, rating: r, text: 't', wasDisputed: false }),
    );
    expect(new Set(payloads).size).toBe(5);
  });
});
