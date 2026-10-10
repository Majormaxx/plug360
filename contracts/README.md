# DealEscrow contracts

Foundry project for `DealEscrow`, the USDC escrow behind Plug360 on Arc. A buyer funds a deal, a plug both sides trust can settle a dispute only by refunding the buyer's fixed address or releasing to the seller, and a plug who stays silent for 7 days forfeits the choice to an automatic refund.

Unaudited. Capped at 100 USDC per deal and 2,500 USDC owed in total.

| Document | For |
|---|---|
| [SECURITY.md](SECURITY.md) | Trust model, payout table, test evidence, Slither triage, known limitations, exiting a deal from the command line |
| [OPERATIONS.md](OPERATIONS.md) | Keys, deployment, owner actions, monitoring, incident playbooks |

## Layout

| Path | What it holds |
|---|---|
| `src/DealEscrow.sol` | The contract |
| `src/interfaces/` | `IDealEscrowTypes` (states, structs, events, errors), `IDealEscrowAdmin` (owner controls, limits, EIP-712 hashing), `IDealEscrow` (deal lifecycle) |
| `test/unit/` | Unit and fuzz tests on the standard EVM |
| `test/invariant/` | Invariant handler and suite: random sequences across all actions, 10 money and state rules checked after every call |
| `test/arc/` | Arc behavior against the real USDC, Memo and Multicall3From contracts on an Arc testnet fork |
| `test/mocks/` | Blocklist-capable USDC mock, ERC-1271 wallet, reentrant and fee-on-transfer tokens |
| `script/Deploy.s.sol` | Deploys and writes `deployments/<chainId>.json` |
| `script/Admin.s.sol` | Owner actions; prints Safe calldata when the owner is a Safe |
| `script/Proofs.s.sol` | Runs every money path once with real transactions |
| `script/rehearse-fork.sh` | Deploy, list and proofs against a local fork of Arc testnet |
| `script/mutate.py` | Mutation check: 24 deliberate bugs the suite must catch |
| `deployments/` | Addresses and deploy blocks per chain |

## Requirements

- [Foundry](https://getfoundry.sh/) 1.7+ for build and unit tests
- [Arc Foundry](https://github.com/circlefin/arc-foundry) (`arc-forge`, `arc-cast`, `arc-anvil`) for anything that touches Arc: fork tests, scripts, deployment
- Slither for `make slither`

## Commands

```sh
git submodule update --init --recursive
make build             # compile, print sizes
make test              # unit, fuzz and invariant tests
make test-arc          # Arc fork tests (needs network)
make coverage          # 100% lines, statements, branches, functions on DealEscrow
make slither           # fails on any medium or high finding
make mutate            # every deliberate bug must be caught
make invariant-stats   # how often each action ran across the invariant campaign
make rehearse          # full deploy and proof run on a local Arc testnet fork
make hooks             # install the commit and push gates
```

Deployment targets (`deploy`, `verify`, `list-plug`, `proofs`, `proof-table`) read keys from an env file outside the repo; see [OPERATIONS.md](OPERATIONS.md).

## Local gates

`make hooks` links `scripts/hooks/pre-commit` (format and build) and `scripts/hooks/pre-push` (all tests, Slither, Arc fork tests) into git. They stand in for hosted CI and write the last run to `cache/last-push-gate.log`. The GitHub Actions workflow in `.github/workflows/contracts.yml` runs the same checks when Actions is available.

## Arc notes

- Compiled for `evm_version = "osaka"`, Arc's EVM baseline.
- USDC is read only through its 6-decimal ERC-20 interface at `0x3600000000000000000000000000000000000000`; native (18-decimal) balances are never used.
- A USDC transfer to or from a blocklisted address fails inside the contract without moving funds, so one blocked payout leg is parked and retried later while the other legs pay.
- One-click payment works for wallets that send their own transactions: Multicall3From batches the approval with a Memo-tagged `pay`, and the escrow still sees the buyer as the payer. Relayed and smart-wallet transactions cannot use Memo and send the plain calls instead.
- Arc drops transactions priced under 20 gwei; every script sets 25 gwei.
