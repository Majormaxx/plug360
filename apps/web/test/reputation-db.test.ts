/**
 * Tests for apps/web/src/lib/reputation/db.ts
 *
 * We point REVIEWS_DB_PATH at a tmp file so tests are isolated and don't
 * pollute the shared /tmp/plug360-reviews.json.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

// ── helpers ─────────────────────────────────────────────────────────────────

const PLUG = getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
const BUYER_A = getAddress('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
const BUYER_B = getAddress('0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');
const DEAL_1 = '0x' + '11'.repeat(32);
const DEAL_2 = '0x' + '22'.repeat(32);

function makeInput(overrides: Partial<Parameters<typeof import('@/lib/reputation/db')['insertReview']>[0]> = {}) {
  return {
    dealId: DEAL_1,
    plugAddress: PLUG,
    buyerAddress: BUYER_A,
    rating: 4 as const,
    text: 'great plug',
    wasDisputed: false,
    signature: '0xdeadbeef',
    ...overrides,
  };
}

// ── test setup ───────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  // Reset module cache so each test gets a fresh _writeLock and reads
  // the updated REVIEWS_DB_PATH env var at import time.
  vi.resetModules();
  tmpDir = mkdtempSync(join(tmpdir(), 'plug360-reviews-'));
  process.env.REVIEWS_DB_PATH = join(tmpDir, 'reviews.json');
});

afterEach(() => {
  delete process.env.REVIEWS_DB_PATH;
  vi.resetModules();
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('insertReview', () => {
  it('persists a review and returns it with an id and createdAt', async () => {
    // Lazy import so the module reads the fresh REVIEWS_DB_PATH set above.
    const { insertReview } = await import('@/lib/reputation/db');
    const r = await insertReview(makeInput());
    expect(r.id).toBeTypeOf('string');
    expect(r.id.length).toBeGreaterThan(0);
    expect(r.dealId).toBe(DEAL_1);
    expect(r.rating).toBe(4);
    expect(r.createdAt).toBeGreaterThan(0);
  });

  it('throws already-reviewed on a duplicate (same dealId + buyerAddress)', async () => {
    const { insertReview } = await import('@/lib/reputation/db');
    await insertReview(makeInput());
    await expect(insertReview(makeInput())).rejects.toThrow('already-reviewed');
  });

  it('allows a second review from a different buyer on the same deal', async () => {
    const { insertReview } = await import('@/lib/reputation/db');
    await insertReview(makeInput({ buyerAddress: BUYER_A }));
    const r2 = await insertReview(makeInput({ buyerAddress: BUYER_B }));
    expect(r2.buyerAddress).toBe(BUYER_B);
  });

  it('allows the same buyer to review a different deal', async () => {
    const { insertReview } = await import('@/lib/reputation/db');
    await insertReview(makeInput({ dealId: DEAL_1 }));
    const r2 = await insertReview(makeInput({ dealId: DEAL_2 }));
    expect(r2.dealId).toBe(DEAL_2);
  });

  it('duplicate detection is case-insensitive on buyerAddress', async () => {
    const { insertReview } = await import('@/lib/reputation/db');
    await insertReview(makeInput({ buyerAddress: BUYER_A }));
    // Same address, different case.
    await expect(
      insertReview(makeInput({ buyerAddress: BUYER_A.toLowerCase() as `0x${string}` })),
    ).rejects.toThrow('already-reviewed');
  });

  it('concurrent inserts for the same buyer/deal succeed exactly once', async () => {
    const { insertReview } = await import('@/lib/reputation/db');
    const N = 20;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () => insertReview(makeInput())),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(N - 1);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason.message).toBe('already-reviewed');
    }
  });
});

describe('getReviewsForPlug', () => {
  it('returns only reviews whose plugAddress matches (case-insensitive)', async () => {
    const { insertReview, getReviewsForPlug } = await import('@/lib/reputation/db');
    const OTHER_PLUG = getAddress('0x9999999999999999999999999999999999999999');
    await insertReview(makeInput({ plugAddress: PLUG }));
    await insertReview(makeInput({ dealId: DEAL_2, plugAddress: OTHER_PLUG }));

    const forPlug = getReviewsForPlug(PLUG);
    expect(forPlug).toHaveLength(1);
    expect(forPlug[0]!.plugAddress).toBe(PLUG);

    // Also matches when queried with lowercase.
    const forPlugLower = getReviewsForPlug(PLUG.toLowerCase());
    expect(forPlugLower).toHaveLength(1);
  });

  it('returns empty array when no reviews exist for the plug', async () => {
    const { getReviewsForPlug } = await import('@/lib/reputation/db');
    expect(getReviewsForPlug(PLUG)).toEqual([]);
  });
});

describe('getReviewForDeal', () => {
  it('finds the review by dealId and buyerAddress', async () => {
    const { insertReview, getReviewForDeal } = await import('@/lib/reputation/db');
    await insertReview(makeInput());
    const found = getReviewForDeal(DEAL_1, BUYER_A);
    expect(found).toBeDefined();
    expect(found!.dealId).toBe(DEAL_1);
  });

  it('returns undefined for a deal with no review', async () => {
    const { getReviewForDeal } = await import('@/lib/reputation/db');
    expect(getReviewForDeal(DEAL_1, BUYER_A)).toBeUndefined();
  });

  it('lookup is case-insensitive on buyerAddress', async () => {
    const { insertReview, getReviewForDeal } = await import('@/lib/reputation/db');
    await insertReview(makeInput({ buyerAddress: BUYER_A }));
    const found = getReviewForDeal(DEAL_1, BUYER_A.toLowerCase());
    expect(found).toBeDefined();
  });
});
