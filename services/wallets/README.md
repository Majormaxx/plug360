# Wallets service

Server-side bridge to Circle's user-controlled wallets, so people can use Plug360 by signing in with Google or email instead of installing a wallet app.

Each person gets their own smart contract wallet on Arc. Plug360's server holds the Circle API key, but it can't move anyone's funds: every signature and transaction it requests comes back as a challenge, and the person approves it in Circle's window in their browser.

## Operations

The HTTP contract lives in `src/contract.ts`. The web app mounts it at `POST /api/wallets/<op>`. Operations marked "user" need the `X-User-Token` header that Circle's web SDK returns after sign-in.

| Op | User | What it does |
|---|---|---|
| `social-token` | no | Device token for Google sign-in |
| `email-token` | no | Device token plus a one-time code sent by email |
| `init` | yes | Creates the person's Arc wallet on first sign-in (a challenge). Returns nothing if they already have one |
| `wallets` | yes | Lists the person's wallets on the configured Arc network |
| `sign-typed-data` | yes | EIP-712 signing challenge |
| `contract-call` | yes | Contract call from raw calldata, tagged with a `refId` |
| `transaction` | yes | Finds the transaction for a `refId` and returns its state and hash |

## Smart wallet notes

- A smart wallet only becomes a contract on its first transaction. Until then the escrow can't verify its signatures, so the app activates new wallets with a zero-value USDC approval.
- Arc's one-transaction pay path needs a plain key (it checks `tx.origin`), so smart wallets pay in two steps: approve, then pay.

## Running

```sh
pnpm --filter @plug360/wallets test         # unit tests against a fake Circle client
pnpm --filter @plug360/wallets build
CIRCLE_API_KEY=... node services/wallets/scripts/live-check.mjs   # real Circle API, signs nothing
```

The web app needs `CIRCLE_API_KEY` (server), `NEXT_PUBLIC_CIRCLE_APP_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Set `NEXT_PUBLIC_CIRCLE_EMAIL_LOGIN=true` once SMTP is configured in Circle's console.
