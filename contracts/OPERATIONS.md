# Operating DealEscrow

How to deploy, run and respond to incidents for a DealEscrow deployment that holds real USDC. Read `SECURITY.md` first for the trust model.

## Keys

Four roles, four separate keys. Never reuse one key for two roles, and never reuse testnet keys on mainnet.

| Role | Holds | Used for | Storage |
|---|---|---|---|
| Owner | `owner()` of the contract | Listing plugs, pause and unpause, sweeping stray USDC, ownership transfer | Mainnet: a 2-of-3 Safe, or a hardware wallet until the Safe exists. Testnet: a generated key |
| Deployer | A few USDC for gas | The deploy transaction only; no rights after deploy | Hot key, emptied after deploy |
| Keeper | A few USDC for gas | `finalizeExpiredDispute` and `retryPayout`, both permissionless | Hot key on the keeper host; no contract rights, so a leak costs only its gas balance |
| Proof wallets (seller, plug, buyer) | Small USDC balances | The proof deals | Team wallets |

Arc testnet blocklists the well-known Foundry and Hardhat test accounts (the `test test ... junk` mnemonic). Always generate fresh keys: `cast wallet new`.

Keys live in an env file outside the repo, for example `~/plug360-internal/testnet.env` (mode 600):

```
DEPLOYER_KEY=  OWNER_KEY=  KEEPER_KEY=  SELLER_KEY=  PLUG_KEY=  BUYER_KEY=
DEPLOYER_ADDR= OWNER_ADDR= KEEPER_ADDR= SELLER_ADDR= PLUG_ADDR= BUYER_ADDR=
RPC_URL=https://rpc.testnet.arc.io
CHAIN=5042002
```

On mainnet, leave `OWNER_KEY` out when the owner is a Safe; owner actions then go through the Safe (see "Owner actions").

## Deploying

Arc runs Osaka with its own precompiles, so scripts run under Arc Foundry (`arc-forge`, `arc-cast`, `arc-anvil` in `~/.local/bin`). Every transaction sets a gas price of at least 25 gwei; Arc drops anything under 20 gwei.

