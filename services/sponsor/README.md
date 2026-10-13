# Gas sponsor

Pays network fees so nobody in a deal gets stuck for lack of USDC. It runs inside the web app's server (`POST /api/sponsor/<op>`) with its own hot wallet, which only ever holds gas money.

## What it pays for

| Op | When the app calls it | What the sponsor checks before spending |
|---|---|---|
| `prepare-signer` | Paying a deal whose seller or plug signed from a smart wallet that has not made its first transaction (an ERC-6492 signature) | The wallet has no code yet, the terms have not expired, and the signature is valid for exactly these terms on this escrow. Then it deploys the wallet through the factory named in the signature and returns the plain signature for `pay` |
| `gas` | A plain-key wallet must act (open a dispute, release, refund, rule) and holds too little for the fee | The deal exists and the escrow would accept this call from this account right now (`src/policy.ts` mirrors the contract's guards). It sends 150% of the estimated fee minus the current balance, capped at `SPONSOR_MAX_TOPUP_USDC` (default 0.05) |

Both operations are idempotent against chain state: a deployed wallet or a wallet that can already pay costs nothing. Calls anyone can make (payouts, expired disputes, retries) are the keeper's job, so the sponsor never pays for them.

Circle smart wallets are covered by Circle's Gas Station instead, so the app does not ask the sponsor for them.

## Running and testing

```sh
pnpm --filter @plug360/sponsor test   # policy unit tests + anvil integration with the real DealEscrow
```

The integration test deploys DealEscrow and a counterfactual wallet factory on anvil. It shows that the escrow rejects an undeployed wallet's signature, that the sponsor deploys the wallet and payment then succeeds, that a signature over different terms deploys nothing, and that a plug with zero balance gets just enough gas to rule.

`apps/web/scripts/e2e-testnet.mjs` repeats the smart-wallet seller and empty-plug flows through the real UI on Arc testnet.

Server env: `SPONSOR_PRIVATE_KEY` (required to enable), `SPONSOR_MAX_TOPUP_USDC` (optional).
