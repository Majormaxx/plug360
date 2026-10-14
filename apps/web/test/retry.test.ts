import { describe, expect, it, vi } from 'vitest';
import { rememberWithRetry } from '../src/lib/circle/retry';

describe('rememberWithRetry', () => {
  it('retries a failure and returns the first success', async () => {
    const fn = vi.fn().mockRejectedValueOnce('Failed to receive deviceId').mockResolvedValueOnce('dev-1');
    const onRetry = vi.fn();
    expect(await rememberWithRetry(fn, 3, onRetry)()).toBe('dev-1');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, 'Failed to receive deviceId');
  });

  it('remembers the result and shares one run between callers', async () => {
    const fn = vi.fn().mockResolvedValue('dev-1');
    const get = rememberWithRetry(fn, 3);
    expect(await Promise.all([get(), get()])).toEqual(['dev-1', 'dev-1']);
    expect(await get()).toBe('dev-1');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last attempt with that error, then starts over on the next call', async () => {
    const fn = vi.fn().mockRejectedValue('timeout');
    const get = rememberWithRetry(fn, 3);
    await expect(get()).rejects.toBe('timeout');
    expect(fn).toHaveBeenCalledTimes(3);
    fn.mockResolvedValueOnce('dev-2');
    expect(await get()).toBe('dev-2');
  });
});
