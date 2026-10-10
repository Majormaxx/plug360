# @plug360/testkit

Test-only helpers shared by the workspace test suites. Not published and not used at runtime.

- `startAnvil({ chainId, genesisBlockNumber, args })` starts anvil on a free port and waits until it answers. `genesisBlockNumber` starts the chain high, because `anvil_mine` gets very slow past a few thousand blocks.
- `deployFixture(rpcUrl, chain, plugLevels)` deploys MockUSDC and DealEscrow from `contracts/out` (running `forge build` if the artifacts are missing) and lists plugs.
- `startArcProxy(upstream)` is a JSON-RPC proxy that rejects `eth_getLogs` over 10,000 blocks like Arc does, records the ranges it forwards, and can inject errors (`failNext`) or return HTTP 503 (`setDown`).
- `anvilAccount(i)`, `anvilPrivateKey(i)`, `roles`: anvil's public development keys. They are fine for a plain local anvil. Arc testnet blocklists these accounts, so a test that forks Arc must generate fresh keys instead.

```sh
pnpm --filter @plug360/testkit test
```
