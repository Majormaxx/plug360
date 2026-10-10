// The keeper against the real compiled DealEscrow and MockUSDC on anvil.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { encodeAbiParameters, keccak256, numberToHex, parseUnits, type Hex } from 'viem';
import { dealEscrowAbi, DealStatus, escrowedAmount } from '@plug360/shared';
import { mockUsdcAbi, type Anvil, type Fixture } from '@plug360/testkit';
import { createKeeper, FileStateStore, memoryLogger, type KeeperConfig } from '../src/index.js';
import { DAY, fundDeal, getDeal, keeperConfig, setBlocked, setup, startWebhook, usdcBalance, warp, write } from './helpers.js';

let anvil: Anvil;
let fx: Fixture;
let webhook: Awaited<ReturnType<typeof startWebhook>>;

beforeAll(async () => {
  ({ anvil, fx } = await setup());
  webhook = await startWebhook();
});
afterAll(async () => {
  await webhook?.stop();
  await anvil?.stop();
});
beforeEach(() => {
  webhook.bodies.length = 0;
});

function keeper(overrides: Partial<KeeperConfig> = {}) {
  const logger = memoryLogger();
  const config = keeperConfig(fx, { alertWebhookUrl: webhook.url, receiptTimeoutMs: 10_000, ...overrides });
  return { k: createKeeper(config, { logger, receiptPollMs: 50 }), logger, config };
}

const kinds = (alerts: Array<{ kind: string }>) => alerts.map((a) => a.kind);

describe('finalizeExpiredDispute', () => {
  it('refunds the buyer once the plug misses the 7-day deadline, and not before', async () => {
    const { buyer } = fx.accounts;
    const dealId = await fundDeal(fx);
    await write(fx, buyer, 'openDispute', [dealId, keccak256('0x01')]);
    const { k, logger } = keeper();

    // Day 6: the plug still has a day; nothing to do, deadline warning fires.
    await warp(fx, 6 * DAY + 3600);
    const early = await k.tick();
    expect(early.ok).toBe(true);
    expect(early.actions).toEqual([]);
    expect(kinds(early.alerts)).toContain('dispute-deadline-near');
    expect((await getDeal(fx, dealId)).status).toBe(DealStatus.Disputed);

    // The warning is sent once per dispute.
    const again = await k.tick();
    expect(kinds(again.alerts)).not.toContain('dispute-deadline-near');

    await warp(fx, DAY);
    const before = await usdcBalance(fx, buyer.address);
    const report = await k.tick();
    expect(report.ok).toBe(true);
    expect(report.actions).toEqual([
      expect.objectContaining({ job: 'finalizeExpiredDispute', dealId: dealId.toString(), outcome: 'confirmed' }),
    ]);
    const deal = await getDeal(fx, dealId);
    expect(deal.status).toBe(DealStatus.Refunded);
    expect((await usdcBalance(fx, buyer.address)) - before).toBe(escrowedAmount(deal.price, deal.plugFee));
    // Every action leaves a structured line with the tx hash.
    const line = logger.entries.find((e) => e.job === 'finalizeExpiredDispute' && e.outcome === 'confirmed');
    expect(line).toMatchObject({ dealId: dealId.toString(), tx: report.actions[0]!.tx });

    // A final deal is dropped from tracking; the next tick sends nothing.
    const after = await k.tick();
    expect(after.actions).toEqual([]);
    const state = await new FileStateStore(k.store instanceof FileStateStore ? k.store.path : '').load();
    expect(state?.deals[dealId.toString()]).toBeUndefined();
  });

  it('skips without sending when someone else finalized first', async () => {
    const dealId = await fundDeal(fx);
    await write(fx, fx.accounts.buyer, 'openDispute', [dealId, keccak256('0x02')]);
    const { k } = keeper();
    await k.tick(); // starts tracking the dispute
    await warp(fx, 7 * DAY);
    await write(fx, fx.accounts.stranger, 'finalizeExpiredDispute', [dealId]);
    const nonceBefore = await fx.publicClient.getTransactionCount({ address: k.address });
    const report = await k.tick();
    expect(report.actions).toEqual([]);
    expect(await fx.publicClient.getTransactionCount({ address: k.address })).toBe(nonceBefore);
  });
});

