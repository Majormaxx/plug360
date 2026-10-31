/**
 * Reviews store backed by a simple JSON file (append-only).
 * In production swap for a Postgres or Turso table — the interface stays the same.
 *
 * The file lives at REVIEWS_DB_PATH (env var) or /tmp/plug360-reviews.json.
 * It is a JSON array of Review objects, written atomically via a mutex to prevent
 * concurrent POST requests from losing each other's writes.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { Review, ReviewInput } from '@plug360/shared';

const DB_PATH = process.env.REVIEWS_DB_PATH || '/tmp/plug360-reviews.json';

// Simple async mutex: all writes are serialised through this promise chain.
let _writeLock: Promise<unknown> = Promise.resolve();

function load(): Review[] {
  if (!existsSync(DB_PATH)) return [];
  try {
    const raw = readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw) as Review[];
  } catch {
    return [];
  }
}

function save(reviews: Review[]) {
  writeFileSync(DB_PATH, JSON.stringify(reviews, null, 2), 'utf8');
}

export async function insertReview(input: ReviewInput): Promise<Review> {
  // Queue behind any in-flight write.
  const result = _writeLock.then((): Review => {
    const reviews = load();
    const existing = reviews.find(
      (r) => r.dealId === input.dealId && r.buyerAddress.toLowerCase() === input.buyerAddress.toLowerCase(),
    );
    if (existing) throw new Error('already-reviewed');

    const review: Review = { ...input, id: randomUUID(), createdAt: Math.floor(Date.now() / 1000) };
    reviews.push(review);
    save(reviews);
    return review;
  });
  // The lock must not reject globally — capture the new tail either way.
  _writeLock = result.catch(() => undefined);
  return result;
}

export function getReviewsForPlug(plugAddress: string): Review[] {
  return load().filter((r) => r.plugAddress.toLowerCase() === plugAddress.toLowerCase());
}

export function getReviewForDeal(dealId: string, buyerAddress: string): Review | undefined {
  return load().find(
    (r) => r.dealId === dealId && r.buyerAddress.toLowerCase() === buyerAddress.toLowerCase(),
  );
}

export function getAllReviews(): Review[] {
  return load();
}
