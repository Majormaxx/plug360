import { defineChain, erc20Abi, formatUnits, type Address, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arcChainById, dealEscrowAbi, DealStatus, MAX_LOG_BLOCKS, PLUG_WINDOW_SECONDS } from '@plug360/shared';
import { AlertSink, type Alert, type FetchLike } from './alerts.js';
import type { KeeperConfig } from './config.js';
import { jsonLogger, type Logger } from './log.js';
import { RpcPool, type RpcPoolOptions } from './rpc.js';
import { TxSender, type ActionResult } from './sender.js';
import { FileStateStore, loadOrInit, pendingKey, type KeeperState, type StateStore } from './state.js';

export type KeeperDeps = {
  logger?: Logger;
  store?: StateStore;
  fetch?: FetchLike;
  /** How often to poll for a receipt while waiting. */
  receiptPollMs?: number;
  /** Overrides for RPC retry timing. */
  rpc?: Pick<RpcPoolOptions, 'maxAttempts' | 'baseDelayMs' | 'maxDelayMs' | 'requestTimeoutMs'>;
};

export type TickReport = {
  ok: boolean;
  error?: string;
  head?: string;
  scannedFrom?: string;
  scannedTo?: string;
  now?: number;
  trackedDeals: number;
  actions: ActionResult[];
  alerts: Alert[];
  durationMs: number;
};

const MAX_RETRY_BACKOFF_SECONDS = 24 * 60 * 60;
const OWNER_EVENTS = new Set([
  'PlugLevelSet',
  'Paused',
  'Unpaused',
  'OwnershipTransferStarted',
  'OwnershipTransferred',
  'ExcessSwept',
]);
const DEAL_EVENTS = new Set([
  'DealFunded',
  'DisputeOpened',
  'PlugRuled',
  'Refunded',
  'Released',
  'Settled',
  'PayoutDeferred',
  'PayoutRetried',
]);

function chainFor(chainId: number): Chain {
  return (
    arcChainById(chainId) ??
    defineChain({
      id: chainId,
      name: `chain ${chainId}`,
      nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
      rpcUrls: { default: { http: [] } },
    })
  );
}

function isFinal(status: number) {
  return status === DealStatus.Refunded || status === DealStatus.Settled;
}

/**
 * Builds a keeper from validated config. tick() runs every job once and never throws; loop() runs
 * ticks until the signal aborts. Both are safe to call from a CLI, a server, or a cron handler.
 */
