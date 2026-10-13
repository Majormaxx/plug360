import { acceptTypedData, dealEscrowAbi, feeOverrides, termsTypedData, type Deal, type Terms } from '@plug360/shared';
import {
  BaseError,
  getAddress,
  isErc6492Signature,
  NonceTooLowError,
  parseErc6492Signature,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { ops, type Op, type OpOutput, type SponsoredAction, type TermsWire } from './contract.js';
import { gasEligibility, topUpAmount } from './policy.js';

export class SponsorError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'SponsorError';
  }
}

export type SponsorDeps = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Account;
  chain: Chain;
  escrow: Address;
  /** Most native gas (18 decimals) one top-up may send. */
  maxTopUp: bigint;
  /** Unix seconds; defaults to the latest block time. */
  now?: () => Promise<number>;
};

export function termsFromWire(w: TermsWire): Terms {
  return {
    seller: getAddress(w.seller),
    plug: getAddress(w.plug),
    orderId: w.orderId as Hex,
    price: BigInt(w.price),
    plugFee: BigInt(w.plugFee),
    windowSeconds: w.windowSeconds,
    expiry: BigInt(w.expiry),
    metadataHash: w.metadataHash as Hex,
  };
}

/**
 * The gas sponsor ("gas master"). Pays from its own hot wallet so people who hold no USDC never get stuck:
 * it deploys counterfactual smart wallets whose ERC-6492 signatures the escrow could not otherwise check,
 * and tops up gas for the one party who must act on a deal. Every request is checked against chain state,
 * so the sponsor can only spend on deployments and calls that will succeed.
 */
export function createSponsor(deps: SponsorDeps) {
  const { publicClient, walletClient, account, chain, escrow } = deps;
  const now = deps.now ?? (async () => Number((await publicClient.getBlock({ blockTag: 'latest' })).timestamp));

  async function send(tx: { to: Address; data?: Hex; value?: bigint }): Promise<Hex> {
    for (let attempt = 0; ; attempt++) {
      try {
        const fees = await feeOverrides(publicClient);
        const hash = await walletClient.sendTransaction({ ...tx, account, chain, ...fees });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
        if (receipt.status !== 'success') throw new SponsorError(502, 'sponsor transaction reverted');
        return hash;
      } catch (err) {
        // Two requests can race for the same nonce on one instance; the loser retries with a fresh one.
        const nonceClash = err instanceof BaseError && err.walk((e) => e instanceof NonceTooLowError) !== null;
        if (!nonceClash || attempt >= 2) throw err;
      }
    }
  }

  async function prepareSigner(kind: 'terms' | 'accept', wire: TermsWire, signature: Hex): Promise<OpOutput['prepare-signer']> {
    const terms = termsFromWire(wire);
    const signer = kind === 'terms' ? terms.seller : terms.plug;
    const code = await publicClient.getCode({ address: signer });
    const deployed = !!code && code !== '0x';
    const wrapped = isErc6492Signature(signature);
    const plain = wrapped ? parseErc6492Signature(signature) : { address: undefined, data: undefined, signature };
    if (deployed || !wrapped) return { signature: plain.signature, deployed: false };

    if (BigInt(await now()) >= terms.expiry) throw new SponsorError(422, 'these terms have expired', 'expired');
    const domain = { chainId: chain.id, escrow };
    const typed = kind === 'terms' ? termsTypedData(domain, terms) : acceptTypedData(domain, terms);
    // viem checks ERC-6492 signatures by simulating the deployment, so this proves the wallet signed these
    // exact Plug360 terms before the sponsor spends anything deploying it.
    const valid = await publicClient.verifyTypedData({ ...typed, address: signer, signature } as never);
    if (!valid) throw new SponsorError(422, 'the signature does not match these terms', 'bad-signature');

    const tx = await send({ to: plain.address!, data: plain.data! });
    const after = await publicClient.getCode({ address: signer });
    if (!after || after === '0x') throw new SponsorError(502, 'the wallet factory did not deploy this wallet', 'not-deployed');
    return { signature: plain.signature, deployed: true, tx };
  }

  async function fundGas(account_: Address, dealId: bigint, action: SponsoredAction): Promise<OpOutput['gas']> {
    const target = getAddress(account_);
    const deal = (await publicClient.readContract({ address: escrow, abi: dealEscrowAbi, functionName: 'getDeal', args: [dealId] })) as Deal;
    const ok = gasEligibility(deal, target, action, await now());
    if (!ok.ok) throw new SponsorError(403, ok.reason, 'not-eligible');

    const args = action === 'openDispute' || action === 'plugRefund' || action === 'plugReject' ? [dealId, `0x${'00'.repeat(32)}`] : [dealId];
    const [gas, fees, balance] = await Promise.all([
      publicClient.estimateContractGas({ account: target, address: escrow, abi: dealEscrowAbi, functionName: action, args } as never),
      feeOverrides(publicClient),
      publicClient.getBalance({ address: target }),
    ]);
    const amount = topUpAmount(balance, gas * fees.maxFeePerGas, deps.maxTopUp);
    if (amount === 0n) return { funded: false, amount: '0' };
    const tx = await send({ to: target, value: amount });
    return { funded: true, amount: amount.toString(), tx };
  }

  /** Validates input against the contract and runs one operation. */
  async function run<O extends Op>(op: O, raw: unknown): Promise<OpOutput[O]> {
    const parsed = ops[op].input.safeParse(raw ?? {});
    if (!parsed.success) throw new SponsorError(400, parsed.error.issues[0]?.message ?? 'invalid input');
    if (op === 'prepare-signer') {
      const i = parsed.data as { kind: 'terms' | 'accept'; terms: TermsWire; signature: string };
      return (await prepareSigner(i.kind, i.terms, i.signature as Hex)) as OpOutput[O];
    }
    const i = parsed.data as { account: string; dealId: string; action: SponsoredAction };
    return (await fundGas(i.account as Address, BigInt(i.dealId), i.action)) as OpOutput[O];
  }

  return { run, prepareSigner, fundGas, address: account.address };
}
