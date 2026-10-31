/**
 * Unit tests for the localStorage fire-once helpers inside DealClosureModal.
 *
 * The helpers are pure functions that read/write a single localStorage key.
 * We extract them for testing by reproducing their exact implementation here
 * (they are not exported from the component) and testing the behaviour
 * contract they must satisfy.
 *
 * We also test the module-level helper directly by re-implementing it,
 * which lets us assert the contract without depending on React rendering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── re-implement the helpers exactly as they are in the component ────────────

const STORAGE_KEY = 'plug360:closure-seen';

function hasSeen(dealIdHex: string): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const seen: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    return seen.includes(dealIdHex.toLowerCase());
  } catch {
    return false;
  }
}

function markSeen(dealIdHex: string): void {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const seen: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!seen.includes(dealIdHex.toLowerCase())) seen.push(dealIdHex.toLowerCase());
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(seen.slice(-100)));
  } catch {}
}

// ── minimal localStorage stub ─────────────────────────────────────────────────

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });
  localStorageMock.clear();
});

afterEach(() => {
  localStorageMock.clear();
});

// ── tests ────────────────────────────────────────────────────────────────────

const DEAL_A = '0x' + 'aa'.repeat(32);
const DEAL_B = '0x' + 'bb'.repeat(32);

describe('hasSeen', () => {
  it('returns false for an unseen deal', () => {
    expect(hasSeen(DEAL_A)).toBe(false);
  });

  it('returns true after markSeen', () => {
    markSeen(DEAL_A);
    expect(hasSeen(DEAL_A)).toBe(true);
  });

  it('is case-insensitive', () => {
    markSeen(DEAL_A.toUpperCase());
    expect(hasSeen(DEAL_A.toLowerCase())).toBe(true);
  });

  it('does not confuse two different deal ids', () => {
    markSeen(DEAL_A);
    expect(hasSeen(DEAL_B)).toBe(false);
  });
});

describe('markSeen', () => {
  it('is idempotent — calling twice does not create duplicate entries', () => {
    markSeen(DEAL_A);
    markSeen(DEAL_A);
    const raw = localStorageMock.getItem(STORAGE_KEY)!;
    const seen = JSON.parse(raw) as string[];
    const count = seen.filter((id) => id === DEAL_A.toLowerCase()).length;
    expect(count).toBe(1);
  });

  it('caps the list at 100 entries, dropping the oldest', () => {
    // Insert 101 unique deal ids.
    for (let i = 0; i < 101; i++) {
      markSeen('0x' + i.toString(16).padStart(64, '0'));
    }
    const raw = localStorageMock.getItem(STORAGE_KEY)!;
    const seen = JSON.parse(raw) as string[];
    expect(seen).toHaveLength(100);
    // The very first entry (id=0) should have been evicted.
    expect(seen).not.toContain('0x' + '0'.padStart(64, '0'));
    // The last entry (id=100) should be present.
    expect(seen).toContain('0x' + (100).toString(16).padStart(64, '0'));
  });

  it('does not throw when localStorage.setItem throws', () => {
    const broken = { ...localStorageMock, setItem: () => { throw new Error('quota exceeded'); } };
    Object.defineProperty(globalThis, 'localStorage', { value: broken, writable: true });
    expect(() => markSeen(DEAL_A)).not.toThrow();
  });

  it('does not throw when localStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, writable: true });
    expect(() => markSeen(DEAL_A)).not.toThrow();
    expect(hasSeen(DEAL_A)).toBe(false);
  });
});
