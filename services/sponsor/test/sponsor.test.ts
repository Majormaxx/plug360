import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptTypedData,
  arcMainnet,
  dealEscrowAbi,
  dealIdOf,
  DealStatus,
  escrowedAmount,
  termsTypedData,
  type Terms,
} from '@plug360/shared';
import { anvilAccount, anvilPrivateKey, deployFixture, loadArtifact, mockUsdcAbi, roles, startAnvil, type Anvil, type Fixture } from '@plug360/testkit';
import {
  bytesToHex,
  createWalletClient,
  encodeFunctionData,
  http,
  parseUnits,
  serializeErc6492Signature,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createSponsor, SponsorError, type TermsWire } from '../src/index.js';

let anvil: Anvil;
let fx: Fixture;
let factory: Address;
const chain = { ...arcMainnet, id: 5042 } as Chain;
const factoryArtifact = loadArtifact('SmartWalletFactory');

beforeAll(async () => {
  anvil = await startAnvil({ chainId: 5042 });
  fx = await deployFixture(anvil.rpcUrl, chain, [[anvilAccount(roles.plug).address, 5]]);
  const owner = fx.wallet(fx.accounts.owner);
  const hash = await owner.deployContract({ abi: factoryArtifact.abi, bytecode: factoryArtifact.bytecode });
  factory = (await fx.publicClient.waitForTransactionReceipt({ hash })).contractAddress!;
});
afterAll(async () => anvil?.stop());

function sponsor() {
  const account = privateKeyToAccount(anvilPrivateKey(roles.keeper));
  return createSponsor({
    publicClient: fx.publicClient as unknown as PublicClient,
    walletClient: createWalletClient({ chain, transport: http(fx.rpcUrl), account }),
    account,
    chain,
    escrow: fx.escrow,
    maxTopUp: parseUnits('0.05', 18),
  });
}

const wire = (t: Terms): TermsWire => ({ ...t, price: t.price.toString(), plugFee: t.plugFee.toString(), expiry: t.expiry.toString() });

async function counterfactualSeller() {
  const owner = fx.accounts.seller;
  const salt = bytesToHex(randomBytes(32)) as Hex;
  const address = (await fx.publicClient.readContract({ address: factory, abi: factoryArtifact.abi, functionName: 'addressOf', args: [owner.address, salt] })) as Address;
  const deployData = encodeFunctionData({ abi: factoryArtifact.abi, functionName: 'deploy', args: [owner.address, salt] });
  return { owner, address, deployData };
}

async function draft(seller: Address) {
  const now = (await fx.publicClient.getBlock()).timestamp;
  const terms: Terms = {
    seller,
    plug: fx.accounts.plug.address,
    orderId: bytesToHex(randomBytes(32)) as Hex,
    price: parseUnits('10', 6),
    plugFee: parseUnits('0.2', 6),
    windowSeconds: 86_400,
    expiry: now + 3600n,
    metadataHash: bytesToHex(randomBytes(32)) as Hex,
  };
  const plugSig = await fx.wallet(fx.accounts.plug).signTypedData(acceptTypedData({ chainId: 5042, escrow: fx.escrow }, terms));
  return { terms, plugSig };
}

async function tryPay(terms: Terms, sellerSig: Hex, plugSig: Hex) {
  const buyer = fx.wallet(fx.accounts.buyer);
  const amount = escrowedAmount(terms.price, terms.plugFee);
  await fx.publicClient.waitForTransactionReceipt({ hash: await buyer.writeContract({ address: fx.usdc, abi: mockUsdcAbi, functionName: 'mint', args: [fx.accounts.buyer.address, amount] }) });
  await fx.publicClient.waitForTransactionReceipt({ hash: await buyer.writeContract({ address: fx.usdc, abi: mockUsdcAbi, functionName: 'approve', args: [fx.escrow, amount] }) });
  return fx.publicClient.simulateContract({
    account: fx.accounts.buyer,
    address: fx.escrow,
    abi: dealEscrowAbi,
    functionName: 'pay',
    args: [terms, sellerSig, plugSig, fx.accounts.buyer.address],
  });
}

