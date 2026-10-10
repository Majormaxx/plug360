import { randomBytes } from 'node:crypto';
import { bytesToHex, getAddress, hexToBigInt, type Address, type Hex } from 'viem';
import type { Terms } from '../src/index.js';

export const rand = {
  bytes32: (): Hex => bytesToHex(randomBytes(32)),
  address: (): Address => getAddress(bytesToHex(randomBytes(20))),
  uint: (bits: number): bigint => hexToBigInt(bytesToHex(randomBytes(bits / 8))),
  pick: <T>(values: readonly T[]): T => values[randomBytes(1)[0]! % values.length]!,
};

/** Terms with every field random over its full ABI range, edge values mixed in. */
export function randomTerms(): Terms {
  return {
    seller: rand.address(),
    plug: rand.address(),
    orderId: rand.pick([rand.bytes32(), `0x${'00'.repeat(32)}`, `0x${'ff'.repeat(32)}`] as Hex[]),
    price: rand.pick([rand.uint(256), 0n, 2n ** 256n - 1n, rand.uint(32)]),
    plugFee: rand.pick([rand.uint(256), 0n, rand.uint(16)]),
    windowSeconds: rand.pick([Number(rand.uint(32)), 0, 2 ** 32 - 1]),
    expiry: rand.pick([rand.uint(64), 0n, 2n ** 64n - 1n]),
    metadataHash: rand.bytes32(),
  };
}

export const ZERO32: Hex = `0x${'00'.repeat(32)}`;
