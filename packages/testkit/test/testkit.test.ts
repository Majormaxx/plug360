import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAbi, type Chain } from 'viem';
import { arc } from 'viem/chains';
import { deployFixture, mockUsdcAbi, startAnvil, startArcProxy, type Anvil, type ArcProxy, type Fixture } from '../src/index.js';

const escrowViews = parseAbi(['function USDC() view returns (address)', 'function owner() view returns (address)']);

describe('testkit', () => {
  let anvil: Anvil;
  let proxy: ArcProxy;
  let fx: Fixture;

  beforeAll(async () => {
    anvil = await startAnvil({ chainId: 5042 });
    proxy = await startArcProxy(anvil.rpcUrl);
    fx = await deployFixture(anvil.rpcUrl, arc as Chain);
  });
  afterAll(async () => {
    await proxy?.stop();
    await anvil?.stop();
  });

  it('starts anvil with the requested chain id', async () => {
    expect(await fx.publicClient.getChainId()).toBe(5042);
  });

  it('deploys DealEscrow wired to a 6-decimal MockUSDC', async () => {
    const usdc = await fx.publicClient.readContract({ address: fx.escrow, abi: escrowViews, functionName: 'USDC' });
    expect(usdc).toBe(fx.usdc);
    const owner = await fx.publicClient.readContract({ address: fx.escrow, abi: escrowViews, functionName: 'owner' });
    expect(owner).toBe(fx.accounts.owner.address);
    const decimals = await fx.publicClient.readContract({ address: fx.usdc, abi: mockUsdcAbi, functionName: 'decimals' });
    expect(decimals).toBe(6);
  });

  async function rpc(url: string, method: string, params: unknown[]) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return { status: res.status, body: res.status === 200 ? ((await res.json()) as { result?: unknown; error?: { code: number } }) : undefined };
  }

  it('proxy rejects eth_getLogs over 10,000 blocks and records accepted ranges', async () => {
    const tooWide = await rpc(proxy.url, 'eth_getLogs', [{ fromBlock: '0x0', toBlock: '0x2710' }]);
    expect(tooWide.body?.error?.code).toBe(-32012);
    const ok = await rpc(proxy.url, 'eth_getLogs', [{ fromBlock: '0x0', toBlock: '0x270f' }]);
    expect(ok.body?.result).toEqual(expect.any(Array));
    expect(proxy.logRanges.at(-1)).toEqual({ from: 0n, to: 9999n });
  });

  it('proxy injects -32014 faults for the requested method only', async () => {
    proxy.failNext(1, { method: 'eth_blockNumber' });
    expect((await rpc(proxy.url, 'eth_chainId', [])).body?.result).toBe('0x13b2');
    expect((await rpc(proxy.url, 'eth_blockNumber', [])).body?.error?.code).toBe(-32014);
    expect((await rpc(proxy.url, 'eth_blockNumber', [])).body?.result).toEqual(expect.any(String));
  });

  it('proxy can be taken down and brought back', async () => {
    proxy.setDown(true);
    expect((await rpc(proxy.url, 'eth_chainId', [])).status).toBe(503);
    proxy.setDown(false);
    expect((await rpc(proxy.url, 'eth_chainId', [])).status).toBe(200);
  });
});

describe('startAnvil genesisBlockNumber', () => {
  it('starts the chain at the requested block with funded dev accounts', async () => {
    const node = await startAnvil({ chainId: 5042, genesisBlockNumber: 20_000 });
    try {
      const res = await fetch(node.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([
          { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
          { jsonrpc: '2.0', id: 2, method: 'eth_getBalance', params: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 'latest'] },
        ]),
      });
      const [block, balance] = (await res.json()) as Array<{ result: string }>;
      expect(BigInt(block!.result)).toBe(20_000n);
      expect(BigInt(balance!.result)).toBeGreaterThan(0n);
    } finally {
      await node.stop();
    }
  });
});
