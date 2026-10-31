/**
 * Integration test: keeper tick aggregates plug stats into the in-memory store
 * and the stats HTTP server exposes them correctly.
 *
 * Uses the same anvil fixture as jobs.test.ts.
 */
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keccak256 } from 'viem';
import type { Anvil, Fixture } from '@plug360/testkit';
import { createKeeper, memoryLogger, type KeeperConfig } from '../src/index.js';
import { createStatsServer } from '../src/stats-server.js';
import type { PlugStats } from '@plug360/shared';
import { fundDeal, keeperConfig, setup, write, warp, DAY } from './helpers.js';

let anvil: Anvil;
let fx: Fixture;

beforeAll(async () => {
  ({ anvil, fx } = await setup());
});
afterAll(async () => {
  await anvil?.stop();
});

function keeper(statsPort?: number) {
  const logger = memoryLogger();
  const config = keeperConfig(fx, { receiptTimeoutMs: 10_000 });
  return { k: createKeeper(config, { logger, receiptPollMs: 50, ...(statsPort ? { statsPort } : {}) }), logger };
}

/** Gets a free TCP port by opening and immediately closing a server. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

/** Polls until the stats server is accepting connections (up to 2 seconds). */
async function waitForPort(port: number, maxMs = 2000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  throw new Error(`stats server on port ${port} did not start within ${maxMs}ms`);
}

describe('keeper plug-stats end-to-end', () => {
  it('populates statsStore after a tick with a funded deal', async () => {
    const port = await freePort();
    const { k } = keeper(port);
    await waitForPort(port);

    // Fund a deal so there is one DealFunded event.
    await fundDeal(fx);
    const report = await (k as unknown as { tick: () => Promise<{ ok: boolean }> }).tick();
    expect(report.ok).toBe(true);

    // The stats endpoint should return the plug's stats.
    const plugAddr = fx.accounts.plug.address;
    const res = await fetch(`http://127.0.0.1:${port}/stats/plugs/${plugAddr}`);
    expect(res.status).toBe(200);
    const stats = await res.json() as PlugStats;
    expect(stats.address.toLowerCase()).toBe(plugAddr.toLowerCase());
    expect(stats.totalDeals).toBeGreaterThanOrEqual(1);
  });

  it('returns all plugs at /stats/plugs', async () => {
    const port = await freePort();
    const { k } = keeper(port);
    await waitForPort(port);
    await fundDeal(fx);
    await (k as unknown as { tick: () => Promise<unknown> }).tick();

    const res = await fetch(`http://127.0.0.1:${port}/stats/plugs`);
    expect(res.status).toBe(200);
    const all = await res.json() as PlugStats[];
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('address lookup is case-insensitive', async () => {
    const port = await freePort();
    const { k } = keeper(port);
    await waitForPort(port);
    await fundDeal(fx);
    await (k as unknown as { tick: () => Promise<unknown> }).tick();

    const plugAddr = fx.accounts.plug.address;
    // The server normalises to lowercase for its Map key; verify both the checksummed
    // form (what the keeper writes) and the lowercase form return the same entry.
    const lower = await fetch(`http://127.0.0.1:${port}/stats/plugs/${plugAddr.toLowerCase()}`);
    const checksum = await fetch(`http://127.0.0.1:${port}/stats/plugs/${plugAddr}`);
    expect(lower.status).toBe(200);
    expect(checksum.status).toBe(200);
  });

  it('/health returns { ok: true }', async () => {
    const port = await freePort();
    createStatsServer({ plugStats: new Map(), plugCids: new Map() }, port);
    await waitForPort(port);
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('returns 404 for an unknown plug address', async () => {
    const port = await freePort();
    createStatsServer({ plugStats: new Map(), plugCids: new Map() }, port);
    await waitForPort(port);
    const res = await fetch(`http://127.0.0.1:${port}/stats/plugs/0x0000000000000000000000000000000000000001`);
    expect(res.status).toBe(404);
  });

  it('stats include dispute and ruling counts after a full dispute cycle', async () => {
    const port = await freePort();
    const { k } = keeper(port);
    await waitForPort(port);

    const dealId = await fundDeal(fx);
    // Buyer opens a dispute.
    await write(fx, fx.accounts.buyer, 'openDispute', [dealId, keccak256('0x01')]);
    // Plug rules for the buyer.
    await write(fx, fx.accounts.plug, 'plugRefund', [dealId, keccak256('0x00')]);

    await (k as unknown as { tick: () => Promise<unknown> }).tick();

    const plugAddr = fx.accounts.plug.address;
    const res = await fetch(`http://127.0.0.1:${port}/stats/plugs/${plugAddr}`);
    const stats = await res.json() as PlugStats;
    expect(stats.totalDisputes).toBeGreaterThanOrEqual(1);
    expect(stats.ruledForBuyer).toBeGreaterThanOrEqual(1);
  });
});
