# Plug360

Escrow for small USDC deals on Arc, with a mutual friend as referee. Funds sit in a contract the referee cannot draw from; in a dispute, the referee's only choices are a refund to the buyer's fixed address or payment to the seller.

Status: in development. The contract is unaudited.

## Layout

| Path | Status |
|---|---|
| [`contracts/`](contracts/) | DealEscrow (Foundry): admin, limits and EIP-712 hashing done; deal lifecycle in progress |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

