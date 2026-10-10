// Every hash and digest the TypeScript helpers produce must equal what the deployed DealEscrow computes.
// The contract is the compiled Foundry artifact running on anvil with Arc's mainnet chain id.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError, erc20Abi, parseUnits, type Address, type Chain, type Hex } from 'viem';
import { anvilAccount, deployFixture, mockUsdcAbi, roles, startAnvil, type Anvil, type Fixture } from '@plug360/testkit';
import {
  acceptDigest,
  acceptTypedData,
  arcMainnet,
  dealEscrowAbi,
  dealIdOf,
  DealStatus,
  escrowedAmount,
  feeOverrides,
  levelCap,
  MAX_BATCH,
  MAX_FEE_BPS,
  MAX_LEVEL,
  MAX_TERMS_LIFETIME_SECONDS,
  MAX_TOTAL_HELD,
  MAX_WINDOW_SECONDS,
  MIN_PRICE,
  PLUG_WINDOW_SECONDS,
  releaseDigest,
  releaseTypedData,
  termsDigest,
  termsHash,
  termsTypedData,
  validateTerms,
  type EscrowDomain,
  type Terms,
} from '../src/index.js';
import { rand, randomTerms, ZERO32 } from './helpers.js';

const RUNS = 150;

let anvil: Anvil;
let fx: Fixture;
let domain: EscrowDomain;

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 5042 });
  // Plug is listed at level 3 (25 USDC cap).
  fx = await deployFixture(anvil.rpcUrl, arcMainnet as Chain, [[anvilAccount(roles.plug).address, 3]]);
  domain = { chainId: 5042, escrow: fx.escrow };
});
afterAll(async () => {
  await anvil?.stop();
});

function read<F extends 'termsHash' | 'termsDigest' | 'acceptDigest' | 'releaseDigest' | 'dealIdOf' | 'levelCap'>(
  functionName: F,
  args: readonly unknown[],
) {
  return fx.publicClient.readContract({ address: fx.escrow, abi: dealEscrowAbi, functionName, args } as never) as Promise<
    Hex | bigint
  >;
}

describe('hashes match the deployed contract', () => {
  it('the anvil node uses chain id 5042, as on Arc mainnet', async () => {
    expect(await fx.publicClient.getChainId()).toBe(5042);
  });

  it(`termsHash and termsDigest over ${RUNS} random terms`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const terms = randomTerms();
      expect(await read('termsHash', [terms])).toBe(termsHash(terms));
      expect(await read('termsDigest', [terms])).toBe(termsDigest(domain, terms));
    }
  });

  it(`acceptDigest over ${RUNS} random inputs`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const th = rand.bytes32();
      const plug = rand.address();
      expect(await read('acceptDigest', [th, plug])).toBe(acceptDigest(domain, th, plug));
    }
  });

  it(`releaseDigest over ${RUNS} random inputs`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const msg = {
        dealId: rand.uint(256),
        buyer: rand.address(),
        amount: rand.pick([rand.uint(256), rand.uint(32), 0n]),
        nonce: rand.pick([rand.uint(256), 0n, 1n]),
        deadline: rand.pick([rand.uint(256), rand.uint(40)]),
      };
      expect(await read('releaseDigest', [msg.dealId, msg.buyer, msg.amount, msg.nonce, msg.deadline])).toBe(
        releaseDigest(domain, msg),
      );
    }
  });

  it(`dealIdOf over ${RUNS} random inputs`, async () => {
    for (let i = 0; i < RUNS; i++) {
      const seller = rand.address();
      const orderId = rand.bytes32();
      expect(await read('dealIdOf', [seller, orderId])).toBe(dealIdOf(seller, orderId));
    }
  });

  it('limit constants equal the contract constants', async () => {
    const c = (functionName: string) =>
      fx.publicClient.readContract({ address: fx.escrow, abi: dealEscrowAbi, functionName, args: [] } as never) as Promise<bigint | number>;
    expect(BigInt(await c('MIN_AMOUNT'))).toBe(MIN_PRICE);
    expect(BigInt(await c('MAX_TOTAL_HELD'))).toBe(MAX_TOTAL_HELD);
    expect(Number(await c('MAX_WINDOW'))).toBe(MAX_WINDOW_SECONDS);
    expect(Number(await c('PLUG_WINDOW'))).toBe(PLUG_WINDOW_SECONDS);
    expect(Number(await c('MAX_TERMS_LIFETIME'))).toBe(MAX_TERMS_LIFETIME_SECONDS);
    expect(BigInt(await c('MAX_FEE_BPS'))).toBe(MAX_FEE_BPS);
    expect(Number(await c('MAX_LEVEL'))).toBe(MAX_LEVEL);
    expect(BigInt(await c('MAX_BATCH'))).toBe(BigInt(MAX_BATCH));
  });

  it('levelCap for every level', async () => {
    for (let level = 0; level <= 5; level++) {
      expect(await read('levelCap', [level])).toBe(levelCap(level));
    }
  });

  it('a different chain id or escrow address changes the digest', async () => {
    const terms = randomTerms();
    const onChain = await read('termsDigest', [terms]);
    expect(termsDigest({ chainId: 5_042_002, escrow: fx.escrow }, terms)).not.toBe(onChain);
    expect(termsDigest({ chainId: 5042, escrow: rand.address() }, terms)).not.toBe(onChain);
  });
});

