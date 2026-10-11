// Event indexing through an Arc-like RPC proxy: 10,000-block getLogs cap, -32014 faults, fallback RPC.
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import { DealStatus, MAX_LOG_BLOCKS } from '@plug360/shared';
import { startArcProxy, type Anvil, type ArcProxy, type Fixture } from '@plug360/testkit';
import { createKeeper, FileStateStore, memoryLogger, type KeeperConfig, type KeeperState } from '../src/index.js';
import { isRangeLimit } from '../src/rpc.js';
import { BaseError, RpcRequestError } from 'viem';
import { fundDeal, keeperConfig, setup, tempStateFile, write } from './helpers.js';

let anvil: Anvil;
let fx: Fixture;
let primary: ArcProxy;
let backup: ArcProxy;

const fastRpc = { maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 20 };

beforeAll(async () => {
  // The chain starts at block 29,500 (anvil_mine is too slow to mine tens of thousands of blocks), and the
  // keeper scans from block 0, so the first tick covers more than 29,500 blocks.
  ({ anvil, fx } = await setup({ genesisBlockNumber: 29_500 }));
  primary = await startArcProxy(anvil.rpcUrl);
  backup = await startArcProxy(anvil.rpcUrl);
});
afterAll(async () => {
  await primary?.stop();
  await backup?.stop();
  await anvil?.stop();
});

function keeper(overrides: Partial<KeeperConfig>) {
  const logger = memoryLogger();
  return { k: createKeeper(keeperConfig(fx, overrides), { logger, receiptPollMs: 50, rpc: fastRpc }), logger };
}

async function readState(path: string): Promise<KeeperState> {
  return JSON.parse(await readFile(path, 'utf8')) as KeeperState;
}

describe('indexing', () => {
  it('scans more than 10,000 blocks in capped chunks and persists the cursor', async () => {
    const dealA = await fundDeal(fx);
    // Deal A sits before block 29,997 and deal B after it, so they land in different 9,999-block chunks.
    await fx.testClient.mine({ blocks: 600 });
    const dealB = await fundDeal(fx);
    await write(fx, fx.accounts.buyer, 'openDispute', [dealB, keccak256('0x0b')]);
    const head = await fx.publicClient.getBlockNumber({ cacheTime: 0 });

    const stateFile = tempStateFile();
    primary.logRanges.length = 0;
    const { k } = keeper({ rpcUrl: primary.url, stateFile, deployBlock: 0n });
    const report = await k.tick();
    expect(report.ok).toBe(true);

    const ranges = primary.logRanges;
    expect(head).toBeGreaterThan(30_000n);
    expect(ranges.length).toBe(4);
    expect(ranges[0]!.from).toBe(0n);
    expect(fx.deployBlock).toBeLessThan(ranges[2]!.to);
    expect(head).toBeGreaterThan(ranges[3]!.from);
    expect(ranges.at(-1)!.to).toBe(head);
    for (let i = 0; i < ranges.length; i++) {
      expect(ranges[i]!.to - ranges[i]!.from + 1n).toBeLessThanOrEqual(BigInt(MAX_LOG_BLOCKS));
      if (i > 0) expect(ranges[i]!.from).toBe(ranges[i - 1]!.to + 1n);
    }

    const state = await readState(stateFile);
    expect(state.cursor).toBe((head + 1n).toString());
    expect(state.deals[dealA.toString()]?.status).toBe(DealStatus.Held);
    expect(state.deals[dealB.toString()]?.status).toBe(DealStatus.Disputed);

    // A fresh process with the same state file resumes from the cursor.
    await fx.testClient.mine({ blocks: 5 });
    primary.logRanges.length = 0;
    const { k: k2 } = keeper({ rpcUrl: primary.url, stateFile, deployBlock: 0n });
    expect((await k2.tick()).ok).toBe(true);
    expect(primary.logRanges).toEqual([{ from: head + 1n, to: head + 5n }]);
    expect((await readState(stateFile)).deals[dealB.toString()]?.status).toBe(DealStatus.Disputed);
  });

  it('refuses a state file written for a different escrow', async () => {
    const stateFile = tempStateFile();
    await new FileStateStore(stateFile).save({
      version: 1,
      chainId: 5042,
      escrow: fx.accounts.stranger.address,
      cursor: '1',
      deals: {},
      pending: {},
      flags: { insolvent: false, lowGas: false },
    });
    const { k } = keeper({ stateFile });
    const report = await k.tick();
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/state belongs to escrow/);
    expect(report.alerts.map((a) => a.kind)).toEqual(['tick-failed']);
  });

  it('refuses an RPC on the wrong chain', async () => {
    const { k } = keeper({ chainId: 5_042_002 });
    const report = await k.tick();
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/RPC is on chain 5042/);
  });
});

