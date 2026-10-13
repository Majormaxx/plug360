import { describe, expect, it } from 'vitest';
import { getAddress, type Hex } from 'viem';
import { MAX_FEE_BPS } from '@plug360/shared';
import {
  claimSeat,
  decodeDraft,
  isOpenSeat,
  reopenSeat,
  DraftError,
  encodeDraft,
  feeForBps,
  jobHash,
  newOrderId,
  parseUsdcInput,
  type Draft,
} from '../src/lib/draft';

const escrow = getAddress('0x3df58effc292d5043075d71e6705df6b7348171d');
const expect_ = { chainId: 5042002, escrow };
const job = { title: 'Logo for Ada’s bakery 🍞', note: 'Two concepts, one revision.\nFiles as SVG.' };

const draft: Draft = {
  chainId: 5042002,
  escrow,
  job,
  terms: {
    seller: getAddress('0x1111111111111111111111111111111111111111'),
    plug: getAddress('0x2222222222222222222222222222222222222222'),
    orderId: `0x${'ab'.repeat(32)}`,
    price: 12_500_000n,
    plugFee: 250_000n,
    windowSeconds: 3 * 86_400,
    expiry: 1_791_900_000n,
    metadataHash: jobHash(job),
  },
  sellerSig: `0x${'1b'.repeat(65)}` as Hex,
};

describe('draft codec', () => {
  it('round-trips every field, including unicode job text', () => {
    const back = decodeDraft(encodeDraft(draft), expect_);
    expect(back).toEqual(draft);
    expect(back.plugSig).toBeUndefined();
  });

  it('produces URL-safe output with no padding', () => {
    expect(encodeDraft(draft)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('accepts a leading # from location.hash', () => {
    expect(decodeDraft(`#${encodeDraft(draft)}`, expect_).terms.price).toBe(12_500_000n);
  });

  it('rejects links for another chain or escrow', () => {
    const e = () => decodeDraft(encodeDraft(draft), { chainId: 5042, escrow });
    expect(e).toThrow(DraftError);
    try {
      decodeDraft(encodeDraft(draft), { chainId: 5042002, escrow: getAddress(`0x${'9'.repeat(40)}`) });
    } catch (err) {
      expect((err as DraftError).reason).toBe('wrong-network');
    }
  });

  it('rejects truncated, garbage and tampered payloads as malformed', () => {
    const enc = encodeDraft(draft);
    for (const bad of [enc.slice(0, enc.length / 2), 'not-base64!!', '', btoa('{"v":2}')]) {
      try {
        decodeDraft(bad, expect_);
        throw new Error('decoded');
      } catch (err) {
        expect(err).toBeInstanceOf(DraftError);
        expect((err as DraftError).reason).toBe('malformed');
      }
    }
  });

  it('recomputes metadataHash from the job text, so edited text no longer matches the signed hash', () => {
    const edited = { ...draft, job: { ...job, title: 'Logo (cheaper)' } };
    const back = decodeDraft(encodeDraft(edited), expect_);
    expect(back.terms.metadataHash).not.toBe(draft.terms.metadataHash);
  });

  it('rejects job text over the limits', () => {
    const long = { ...draft, job: { title: 'x'.repeat(81), note: '' } };
    expect(() => decodeDraft(encodeDraft(long), expect_)).toThrow(DraftError);
  });
});

describe('jobHash', () => {
  it('is stable for the same text and differs for any change', () => {
    expect(jobHash(job)).toBe(jobHash({ ...job }));
    expect(jobHash(job)).not.toBe(jobHash({ ...job, note: job.note + ' ' }));
  });
});

describe('newOrderId', () => {
  it('returns 32 random bytes', () => {
    const a = newOrderId();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(newOrderId()).not.toBe(a);
  });
});

describe('parseUsdcInput', () => {
  it.each([
    ['1', 1_000_000n],
    ['12.5', 12_500_000n],
    ['0.000001', 1n],
    ['.5', 500_000n],
    ['5.', 5_000_000n],
    ['1,000.25', 1_000_250_000n],
    [' 7 ', 7_000_000n],
  ])('parses %s', (input, want) => expect(parseUsdcInput(input)).toBe(want));

  it.each(['', '.', '-1', '1.0000001', '1e3', 'abc', '1.2.3'])('rejects %s', (input) =>
    expect(parseUsdcInput(input)).toBeUndefined(),
  );
});

describe('feeForBps', () => {
  it('rounds down to an even base-unit amount', () => {
    expect(feeForBps(12_500_000n, 200)).toBe(250_000n);
    expect(feeForBps(1_000_001n, 500)).toBe(50_000n);
    expect(feeForBps(1_000_030n, 100)).toBe(10_000n);
    expect(feeForBps(3n, 500) % 2n).toBe(0n);
  });

  it('never exceeds the contract maximum', () => {
    for (const p of [1_000_000n, 7_777_777n, 100_000_000n]) {
      const f = feeForBps(p, Number(MAX_FEE_BPS));
      expect(f * 10_000n <= p * MAX_FEE_BPS).toBe(true);
      expect(f % 2n).toBe(0n);
    }
  });

  it('refuses out-of-range percentages', () => {
    expect(() => feeForBps(1n, 501)).toThrow(RangeError);
    expect(() => feeForBps(1n, -1)).toThrow(RangeError);
  });
});

describe('open plug seat', () => {
  const open: Draft = { ...draft, terms: { ...draft.terms, plug: '0x0000000000000000000000000000000000000000' } };
  delete open.sellerSig;

  it('omits the plug from the link and decodes it as an open seat', () => {
    const enc = encodeDraft(open);
    expect(JSON.parse(atob(enc.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((enc.length + 3) % 4))).t.p).toBeUndefined();
    const back = decodeDraft(enc, expect_);
    expect(isOpenSeat(back)).toBe(true);
    expect(isOpenSeat(draft)).toBe(false);
  });

  it('claiming fills the seat, keeps the terms and drops stale signatures', () => {
    const plug = getAddress('0x5555555555555555555555555555555555555555');
    const claimed = claimSeat({ ...open, sellerSig: draft.sellerSig! }, plug);
    expect(claimed.terms.plug).toBe(plug);
    expect(claimed.sellerSig).toBeUndefined();
    expect(claimed.terms.metadataHash).toBe(open.terms.metadataHash);
    expect(decodeDraft(encodeDraft(claimed), expect_)).toEqual(claimed);
  });

  it('reopening clears the plug and its acceptance', () => {
    const plug = getAddress('0x5555555555555555555555555555555555555555');
    const reopened = reopenSeat({ ...claimSeat(open, plug), plugSig: `0x${'2b'.repeat(65)}` });
    expect(isOpenSeat(reopened)).toBe(true);
    expect(reopened.plugSig).toBeUndefined();
  });
});
