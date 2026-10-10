# @plug360/keeper

The always-on piece of Plug360. It watches one DealEscrow and calls the functions anyone may call. It never needs owner rights; the key only pays gas.

## What a tick does

1. Index. Reads escrow events from the saved cursor up to the chain head in ranges of at most 9,999 blocks (Arc rejects more than 10,000). Every deal touched by an event is re-read with `getDeal`, which stays the source of truth. The cursor and the deal set are saved after each range.
2. Expired disputes. For each Disputed deal where `now >= disputedAt + 7 days` (chain time), calls `finalizeExpiredDispute`.
3. Parked payouts. For each deal with `payoutPending`, asks USDC (an `eth_call` of `transfer` from the escrow) whether any parked leg would now go through. If none would, nothing is sent. Otherwise it calls `retryPayout`. While a deal stays pending, the next attempt waits `RETRY_BACKOFF_SECONDS`, doubling per attempt up to 24 hours.
4. Monitors, each sent as an alert:
   - `insolvent` (critical): `USDC.balanceOf(escrow) < totalHeld()`, both read at the head block. `solvency-restored` when it recovers.
   - `owner-action`: `PlugLevelSet`, `Paused`, `Unpaused`, `OwnershipTransferStarted`, `OwnershipTransferred`, `ExcessSwept`.
   - `payout-deferred`: every `PayoutDeferred` event.
   - `dispute-deadline-near`: a dispute with less than `DEADLINE_WARNING_SECONDS` before the plug's deadline, once per dispute.
   - `low-gas`: the keeper's native balance below `MIN_GAS_BALANCE_USDC`. `gas-restored` when it recovers.
   - `tick-failed`: the tick stopped on an error.

   Insolvency and low gas alert when the condition starts and when it ends, not on every tick.
5. Logs one JSON line per action and per tick (`job`, `dealId`, `tx`, `outcome`, ...).

## Sending transactions

Every transaction is simulated first and carries the Arc fee rule (`maxFeePerGas = max(2 x baseFee, 25 gwei)`, priority 1 gwei). It is signed locally with an explicit nonce and written to the state file before it is broadcast. With no receipt after `RECEIPT_TIMEOUT_SECONDS` the outcome is `unknown`, and nothing else is sent in that tick. On the next tick the keeper looks for a receipt of every hash sent for that nonce, re-reads the deal, and rebroadcasts only if the action is still needed. A rebroadcast reuses the nonce with fees raised by 12.5%, so at most one attempt can be mined. If the deal no longer needs the action the record is dropped.

## RPC handling

Transient errors (Arc's `-32014` near the chain head, `-32005`, HTTP failures and timeouts) are retried with exponential backoff. After two failures in a row on one endpoint the keeper switches to the other (when `RPC_FALLBACK_URL` is set) for the rest of the tick. Other errors are not retried. The keeper refuses to run if the RPC reports a chain id other than `CHAIN_ID`, or if the state file was written for another escrow or chain.

## Configuration

Copy `.env.example` to `.env` and fill it in. Never commit `.env`.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `RPC_URL` | yes | | Primary RPC |
| `RPC_FALLBACK_URL` | no | | Second RPC, used after two failures in a row |
| `CHAIN_ID` | yes | | 5042 (Arc mainnet) or 5042002 (Arc testnet) |
| `ESCROW_ADDRESS` | yes | | DealEscrow address |
| `DEPLOY_BLOCK` | yes | | First block to scan on a fresh state file |
| `KEEPER_PRIVATE_KEY` | yes | | Gas-paying key, no owner rights needed |
| `ALERT_WEBHOOK_URL` | no | | Receives each alert as a JSON POST |
| `STATE_FILE` | no | `.keeper-state.json` | Cursor, tracked deals, unconfirmed transactions |
| `POLL_INTERVAL_SECONDS` | no | 60 | Pause between ticks in loop mode |
| `RETRY_BACKOFF_SECONDS` | no | 3600 | First wait between `retryPayout` attempts for one deal |
| `MIN_GAS_BALANCE_USDC` | no | 1 | Low-gas alert threshold |
| `RECEIPT_TIMEOUT_SECONDS` | no | 30 | Wait for a receipt before calling the outcome unknown |
| `DEADLINE_WARNING_SECONDS` | no | 86400 | How early to warn about a plug deadline |

The webhook body is `{ source, chainId, escrow, at, severity, kind, message, dealId?, data? }`. A failed delivery is logged and the tick continues.

## Commands

```sh
pnpm --filter @plug360/keeper... build
set -a; . services/keeper/.env; set +a
node services/keeper/dist/cli.js run --once   # one tick; exit 1 if it failed, 2 on bad config
node services/keeper/dist/cli.js run          # tick every POLL_INTERVAL_SECONDS until SIGINT/SIGTERM
```

As a library, for a cron handler:

```ts
import { createKeeper, loadConfig } from '@plug360/keeper';

const keeper = createKeeper(loadConfig(process.env));
const report = await keeper.tick(); // never throws; report.ok, report.actions, report.alerts
```

`createKeeper` accepts a custom `store` (any `StateStore` with `load` and `save`) for hosts without a persistent disk. Only one tick runs at a time per keeper instance.

## Tests

```sh
pnpm --filter @plug360/keeper test
```

Requires Foundry on `PATH` or in `~/.foundry/bin`. All tests run against a local anvil with the compiled DealEscrow and MockUSDC from `contracts/out`.

- `test/jobs.test.ts`: dispute expiry refund (and no action before the deadline), parked seller payout paid after unblocking, no gas spent while still blocked plus per-deal backoff, solvency alert on and off, owner-action alerts, low-gas alert, webhook delivery and failure.
- `test/scan.test.ts`: a first tick scanning more than 30,000 blocks through a proxy that enforces Arc's 10,000-block `eth_getLogs` cap, contiguous capped ranges, cursor reuse by a second process, `-32014` retry, fallback switch, RPC down, wrong chain and wrong state file.
- `test/sender.test.ts`: with mining paused, an unknown transaction is replaced at the same nonce with higher fees and exactly one is mined; a dropped transaction is not resent once the deal no longer needs it, and is resent at the same nonce when it still does.
- `test/cli.test.ts`: `main` exit codes, loop mode, tick overlap guard, state file handling, and the built `dist/cli.js run --once`.
- `test/config.test.ts`: environment validation.
