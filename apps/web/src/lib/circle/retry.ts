/**
 * Runs `fn` up to `attempts` times until it succeeds, shares one in-flight run between callers, and
 * remembers the result. A run that fails every attempt is forgotten, so the next call starts over.
 */
export function rememberWithRetry<T>(fn: () => Promise<T>, attempts: number, onRetry?: (attempt: number, err: unknown) => void): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= (async () => {
      let last: unknown;
      for (let i = 1; i <= attempts; i++) {
        try {
          return await fn();
        } catch (err) {
          last = err;
          if (i < attempts) onRetry?.(i, err);
        }
      }
      throw last;
    })().catch((err) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };
}
