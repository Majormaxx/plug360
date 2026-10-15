# Plug360

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE) [![Network: Arc mainnet](https://img.shields.io/badge/Arc-mainnet-F2663B.svg)](https://explorer.arc.io/address/0xd173909Bc98DAf021669c56e5613Cd531903B0de) [![Contract verified](https://img.shields.io/badge/source-verified%20on%20Sourcify-3BB273.svg)](https://sourcify.dev/#/lookup/0xd173909Bc98DAf021669c56e5613Cd531903B0de)

Plug360 is USDC escrow on Arc for small deals between people who know each other, with a mutual friend (the "plug") as referee. Informal deals today run on trust, so one side pays first and hopes; Plug360 locks the buyer's USDC in a contract until the job is done, and the plug can settle a dispute only by refunding the buyer or paying the seller, never by taking the money.

**Live app:** [plug360.xyz](https://plug360.xyz)

## How a deal works

1. The seller (or buyer) writes the job, sets a price and names a plug. The terms travel in a single link.
2. The seller signs the terms, then the plug accepts. Signing is free and nothing moves yet.
3. The buyer pays from the same link. The USDC sits in `DealEscrow` while the work is done.
4. The buyer releases the money, or opens a dispute before the money-back window closes. The plug rules within 7 days; if they stay silent, anyone can trigger a full refund.

Platform fee is zero. The plug fee is set per deal, capped at 5% of the price and split evenly between buyer and seller.

## Status and audit

| | |
|---|---|
| Audit | Not audited. Internal review only: Slither with no medium or high findings, invariant and mutation testing ([SECURITY.md](contracts/SECURITY.md)) |
| Limits | 100 USDC per deal (lower per plug level), 2,500 USDC owed by the contract in total |
| Mainnet | Live since 15 October 2026. Every money path run once with real USDC; 20 of 20 receipts succeeded and the escrow ended owing nothing |
| Ownership | Single owner key for launch week; moving to a multisig is the next operations task |

## Deployments

| Network | DealEscrow | Deploy block | Source |
|---|---|---|---|
| Arc mainnet (5042) | [`0xd173909Bc98DAf021669c56e5613Cd531903B0de`](https://explorer.arc.io/address/0xd173909Bc98DAf021669c56e5613Cd531903B0de) | 26,019,786 | [Sourcify](https://sourcify.dev/#/lookup/0xd173909Bc98DAf021669c56e5613Cd531903B0de) |
| Arc testnet (5042002) | [`0x3df58eFFC292D5043075d71e6705dF6b7348171D`](https://explorer.testnet.arc.io/address/0x3df58eFFC292D5043075d71e6705dF6b7348171D) | 66,562,861 | [Sourcify](https://sourcify.dev/#/lookup/0x3df58eFFC292D5043075d71e6705dF6b7348171D) |

Both use Arc's native USDC (`0x3600000000000000000000000000000000000000`). Addresses and deploy blocks are committed in [`contracts/deployments/`](contracts/deployments/); check the address before you pay.

### Mainnet proof run

Paths: canary is a 1 USDC deal the seller sends back; P1 the seller refunds; P2 the buyer disputes and the plug refunds the buyer; P3 the plug rejects the dispute and the seller is paid; P4 the buyer signs an early release that someone else relays; P5 a deal with no money-back window pays out at once. Re-check it any time with `script/check-proofs.sh`. The testnet run is in [`5042002-proofs.json`](contracts/deployments/5042002-proofs.json).

| Path | Step | Transaction | Result |
|---|---|---|---|
| setup | buyer approves escrow | [0x9b324acf...](https://explorer.arc.io/tx/0x9b324acfd783f6dbb8c7fe7a870020b71de0772465f798061c87880b7567dca0) | ok |
| canary | buyer pays | [0x60958251...](https://explorer.arc.io/tx/0x60958251bf1317e5786ef6d0d45527e3b80b1f5241af58a0942a4c447c8cf7af) | ok |
| canary | seller sends it back | [0xe9596ccc...](https://explorer.arc.io/tx/0xe9596ccc0d1630189543c19c7a56d635fb953bbe5db73e5f8ff86454a440eeca) | ok |
| P1 | buyer pays | [0xd5a3468b...](https://explorer.arc.io/tx/0xd5a3468b247cbd9e4cd07b8fec7721c5aa8e5ec599010d2fb59b929a9b5717c8) | ok |
| P1 | seller sends it back | [0x4de21a9e...](https://explorer.arc.io/tx/0x4de21a9ebe162dc595ec4c1092bf04bce6b7108738a1575a6e591947ce176d36) | ok |
| P2 | buyer pays | [0xaf6bdb3e...](https://explorer.arc.io/tx/0xaf6bdb3e367d5dabe9075dd312138d8a0f2a808dcfac9fec86f24b76fc9445db) | ok |
| P2 | buyer disputes | [0x3f2fb627...](https://explorer.arc.io/tx/0x3f2fb627c1c972c4c9c3a42855ce1cebe1fa6b57a0253af17fb7b3b9c1866b56) | ok |
| P2 | plug rules for the buyer | [0xd26a8421...](https://explorer.arc.io/tx/0xd26a8421c0601084629aa3dd57962b767bb2eeda57036f74b0e9ec177a637b7f) | ok |
| P3 | buyer pays | [0x39ae3da9...](https://explorer.arc.io/tx/0x39ae3da9d379d704f395b182428824ce9dcaf538a6c497fc080f7106be00679f) | ok |
| P3 | buyer disputes | [0x79ee3a23...](https://explorer.arc.io/tx/0x79ee3a23a76650565bda973382fad466ea8366bd449f6ccf05976ad0ba4590ff) | ok |
| P3 | plug rejects the dispute | [0x05287a46...](https://explorer.arc.io/tx/0x05287a4667447fb8731e9ab17d89465a523563b34c0fb120860f4cb6754b12c8) | ok |
| P3 | payout | [0x1524d2b9...](https://explorer.arc.io/tx/0x1524d2b93762e0ffd745baffcb31a30ac3ac7b380eb18b54000262f6d6d6658f) | ok |
| P3 | seller returns the payout (capital reuse) | [0xbc6a6803...](https://explorer.arc.io/tx/0xbc6a68034d7c0e4747bde4bc3d4eda3642db4bf597007219222f83e569345296) | ok |
| P4 | buyer pays | [0x9d35c4e9...](https://explorer.arc.io/tx/0x9d35c4e98ea5fa06e883f3a9ac29fc75551c9597485d8cd7c0d496b433e01e23) | ok |
| P4 | signed release, relayed | [0xe8ddd2f1...](https://explorer.arc.io/tx/0xe8ddd2f1cfb00d9b1c475a7db3070fe6bac653030d09cc7cca73266bbfa0f2ed) | ok |
| P4 | payout | [0x6c7829ba...](https://explorer.arc.io/tx/0x6c7829ba65c3a897406f7cda46bc8792e8177cad5428bce304d248c0bcf34406) | ok |
| P4 | seller returns the payout (capital reuse) | [0x0bb7ac57...](https://explorer.arc.io/tx/0x0bb7ac57cde7f75abed00f18b261eec36aecce23c34d1fb3b6b25d89504973e9) | ok |
| P5 | buyer pays | [0x40144465...](https://explorer.arc.io/tx/0x401444652723f7f56668a9d36f0f23cb043c5f1e159a6230474c533b9832f077) | ok |
| P5 | payout | [0x37588f6f...](https://explorer.arc.io/tx/0x37588f6fff26d5adca1d98cf0a5cc6dc69f6496329bc5c278931a9238ceb5466) | ok |
| P5 | seller returns the payout (capital reuse) | [0x54101948...](https://explorer.arc.io/tx/0x541019480132e303a7bda9d22f5eaa37702c620691173891d7206264890f28ca) | ok |

## Architecture

| Component | Role |
|---|---|
| [`contracts/`](contracts/) | `DealEscrow` (Foundry): holds funded deals and pays only the addresses fixed at funding. Unit, fuzz, invariant and Arc fork tests; deploy, admin and proof scripts |
| [`apps/web/`](apps/web/) | The deal room (Next.js): create, sign, pay, dispute and settle from a phone. Shows a live naira equivalent next to USDC prices |
| [`services/wallets/`](services/wallets/) | Google sign-in through Circle user-controlled wallets, so people without a wallet app can take part |
| [`services/sponsor/`](services/sponsor/) | Gas sponsor: deploys smart wallets from their signatures and covers gas for the party who must act, after checking the call on-chain |
| [`services/keeper/`](services/keeper/) | Pays out finished deals, refunds buyers when a plug misses the 7-day deadline, retries parked payouts, alerts on solvency and owner actions |
| [`packages/shared/`](packages/shared/) | ABI, chain config, EIP-712 types and funding rules shared by the app and services |
| [`packages/testkit/`](packages/testkit/) | Test helpers: local chain, contract deployment, an RPC proxy that behaves like Arc |

Key design choices, in short: the plug can only choose between two fixed destinations, so a referee can never become a custodian; deal terms are signed EIP-712 data carried in the link, so there is no server database of deals; and a silent plug defaults to a refund, so the worst case for a buyer is waiting 7 days. The full trust model and threat analysis is in [contracts/SECURITY.md](contracts/SECURITY.md).

## Testing

Every push runs a local gate ([`scripts/hooks/pre-push`](scripts/hooks/pre-push)): `forge fmt --check`, the Foundry unit, fuzz and invariant suites, Slither (fails on any medium or high finding), the Arc fork tests, and typecheck plus tests for every TypeScript package. The contract suite includes 9 invariant tests over 10 money and state rules: the balance always covers what the contract owes, the total held is exact, payout legs sum to what was escrowed, and the parties fixed at funding never change ([SECURITY.md](contracts/SECURITY.md#test-evidence)). GitHub Actions runs the contract build and tests on pushes to `main` ([`contracts.yml`](.github/workflows/contracts.yml)).

```sh
cd contracts && make test           # unit, fuzz and invariant tests
pnpm -r typecheck && pnpm -r test   # TypeScript packages and the web app
```

## Quickstart

Requires Node 22+, pnpm and [Foundry](https://getfoundry.sh).

```sh
git clone https://github.com/Majormaxx/plug360 && cd plug360
git submodule update --init --recursive
pnpm install
pnpm build
cp apps/web/.env.example apps/web/.env.local   # defaults to Arc testnet
pnpm --filter @plug360/web dev                  # http://localhost:3000
```

The app runs on Arc testnet with no configuration. Google sign-in, gas sponsorship and the keeper need the optional values described in [`apps/web/.env.example`](apps/web/.env.example) and [`services/keeper/.env.example`](services/keeper/.env.example). Get test USDC from [faucet.circle.com](https://faucet.circle.com).

## Operations

Keys, deployment steps, owner actions, monitoring and incident playbooks: [contracts/OPERATIONS.md](contracts/OPERATIONS.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates; this project is built on Arc and is not affiliated with or endorsed by Circle.
