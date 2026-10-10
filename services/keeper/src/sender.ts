import {
  BaseError,
  encodeFunctionData,
  keccak256,
  NonceTooLowError,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PrivateKeyAccount,
  type TransactionReceipt,
} from 'viem';
import { dealEscrowAbi, feeOverrides } from '@plug360/shared';
import type { Logger } from './log.js';
import { RpcExhaustedError, type RpcPool } from './rpc.js';
import { pendingKey, type Job, type KeeperState, type PendingTx } from './state.js';

export type Outcome = 'confirmed' | 'reverted' | 'unknown' | 'skipped' | 'failed' | 'dropped';

export type ActionResult = {
  job: Job;
  dealId: string;
  outcome: Outcome;
  tx?: Hex;
  reason?: string;
};

export type SenderContext = {
  pool: RpcPool;
  account: PrivateKeyAccount;
  chainId: number;
  escrow: Address;
  logger: Logger;
  state: KeeperState;
  save: () => Promise<void>;
  receiptTimeoutMs: number;
  receiptPollMs: number;
};

/** Revert name from a simulation error, or undefined if the error is not a revert. */
export function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => (e as { name?: string }).name === 'ContractFunctionRevertedError') as
    | { data?: { errorName?: string }; reason?: string; shortMessage?: string }
    | null;
  if (!revert) return undefined;
  return revert.data?.errorName ?? revert.reason ?? revert.shortMessage ?? 'reverted';
}

const bump = (value: bigint) => (value * 1125n) / 1000n + 1n;
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/**
 * Sends keeper transactions so that each action is mined at most once.
 *
 * Every transaction is simulated first, signed locally with an explicit nonce, and recorded in the
 * state file before it is broadcast. If no receipt arrives within the timeout the outcome is
 * "unknown" and the record stays. On the next tick resolve() looks for a receipt of any hash sent
 * for that nonce, re-reads the deal, and only then rebroadcasts, always with the same nonce and higher
 * fees, so at most one of the attempts can ever be included.
 */
export class TxSender {
  constructor(private readonly ctx: SenderContext) {}

  private log(result: ActionResult, extra: Record<string, unknown> = {}) {
    const level = result.outcome === 'failed' || result.outcome === 'reverted' ? 'error' : result.outcome === 'unknown' ? 'warn' : 'info';
    this.ctx.logger({ level, job: result.job, dealId: result.dealId, tx: result.tx, outcome: result.outcome, reason: result.reason, ...extra });
  }

  /** Simulates, signs, records, broadcasts and waits. `halt` asks the caller to send nothing else this tick. */
  async execute(job: Job, dealId: bigint): Promise<ActionResult & { halt: boolean }> {
    const { pool, account, escrow } = this.ctx;
    const id = dealId.toString();
    const key = pendingKey(job, dealId);
    if (this.ctx.state.pending[key]) return { job, dealId: id, outcome: 'skipped', reason: 'awaiting earlier transaction', halt: false };

    try {
      await pool.call('simulate', (c) =>
        c.simulateContract({ account: account.address, address: escrow, abi: dealEscrowAbi, functionName: job, args: [dealId] }),
      );
    } catch (err) {
      const name = revertName(err);
      if (name === undefined) throw err;
      const result: ActionResult = { job, dealId: id, outcome: 'skipped', reason: name };
      this.log(result);
      return { ...result, halt: false };
    }

    const estimate = await pool.call('estimateGas', (c) =>
      c.estimateContractGas({ account: account.address, address: escrow, abi: dealEscrowAbi, functionName: job, args: [dealId] }),
    );
    const fees = await pool.call('fees', (c) => feeOverrides(c));
    const nonce = await pool.call('nonce', (c) => c.getTransactionCount({ address: account.address, blockTag: 'pending' }));
    const block = await pool.call('block', (c) => c.getBlock());

    const pending: PendingTx = {
      job,
      dealId: id,
      nonce,
      gas: ((estimate * 12n) / 10n).toString(),
      maxFeePerGas: fees.maxFeePerGas.toString(),
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      hashes: [],
      firstSentAt: Number(block.timestamp),
    };
    return this.sendAndWait(key, pending);
  }

