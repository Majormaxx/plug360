# Plug360

Escrow for small USDC deals on Arc, with a mutual friend as referee. Funds sit in a contract the referee cannot draw from; in a dispute, the referee's only choices are a refund to the buyer's fixed address or payment to the seller.

Status: in development. The contract is unaudited and capped at 100 USDC per deal and 2,500 USDC held in total.

## Layout

| Path | What it is | Status |
|---|---|---|
| [`contracts/`](contracts/) | `DealEscrow` (Foundry): the escrow, its unit, invariant and Arc fork tests, deploy, admin and proof scripts | Complete; testnet deployment next |
| [`packages/shared/`](packages/shared/) | ABI, chain config, EIP-712 types and the funding rules, checked against the deployed contract | Complete |
| [`services/keeper/`](services/keeper/) | Refunds buyers when a plug misses the 7-day deadline, retries parked payouts, and alerts on solvency and owner actions | Complete; runs after deployment |
| [`packages/testkit/`](packages/testkit/) | Test helpers: local chain, contract deployment, an RPC proxy that behaves like Arc's | Test-only |
| `apps/web/` | The deal room | Not started |

## Development

```sh
git submodule update --init --recursive
pnpm install
pnpm build && pnpm test          # TypeScript packages
cd contracts && make test        # contracts: unit, fuzz and invariant tests
cd contracts && make hooks       # commit and push gates
```

See [contracts/README.md](contracts/README.md), [contracts/SECURITY.md](contracts/SECURITY.md) and [contracts/OPERATIONS.md](contracts/OPERATIONS.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates; this project is built on Arc and is not affiliated with or endorsed by Circle.
