import { z } from 'zod';
import { network } from './config';

/**
 * Per-browser conveniences only: job titles for deals this browser has seen, the deals-scan cursor, and the
 * hashes of transactions sent from here. Nothing here is needed for safety; the chain is always the source
 * of truth. Every access is wrapped because storage can be blocked or missing.
 */
const prefix = `plug360:${network.chain.id}:${network.escrow.toLowerCase()}:`;

function read<T>(key: string, schema: z.ZodType<T>): T | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(prefix + key);
    if (!raw) return undefined;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(prefix + key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: losing a convenience is fine.
  }
}

const titlesSchema = z.record(z.string(), z.string().max(80));

export function rememberTitle(dealIdHex: string, title: string): void {
  if (!title) return;
  const all = read('titles', titlesSchema) ?? {};
  all[dealIdHex.toLowerCase()] = title;
  write('titles', all);
}

export function titleOf(dealIdHex: string): string | undefined {
  return read('titles', titlesSchema)?.[dealIdHex.toLowerCase()];
}

export const fundedSchema = z.object({
  id: z.string(),
  buyer: z.string(),
  seller: z.string(),
  plug: z.string(),
  price: z.string(),
  plugFee: z.string(),
  releaseAt: z.number(),
  block: z.string(),
});
export type FundedRecord = z.infer<typeof fundedSchema>;

const scanSchema = z.object({ scannedTo: z.string(), deals: z.array(fundedSchema) });

export function loadScan(): { scannedTo: bigint; deals: FundedRecord[] } | undefined {
  const s = read('scan', scanSchema);
  return s ? { scannedTo: BigInt(s.scannedTo), deals: s.deals } : undefined;
}

export function saveScan(scannedTo: bigint, deals: FundedRecord[]): void {
  write('scan', { scannedTo: scannedTo.toString(), deals });
}

const activitySchema = z.array(z.object({ dealId: z.string(), label: z.string(), hash: z.string(), at: z.number() }));
export type Activity = z.infer<typeof activitySchema>[number];

export function logActivity(entry: Activity): void {
  const all = read('activity', activitySchema) ?? [];
  write('activity', [entry, ...all].slice(0, 200));
}

export function activityFor(dealIdHex: string): Activity[] {
  return (read('activity', activitySchema) ?? []).filter((a) => a.dealId.toLowerCase() === dealIdHex.toLowerCase());
}
