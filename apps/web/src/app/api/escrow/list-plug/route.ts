import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, createWalletClient, http, isAddress, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { network } from '@/lib/config';

/** POST /api/escrow/list-plug  { plug: "0x..." }
 *  Lists the plug at level 1 using the owner private key.
 *  Safe to call multiple times — idempotent if already level >= 1.
 */
export async function POST(req: NextRequest) {
  const ownerKey = process.env.OWNER_PRIVATE_KEY;
  if (!ownerKey) {
    return NextResponse.json({ error: 'Listing not available' }, { status: 503 });
  }

  let plug: string;
  try {
    const body = await req.json() as { plug?: unknown };
    plug = String(body.plug ?? '');
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isAddress(plug)) {
    return NextResponse.json({ error: 'Invalid plug address' }, { status: 400 });
  }

  const rpcUrl = network.rpcUrls[0]!;
  const publicClient = createPublicClient({ chain: network.chain, transport: http(rpcUrl) });

  // Read current level — already listed plugs are a no-op.
  const abi = parseAbi(['function plugLevel(address) view returns (uint8)', 'function setPlugLevel(address,uint8,string) external']);
  const current = await publicClient.readContract({
    address: network.escrow,
    abi,
    functionName: 'plugLevel',
    args: [plug as `0x${string}`],
  });

  if (current >= 1) {
    return NextResponse.json({ ok: true, level: current, listed: false });
  }

  const account = privateKeyToAccount(ownerKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain: network.chain, transport: http(rpcUrl) });

  const hash = await walletClient.writeContract({
    address: network.escrow,
    abi,
    functionName: 'setPlugLevel',
    args: [plug as `0x${string}`, 1, ''],
  });

  // Wait for the tx to land before responding so the caller can sign immediately after.
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== 'success') {
    return NextResponse.json({ error: 'Transaction reverted', hash }, { status: 500 });
  }

  return NextResponse.json({ ok: true, level: 1, listed: true, hash });
}