export function createKeeper(config: KeeperConfig, deps: KeeperDeps = {}) {
  const logger = deps.logger ?? jsonLogger();
  const store = deps.store ?? new FileStateStore(config.stateFile);
  const chain = chainFor(config.chainId);
  const account = privateKeyToAccount(config.privateKey);
  const pool = new RpcPool({
    primaryUrl: config.rpcUrl,
    ...(config.rpcFallbackUrl ? { fallbackUrl: config.rpcFallbackUrl } : {}),
    chain,
    logger,
    ...deps.rpc,
  });
  const escrow = config.escrow;
  let running = false;

  const readEscrow = <T>(label: string, functionName: string, args: readonly unknown[], blockNumber?: bigint) =>
    pool.call(label, (c) =>
      c.readContract({ address: escrow, abi: dealEscrowAbi, functionName, args, blockNumber } as never),
    ) as Promise<T>;

  async function tickInner(state: KeeperState, report: TickReport, alerts: AlertSink, save: () => Promise<void>) {
    const chainId = await pool.call('chainId', (c) => c.getChainId());
    if (chainId !== config.chainId) throw new Error(`RPC is on chain ${chainId}, config says ${config.chainId}`);

    const head = await pool.call('blockNumber', (c) => c.getBlockNumber());
    const headBlock = await pool.call('block', (c) => c.getBlock({ blockNumber: head }));
    const now = Number(headBlock.timestamp);
    report.head = head.toString();
    report.now = now;

    async function refreshDeal(dealId: bigint) {
      const id = dealId.toString();
      const d = await readEscrow<{ status: number; disputedAt: number; releaseAt: number; payoutPending: boolean }>(
        'getDeal',
        'getDeal',
        [dealId],
      );
      if (d.status === DealStatus.None) return;
      if (isFinal(d.status) && !d.payoutPending) {
        delete state.deals[id];
        return;
      }
      const prev = state.deals[id];
      state.deals[id] = {
        status: d.status,
        disputedAt: Number(d.disputedAt),
        releaseAt: Number(d.releaseAt),
        payoutPending: d.payoutPending,
        ...(d.payoutPending && prev?.retryAttempts !== undefined ? { retryAttempts: prev.retryAttempts } : {}),
        ...(d.payoutPending && prev?.nextRetryAt !== undefined ? { nextRetryAt: prev.nextRetryAt } : {}),
        ...(d.status === DealStatus.Disputed && prev?.deadlineWarned ? { deadlineWarned: true } : {}),
      };
    }

    // 1. Index escrow events in ranges Arc accepts. The cursor and every touched deal are saved per range.
    const startCursor = BigInt(state.cursor);
    report.scannedFrom = startCursor.toString();
    for (let from = startCursor; from <= head; ) {
      const to = from + BigInt(MAX_LOG_BLOCKS) - 1n < head ? from + BigInt(MAX_LOG_BLOCKS) - 1n : head;
      const events = await pool.call('getLogs', (c) =>
        c.getContractEvents({ address: escrow, abi: dealEscrowAbi, fromBlock: from, toBlock: to }),
      );
      const touched = new Set<bigint>();
      for (const ev of events) {
        const args = ev.args as Record<string, unknown>;
        if (DEAL_EVENTS.has(ev.eventName)) touched.add(args.dealId as bigint);
        if (ev.eventName === 'PayoutDeferred') {
          await alerts.emit({
            severity: 'warning',
            kind: 'payout-deferred',
            message: `payout of ${formatUnits(args.amount as bigint, 6)} USDC to ${String(args.to)} was parked`,
            dealId: String(args.dealId),
            data: { to: args.to, amount: args.amount, tx: ev.transactionHash, block: ev.blockNumber },
          });
        } else if (OWNER_EVENTS.has(ev.eventName)) {
          await alerts.emit({
            severity: 'warning',
            kind: 'owner-action',
            message: `owner action: ${ev.eventName}`,
            data: { event: ev.eventName, args, tx: ev.transactionHash, block: ev.blockNumber },
          });
        }
      }
      for (const dealId of touched) await refreshDeal(dealId);
      logger({ level: 'debug', job: 'index', outcome: 'scanned', from, to, events: events.length, deals: touched.size });
      state.cursor = (to + 1n).toString();
      await save();
      report.scannedTo = to.toString();
      from = to + 1n;
    }

    const sender = new TxSender({
      pool,
      account,
      chainId: config.chainId,
      escrow,
      logger,
      state,
      save,
      receiptTimeoutMs: config.receiptTimeoutMs,
      receiptPollMs: deps.receiptPollMs ?? 1_000,
    });
    const expired = (d: { status: number; disputedAt: number }) =>
      d.status === DealStatus.Disputed && now >= d.disputedAt + PLUG_WINDOW_SECONDS;
    let halted = false;

    // 2. Settle transactions an earlier tick left without a receipt, before sending anything new.
    for (const key of Object.keys(state.pending)) {
      const p = state.pending[key]!;
      const dealId = BigInt(p.dealId);
      const result = await sender.resolve(key, async () => {
        await refreshDeal(dealId);
        const d = state.deals[p.dealId];
        if (!d) return false;
        return p.job === 'finalizeExpiredDispute' ? expired(d) : d.payoutPending;
      });
      report.actions.push(result);
      if (result.outcome === 'confirmed' || result.outcome === 'reverted') await refreshDeal(dealId);
      if (result.halt) halted = true;
    }

    // 3. Refund buyers whose plug let the 7-day ruling window pass.
    for (const [id, d] of Object.entries(state.deals)) {
      if (halted) break;
      if (!expired(d) || state.pending[pendingKey('finalizeExpiredDispute', id)]) continue;
      const result = await sender.execute('finalizeExpiredDispute', BigInt(id));
      report.actions.push(result);
      await refreshDeal(BigInt(id));
      if (result.halt) halted = true;
    }

    // 4. Retry parked payout legs, with per-deal backoff.
    const usdc = await readEscrow<Address>('USDC', 'USDC', []);
    for (const [id, d] of Object.entries(state.deals)) {
      if (halted) break;
      if (!d.payoutPending || (d.nextRetryAt ?? 0) > now) continue;
      if (state.pending[pendingKey('retryPayout', id)]) continue;
      const dealId = BigInt(id);
      const deal = await readEscrow<{ refundTo: Address; seller: Address; plug: Address }>('getDeal', 'getDeal', [dealId]);
      const [toRefund, toSeller, toPlug] = await readEscrow<readonly [bigint, bigint, bigint]>('pendingPayouts', 'pendingPayouts', [dealId]);
      const legs: Array<[Address, bigint]> = [
        [deal.refundTo, toRefund],
        [deal.seller, toSeller],
        [deal.plug, toPlug],
      ];
      // Ask USDC whether any leg would go through now. A blocklisted recipient fails here for free.
      let payable = 0;
      for (const [to, amount] of legs) {
        if (amount === 0n) continue;
        const ok = await pool
          .call('simulateTransfer', (c) =>
            c.simulateContract({ account: escrow, address: usdc, abi: erc20Abi, functionName: 'transfer', args: [to, amount] }),
          )
          .then((r) => r.result === true)
          .catch((err: unknown) => {
            if (err instanceof Error && err.name === 'RpcExhaustedError') throw err;
            return false;
          });
        if (ok) payable++;
      }

      let stillPending = true;
      if (payable === 0) {
        const result: ActionResult = { job: 'retryPayout', dealId: id, outcome: 'skipped', reason: 'every parked leg would still fail' };
        logger({ level: 'info', job: 'retryPayout', dealId: id, outcome: 'skipped', reason: result.reason });
        report.actions.push(result);
      } else {
        const result = await sender.execute('retryPayout', dealId);
        report.actions.push(result);
        await refreshDeal(dealId);
        stillPending = state.deals[id]?.payoutPending === true;
        if (result.halt) halted = true;
      }
      const current = state.deals[id];
      if (stillPending && current) {
        const attempts = (current.retryAttempts ?? 0) + 1;
        current.retryAttempts = attempts;
        current.nextRetryAt = now + Math.min(config.retryBackoffSeconds * 2 ** (attempts - 1), MAX_RETRY_BACKOFF_SECONDS);
      }
    }

    // 5. Monitors.
    const [balance, held] = await Promise.all([
      pool.call('balanceOf', (c) => c.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [escrow], blockNumber: head })),
      readEscrow<bigint>('totalHeld', 'totalHeld', [], head),
    ]);
    const insolvent = balance < held;
    logger({ level: insolvent ? 'error' : 'debug', job: 'solvency', outcome: insolvent ? 'insolvent' : 'ok', balance, totalHeld: held });
    if (insolvent && !state.flags.insolvent) {
      await alerts.emit({
        severity: 'critical',
        kind: 'insolvent',
        message: `escrow holds ${formatUnits(balance, 6)} USDC but owes ${formatUnits(held, 6)} USDC`,
        data: { balance, totalHeld: held, block: head },
      });
    } else if (!insolvent && state.flags.insolvent) {
      await alerts.emit({ severity: 'info', kind: 'solvency-restored', message: 'escrow balance covers totalHeld again', data: { balance, totalHeld: held } });
    }
    state.flags.insolvent = insolvent;

    const gas = await pool.call('gasBalance', (c) => c.getBalance({ address: account.address }));
    const lowGas = gas < config.minGasBalance;
    if (lowGas && !state.flags.lowGas) {
      await alerts.emit({
        severity: 'warning',
        kind: 'low-gas',
        message: `keeper ${account.address} has ${formatUnits(gas, 18)} USDC for gas, below ${formatUnits(config.minGasBalance, 18)}`,
        data: { address: account.address, balance: gas, threshold: config.minGasBalance },
      });
    } else if (!lowGas && state.flags.lowGas) {
      await alerts.emit({ severity: 'info', kind: 'gas-restored', message: 'keeper gas balance is above the threshold again', data: { balance: gas } });
    }
    state.flags.lowGas = lowGas;

    for (const [id, d] of Object.entries(state.deals)) {
      if (d.status !== DealStatus.Disputed || d.deadlineWarned) continue;
      const deadline = d.disputedAt + PLUG_WINDOW_SECONDS;
      const left = deadline - now;
      if (left > 0 && left <= config.deadlineWarningSeconds) {
        await alerts.emit({
          severity: 'warning',
          kind: 'dispute-deadline-near',
          message: `plug has ${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m left to rule`,
          dealId: id,
          data: { deadline, secondsLeft: left },
        });
        d.deadlineWarned = true;
      }
    }
  }

  async function tick(): Promise<TickReport> {
    const started = Date.now();
    const report: TickReport = { ok: false, trackedDeals: 0, actions: [], alerts: [], durationMs: 0 };
    const alerts = new AlertSink(logger, { chainId: config.chainId, escrow }, config.alertWebhookUrl, deps.fetch);
    report.alerts = alerts.sent;
    if (running) {
      report.error = 'a tick is already running';
      logger({ level: 'warn', job: 'tick', outcome: 'skipped', reason: report.error });
      return report;
    }
    running = true;
    pool.reset();
    let state: KeeperState | undefined;
    const save = async () => {
      if (state) await store.save(state);
    };
    try {
      state = await loadOrInit(store, config.chainId, escrow, config.deployBlock);
      await tickInner(state, report, alerts, save);
      await save();
      report.ok = true;
    } catch (err) {
      report.error = err instanceof Error ? err.message.split('\n')[0] : String(err);
      logger({ level: 'error', job: 'tick', outcome: 'failed', error: report.error, stack: err instanceof Error ? err.stack : undefined });
      await alerts.emit({ severity: 'warning', kind: 'tick-failed', message: report.error ?? 'tick failed' });
      try {
        await save();
      } catch (saveErr) {
        logger({ level: 'error', job: 'state', outcome: 'save-failed', error: String(saveErr) });
      }
    } finally {
      running = false;
    }
    report.trackedDeals = state ? Object.keys(state.deals).length : 0;
    report.durationMs = Date.now() - started;
    logger({
      level: report.ok ? 'info' : 'error',
      job: 'tick',
      outcome: report.ok ? 'done' : 'failed',
      head: report.head,
      scannedFrom: report.scannedFrom,
      scannedTo: report.scannedTo,
      trackedDeals: report.trackedDeals,
      actions: report.actions.length,
      alerts: report.alerts.length,
      durationMs: report.durationMs,
    });
    return report;
  }

  /** Runs ticks every pollIntervalSeconds until `signal` aborts. A failed tick is logged and the loop goes on. */
  async function loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await tick();
      if (signal.aborted) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, config.pollIntervalSeconds * 1000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  }

  return { tick, loop, pool, address: account.address, store };
}

export type Keeper = ReturnType<typeof createKeeper>;
