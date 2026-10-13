/**
 * Fixed-window counter per key. Best effort: on serverless each instance keeps its own window, which is
 * fine for slowing down abuse of the sign-in endpoints; Circle enforces its own limits behind it.
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { start: number; count: number }>();
  return function allow(key: string): boolean {
    const t = now();
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      return true;
    }
    h.count += 1;
    return h.count <= limit;
  };
}
