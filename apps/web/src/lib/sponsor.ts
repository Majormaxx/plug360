import type { Terms } from '@plug360/shared';
import type { OpError, OpInput, OpOutput, Op, SponsoredAction } from '@plug360/sponsor/contract';
import type { Address, Hex } from 'viem';

export class SponsorApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'SponsorApiError';
  }
}

async function call<O extends Op>(op: O, input: OpInput<O>): Promise<OpOutput[O]> {
  const res = await fetch(`/api/sponsor/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = (await res.json().catch(() => ({}))) as OpError & OpOutput[O];
  if (!res.ok) throw new SponsorApiError(res.status, body.error ?? `sponsor request failed (${res.status})`, body.reason);
  return body;
}

const wire = (t: Terms) => ({ ...t, price: t.price.toString(), plugFee: t.plugFee.toString(), expiry: t.expiry.toString() });

/** Returns the signature the escrow can verify, deploying a counterfactual smart wallet first if needed. */
export async function prepareSigner(kind: 'terms' | 'accept', terms: Terms, signature: Hex): Promise<{ signature: Hex; deployed: boolean }> {
  const out = await call('prepare-signer', { kind, terms: wire(terms), signature });
  return { signature: out.signature, deployed: out.deployed };
}

/** Asks the sponsor to cover gas for an action this account may take on a deal. */
export async function requestGas(account: Address, dealId: bigint, action: SponsoredAction) {
  return call('gas', { account, dealId: dealId.toString(), action });
}