describe('prepare-signer', () => {
  it('deploys a counterfactual seller wallet so the escrow accepts its signature', async () => {
    const w = await counterfactualSeller();
    const { terms, plugSig } = await draft(w.address);
    const inner = await fx.wallet(w.owner).signTypedData(termsTypedData({ chainId: 5042, escrow: fx.escrow }, terms));
    const wrapped = serializeErc6492Signature({ address: factory, data: w.deployData, signature: inner });

    // The problem: before deployment the escrow cannot verify the wallet's signature at all.
    await expect(tryPay(terms, wrapped, plugSig)).rejects.toThrow(/InvalidSellerSignature/);

    const out = await sponsor().run('prepare-signer', { kind: 'terms', terms: wire(terms), signature: wrapped });
    expect(out.deployed).toBe(true);
    expect(out.signature).toBe(inner);
    expect(await fx.publicClient.getCode({ address: w.address })).not.toBe('0x');

    const sim = await tryPay(terms, out.signature, plugSig);
    const hash = await fx.wallet(fx.accounts.buyer).writeContract(sim.request);
    expect((await fx.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
    const deal = await fx.publicClient.readContract({ address: fx.escrow, abi: dealEscrowAbi, functionName: 'getDeal', args: [dealIdOf(w.address, terms.orderId)] });
    expect(deal.status).toBe(DealStatus.Held);
  });

  it('is idempotent: a deployed wallet or a plain key costs nothing', async () => {
    const { terms } = await draft(fx.accounts.seller.address);
    const sig = await fx.wallet(fx.accounts.seller).signTypedData(termsTypedData({ chainId: 5042, escrow: fx.escrow }, terms));
    expect(await sponsor().run('prepare-signer', { kind: 'terms', terms: wire(terms), signature: sig })).toEqual({ signature: sig, deployed: false });
  });

  it('refuses to deploy for a signature over different terms', async () => {
    const w = await counterfactualSeller();
    const { terms } = await draft(w.address);
    const other = { ...terms, price: terms.price + 1n };
    const inner = await fx.wallet(w.owner).signTypedData(termsTypedData({ chainId: 5042, escrow: fx.escrow }, other));
    const wrapped = serializeErc6492Signature({ address: factory, data: w.deployData, signature: inner });
    const err = await sponsor().run('prepare-signer', { kind: 'terms', terms: wire(terms), signature: wrapped }).catch((e) => e);
    expect(err).toBeInstanceOf(SponsorError);
    expect(err.reason).toBe('bad-signature');
    expect(await fx.publicClient.getCode({ address: w.address })).toBeUndefined();
  });

  it('rejects malformed input', async () => {
    await expect(sponsor().run('prepare-signer', { kind: 'terms', terms: {}, signature: '0x' })).rejects.toMatchObject({ status: 400 });
  });
});

describe('gas', () => {
  it('gives a plug with no USDC just enough gas to rule, once', async () => {
    const plug = privateKeyToAccount(generatePrivateKey());
    const owner = fx.wallet(fx.accounts.owner);
    await fx.publicClient.waitForTransactionReceipt({
      hash: await owner.writeContract({ address: fx.escrow, abi: dealEscrowAbi, functionName: 'setPlugLevel', args: [plug.address, 5] }),
    });
    const now = (await fx.publicClient.getBlock()).timestamp;
    const terms: Terms = {
      seller: fx.accounts.seller.address, plug: plug.address, orderId: bytesToHex(randomBytes(32)) as Hex, price: parseUnits('10', 6),
      plugFee: parseUnits('0.2', 6), windowSeconds: 86_400, expiry: now + 3600n, metadataHash: bytesToHex(randomBytes(32)) as Hex,
    };
    const domain = { chainId: 5042, escrow: fx.escrow };
    const sellerSig = await fx.wallet(fx.accounts.seller).signTypedData(termsTypedData(domain, terms));
    const plugSig = await plug.signTypedData(acceptTypedData(domain, terms));
    const sim = await tryPay(terms, sellerSig, plugSig);
    await fx.publicClient.waitForTransactionReceipt({ hash: await fx.wallet(fx.accounts.buyer).writeContract(sim.request) });
    const dealId = dealIdOf(terms.seller, terms.orderId);
    await fx.publicClient.waitForTransactionReceipt({
      hash: await fx.wallet(fx.accounts.buyer).writeContract({ address: fx.escrow, abi: dealEscrowAbi, functionName: 'openDispute', args: [dealId, `0x${'11'.repeat(32)}`] }),
    });

    expect(await fx.publicClient.getBalance({ address: plug.address })).toBe(0n);
    const s = sponsor();
    await expect(s.run('gas', { account: fx.accounts.seller.address, dealId: dealId.toString(), action: 'plugRefund' })).rejects.toMatchObject({ status: 403 });

    const out = await s.run('gas', { account: plug.address, dealId: dealId.toString(), action: 'plugRefund' });
    expect(out.funded).toBe(true);
    expect(BigInt(out.amount)).toBeLessThanOrEqual(parseUnits('0.05', 18));
    expect(await s.run('gas', { account: plug.address, dealId: dealId.toString(), action: 'plugRefund' })).toEqual({ funded: false, amount: '0' });

    // The plug, who never held anything, can now rule.
    const plugWallet = createWalletClient({ chain, transport: http(fx.rpcUrl), account: plug });
    const hash = await plugWallet.writeContract({ address: fx.escrow, abi: dealEscrowAbi, functionName: 'plugRefund', args: [dealId, `0x${'22'.repeat(32)}`] });
    expect((await fx.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
  });
});