  /**
   * Settles a transaction left without a receipt by an earlier tick. `stillNeeded` re-reads the deal
   * from the chain; a rebroadcast happens only if the action is still required.
   */
  async resolve(key: string, stillNeeded: () => Promise<boolean>): Promise<ActionResult & { halt: boolean }> {
    const { pool, account } = this.ctx;
    const pending = this.ctx.state.pending[key];
    if (!pending) throw new Error(`no pending transaction ${key}`);
    const base = { job: pending.job, dealId: pending.dealId };

    const found = await this.findReceipt(pending.hashes);
    if (found) return this.finish(key, pending, found);

    const latestNonce = await pool.call('nonce', (c) => c.getTransactionCount({ address: account.address, blockTag: 'latest' }));
    if (latestNonce > pending.nonce) {
      // The nonce was used, but by none of our hashes: another process signs with this key.
      await this.clear(key);
      const result: ActionResult = { ...base, outcome: 'dropped', reason: 'nonce used by another transaction' };
      this.log(result, { nonce: pending.nonce });
      return { ...result, halt: false };
    }

    if (!(await stillNeeded())) {
      await this.clear(key);
      const result: ActionResult = { ...base, outcome: 'dropped', reason: 'no longer needed' };
      this.log(result, { nonce: pending.nonce });
      return { ...result, halt: false };
    }

    const fees = await pool.call('fees', (c) => feeOverrides(c));
    pending.maxFeePerGas = max(fees.maxFeePerGas, bump(BigInt(pending.maxFeePerGas))).toString();
    pending.maxPriorityFeePerGas = max(fees.maxPriorityFeePerGas, bump(BigInt(pending.maxPriorityFeePerGas))).toString();
    return this.sendAndWait(key, pending);
  }

  private async sendAndWait(key: string, pending: PendingTx): Promise<ActionResult & { halt: boolean }> {
    const { account, chainId, escrow, pool } = this.ctx;
    const base = { job: pending.job, dealId: pending.dealId };
    const raw = await account.signTransaction({
      type: 'eip1559',
      chainId,
      nonce: pending.nonce,
      to: escrow,
      data: encodeFunctionData({ abi: dealEscrowAbi, functionName: pending.job, args: [BigInt(pending.dealId)] }),
      value: 0n,
      gas: BigInt(pending.gas),
      maxFeePerGas: BigInt(pending.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(pending.maxPriorityFeePerGas),
    });
    const hash = keccak256(raw);

    // Record intent before broadcasting so a crash here cannot lead to a second, unrelated send.
    pending.hashes.push(hash);
    this.ctx.state.pending[key] = pending;
    await this.ctx.save();

    try {
      await pool.call('sendRawTransaction', (c) => c.sendRawTransaction({ serializedTransaction: raw }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const alreadyKnown = /already known|known transaction|already imported/i.test(message);
      const nonceUsed = err instanceof BaseError && err.walk((e) => e instanceof NonceTooLowError) !== null;
      if (err instanceof RpcExhaustedError) {
        const result: ActionResult = { ...base, outcome: 'unknown', tx: hash, reason: 'broadcast not confirmed by RPC' };
        this.log(result, { nonce: pending.nonce });
        return { ...result, halt: true };
      }
      if (!alreadyKnown && !nonceUsed) {
        // Definitely not accepted: forget this hash. Keep the record if an earlier hash may still land.
        pending.hashes.pop();
        if (pending.hashes.length === 0) delete this.ctx.state.pending[key];
        await this.ctx.save();
        const result: ActionResult = { ...base, outcome: 'failed', tx: hash, reason: message.split('\n')[0] };
        this.log(result, { nonce: pending.nonce });
        return { ...result, halt: pending.hashes.length > 0 };
      }
    }
    this.ctx.logger({ level: 'info', job: pending.job, dealId: pending.dealId, tx: hash, outcome: 'sent', nonce: pending.nonce, attempt: pending.hashes.length });

    const deadline = Date.now() + this.ctx.receiptTimeoutMs;
    for (;;) {
      const found = await this.findReceipt(pending.hashes);
      if (found) return this.finish(key, pending, found);
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, this.ctx.receiptPollMs));
    }
    const result: ActionResult = { ...base, outcome: 'unknown', tx: hash, reason: `no receipt after ${this.ctx.receiptTimeoutMs} ms` };
    this.log(result, { nonce: pending.nonce });
    return { ...result, halt: true };
  }

  private async findReceipt(hashes: Hex[]): Promise<TransactionReceipt | undefined> {
    for (const hash of hashes) {
      try {
        return await this.ctx.pool.call('receipt', (c) => c.getTransactionReceipt({ hash }));
      } catch (err) {
        if (err instanceof TransactionReceiptNotFoundError) continue;
        throw err;
      }
    }
    return undefined;
  }

  private async finish(key: string, pending: PendingTx, receipt: TransactionReceipt): Promise<ActionResult & { halt: boolean }> {
    await this.clear(key);
    const result: ActionResult = {
      job: pending.job,
      dealId: pending.dealId,
      outcome: receipt.status === 'success' ? 'confirmed' : 'reverted',
      tx: receipt.transactionHash,
    };
    this.log(result, { block: receipt.blockNumber, gasUsed: receipt.gasUsed, nonce: pending.nonce, attempts: pending.hashes.length });
    return { ...result, halt: false };
  }

  private async clear(key: string) {
    delete this.ctx.state.pending[key];
    await this.ctx.save();
  }
}
