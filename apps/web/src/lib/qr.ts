import { getAddress, isAddress, type Address } from 'viem';

/** Pulls an address out of what a wallet's "receive" QR code holds: a bare address or an EIP-681 URI. */
export function addressFromQr(text: string): Address | undefined {
  const m = /0x[0-9a-fA-F]{40}/.exec(text);
  return m && isAddress(m[0], { strict: false }) ? getAddress(m[0]) : undefined;
}
