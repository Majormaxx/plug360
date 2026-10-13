import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bytesToHex, parseUnits, type Address, type Chain, type HDAccount, type Hex } from 'viem';
import {
  acceptTypedData,
  arcMainnet,
  dealEscrowAbi,
  dealIdOf,
  escrowedAmount,
  termsTypedData,
  type Terms,
} from '@plug360/shared';
import { anvilAccount, anvilPrivateKey, deployFixture, mockUsdcAbi, roles, startAnvil, type Anvil, type Fixture } from '@plug360/testkit';
import type { KeeperConfig } from '../src/index.js';

export const DAY = 86_400;

export async function setup(opts: { genesisBlockNumber?: number } = {}): Promise<{ anvil: Anvil; fx: Fixture }> {
  const anvil = await startAnvil({ chainId: 5042, ...opts });
  const fx = await deployFixture(anvil.rpcUrl, arcMainnet as Chain, [[anvilAccount(roles.plug).address, 5]]);
  return { anvil, fx };
}

export function tempStateFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'plug360-keeper-')), 'state.json');
}

export function keeperConfig(fx: Fixture, overrides: Partial<KeeperConfig> = {}): KeeperConfig {
  return {
    rpcUrl: fx.rpcUrl,
    chainId: 5042,
    escrow: fx.escrow,
    deployBlock: fx.deployBlock,
    privateKey: anvilPrivateKey(roles.keeper),
    stateFile: tempStateFile(),
    pollIntervalSeconds: 1,
    retryBackoffSeconds: 3600,
    minGasBalance: parseUnits('1', 18),
    receiptTimeoutMs: 10_000,
    deadlineWarningSeconds: DAY,
    autoPayout: false,
    minSponsorBalance: parseUnits('0.5', 18),
    ...overrides,
  };
}

export async function write(fx: Fixture, account: HDAccount, functionName: string, args: readonly unknown[]) {
  const hash = await fx.wallet(account).writeContract({ address: fx.escrow, abi: dealEscrowAbi, functionName, args } as never);
  const receipt = await fx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted`);
  return receipt;
}

export async function getDeal(fx: Fixture, dealId: bigint) {
  return fx.publicClient.readContract({ address: fx.escrow, abi: dealEscrowAbi, functionName: 'getDeal', args: [dealId] });
}

export async function usdcBalance(fx: Fixture, who: Address) {
  return fx.publicClient.readContract({ address: fx.usdc, abi: mockUsdcAbi, functionName: 'balanceOf', args: [who] });
}

export async function setBlocked(fx: Fixture, who: Address, blocked: boolean) {
  const hash = await fx.wallet(fx.accounts.owner).writeContract({ address: fx.usdc, abi: mockUsdcAbi, functionName: 'setBlocked', args: [who, blocked] });
  await fx.publicClient.waitForTransactionReceipt({ hash });
}

export async function warp(fx: Fixture, seconds: number) {
  await fx.testClient.increaseTime({ seconds });
  await fx.testClient.mine({ blocks: 1 });
}

/** Funds a deal end to end: seller signs terms, plug accepts, buyer mints, approves and pays. */
export async function fundDeal(
  fx: Fixture,
  opts: { seller?: HDAccount; buyer?: HDAccount; price?: bigint; plugFee?: bigint; windowSeconds?: number; refundTo?: Address } = {},
): Promise<bigint> {
  const seller = opts.seller ?? fx.accounts.seller;
  const buyer = opts.buyer ?? fx.accounts.buyer;
  const domain = { chainId: 5042, escrow: fx.escrow };
  const now = (await fx.publicClient.getBlock()).timestamp;
  const terms: Terms = {
    seller: seller.address,
    plug: fx.accounts.plug.address,
    orderId: bytesToHex(randomBytes(32)) as Hex,
    price: opts.price ?? parseUnits('20', 6),
    plugFee: opts.plugFee ?? parseUnits('1', 6),
    windowSeconds: opts.windowSeconds ?? 3 * DAY,
    expiry: now + 3600n,
    metadataHash: bytesToHex(randomBytes(32)) as Hex,
  };
  const sellerSig = await fx.wallet(seller).signTypedData(termsTypedData(domain, terms));
  const plugSig = await fx.wallet(fx.accounts.plug).signTypedData(acceptTypedData(domain, terms));
  const amount = escrowedAmount(terms.price, terms.plugFee);
  const w = fx.wallet(buyer);
  await fx.publicClient.waitForTransactionReceipt({
    hash: await w.writeContract({ address: fx.usdc, abi: mockUsdcAbi, functionName: 'mint', args: [buyer.address, amount] }),
  });
  await fx.publicClient.waitForTransactionReceipt({
    hash: await w.writeContract({ address: fx.usdc, abi: mockUsdcAbi, functionName: 'approve', args: [fx.escrow, amount] }),
  });
  await write(fx, buyer, 'pay', [terms, sellerSig, plugSig, opts.refundTo ?? buyer.address]);
  return dealIdOf(seller.address, terms.orderId);
}

/** A local HTTP endpoint that records JSON POST bodies, standing in for an alert webhook. */
export async function startWebhook(status = 200) {
  const bodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      bodies.push(JSON.parse(body) as Record<string, unknown>);
      res.writeHead(status).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    bodies,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
