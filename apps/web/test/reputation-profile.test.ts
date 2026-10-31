/**
 * Unit tests for apps/web/src/lib/reputation/profile.ts
 * fetchProfile makes real network calls so we mock global fetch.
 * verifyMessage from viem is mocked via vi.mock (hoisted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';

// ── mock viem (hoisted) ───────────────────────────────────────────────────────
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return { ...actual, verifyMessage: vi.fn().mockResolvedValue(true) };
});

// ── constants ─────────────────────────────────────────────────────────────────
const PLUG = getAddress('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
const SIG  = '0xdeadbeef1234';
const VALID_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

function makeProfile(overrides: Record<string, unknown> = {}) {
  return { address: PLUG, name: 'Test Plug', bio: 'Reliable', publishedAt: '2026-01-01T00:00:00.000Z', signature: SIG, ...overrides };
}

function stubFetch(response: string | null, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (response === null) throw new Error('network error');
    return { ok: status === 200, text: async () => response } as Response;
  }));
}

beforeEach(async () => {
  // Reset the mock return value to true before each test.
  const { verifyMessage } = await import('viem');
  vi.mocked(verifyMessage).mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── profilePayload ────────────────────────────────────────────────────────────
describe('profilePayload', () => {
  it('returns a stable JSON string containing publishedAt', async () => {
    const { profilePayload } = await import('@/lib/reputation/profile');
    const payload = profilePayload({ address: PLUG, name: 'My Plug' });
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    expect(parsed.address).toBe(PLUG);
    expect(parsed.name).toBe('My Plug');
    expect(typeof parsed.publishedAt).toBe('string');
    expect(parsed.publishedAt as string).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not include a signature field', async () => {
    const { profilePayload } = await import('@/lib/reputation/profile');
    const payload = profilePayload({ address: PLUG, name: 'Plug' });
    expect(JSON.parse(payload)).not.toHaveProperty('signature');
  });

  it('re-parsing the payload gives the same fields back', async () => {
    const { profilePayload } = await import('@/lib/reputation/profile');
    const input = { address: PLUG, name: 'The Plug', bio: 'Experienced' };
    const payload = profilePayload(input);
    const parsed = JSON.parse(payload) as typeof input;
    expect(parsed.address).toBe(input.address);
    expect(parsed.name).toBe(input.name);
    expect(parsed.bio).toBe(input.bio);
  });
});

// ── fetchProfile — CID validation ─────────────────────────────────────────────
describe('fetchProfile — CID validation', () => {
  it('returns null for an empty CID without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    const { fetchProfile } = await import('@/lib/reputation/profile');
    expect(await fetchProfile('')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null for a CID that fails the regex', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as never);
    const { fetchProfile } = await import('@/lib/reputation/profile');
    expect(await fetchProfile('not-a-cid')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a valid CIDv0', async () => {
    stubFetch(JSON.stringify(makeProfile()));
    const { fetchProfile } = await import('@/lib/reputation/profile');
    const result = await fetchProfile(VALID_CID);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Test Plug');
  });
});

// ── fetchProfile — gateway fallback ───────────────────────────────────────────
describe('fetchProfile — gateway fallback', () => {
  it('returns null when all gateways fail', async () => {
    stubFetch(null);
    const { fetchProfile } = await import('@/lib/reputation/profile');
    expect(await fetchProfile(VALID_CID)).toBeNull();
  });

  it('returns null when response is not valid JSON', async () => {
    stubFetch('this is not json');
    const { fetchProfile } = await import('@/lib/reputation/profile');
    expect(await fetchProfile(VALID_CID)).toBeNull();
  });
});

// ── fetchProfile — signature verification ─────────────────────────────────────
describe('fetchProfile — signature verification', () => {
  it('returns the profile when verifyMessage returns true', async () => {
    stubFetch(JSON.stringify(makeProfile()));
    const { fetchProfile } = await import('@/lib/reputation/profile');
    const result = await fetchProfile(VALID_CID);
    expect(result).not.toBeNull();
    expect(result?.address).toBe(PLUG);
  });

  it('returns null when verifyMessage returns false', async () => {
    const { verifyMessage } = await import('viem');
    vi.mocked(verifyMessage).mockResolvedValue(false);
    stubFetch(JSON.stringify(makeProfile()));
    const { fetchProfile } = await import('@/lib/reputation/profile');
    expect(await fetchProfile(VALID_CID)).toBeNull();
  });

  it('returns null when the profile is missing the address field', async () => {
    stubFetch(JSON.stringify(makeProfile({ address: undefined })));
    const { fetchProfile } = await import('@/lib/reputation/profile');
    expect(await fetchProfile(VALID_CID)).toBeNull();
  });

  it('returns null when the profile is missing the name field', async () => {
    stubFetch(JSON.stringify(makeProfile({ name: undefined })));
    const { fetchProfile } = await import('@/lib/reputation/profile');
    expect(await fetchProfile(VALID_CID)).toBeNull();
  });

  it('accepts an unsigned profile (no signature)', async () => {
    const { verifyMessage } = await import('viem');
    vi.mocked(verifyMessage).mockClear();
    stubFetch(JSON.stringify(makeProfile({ signature: undefined })));
    const { fetchProfile } = await import('@/lib/reputation/profile');
    const result = await fetchProfile(VALID_CID);
    expect(result).not.toBeNull();
    expect(vi.mocked(verifyMessage)).not.toHaveBeenCalled();
  });
});
