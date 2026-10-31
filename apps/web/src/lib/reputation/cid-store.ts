/**
 * Persistent address → IPFS CID store.
 *
 * Backed by a single JSON file (default /tmp/plug360-cids.json, overridden by
 * CID_STORE_PATH env var). Writes are serialised with a module-level promise
 * chain so concurrent requests never corrupt the file.
 *
 * In production, swap the read/write calls for a Postgres/Turso table.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const storePath = () => process.env.CID_STORE_PATH ?? '/tmp/plug360-cids.json';

type CidMap = Record<string, string>; // lowercase address → CID

let _writeLock: Promise<void> = Promise.resolve();

async function read(): Promise<CidMap> {
  try {
    const raw = await readFile(storePath(), 'utf8');
    return JSON.parse(raw) as CidMap;
  } catch {
    return {};
  }
}

/**
 * Returns the CID for `address`, or null if none is stored.
 */
export async function getCid(address: string): Promise<string | null> {
  const map = await read();
  return map[address.toLowerCase()] ?? null;
}

/**
 * Persists `cid` for `address`. Serialised — concurrent callers queue up.
 */
export async function setCid(address: string, cid: string): Promise<void> {
  _writeLock = _writeLock.then(async () => {
    const map = await read();
    map[address.toLowerCase()] = cid;
    const path = storePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(map, null, 2), 'utf8');
  });
  return _writeLock;
}
