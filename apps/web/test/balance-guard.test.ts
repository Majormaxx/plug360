import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Anyone can send USDC to any address, and address-poisoning bots do, so a balance never proves a deal
 * moved money. Deal state comes from the escrow (getDeal and its events). Reading balances is allowed
 * only where the question really is "how much does this wallet hold" (funding checks and gas).
 */
const ALLOWED = new Set([
  'src/hooks/useEscrow.ts', // the buyer's spendable USDC before paying
  'src/hooks/useTx.ts', // gas headroom before a sponsored call
  'src/lib/gas.ts',
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe('balance reads', () => {
  it('appear only in the allowlisted funding and gas code', () => {
    const root = join(__dirname, '..');
    const offenders = files(join(root, 'src'))
      .map((f) => relative(root, f))
      .filter((f) => !ALLOWED.has(f) && /\b(balanceOf|getBalance)\b/.test(readFileSync(join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
