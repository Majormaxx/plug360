#!/usr/bin/env node
// Drives the real UI against Arc testnet with three test wallets: the seller creates and signs a deal,
// the plug accepts, the buyer pays in one step, then the seller refunds. Every transaction is real.
//
// Usage: node scripts/e2e-testnet.mjs <env-file> [base-url]
//   env-file holds SELLER_KEY, PLUG_KEY, BUYER_KEY (testnet keys only; never mainnet).
//   base-url defaults to http://localhost:3360 (run `pnpm build && pnpm start -p 3360` first).
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createPublicClient, createWalletClient, http, parseGwei } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const envFile = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3360';
if (!envFile) throw new Error('usage: e2e-testnet.mjs <env-file> [base-url]');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error('e2e only runs against a local server');

const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (env.CHAIN !== '5042002') throw new Error('refusing to run: env file is not for Arc testnet');

const RPC = 'https://rpc.drpc.testnet.arc.io';
const chain = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const publicClient = createPublicClient({ chain, transport: http(RPC, { retryCount: 4 }) });
const shots = new URL('../test-results/e2e/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);

/** A browser context whose injected wallet signs with `key`. Requests other than signing go to the RPC. */
async function walletContext(browser, key, name, viewport) {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain, transport: http(RPC, { retryCount: 4 }) });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: viewport.width < 600 });
  const sent = [];
  await ctx.exposeBinding('__testWallet', async (_src, method, paramsJson) => {
    const params = paramsJson ? JSON.parse(paramsJson) : [];
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [account.address];
      case 'eth_chainId':
        return `0x${chain.id.toString(16)}`;
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
        return null;
      case 'eth_signTypedData_v4': {
        const typed = JSON.parse(params[1]);
        delete typed.types.EIP712Domain;
        return account.signTypedData(typed);
      }
      case 'personal_sign':
        return account.signMessage({ message: { raw: params[0] } });
      case 'eth_sendTransaction': {
        const tx = params[0];
        const hash = await wallet.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value ? BigInt(tx.value) : 0n,
          ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
          maxFeePerGas: tx.maxFeePerGas ? BigInt(tx.maxFeePerGas) : parseGwei('25'),
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? BigInt(tx.maxPriorityFeePerGas) : parseGwei('1'),
        });
        sent.push(hash);
        log(`${name} sent ${hash}`);
        return hash;
      }
      default:
        return publicClient.request({ method, params });
    }
  });
  await ctx.addInitScript(({ walletName }) => {
    const listeners = {};
    const provider = {
      isMetaMask: false,
      request: async ({ method, params }) => {
        const res = await window.__testWallet(method, params ? JSON.stringify(params) : '');
        return res;
      },
      on: (ev, fn) => ((listeners[ev] ||= []).push(fn), provider),
      removeListener: (ev, fn) => ((listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn)), provider),
    };
    const info = {
      uuid: '7d5b5a7e-0000-4000-8000-000000000360',
      name: walletName,
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Ccircle cx="16" cy="16" r="16" fill="%2317141F"/%3E%3C/svg%3E',
      rdns: 'net.plug360.testwallet',
    };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
    window.ethereum = provider;
  }, { walletName: `Test wallet (${name})` });
  const page = await ctx.newPage();
  pages.push([name, page]);
  page.on('console', (m) => m.type() === 'error' && log(`${name} console error: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => log(`${name} page error: ${e.message}`));
  return { ctx, page, account, sent };
}

/** Connects through the app's wallet sheet, unless wagmi already reconnected the injected wallet. */
async function connect(page, name, address) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const mine = page.getByRole('button', { name: short });
  // wagmi may reconnect an already-authorized injected wallet a moment after load.
  if (await mine.waitFor({ timeout: 3_000 }).then(() => true, () => false)) return;
  const either = page.getByRole('button', { name: /^Connect/ }).first();
  await either.click();
  await page.getByRole('button', { name: new RegExp(`Test wallet \\(${name}\\)`) }).click();
  await page.getByRole('button', { name: short }).waitFor();
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const mobile = { width: 390, height: 844 };
const desktop = { width: 1280, height: 900 };
const failures = [];
const pages = [];

try {
  const seller = await walletContext(browser, env.SELLER_KEY, 'seller', mobile);
  const plug = await walletContext(browser, env.PLUG_KEY, 'plug', desktop);
  const buyer = await walletContext(browser, env.BUYER_KEY, 'buyer', mobile);
  const usdcOf = (a) => publicClient.readContract({ address: '0x3600000000000000000000000000000000000000', abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [a] });
  const buyerBefore = await usdcOf(buyer.account.address);

  // 1. Seller drafts the deal.
  log('seller drafts');
  await seller.page.goto(`${base}/new`);
  await connect(seller.page, 'seller', seller.account.address);
  await seller.page.getByLabel("What's the job?").fill(`E2E ${new Date().toISOString().slice(0, 16)}`);
  await seller.page.getByLabel('Details').fill('Automated end-to-end run against Arc testnet.');
  await seller.page.getByLabel('Price').fill('2');
  await seller.page.getByLabel('Your plug').fill(plug.account.address);
  await seller.page.getByText(/Level 1 plug/).waitFor();
  await seller.page.getByRole('radio', { name: '1 day' }).first().click();
  await seller.page.screenshot({ path: `${shots}01-new-mobile.png`, fullPage: true });
  await seller.page.getByRole('button', { name: 'Create deal link' }).click();
  await seller.page.waitForURL(/\/deal#/);

  // 2. Seller signs.
  log('seller signs');
  await seller.page.getByRole('button', { name: 'Sign terms' }).click();
  await seller.page.getByText('Signed. Now send it to your plug.').waitFor();
  await seller.page.screenshot({ path: `${shots}02-signed-mobile.png`, fullPage: true });
  const afterSeller = seller.page.url();

  // 3. Plug accepts.
  log('plug accepts');
  await plug.page.goto(afterSeller);
  await connect(plug.page, 'plug', plug.account.address);
  await plug.page.getByRole('button', { name: 'Accept', exact: true }).click();
  await plug.page.getByText('Accepted. Send it to the buyer.').waitFor();
  await plug.page.screenshot({ path: `${shots}03-accepted-desktop.png`, fullPage: true });
  const afterPlug = plug.page.url();

  // 4. Buyer pays in one step (Multicall3From + Memo).
  log('buyer pays');
  await buyer.page.goto(afterPlug);
  await connect(buyer.page, 'buyer', buyer.account.address);
  await buyer.page.getByRole('radio', { name: 'One step' }).waitFor();
  await buyer.page.screenshot({ path: `${shots}04-pay-mobile.png`, fullPage: true });
  await buyer.page.getByRole('button', { name: /^Pay 2\.02 USDC$/ }).click();
  await buyer.page.waitForURL(/\/r\/0x[0-9a-f]{64}/, { timeout: 120_000 });
  await buyer.page.getByText('Window open').first().waitFor({ timeout: 30_000 });
  await buyer.page.screenshot({ path: `${shots}05-receipt-buyer-mobile.png`, fullPage: true });
  const receipt = buyer.page.url();
  const buyerPaid = await usdcOf(buyer.account.address);
  log(`buyer balance ${buyerBefore} -> ${buyerPaid}`);

  // 5. Seller refunds from the receipt.
  log('seller refunds');
  await seller.page.goto(receipt);
  await seller.page.getByRole('button', { name: 'Refund the buyer' }).click();
  await seller.page.getByRole('dialog').getByRole('button', { name: 'Refund the buyer' }).click();
  await seller.page.getByText('Refunded', { exact: true }).first().waitFor({ timeout: 120_000 });
  await seller.page.screenshot({ path: `${shots}06-refunded-mobile.png`, fullPage: true });
  const buyerAfter = await usdcOf(buyer.account.address);
  log(`buyer balance after refund ${buyerAfter}`);

  // Checks against the chain, not the UI.
  if (buyerBefore - buyerPaid < 2_020_000n) failures.push(`buyer paid ${buyerBefore - buyerPaid}, expected >= 2020000 (incl. gas)`);
  if (buyerPaid + 2_020_000n !== buyerAfter) failures.push(`refund mismatch: ${buyerPaid} + 2020000 != ${buyerAfter}`);
  for (const h of [...buyer.sent, ...seller.sent]) {
    const r = await publicClient.getTransactionReceipt({ hash: h });
    if (r.status !== 'success') failures.push(`tx ${h} status ${r.status}`);
  }
  log(`receipt ${receipt}`);
  log(`txs: ${[...buyer.sent, ...seller.sent].join(' ')}`);
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
  for (const [name, page] of pages) await page.screenshot({ path: `${shots}fail-${name}.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('E2E FAILED\n - ' + failures.join('\n - '));
  process.exit(1);
}
log('E2E PASSED: draft, sign, accept, one-step pay, refund all confirmed on Arc testnet');
