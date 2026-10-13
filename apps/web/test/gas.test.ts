import { describe, expect, it, vi } from 'vitest';
import { ensureGasFor, type GasDeps } from '../src/lib/gas';

const me = '0x1111111111111111111111111111111111111111' as const;
const deps = (o: Partial<GasDeps> = {}): GasDeps => ({
  getCode: vi.fn(async () => '0x' as const),
  estimateGas: vi.fn(async () => 100_000n),
  getBalance: vi.fn(async () => 0n),
  requestGas: vi.fn(async () => ({ funded: true })),
  ...o,
});
const unconfigured = (e: unknown) => (e as { reason?: string }).reason === 'unconfigured';

describe('ensureGasFor', () => {
  it('leaves smart wallets to Circle Gas Station', async () => {
    const d = deps({ getCode: vi.fn(async () => '0x6080' as const) });
    expect(await ensureGasFor(me, 25n, d, unconfigured)).toBe('smart-wallet');
    expect(d.requestGas).not.toHaveBeenCalled();
  });

  it('does nothing when the wallet can already pay', async () => {
    const d = deps({ getBalance: vi.fn(async () => 100_000n * 25n) });
    expect(await ensureGasFor(me, 25n, d, unconfigured)).toBe('has-gas');
    expect(d.requestGas).not.toHaveBeenCalled();
  });

  it('asks the sponsor when a plain key is short', async () => {
    const d = deps({ getBalance: vi.fn(async () => 1n) });
    expect(await ensureGasFor(me, 25n, d, unconfigured)).toBe('sponsored');
    expect(d.requestGas).toHaveBeenCalledOnce();
  });

  it('carries on without a sponsor, and surfaces real sponsor errors', async () => {
    expect(await ensureGasFor(me, 25n, deps({ requestGas: vi.fn(async () => Promise.reject({ reason: 'unconfigured' })) }), unconfigured)).toBe('no-sponsor');
    await expect(ensureGasFor(me, 25n, deps({ requestGas: vi.fn(async () => Promise.reject({ reason: 'not-eligible' })) }), unconfigured)).rejects.toEqual({ reason: 'not-eligible' });
  });
});
