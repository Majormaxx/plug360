import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anvilPrivateKey, roles, type Anvil, type Fixture } from '@plug360/testkit';
import { createKeeper, FileStateStore, main, memoryLogger, type KeeperState } from '../src/index.js';
import { keeperConfig, setup, tempStateFile } from './helpers.js';

let anvil: Anvil;
let fx: Fixture;

beforeAll(async () => {
  ({ anvil, fx } = await setup());
});
afterAll(async () => {
  await anvil?.stop();
});

function env(stateFile: string) {
  return {
    RPC_URL: fx.rpcUrl,
    CHAIN_ID: '5042',
    ESCROW_ADDRESS: fx.escrow,
    DEPLOY_BLOCK: fx.deployBlock.toString(),
    KEEPER_PRIVATE_KEY: anvilPrivateKey(roles.keeper),
    STATE_FILE: stateFile,
    POLL_INTERVAL_SECONDS: '1',
  };
}

describe('main', () => {
  it('run --once ticks and writes the state file', async () => {
    const stateFile = tempStateFile();
    const logger = memoryLogger();
    const code = await main(['run', '--once'], { env: env(stateFile), stderr: () => {}, deps: { logger } });
    expect(code).toBe(0);
    expect(existsSync(stateFile)).toBe(true);
    expect(logger.entries.at(-1)).toMatchObject({ job: 'tick', outcome: 'done' });
  });

  it('returns 1 when the tick fails', async () => {
    const code = await main(['run', '--once'], {
      env: { ...env(tempStateFile()), RPC_URL: 'http://127.0.0.1:1' },
      stderr: () => {},
      deps: { logger: memoryLogger(), rpc: { maxAttempts: 2, baseDelayMs: 1 } },
    });
    expect(code).toBe(1);
  });

  it('returns 2 with every problem listed for bad configuration', async () => {
    let err = '';
    const code = await main(['run', '--once'], { env: {}, stderr: (t) => (err += t) });
    expect(code).toBe(2);
    expect(err).toMatch(/RPC_URL is required/);
    expect(err).toMatch(/KEEPER_PRIVATE_KEY is required/);
  });

  it('prints usage', async () => {
    let out = '';
    expect(await main([], { env: {}, stderr: (t) => (out += t) })).toBe(0);
    expect(out).toMatch(/Usage/);
    expect(await main(['run', '--forever'], { env: {}, stderr: () => {} })).toBe(2);
  });

  it('loop mode keeps ticking until aborted', async () => {
    const logger = memoryLogger();
    const controller = new AbortController();
    const running = main(['run'], { env: env(tempStateFile()), stderr: () => {}, signal: controller.signal, deps: { logger } });
    await new Promise((r) => setTimeout(r, 1_600));
    controller.abort();
    expect(await running).toBe(0);
    expect(logger.entries.filter((e) => e.job === 'tick' && e.outcome === 'done').length).toBeGreaterThanOrEqual(2);
  });
});

describe('tick concurrency', () => {
  it('refuses to start a second tick while one is running', async () => {
    const k = createKeeper(keeperConfig(fx), { logger: memoryLogger() });
    const [a, b] = await Promise.all([k.tick(), k.tick()]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a.error, b.error]).toContain('a tick is already running');
  });
});

describe('FileStateStore', () => {
  it('returns undefined for a missing file and round-trips state', async () => {
    const store = new FileStateStore(tempStateFile());
    expect(await store.load()).toBeUndefined();
    const state: KeeperState = {
      version: 1,
      chainId: 5042,
      escrow: fx.escrow,
      cursor: '42',
      deals: { '7': { status: 2, disputedAt: 1, releaseAt: 2, payoutPending: false } },
      pending: {},
      flags: { insolvent: false, lowGas: true },
    };
    await store.save(state);
    expect(await store.load()).toEqual(state);
  });

  it('rejects a file that is not keeper state', async () => {
    const path = tempStateFile();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, '{"hello":1}');
    await expect(new FileStateStore(path).load()).rejects.toThrow(/not a keeper state file/);
  });
});

describe('built CLI', () => {
  const root = resolve(import.meta.dirname, '..');
  it('node dist/cli.js run --once exits 0 and prints JSON lines', () => {
    // Build this package and its shared dependency so the test exercises the real entry point.
    execFileSync('pnpm', ['--filter', '@plug360/keeper...', 'build'], { cwd: root, stdio: 'ignore' });
    const res = spawnSync(process.execPath, [resolve(root, 'dist/cli.js'), 'run', '--once'], {
      env: { ...process.env, ...env(tempStateFile()) },
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    const lines = res.stdout.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.at(-1)).toMatchObject({ job: 'tick', outcome: 'done' });
    expect(lines.every((l) => typeof l.ts === 'string')).toBe(true);
  }, 120_000);
});
