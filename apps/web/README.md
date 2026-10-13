# Plug360 web app

The deal room for `DealEscrow`. Next.js 16 (App Router), TypeScript, Tailwind CSS v4, wagmi and viem, TanStack Query for chain reads, and Motion for the few animations.

## How a deal moves through the app

| Route | Who uses it | What happens |
|---|---|---|
| `/new` | Seller or buyer | Fill in the job, price, plug, fee and money-back window. The form checks every rule the contract enforces (plug level, fee cap, even fee, window and expiry limits) before a link is made. |
| `/deal#…` | All three | The terms, the seller's signature and the plug's acceptance travel in the URL fragment, which browsers never send to a server. Signatures are verified against the chain (plain keys and ERC-1271 wallets) before Pay is enabled. |
| `/r/<dealId>` | All three | The receipt: status, countdowns, and only the actions the connected wallet can take right now (release, dispute, refund, plug ruling, payout, expired-dispute refund, payout retry). Every write is simulated before the wallet opens. |
| `/me` | Anyone connected | Every deal the wallet is in, found by scanning `DealFunded` events from the deploy block. The scan shrinks its block range when an RPC refuses it and caches its progress in the browser. |
| `/add-usdc` | Buyers | Faucet steps on testnet, exchange withdrawal steps on mainnet. |

Paying uses one wallet prompt through Arc's Multicall3From and Memo contracts (approve and pay, tagged with the order) when the wallet sends from its own key. Contract wallets pay in two steps. If a receipt doesn't arrive in time, the app shows "sent, not confirmed" and checks the deal on-chain before letting anyone pay again. A second payment can't succeed anyway, because each order id is single-use.

## Layout

```
src/app/         routes, layout, error boundaries
src/components/  ui/ primitives, deal/ flows, wallet/, layout/, landing/
src/hooks/       useTx (simulate, sign, confirm, recover), chain reads, deals scan
src/lib/         pure logic: draft codec, deal state machine, error copy, scanner, calldata
test/            vitest for everything in src/lib
scripts/         smoke.mjs (every route, both themes, two widths), e2e-testnet.mjs (real transactions)
```

## Running it

```sh
pnpm install
pnpm --filter @plug360/web dev          # http://localhost:3000
pnpm --filter @plug360/web test         # unit tests
pnpm --filter @plug360/web build && pnpm --filter @plug360/web start -p 3360
node apps/web/scripts/smoke.mjs         # needs the server on :3360 and Google Chrome
node apps/web/scripts/e2e-testnet.mjs ~/path/to/testnet.env   # spends a few cents of testnet gas
```

The end-to-end script drives the real UI with three injected test wallets: the seller drafts and signs, the plug accepts, the buyer pays in one step, and the seller refunds. It then checks balances and receipts on Arc testnet. It refuses any env file that isn't for chain 5042002 and any server that isn't local.

## Configuration

Copy `.env.example` to `.env.local` to override anything. With no env set, the app uses Arc testnet and the deployment in `contracts/deployments/5042002.json`. For mainnet, set `NEXT_PUBLIC_CHAIN_ID=5042` and `NEXT_PUBLIC_ESCROW`.
