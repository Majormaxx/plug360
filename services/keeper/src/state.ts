import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getAddress, type Address, type Hex } from 'viem';
import { toJson } from './log.js';

/** What the keeper remembers about a deal between ticks. getDeal stays the source of truth. */
export type TrackedDeal = {
  status: number;
  disputedAt: number;
  releaseAt: number;
  payoutPending: boolean;
  /** Failed retryPayout attempts so far, for backoff. */
  retryAttempts?: number;
  /** Chain time (unix seconds) before which retryPayout is not attempted again. */
  nextRetryAt?: number;
  /** Set once the "plug deadline near" alert has gone out for the current dispute. */
  deadlineWarned?: boolean;
};

export type Job = 'finalizeExpiredDispute' | 'retryPayout' | 'withdraw';

/** A transaction that was signed and broadcast but has no receipt yet. Replacements reuse the nonce. */
export type PendingTx = {
  job: Job;
  dealId: string;
  nonce: number;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  /** Every hash broadcast for this nonce; at most one can ever be mined. */
  hashes: Hex[];
  firstSentAt: number;
};

export type KeeperState = {
  version: 1;
  chainId: number;
  escrow: Address;
  /** Next block to scan. */
  cursor: string;
  deals: Record<string, TrackedDeal>;
  pending: Record<string, PendingTx>;
  flags: { insolvent: boolean; lowGas: boolean; lowSponsor?: boolean };
};

export function initialState(chainId: number, escrow: Address, deployBlock: bigint): KeeperState {
  return {
    version: 1,
    chainId,
    escrow: getAddress(escrow),
    cursor: deployBlock.toString(),
    deals: {},
    pending: {},
    flags: { insolvent: false, lowGas: false },
  };
}

export function pendingKey(job: Job, dealId: bigint | string): string {
  return `${job}:${dealId.toString()}`;
}

export interface StateStore {
  load(): Promise<KeeperState | undefined>;
  save(state: KeeperState): Promise<void>;
}

function assertShape(value: unknown, where: string): asserts value is KeeperState {
  const s = value as Partial<KeeperState> | null;
  if (
    !s ||
    s.version !== 1 ||
    typeof s.chainId !== 'number' ||
    typeof s.escrow !== 'string' ||
    typeof s.cursor !== 'string' ||
    !/^\d+$/.test(s.cursor) ||
    typeof s.deals !== 'object' ||
    typeof s.pending !== 'object' ||
    typeof s.flags !== 'object'
  ) {
    throw new Error(`${where} is not a keeper state file`);
  }
}

/** Keeps the state in one JSON file. Writes go to a temp file first and are renamed into place. */
export class FileStateStore implements StateStore {
  constructor(readonly path: string) {}

  async load(): Promise<KeeperState | undefined> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    const parsed: unknown = JSON.parse(text);
    assertShape(parsed, this.path);
    return parsed;
  }

  async save(state: KeeperState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, `${toJson(state)}\n`);
    await rename(tmp, this.path);
  }
}

/** Loads saved state or starts fresh, refusing a file written for another chain or escrow. */
export async function loadOrInit(
  store: StateStore,
  chainId: number,
  escrow: Address,
  deployBlock: bigint,
): Promise<KeeperState> {
  const saved = await store.load();
  if (!saved) return initialState(chainId, escrow, deployBlock);
  if (saved.chainId !== chainId || getAddress(saved.escrow) !== getAddress(escrow)) {
    throw new Error(
      `state belongs to escrow ${saved.escrow} on chain ${saved.chainId}, not ${escrow} on chain ${chainId}`,
    );
  }
  return saved;
}
