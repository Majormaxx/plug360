import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/** PATH with Foundry's default install directory appended, so anvil and forge resolve without shell setup. */
export function foundryPath(): string {
  return [process.env.PATH ?? '', join(homedir(), '.foundry', 'bin')].join(delimiter);
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('could not read the free port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

export type Anvil = { rpcUrl: string; port: number; stop: () => Promise<void> };

export type AnvilOptions = {
  chainId?: number;
  /**
   * Start the chain at this block number instead of 0. anvil_mine slows down badly past a few thousand
   * blocks, so tests that need a long block range start high instead of mining their way there.
   */
  genesisBlockNumber?: number;
  /** Extra command-line flags. */
  args?: string[];
};

async function rpcReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Starts anvil on a free local port and waits until it answers JSON-RPC. */
export async function startAnvil(options: AnvilOptions = {}): Promise<Anvil> {
  const port = await freePort();
  const args = ['--port', String(port), '--host', '127.0.0.1', '--hardfork', 'osaka', '--silent'];
  if (options.chainId !== undefined) args.push('--chain-id', String(options.chainId));
  if (options.genesisBlockNumber !== undefined) {
    const genesis = {
      config: { chainId: options.chainId ?? 31337 },
      number: `0x${options.genesisBlockNumber.toString(16)}`,
      timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`,
      gasLimit: '0x1c9c380',
      baseFeePerGas: '0x3b9aca00',
      difficulty: '0x0',
      alloc: {},
    };
    const file = join(mkdtempSync(join(tmpdir(), 'plug360-anvil-')), 'genesis.json');
    writeFileSync(file, JSON.stringify(genesis));
    args.push('--init', file);
  }
  args.push(...(options.args ?? []));

  const child: ChildProcess = spawn(process.env.ANVIL_BIN ?? 'anvil', args, {
    env: { ...process.env, PATH: foundryPath() },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  let exited = false;
  child.on('exit', () => (exited = true));
  const spawnError = new Promise<never>((_, reject) => child.on('error', reject));

  const rpcUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  const waitReady = (async () => {
    while (Date.now() < deadline) {
      if (exited) throw new Error(`anvil exited during startup: ${stderr}`);
      if (await rpcReady(rpcUrl)) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill('SIGKILL');
    throw new Error(`anvil did not start within 15s: ${stderr}`);
  })();
  await Promise.race([waitReady, spawnError]);

  return {
    rpcUrl,
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}