async function chainNow(): Promise<bigint> {
  return (await fx.publicClient.getBlock()).timestamp;
}

async function mintAndApprove(buyer: Fixture['accounts']['buyer'], amount: bigint) {
  const w = fx.wallet(buyer);
  await fx.publicClient.waitForTransactionReceipt({
    hash: await w.writeContract({ address: fx.usdc, abi: mockUsdcAbi, functionName: 'mint', args: [buyer.address, amount] }),
  });
  await fx.publicClient.waitForTransactionReceipt({
    hash: await w.writeContract({ address: fx.usdc, abi: mockUsdcAbi, functionName: 'approve', args: [fx.escrow, amount] }),
  });
}

describe('signatures from viem are accepted by the contract', () => {
  it('funds a deal with signed terms, then releases it with a relayed buyer signature', async () => {
    const { seller, plug, buyer, stranger } = fx.accounts;
    const terms: Terms = {
      seller: seller.address,
      plug: plug.address,
      orderId: rand.bytes32(),
      price: parseUnits('20', 6),
      plugFee: parseUnits('1', 6),
      windowSeconds: 3 * 24 * 60 * 60,
      expiry: (await chainNow()) + 3600n,
      metadataHash: rand.bytes32(),
    };
    expect(validateTerms(terms, { now: await chainNow(), plugLevel: 3, buyer: buyer.address, refundTo: buyer.address })).toEqual([]);

    const sellerSig = await fx.wallet(seller).signTypedData(termsTypedData(domain, terms));
    const plugSig = await fx.wallet(plug).signTypedData(acceptTypedData(domain, terms));
    const escrowed = escrowedAmount(terms.price, terms.plugFee);
    await mintAndApprove(buyer, escrowed);

    const { request, result: dealId } = await fx.publicClient.simulateContract({
      account: buyer,
      address: fx.escrow,
      abi: dealEscrowAbi,
      functionName: 'pay',
      args: [terms, sellerSig, plugSig, buyer.address],
      ...(await feeOverrides(fx.publicClient)),
    });
    expect(dealId).toBe(dealIdOf(seller.address, terms.orderId));
    const receipt = await fx.publicClient.waitForTransactionReceipt({ hash: await fx.wallet(buyer).writeContract(request) });
    expect(receipt.status).toBe('success');

    const deal = await fx.publicClient.readContract({ address: fx.escrow, abi: dealEscrowAbi, functionName: 'getDeal', args: [dealId] });
    expect(deal.status).toBe(DealStatus.Held);
    expect(deal.buyer).toBe(buyer.address);
    expect(deal.price).toBe(terms.price);
    expect(await fx.publicClient.readContract({ address: fx.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [fx.escrow] })).toBe(escrowed);

    // Buyer signs an early release; a stranger relays it.
    const nonce = await fx.publicClient.readContract({ address: fx.escrow, abi: dealEscrowAbi, functionName: 'releaseNonce', args: [buyer.address] });
    const deadline = BigInt(deal.releaseAt);
    const buyerSig = await fx.wallet(buyer).signTypedData(
      releaseTypedData(domain, { dealId, buyer: buyer.address, amount: escrowed, nonce, deadline }),
    );
    const relay = await fx.wallet(stranger).writeContract({
      address: fx.escrow,
      abi: dealEscrowAbi,
      functionName: 'releaseWithSig',
      args: [dealId, deadline, buyerSig],
      ...(await feeOverrides(fx.publicClient)),
    });
    expect((await fx.publicClient.waitForTransactionReceipt({ hash: relay })).status).toBe('success');
    const after = await fx.publicClient.readContract({ address: fx.escrow, abi: dealEscrowAbi, functionName: 'getDeal', args: [dealId] });
    expect(after.status).toBe(DealStatus.Released);
  });

  it('rejects a seller signature over different terms', async () => {
    const { seller, plug, buyer } = fx.accounts;
    const terms: Terms = {
      seller: seller.address,
      plug: plug.address,
      orderId: rand.bytes32(),
      price: parseUnits('10', 6),
      plugFee: 0n,
      windowSeconds: 0,
      expiry: (await chainNow()) + 3600n,
      metadataHash: ZERO32,
    };
    const sellerSig = await fx.wallet(seller).signTypedData(termsTypedData(domain, terms));
    const tampered = { ...terms, price: parseUnits('11', 6) };
    const plugSig = await fx.wallet(plug).signTypedData(acceptTypedData(domain, tampered));
    await expect(
      fx.publicClient.simulateContract({
        account: buyer,
        address: fx.escrow,
        abi: dealEscrowAbi,
        functionName: 'pay',
        args: [tampered, sellerSig, plugSig, buyer.address],
      }),
    ).rejects.toThrow(/InvalidSellerSignature/);
  });
});