describe('retryPayout', () => {
  it('pays a parked seller leg on the first tick after the seller is unblocked', async () => {
    const { seller, stranger } = fx.accounts;
    const dealId = await fundDeal(fx, { windowSeconds: 0 });
    await setBlocked(fx, seller.address, true);
    await write(fx, stranger, 'withdraw', [dealId]);
    const parked = await getDeal(fx, dealId);
    expect(parked.status).toBe(DealStatus.Settled);
    expect(parked.payoutPending).toBe(true);

    await setBlocked(fx, seller.address, false);
    const before = await usdcBalance(fx, seller.address);
    const { k } = keeper();
    const report = await k.tick();
    expect(report.actions).toEqual([expect.objectContaining({ job: 'retryPayout', outcome: 'confirmed' })]);
    expect(kinds(report.alerts)).toContain('payout-deferred');
    expect((await getDeal(fx, dealId)).payoutPending).toBe(false);
    // Seller receives price - sellerHalf: 20 - 0.5 USDC.
    expect((await usdcBalance(fx, seller.address)) - before).toBe(parseUnits('19.5', 6));
  });

  it('spends no gas while the leg would still fail and backs off per deal', async () => {
    const seller = fx.accounts.seller2;
    const dealId = await fundDeal(fx, { seller, windowSeconds: 0 });
    await setBlocked(fx, seller.address, true);
    await write(fx, fx.accounts.stranger, 'withdraw', [dealId]);
    const { k } = keeper({ retryBackoffSeconds: 3600 });
    const nonce0 = await fx.publicClient.getTransactionCount({ address: k.address });

    const blocked = await k.tick();
    expect(blocked.actions).toEqual([
      expect.objectContaining({ job: 'retryPayout', outcome: 'skipped', reason: 'every parked leg would still fail' }),
    ]);
    expect(await fx.publicClient.getTransactionCount({ address: k.address })).toBe(nonce0);

    // Unblocked, but inside the backoff window: no attempt yet.
    await setBlocked(fx, seller.address, false);
    const waiting = await k.tick();
    expect(waiting.actions).toEqual([]);
    expect((await getDeal(fx, dealId)).payoutPending).toBe(true);

    await warp(fx, 3600);
    const paid = await k.tick();
    expect(paid.actions).toEqual([expect.objectContaining({ job: 'retryPayout', outcome: 'confirmed' })]);
    expect((await getDeal(fx, dealId)).payoutPending).toBe(false);
  });
});

describe('monitors', () => {
  it('raises no solvency alert when the escrow holds stray funds above what it owes', async () => {
    await fundDeal(fx);
    const mint = await fx.wallet(fx.accounts.owner).writeContract({
      address: fx.usdc,
      abi: mockUsdcAbi,
      functionName: 'mint',
      args: [fx.escrow, parseUnits('3', 6)],
    });
    await fx.publicClient.waitForTransactionReceipt({ hash: mint });
    const { k } = keeper();
    const report = await k.tick();
    expect(report.ok).toBe(true);
    expect(kinds(report.alerts)).not.toContain('insolvent');
  });

  it('raises a critical alert once when the escrow balance drops below totalHeld, and a recovery notice', async () => {
    await fundDeal(fx);
    const { k } = keeper();
    await k.tick();
    webhook.bodies.length = 0;

    // OpenZeppelin ERC20 keeps balances in storage slot 0: slot = keccak256(abi.encode(account, 0)).
    const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [fx.escrow, 0n]));
    const original = await usdcBalance(fx, fx.escrow);
    const held = await fx.publicClient.readContract({ address: fx.escrow, abi: dealEscrowAbi, functionName: 'totalHeld' });
    await fx.testClient.setStorageAt({ address: fx.usdc, index: slot, value: numberToHex(held - 1n, { size: 32 }) as Hex });
    expect(await usdcBalance(fx, fx.escrow)).toBe(held - 1n);
    await fx.testClient.mine({ blocks: 1 });

    const bad = await k.tick();
    expect(bad.alerts).toEqual([expect.objectContaining({ kind: 'insolvent', severity: 'critical' })]);
    expect(webhook.bodies).toEqual([
      expect.objectContaining({ source: 'plug360-keeper', kind: 'insolvent', severity: 'critical', chainId: 5042, escrow: fx.escrow }),
    ]);
    expect(kinds((await k.tick()).alerts)).not.toContain('insolvent');

    await fx.testClient.setStorageAt({ address: fx.usdc, index: slot, value: numberToHex(original, { size: 32 }) as Hex });
    await fx.testClient.mine({ blocks: 1 });
    expect(kinds((await k.tick()).alerts)).toEqual(['solvency-restored']);
  });

  it('reports owner actions from the event log', async () => {
    const { k } = keeper();
    await k.tick();
    await write(fx, fx.accounts.owner, 'pause', []);
    await write(fx, fx.accounts.owner, 'unpause', []);
    await write(fx, fx.accounts.owner, 'setPlugLevel', [fx.accounts.stranger.address, 2]);
    await write(fx, fx.accounts.owner, 'transferOwnership', [fx.accounts.stranger.address]);
    const report = await k.tick();
    const owner = report.alerts.filter((a) => a.kind === 'owner-action').map((a) => (a.data as { event: string }).event);
    expect(owner).toEqual(['Paused', 'Unpaused', 'PlugLevelSet', 'OwnershipTransferStarted']);
  });

  it('warns when the keeper gas balance is below the threshold', async () => {
    const { k } = keeper({ minGasBalance: parseUnits('1', 18) });
    const original = await fx.publicClient.getBalance({ address: k.address });
    await fx.testClient.setBalance({ address: k.address, value: parseUnits('0.5', 18) });
    expect(kinds((await k.tick()).alerts)).toContain('low-gas');
    expect(kinds((await k.tick()).alerts)).not.toContain('low-gas');
    await fx.testClient.setBalance({ address: k.address, value: original });
    expect(kinds((await k.tick()).alerts)).toContain('gas-restored');
  });

  it('keeps running when the webhook fails and logs the failed delivery', async () => {
    const broken = await startWebhook(500);
    try {
      const { k, logger } = keeper({ alertWebhookUrl: broken.url, minGasBalance: parseUnits('1000000', 18) });
      const report = await k.tick();
      expect(report.ok).toBe(true);
      expect(kinds(report.alerts)).toContain('low-gas');
      expect(logger.entries).toContainEqual(expect.objectContaining({ job: 'alert', outcome: 'delivery-failed' }));
    } finally {
      await broken.stop();
    }
  });
});
