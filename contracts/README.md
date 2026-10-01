# DealEscrow contracts

Foundry project for `DealEscrow`, the USDC escrow behind Plug360 on Arc.

| Path | What it holds |
|---|---|
| `src/interfaces/IDealEscrowTypes.sol` | Deal states, structs, events, custom errors |
| `src/interfaces/IDealEscrowAdmin.sol` | Owner controls, limits, EIP-712 hashing |
| `src/interfaces/IDealEscrow.sol` | Deal lifecycle: pay, dispute, release, refund, ruling, withdraw |
| `src/DealEscrow.sol` | The contract (admin, limits and hashing implemented; lifecycle in progress) |
| `test/unit/` | Standard-EVM unit and fuzz tests |
| `test/arc/` | Arc-only behavior, run on an Arc testnet fork with Arc Foundry |

## Requirements

- [Foundry](https://getfoundry.sh/) 1.7+
- [Arc Foundry](https://github.com/circlefin/arc-foundry) (`arc-forge`) for `make test-arc`

## Commands

```sh
git submodule update --init --recursive
make build      # compile, print contract sizes
make test       # unit and fuzz tests
make test-arc   # Arc behavior on a testnet fork (needs network)
make fmt-check
make coverage
```

## Arc notes

- Compiled for `evm_version = "osaka"`, Arc's EVM baseline.
- USDC is read only through its 6-decimal ERC-20 interface at `0x3600000000000000000000000000000000000000`. Native balances (18 decimals) are never used.
- `test/arc/ArcUsdcBehavior.t.sol` shows that a USDC transfer to or from a blocklisted address fails inside `try/catch` without moving funds, so one blocked payout leg cannot stop the others.
