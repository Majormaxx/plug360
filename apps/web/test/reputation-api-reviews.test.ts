/**
 * Unit tests for /api/reputation/reviews route handler.
 *
 * We import the route handlers directly. verifyMessage, createPublicClient,
 * and @plug360/shared are mocked so tests run offline without a built package.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

// ── hoisted mock state ────────────────────────────────────────────────────────
// vi.hoisted runs before vi.mock factories, making these available to them.
const { mockReadContract, verifyMessageFn } = vi.hoisted(() => ({
  mockReadContract: vi.fn(),
  verifyMessageFn: vi.fn().mockResolvedValue(true),
}));

// ── mock @plug360/shared ──────────────────────────────────────────────────────
// reputation.ts resolves fine on its own but the `export * from './reputation.js'`
// re-export inside @plug360/shared's index.ts silently drops it in the web
// test environment (vitest conditions resolution quirk). We re-export reviewPayload
// explicitly so the route module gets it.

vi.mock('@plug360/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@plug360/shared')>();
  function reviewPayload(r: { dealId: string; plugAddress: string; buyerAddress: string; rating: number; text: string; wasDisputed: boolean }): string {
    return `plug360-review:${r.dealId}:${r.plugAddress.toLowerCase()}:${r.buyerAddress.toLowerCase()}:${r.rating}:${r.text}`;
  }
  return { ...actual, reviewPayload };
});

// ── mock viem ─────────────────────────────────────────────────────────────────
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    verifyMessage: verifyMessageFn,
    createPublicClient: vi.fn(() => ({ readContract: mockReadContract })),
  };
});

// ── mock @/lib/config ─────────────────────────────────────────────────────────
vi.mock('@/lib/config', () => ({
  network: {
    chain: { id: 5042, name: 'Arc Testnet' },
    escrow: '0x0000000000000000000000000000000000000001' as `0x${string}`,
    rpcUrls: ['http://localhost:8545'],
  },
}));

// ── addresses ────────────────────────────────────────────────────────────────
const PLUG  = getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
const BUYER = getAddress('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
const DEAL_ID = '0x' + '11'.repeat(32);

// ── helpers ───────────────────────────────────────────────────────────────────
// Each test gets a unique IP so the module-level rate limiter (10 req / min)
// never fires spuriously across tests.
let _ipCounter = 0;
function freshIp() { return `10.0.0.${++_ipCounter}`; }

function makeRequest(body: unknown, ip?: string): Request {
  return new Request('http://localhost/api/reputation/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip ?? freshIp() },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    dealId: DEAL_ID,
    plugAddress: PLUG,
    buyerAddress: BUYER,
    rating: 3,
    text: 'solid work',
    wasDisputed: false,
    signature: '0xdeadbeef',
  };
}

// Import DealStatus from the mock too; it's in actual so it works fine.
import { DealStatus } from '@plug360/shared';

function mockDeal(status: number, buyer = BUYER, plug = PLUG) {
  mockReadContract.mockResolvedValue({ buyer, plug, status });
}

// ── setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'plug360-reviews-api-'));
  process.env.REVIEWS_DB_PATH = join(tmpDir, 'reviews.json');
  mockDeal(DealStatus.Settled);
  // Restore verifyMessage's default after vi.clearAllMocks() wipes it.
  vi.mocked(verifyMessageFn).mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.REVIEWS_DB_PATH;
  vi.clearAllMocks();
});

// ── GET ───────────────────────────────────────────────────────────────────────
describe('GET /api/reputation/reviews', () => {
  it('returns 400 when plug param is missing', async () => {
    const { GET } = await import('@/app/api/reputation/reviews/route');
    const req = new Request('http://localhost/api/reputation/reviews');
    expect((await GET(req)).status).toBe(400);
  });

  it('returns empty array when no reviews exist', async () => {
    const { GET } = await import('@/app/api/reputation/reviews/route');
    const req = new Request(`http://localhost/api/reputation/reviews?plug=${PLUG}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

// ── POST validation ───────────────────────────────────────────────────────────
describe('POST /api/reputation/reviews — field validation', () => {
  it('returns 400 when dealId is missing', async () => {
    const { POST } = await import('@/app/api/reputation/reviews/route');
    const body = validBody();
    delete (body as Record<string, unknown>).dealId;
    expect((await POST(makeRequest(body))).status).toBe(400);
  });

  it('returns 400 when plugAddress is not an address', async () => {
    const { POST } = await import('@/app/api/reputation/reviews/route');
    expect((await POST(makeRequest({ ...validBody(), plugAddress: 'not-an-address' }))).status).toBe(400);
  });

  it('returns 400 when rating is out of range', async () => {
    const { POST } = await import('@/app/api/reputation/reviews/route');
    expect((await POST(makeRequest({ ...validBody(), rating: 6 }))).status).toBe(400);
    expect((await POST(makeRequest({ ...validBody(), rating: 0 }))).status).toBe(400);
  });

  it('returns 400 when text is empty', async () => {
    const { POST } = await import('@/app/api/reputation/reviews/route');
    expect((await POST(makeRequest({ ...validBody(), text: '   ' }))).status).toBe(400);
  });

  it('returns 400 when text exceeds 280 chars', async () => {
    const { POST } = await import('@/app/api/reputation/reviews/route');
    expect((await POST(makeRequest({ ...validBody(), text: 'x'.repeat(281) }))).status).toBe(400);
  });

  it('returns 400 for non-JSON body', async () => {
    const { POST } = await import('@/app/api/reputation/reviews/route');
    const req = new Request('http://localhost/api/reputation/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': freshIp() },
      body: 'not json',
    });
    expect((await POST(req)).status).toBe(400);
  });
});

// ── POST security gates ───────────────────────────────────────────────────────
describe('POST /api/reputation/reviews — security gates', () => {
  it('returns 401 when signature does not match', async () => {
    const { verifyMessage } = await import('viem');
    vi.mocked(verifyMessage).mockResolvedValue(false);
    const { POST } = await import('@/app/api/reputation/reviews/route');
    expect((await POST(makeRequest(validBody()))).status).toBe(401);
  });

  it('returns 422 when deal is not final (Held)', async () => {
    mockDeal(DealStatus.Held);
    const { POST } = await import('@/app/api/reputation/reviews/route');
    expect((await POST(makeRequest(validBody()))).status).toBe(422);
  });

  it('returns 403 when buyer does not match deal', async () => {
    const OTHER = getAddress('0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD');
    mockDeal(DealStatus.Settled, OTHER, PLUG);
    const { POST } = await import('@/app/api/reputation/reviews/route');
    expect((await POST(makeRequest(validBody()))).status).toBe(403);
  });

  it('returns 403 when plug address does not match deal', async () => {
    const OTHER = getAddress('0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE');
    mockDeal(DealStatus.Settled, BUYER, OTHER);
    const { POST } = await import('@/app/api/reputation/reviews/route');
    expect((await POST(makeRequest(validBody()))).status).toBe(403);
  });

  it('returns 404 when deal status is None', async () => {
    mockDeal(DealStatus.None);
    const { POST } = await import('@/app/api/reputation/reviews/route');
    expect((await POST(makeRequest(validBody()))).status).toBe(404);
  });
});

// ── POST happy path ───────────────────────────────────────────────────────────
describe('POST /api/reputation/reviews — happy path', () => {
  it('returns 201 and the saved review on success', async () => {
    const { POST } = await import('@/app/api/reputation/reviews/route');
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; rating: number };
    expect(body.id).toBeTypeOf('string');
    expect(body.rating).toBe(3);
  });

  it('returns 409 on a duplicate review for the same buyer/deal', async () => {
    const { POST } = await import('@/app/api/reputation/reviews/route');
    const ip = freshIp();
    await POST(makeRequest(validBody(), ip));
    expect((await POST(makeRequest(validBody(), ip))).status).toBe(409);
  });
});

// ── Rate limiter ──────────────────────────────────────────────────────────────
describe('POST /api/reputation/reviews — rate limiter', () => {
  it('returns 429 after 10 requests from the same IP in one window', async () => {
    const { POST } = await import('@/app/api/reputation/reviews/route');
    const ip = `10.99.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    // 10 requests — all with unique dealIds to avoid 409.
    for (let i = 0; i < 10; i++) {
      mockDeal(DealStatus.Settled);
      await POST(makeRequest({ ...validBody(), dealId: '0x' + i.toString(16).padStart(64, '0') }, ip));
    }
    mockDeal(DealStatus.Settled);
    expect((await POST(makeRequest({ ...validBody(), dealId: '0x' + 'ff'.repeat(32) }, ip))).status).toBe(429);
  });
});
