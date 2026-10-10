// A transaction without a receipt must never turn into a second, independent send.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keccak256, type Hex } from 'viem';
import { DealStatus } from '@plug360/shared';
import type { Anvil, Fixture } from '@plug360/testkit';
import { createKeeper, FileStateStore, memoryLogger } from '../src/index.js';
import { DAY, fundDeal, getDeal, keeperConfig, setup, warp, write } from './helpers.js';

let anvil: Anvil;
let fx: Fixture;

beforeAll(async () => {
  ({ anvil, fx } = await setup());
});
afterAll(async () => {
  await anvil?.stop();
});

/** Opens a dispute, lets the keeper index it while it is still young, then moves past the plug deadline. */
async function expiredDispute(k: { tick: () => Promise<unknown> }): Promise<bigint> {
  const dealId = await fundDeal(fx);
  await write(fx, fx.accounts.buyer, 'openDispute', [dealId, keccak256('0x0c')]);
  await k.tick();
  await warp(fx, 7 * DAY);
  return dealId;
}

function keeper() {
  const config = keeperConfig(fx, { receiptTimeoutMs: 800 });
  const logger = memoryLogger();
  const k = createKeeper(config, { logger, receiptPollMs: 50 });
  return { k, logger, store: new FileStateStore(config.stateFile) };
}

describe('unknown transactions', () => {
  it('replaces with the same nonce and higher fees, and only one transaction is ever mined', async () => {
    const { k, store } = keeper();
    const dealId = await expiredDispute(k);
    const nonce0 = await fx.publicClient.getTransactionCount({ address: k.address });

    await fx.testClient.setAutomine(false);
    try {
      const first = await k.tick();
      expect(first.actions).toEqual([expect.objectContaining({ job: 'finalizeExpiredDispute', outcome: 'unknown' })]);
      const p1 = Object.values((await store.load())!.pending);
      expect(p1).toHaveLength(1);
      expect(p1[0]).toMatchObject({ job: 'finalizeExpiredDispute', dealId: dealId.toString(), nonce: nonce0 });
      expect(p1[0]!.hashes).toHaveLength(1);

      const second = await k.tick();
      expect(second.actions).toEqual([expect.objectContaining({ job: 'finalizeExpiredDispute', outcome: 'unknown' })]);
      const p2 = Object.values((await store.load())!.pending)[0]!;
      expect(p2.nonce).toBe(nonce0);
      expect(p2.hashes).toHaveLength(2);
      expect(BigInt(p2.maxFeePerGas)).toBeGreaterThan(BigInt(p1[0]!.maxFeePerGas));
      expect(BigInt(p2.maxPriorityFeePerGas)).toBeGreaterThan(BigInt(p1[0]!.maxPriorityFeePerGas));
      expect((await getDeal(fx, dealId)).status).toBe(DealStatus.Disputed);

      await fx.testClient.mine({ blocks: 1 });
    } finally {
      await fx.testClient.setAutomine(true);
    }

    const third = await k.tick();
    expect(third.actions).toEqual([expect.objectContaining({ job: 'finalizeExpiredDispute', outcome: 'confirmed' })]);
    expect((await getDeal(fx, dealId)).status).toBe(DealStatus.Refunded);
    expect((await store.load())!.pending).toEqual({});
    expect(await fx.publicClient.getTransactionCount({ address: k.address })).toBe(nonce0 + 1);

    // Exactly one of the two signed transactions made it into a block.
    const latest = await fx.publicClient.getBlockNumber({ cacheTime: 0 });
    const mined = [];
    for (let n = latest - 5n; n <= latest; n++) {
      const block = await fx.publicClient.getBlock({ blockNumber: n, includeTransactions: true });
      mined.push(...block.transactions.filter((t) => t.from.toLowerCase() === k.address.toLowerCase()));
    }
    expect(mined).toHaveLength(1);
    expect(mined[0]!.hash).toBe(third.actions[0]!.tx);
  });

  it('drops a stuck transaction without resending when the deal no longer needs it', async () => {
    const { k, store, logger } = keeper();
    const dealId = await expiredDispute(k);
    const nonce0 = await fx.publicClient.getTransactionCount({ address: k.address });

    await fx.testClient.setAutomine(false);
    let stuck: Hex;
    try {
      const first = await k.tick();
      expect(first.actions[0]).toMatchObject({ outcome: 'unknown' });
      stuck = first.actions[0]!.tx!;
      // The node forgets the keeper's transaction, and someone else finalizes the deal.
      await fx.testClient.dropTransaction({ hash: stuck });
    } finally {
      await fx.testClient.setAutomine(true);
    }
    await write(fx, fx.accounts.stranger, 'finalizeExpiredDispute', [dealId]);

    const second = await k.tick();
    expect(second.actions).toEqual([
      expect.objectContaining({ job: 'finalizeExpiredDispute', outcome: 'dropped', reason: 'no longer needed' }),
    ]);
    expect((await store.load())!.pending).toEqual({});
    expect(await fx.publicClient.getTransactionCount({ address: k.address })).toBe(nonce0);
    expect(logger.entries.filter((e) => e.outcome === 'sent')).toHaveLength(1);
  });

  it('resends a dropped transaction at the same nonce when the deal still needs it', async () => {
    const { k, store } = keeper();
    const dealId = await expiredDispute(k);
    const nonce0 = await fx.publicClient.getTransactionCount({ address: k.address });

    await fx.testClient.setAutomine(false);
    try {
      const first = await k.tick();
      await fx.testClient.dropTransaction({ hash: first.actions[0]!.tx! });
    } finally {
      await fx.testClient.setAutomine(true);
    }

    const second = await k.tick();
    expect(second.actions).toEqual([expect.objectContaining({ job: 'finalizeExpiredDispute', outcome: 'confirmed' })]);
    expect((await getDeal(fx, dealId)).status).toBe(DealStatus.Refunded);
    expect((await store.load())!.pending).toEqual({});
    expect(await fx.publicClient.getTransactionCount({ address: k.address })).toBe(nonce0 + 1);
  });
});
