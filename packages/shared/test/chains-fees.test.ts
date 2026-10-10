import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, getAddress, http, parseGwei } from 'viem';
import { startAnvil, type Anvil } from '@plug360/testkit';
import {
  arcChainById,
  arcMainnet,
  arcTestnet,
  dealEscrowAbi,
  feeOverrides,
  feeOverridesFromBaseFee,
  MEMO,
  MIN_FEE_GWEI,
  MULTICALL3FROM,
  USDC,
} from '../src/index.js';

describe('chains', () => {
  it('arcMainnet is viem arc with id 5042', () => {
    expect(arcMainnet.id).toBe(5042);
    expect(arcMainnet.nativeCurrency.decimals).toBe(18);
  });

  it('arcTestnet uses the current RPC and explorer', () => {
    expect(arcTestnet.id).toBe(5_042_002);
    expect(arcTestnet.rpcUrls.default.http).toEqual(['https://rpc.testnet.arc.io']);
    expect(arcTestnet.blockExplorers.default.url).toBe('https://explorer.testnet.arc.io');
  });

  it('constants are checksummed addresses', () => {
    for (const a of [USDC, MEMO, MULTICALL3FROM]) expect(getAddress(a)).toBe(a);
    expect(MIN_FEE_GWEI).toBe(25);
  });

  it('arcChainById', () => {
    expect(arcChainById(5042)).toBe(arcMainnet);
    expect(arcChainById(5_042_002)).toBe(arcTestnet);
    expect(arcChainById(1)).toBeUndefined();
  });
});

describe('fees', () => {
  it('applies the 25 gwei floor and doubles the base fee above it', () => {
    expect(feeOverridesFromBaseFee(0n)).toEqual({ maxFeePerGas: parseGwei('25'), maxPriorityFeePerGas: parseGwei('1') });
    expect(feeOverridesFromBaseFee(parseGwei('12.5')).maxFeePerGas).toBe(parseGwei('25'));
    expect(feeOverridesFromBaseFee(parseGwei('13')).maxFeePerGas).toBe(parseGwei('26'));
    expect(feeOverridesFromBaseFee(parseGwei('160')).maxFeePerGas).toBe(parseGwei('320'));
  });

  describe('against a node', () => {
    let anvil: Anvil;
    beforeAll(async () => {
      anvil = await startAnvil({ args: ['--block-base-fee-per-gas', String(parseGwei('40'))] });
    });
    afterAll(async () => anvil?.stop());

    it('reads the latest base fee', async () => {
      const client = createPublicClient({ transport: http(anvil.rpcUrl) });
      const block = await client.getBlock();
      const fees = await feeOverrides(client);
      expect(block.baseFeePerGas).toBeGreaterThan(parseGwei('25'));
      expect(fees.maxFeePerGas).toBe(block.baseFeePerGas! * 2n);
      expect(fees.maxPriorityFeePerGas).toBe(parseGwei('1'));
    });
  });
});

describe('abi', () => {
  it('src/abi.ts is current with the compiled contract', () => {
    const script = resolve(import.meta.dirname, '../scripts/gen-abi.mjs');
    const out = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/matches/);
  });

  it('exposes every function the off-chain code calls', () => {
    const names = new Set<string>(dealEscrowAbi.filter((e) => e.type === 'function').map((e) => e.name));
    for (const fn of ['pay', 'getDeal', 'finalizeExpiredDispute', 'retryPayout', 'totalHeld', 'pendingPayouts', 'USDC']) {
      expect(names.has(fn)).toBe(true);
    }
  });
});