describe('provider log-range limits', () => {
  // dRPC's free plan refuses ranges of a few hundred blocks with code 35 and a message naming a 10,000-block
  // limit it does not apply. Found on the first live testnet run.
  const drpcError = { code: 35, message: 'ranges over 10000 blocks are not supported on free plan' };

  it('shrinks the range until a strict provider accepts it, without gaps', async () => {
    const strict = await startArcProxy(anvil.rpcUrl, { maxLogBlocks: 400, logRangeError: drpcError });
    try {
      const dealA = await fundDeal(fx);
      const head = await fx.publicClient.getBlockNumber({ cacheTime: 0 });
      const stateFile = tempStateFile();
      const from = fx.deployBlock > 2_000n ? fx.deployBlock - 2_000n : 0n;
      const { k, logger } = keeper({ rpcUrl: strict.url, stateFile, deployBlock: from });
      const report = await k.tick();
      expect(report.ok).toBe(true);

      const ranges = strict.logRanges;
      expect(ranges.length).toBeGreaterThan(1);
      expect(ranges[0]!.from).toBe(from);
      expect(ranges.at(-1)!.to).toBe(head);
      for (let i = 0; i < ranges.length; i++) {
        expect(ranges[i]!.to - ranges[i]!.from + 1n).toBeLessThanOrEqual(400n);
        if (i > 0) expect(ranges[i]!.from).toBe(ranges[i - 1]!.to + 1n);
      }
      expect(logger.entries.some((e) => e.outcome === 'range-shrunk')).toBe(true);
      expect((await readState(stateFile)).deals[dealA.toString()]?.status).toBe(DealStatus.Held);
    } finally {
      await strict.stop();
    }
  });

  it('switches to a fallback that accepts wider ranges before shrinking', async () => {
    const strict = await startArcProxy(anvil.rpcUrl, { maxLogBlocks: 400, logRangeError: drpcError });
    const wide = await startArcProxy(anvil.rpcUrl);
    try {
      const stateFile = tempStateFile();
      const from = fx.deployBlock > 5_000n ? fx.deployBlock - 5_000n : 0n;
      const { k, logger } = keeper({ rpcUrl: strict.url, rpcFallbackUrl: wide.url, stateFile, deployBlock: from });
      expect((await k.tick()).ok).toBe(true);
      expect(strict.logRanges.length).toBe(0); // refused calls are never forwarded
      expect(wide.logRanges.length).toBeLessThanOrEqual(2);
      expect(logger.entries.some((e) => e.reason === 'range-limit' && e.outcome === 'switched')).toBe(true);
      expect(logger.entries.some((e) => e.outcome === 'range-shrunk')).toBe(false);
    } finally {
      await strict.stop();
      await wide.stop();
    }
  });

  it('classifies range refusals and nothing else as range limits', () => {
    const rpcErr = (code: number, message: string) =>
      new RpcRequestError({ body: {}, url: 'http://x', error: { code, message } });
    expect(isRangeLimit(rpcErr(-32012, 'requested range too large'))).toBe(true);
    expect(isRangeLimit(rpcErr(35, drpcError.message))).toBe(true);
    expect(isRangeLimit(rpcErr(-32602, 'query exceeds max block range 2000'))).toBe(true);
    expect(isRangeLimit(rpcErr(-32005, 'rate limit exceeded'))).toBe(false);
    expect(isRangeLimit(rpcErr(-32000, 'execution reverted'))).toBe(false);
    expect(isRangeLimit(new BaseError('unrelated'))).toBe(false);
    expect(isRangeLimit(new Error('plain'))).toBe(false);
  });
});

describe('RPC resilience', () => {
  it('retries -32014 on the primary without switching after one failure', async () => {
    const { k, logger } = keeper({ rpcUrl: primary.url, rpcFallbackUrl: backup.url });
    primary.failNext(1, { method: 'eth_blockNumber' });
    const report = await k.tick();
    expect(report.ok).toBe(true);
    expect(logger.entries).toContainEqual(expect.objectContaining({ job: 'rpc', outcome: 'retry', code: -32014, endpoint: 'primary' }));
    expect(logger.entries.some((e) => e.outcome === 'switched')).toBe(false);
  });

  it('switches to the fallback RPC after two failures in a row', async () => {
    const { k, logger } = keeper({ rpcUrl: primary.url, rpcFallbackUrl: backup.url });
    primary.failNext(2, { method: 'eth_blockNumber' });
    const backupCalls = backup.calls.get('eth_getLogs') ?? 0;
    const report = await k.tick();
    expect(report.ok).toBe(true);
    expect(logger.entries).toContainEqual(expect.objectContaining({ job: 'rpc', outcome: 'switched', endpoint: 'fallback' }));
    // The rest of the tick ran on the fallback.
    expect(backup.calls.get('eth_getLogs') ?? 0).toBeGreaterThan(backupCalls);
  });

  it('fails the tick cleanly when the only RPC is down, then recovers', async () => {
    const stateFile = tempStateFile();
    const { k, logger } = keeper({ rpcUrl: primary.url, stateFile });
    primary.setDown(true);
    expect(logger.entries).toEqual([]);
    try {
      const report = await k.tick();
      expect(report.ok).toBe(false);
      expect(report.error).toMatch(/retries exhausted/);
    } finally {
      primary.setDown(false);
    }
    expect((await k.tick()).ok).toBe(true);
  });

  it('does not retry errors that are not transient', async () => {
    const { k, logger } = keeper({ rpcUrl: primary.url });
    primary.failNext(1, { method: 'eth_blockNumber', code: -32602 });
    const report = await k.tick();
    expect(report.ok).toBe(false);
    expect(logger.entries.some((e) => e.job === 'rpc' && e.outcome === 'retry')).toBe(false);
  });
});