/** Runs pay in simulation with dummy signatures. Terms checks run before signature checks. */
async function payRevertName(terms: Terms, buyer: Address, refundTo: Address): Promise<string | undefined> {
  try {
    await fx.publicClient.simulateContract({
      account: buyer,
      address: fx.escrow,
      abi: dealEscrowAbi,
      functionName: 'pay',
      args: [terms, '0x', '0x', refundTo],
    });
    return undefined;
  } catch (err) {
    if (err instanceof BaseError) {
      const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revert instanceof ContractFunctionRevertedError) return revert.data?.errorName;
    }
    throw err;
  }
}

describe('validateTerms agrees with the contract', () => {
  it('reports the same error the contract reverts with, for one broken rule at a time', async () => {
    const { seller, plug, buyer, stranger } = fx.accounts;
    const now = await chainNow();
    const base: Terms = {
      seller: seller.address,
      plug: plug.address,
      orderId: rand.bytes32(),
      price: parseUnits('20', 6),
      plugFee: parseUnits('1', 6),
      windowSeconds: 86_400,
      expiry: now + 3600n,
      metadataHash: ZERO32,
    };
    const cases: Array<{ name: string; terms: Terms; buyer?: Address; refundTo?: Address; plugLevel?: number }> = [
      { name: 'zero seller', terms: { ...base, seller: '0x0000000000000000000000000000000000000000' } },
      { name: 'plug is seller', terms: { ...base, plug: seller.address } },
      { name: 'plug is buyer', terms: base, buyer: plug.address, refundTo: buyer.address },
      { name: 'refund to seller', terms: base, refundTo: seller.address },
      { name: 'unlisted plug', terms: { ...base, plug: stranger.address }, plugLevel: 0 },
      { name: 'price under 1 USDC', terms: { ...base, price: 999_999n, plugFee: 0n } },
      { name: 'price over level 3 cap', terms: { ...base, price: parseUnits('25', 6) + 1n, plugFee: 0n } },
      { name: 'fee over 5%', terms: { ...base, plugFee: parseUnits('1', 6) + 2n } },
      { name: 'odd fee', terms: { ...base, plugFee: 999_999n } },
      { name: 'window over 14 days', terms: { ...base, windowSeconds: 14 * 86_400 + 1 } },
      { name: 'expired terms', terms: { ...base, expiry: now - 10n } },
      { name: 'terms open too long', terms: { ...base, expiry: now + 31n * 86_400n } },
    ];
    for (const c of cases) {
      const b = c.buyer ?? buyer.address;
      const r = c.refundTo ?? b;
      const violations = validateTerms(c.terms, { now, plugLevel: c.plugLevel ?? 3, buyer: b, refundTo: r });
      const onChain = await payRevertName(c.terms, b, r);
      expect({ name: c.name, error: violations.map((v) => v.error) }).toEqual({ name: c.name, error: [onChain] });
    }
    // And valid terms get past every terms check (failing only on the dummy signature).
    expect(validateTerms(base, { now, plugLevel: 3, buyer: buyer.address, refundTo: buyer.address })).toEqual([]);
    expect(await payRevertName(base, buyer.address, buyer.address)).toBe('InvalidSellerSignature');
  });
});