1. Gate: `make test`, `make test-arc`, `make slither`, `make mutate` all green.
2. Rehearse on a fork of the target network: `make rehearse`. It deploys, lists a plug and runs every money path against a local fork with real Arc behavior, then checks the escrow ends at zero.
3. Fund the wallets. A full mainnet run fits in about 2 USDC, because only gas is consumed: the whole deploy and proof sequence uses about 6.2 million gas (about 0.13 USDC at Arc's 20 gwei base fee), and the proof deals recycle one deal's worth of USDC between your own wallets (measured on testnet with a buyer holding 1.15 USDC). Send everything to the deployer, then `FUND_OWNER=0.05 FUND_PLUG=0.05 FUND_SELLER=0.15 FUND_KEEPER=0.3 FUND_BUYER=1.2 script/fund-roles.sh <env-file>`.
   Testnet: faucet.circle.com. Mainnet: withdraw USDC on the Arc network from an exchange that supports it.
4. Deploy: `make deploy NETWORK=testnet` (mainnet: `make deploy NETWORK=mainnet CONFIRM=mainnet`). This writes `deployments/<chainId>.json` with the address, owner and deploy block. Commit that file.
5. Verify the source on Sourcify: `make verify NETWORK=...`. The mainnet explorer API sits behind a Cloudflare challenge, so Sourcify is the verification route.
6. List the first plug: `make list-plug NETWORK=... PLUG=0x... LEVEL=1`.
7. Mainnet only: canary first. The proof run starts with a 1 USDC deal and a refund; stop if anything looks wrong.
8. Run the proofs: `make proofs NETWORK=...`, then `make proof-table NETWORK=...` and paste the table into the README.
9. Start the keeper with the escrow address and deploy block (see `services/keeper`).
10. Publish the contract address in the README and every announcement, so users can check they are on the real contract.

## Owner actions

With an EOA owner, `make list-plug` and the `script/Admin.s.sol` functions broadcast directly. With a Safe owner, run the same script without `--broadcast`; it prints the target and calldata to paste into the Safe transaction builder:

```sh
ESCROW=<address> arc-forge script script/Admin.s.sol --sig "setPlugLevel(address,uint8)" <plug> 1 --rpc-url arc_mainnet --network arc
ESCROW=<address> arc-forge script script/Admin.s.sol --sig "pause()" --rpc-url arc_mainnet --network arc
```

Every owner action emits an event (`PlugLevelSet`, `Paused`, `Unpaused`, `OwnershipTransferStarted`, `ExcessSwept`). The keeper alerts on each one, so an owner action nobody planned is visible within one keeper tick.

## Daily checks

| Check | How | Healthy |
|---|---|---|
| Solvency | USDC balance of the escrow vs `totalHeld()` | balance >= totalHeld (the keeper alerts otherwise) |
| Keeper running | Its last log line and the cursor block in its state file | Within the last tick interval |
| Keeper gas | USDC balance of the keeper address | Above the alert threshold |
| Open disputes | Keeper alerts for disputes with under 24 hours left | Plugs ruling well before day 7 |
| Parked payouts | `PayoutDeferred` alerts and `pendingPayouts(id)` | Zero, or explained by a blocklisted address |

## Alerts

| Alert | Meaning | Action |
|---|---|---|
| Solvency breach | The escrow holds less USDC than it owes | Treat as critical. Pause new deals, then investigate. Exits stay open while paused |
| Owner action | An owner event was seen | Confirm it was planned; if not, treat the owner key as compromised |
| Payout deferred | A payout leg failed, usually a USDC-blocklisted address | Nothing to do. The keeper retries with backoff; the leg pays when the address is unblocked, and it can only ever go to the original address |
| Dispute deadline near | A plug has under 24 hours to rule | Remind the plug. If they miss it, the keeper refunds the buyer in full |
| Keeper gas low | The keeper may stop sending transactions | Top up the keeper address |

## Incidents

Pausing blocks new deals only. It never stops a refund, release, ruling, withdrawal or retry, so pausing is always safe.

| Situation | Response |
|---|---|
| A bug that could lose funds | Pause immediately. Tell users in the deal room and on social channels. Help every open deal exit: buyers and sellers can call the exits themselves (commands in `SECURITY.md`), and anyone can withdraw released deals or finalize expired disputes. The contract is immutable; fix forward by deploying a new contract and pointing the app at it. Never ask users to send funds anywhere |
| A plug rules dishonestly | Set the plug's level to 0. That blocks new deals; existing deals keep their plug, by design. Publish the ruling history |
| Owner key lost or compromised | The owner cannot move deal funds. Pause if possible, transfer ownership to a fresh Safe, and alert on any `PlugLevelSet` you did not make. A compromised owner could list a colluding plug for new deals, so warn users to check the plug before paying |
| Keeper down | Nothing is at risk. Exits are permissionless; anyone can run `finalizeExpiredDispute` or `retryPayout`. Restart the keeper; it resumes from its cursor |
| RPC outage or rate limit | The public endpoints rate-limit heavy use (HTTP 429, error -32005). Point the app and keeper at a fallback: `rpc.drpc.testnet.arc.io` or `rpc.blockdaemon.testnet.arc.io` on testnet, `rpc.drpc.mainnet.arc.io`, `rpc.blockdaemon.mainnet.arc.io` or a keyed Alchemy or QuickNode URL on mainnet. The keeper retries -32005 and switches to `RPC_FALLBACK_URL` on its own. Users can still exit through any working RPC |
| Phishing site | Announce the one real domain and contract address. The contract only pays addresses fixed at funding, so a fake site cannot redirect existing deals |

## Limits to watch

- 2,500 USDC is the most the contract can owe at once. New payments revert with `HeldCapExceeded` near the cap; that is the design, not an outage.
- 100 USDC per deal, and lower per plug level.
- Raising either limit means a new deployment after an external audit.
