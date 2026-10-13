import { describe, expect, it } from 'vitest';
import { idleTx, isBusy, txReducer, type TxEvent, type TxState } from '../src/lib/tx';

const h1 = `0x${'a'.repeat(64)}` as const;
const h2 = `0x${'b'.repeat(64)}` as const;
const run = (events: TxEvent[], from: TxState = idleTx) => events.reduce(txReducer, from);
const err = { kind: 'revert' as const, title: 'no' };

describe('txReducer', () => {
  it('walks a single transaction to done', () => {
    const s = run([{ type: 'start', label: 'Release' }, { type: 'prompt' }, { type: 'sent', hash: h1 }, { type: 'confirmed' }]);
    expect(s).toMatchObject({ phase: 'done', hash: h1, hashes: [h1], label: 'Release' });
  });

  it('walks a two-step pay through both transactions', () => {
    let s = run([{ type: 'start', label: 'Pay', steps: 2 }, { type: 'prompt' }, { type: 'sent', hash: h1 }, { type: 'confirmed' }]);
    expect(s).toMatchObject({ phase: 'checking', step: 2 });
    expect(s.hash).toBeUndefined();
    s = run([{ type: 'prompt' }, { type: 'sent', hash: h2 }, { type: 'confirmed' }], s);
    expect(s).toMatchObject({ phase: 'done', step: 2, hashes: [h1, h2] });
  });

  it('ignores a second start while busy, so double clicks never send twice', () => {
    const busy = run([{ type: 'start', label: 'Pay' }, { type: 'prompt' }]);
    expect(txReducer(busy, { type: 'start', label: 'Pay again' })).toBe(busy);
    expect(isBusy(busy)).toBe(true);
  });

  it('fails from any busy phase, and reset returns to idle', () => {
    for (const events of [
      [{ type: 'start', label: 'x' }],
      [{ type: 'start', label: 'x' }, { type: 'prompt' }],
      [{ type: 'start', label: 'x' }, { type: 'prompt' }, { type: 'sent', hash: h1 }],
    ] as TxEvent[][]) {
      const s = run([...events, { type: 'fail', error: err }]);
      expect(s.phase).toBe('failed');
      expect(run([{ type: 'reset' }], s)).toEqual(idleTx);
    }
  });

  it('marks a sent transaction without a receipt as unknown, and a later check can confirm it', () => {
    const lost = run([{ type: 'start', label: 'Pay' }, { type: 'prompt' }, { type: 'sent', hash: h1 }, { type: 'lost', error: err }]);
    expect(lost).toMatchObject({ phase: 'unknown', hash: h1 });
    const found = txReducer(lost, { type: 'confirmed' });
    expect(found.phase).toBe('done');
    expect(found.error).toBeUndefined();
  });

  it('rejects out-of-order events', () => {
    expect(txReducer(idleTx, { type: 'sent', hash: h1 })).toBe(idleTx);
    expect(txReducer(idleTx, { type: 'confirmed' })).toBe(idleTx);
    expect(txReducer(idleTx, { type: 'fail', error: err })).toBe(idleTx);
    const checking = run([{ type: 'start', label: 'x' }]);
    expect(txReducer(checking, { type: 'lost', error: err })).toBe(checking);
    expect(txReducer(checking, { type: 'reset' })).toBe(checking);
  });
});
