# Plug360

Escrow for small USDC deals on Arc, with a mutual friend as referee. Funds sit in a contract the referee cannot draw from; in a dispute, the referee's only choices are a refund to the buyer's fixed address or payment to the seller.

Status: in development. The contract is unaudited and capped at 100 USDC per deal and 2,500 USDC held in total.

## Layout

| Path | What it is | Status |
|---|---|---|
| [`contracts/`](contracts/) | `DealEscrow` (Foundry): the escrow, its unit, invariant and Arc fork tests, deploy, admin and proof scripts | Complete; live on Arc testnet |
| [`packages/shared/`](packages/shared/) | ABI, chain config, EIP-712 types and the funding rules, checked against the deployed contract | Complete |
| [`services/keeper/`](services/keeper/) | Refunds buyers when a plug misses the 7-day deadline, retries parked payouts, and alerts on solvency and owner actions | Complete; ran against the testnet deployment |
| [`packages/testkit/`](packages/testkit/) | Test helpers: local chain, contract deployment, an RPC proxy that behaves like Arc's | Test-only |
| [`apps/web/`](apps/web/) | The deal room: create, sign, pay, dispute and settle deals from a phone or desktop | Complete; end-to-end tested against the testnet deployment |

## Arc testnet deployment

| Item | Value |
|---|---|
| DealEscrow | [`0x3df58eFFC292D5043075d71e6705dF6b7348171D`](https://explorer.testnet.arc.io/address/0x3df58eFFC292D5043075d71e6705dF6b7348171D) |
| Source | Verified on [Sourcify](https://sourcify.dev/#/lookup/0x3df58eFFC292D5043075d71e6705dF6b7348171D) (creation and runtime bytecode match) |
| Chain | Arc testnet, chain ID 5042002, deployed in block 66,562,861 |
| Owner | `0x6FcCB3cf837a490A5dB9112770d46e395EeA88c9` (testnet key; mainnet uses a separate owner) |

Every money path, run once with real testnet transactions (`make proofs`, checked on-chain with `script/check-proofs.sh`). All receipts succeeded and the escrow ended holding nothing.

| Path | Step | Transaction | Result |
|---|---|---|---|
| setup | buyer approves escrow | [0xa7494580...](https://explorer.testnet.arc.io/tx/0xa7494580ca59da5474c291aa83614d54dfc1c34c307d3b3d8cde3dd2074e6937) | ok |
| canary | buyer pays | [0x883fffba...](https://explorer.testnet.arc.io/tx/0x883fffba053f878e4034b5ef10bb9226e2776bff0e1b8483d01c77ffa6db091c) | ok |
| canary | seller sends it back | [0x0aa09bbf...](https://explorer.testnet.arc.io/tx/0x0aa09bbfa712fc9b1814e6f5723befbed31d90f9b165fd781ae369c8886c1f39) | ok |
| P1 | buyer pays | [0x28f55e7b...](https://explorer.testnet.arc.io/tx/0x28f55e7b28b2345a2e1f733ea802c345a19367de6f3c9659ac2cd70c52e12d0d) | ok |
| P1 | seller sends it back | [0xbd09f693...](https://explorer.testnet.arc.io/tx/0xbd09f693a922c99d2545a4bd8eb2d60d10653ee55172297cc165b58b61b4b895) | ok |
| P2 | buyer pays | [0xffc89a2f...](https://explorer.testnet.arc.io/tx/0xffc89a2f3b1389640a748f03a0c6d8702a4ccb5d7833d5060f2bba4065008bd0) | ok |
| P2 | buyer disputes | [0xa745ed41...](https://explorer.testnet.arc.io/tx/0xa745ed418a908eafe878f920d73e9ee2d6f0b4c60ff46d2f321b6f89e701b5d5) | ok |
| P2 | plug rules for the buyer | [0x3ae2f6df...](https://explorer.testnet.arc.io/tx/0x3ae2f6dff9d4aed592266cb97a9085da60a101e063d65bf2b740bba9d19c2bea) | ok |
| P3 | buyer pays | [0x660f25a6...](https://explorer.testnet.arc.io/tx/0x660f25a65c17776056d0c271d07afe8a144067d3c1ff99a254c77a51792d014f) | ok |
| P3 | buyer disputes | [0x542ce5c6...](https://explorer.testnet.arc.io/tx/0x542ce5c6804059e5aa63fa8848a757501488cdd54a117306fe522701c89fc75e) | ok |
| P3 | plug rejects the dispute | [0xf5b11e00...](https://explorer.testnet.arc.io/tx/0xf5b11e009107c63b6c9a930b7d0ecb9d301fd67687034e8e3d7a3c361feef1cd) | ok |
| P3 | payout | [0x8c85f701...](https://explorer.testnet.arc.io/tx/0x8c85f701f7b4fcf1c129914c4accbe4630f596d0100dd17b7af8559682fb63ad) | ok |
| P4 | buyer pays | [0xe0787853...](https://explorer.testnet.arc.io/tx/0xe078785353b2dd7ad57b891050a8f52c596e8596b711d09b4664b1033e5d2209) | ok |
| P4 | signed release, relayed | [0x75b0d61b...](https://explorer.testnet.arc.io/tx/0x75b0d61b599f2990d1663dc160406f31bd1f152e2c233150741e761e637937f1) | ok |
| P4 | payout | [0x9682778f...](https://explorer.testnet.arc.io/tx/0x9682778f715f02adce8dedb0316d93a16252ab299e1f9c93567c19f4fd0c9244) | ok |
| P5 | buyer pays | [0xdaca6ac7...](https://explorer.testnet.arc.io/tx/0xdaca6ac771a2cb920281f90bc623c7d1ddbbc79d88881a0ecac94fac01498f61) | ok |
| P5 | payout | [0xf851e9aa...](https://explorer.testnet.arc.io/tx/0xf851e9aa444eec19f616b00bd67aca5f1b64597d8b097616a566accb3aac23a5) | ok |

Paths: canary is a 1 USDC deal the seller sends back; P1 the seller sends the money back; P2 the buyer disputes and the plug refunds the buyer; P3 the plug rejects the dispute and the seller is paid; P4 the buyer signs an early release that someone else relays; P5 a deal with no money-back window pays out at once.

## Development

```sh
git submodule update --init --recursive
pnpm install
pnpm build && pnpm test          # TypeScript packages and the web app
pnpm --filter @plug360/web dev   # the deal room on http://localhost:3000
cd contracts && make test        # contracts: unit, fuzz and invariant tests
cd contracts && make hooks       # commit and push gates
```

See [contracts/README.md](contracts/README.md), [contracts/SECURITY.md](contracts/SECURITY.md) and [contracts/OPERATIONS.md](contracts/OPERATIONS.md).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates; this project is built on Arc and is not affiliated with or endorsed by Circle.
