# DealEscrow security notes

DealEscrow is unaudited. Each deal is capped at 100 USDC and the contract never holds more than 2,500 USDC owed to deals. Treat it as experimental software.

To report a problem, open a private security advisory on this repository (Security tab, "Report a vulnerability").

## Trust model

| Role | Can | Cannot |
|---|---|---|
| Buyer | Fund a deal from their own USDC; open one dispute before the window ends; release the money to the seller early (directly or with a signature anyone can relay); cancel an unused release signature | Change the refund address after funding; dispute after the window ends; dispute twice |
| Seller | Sign the terms; send the money back to the buyer any time before it is withdrawn | Withdraw before the window ends unless the buyer releases or the plug rejects a dispute |
| Plug | Accept the terms by signature; on a disputed deal, within 7 days, either refund the buyer's fixed refund address or release to the seller | Move money anywhere else; act on undisputed deals; act after 7 days |
| Anyone | Withdraw a released deal or one whose window has ended; refund the buyer once a plug misses the 7-day deadline; retry a parked payout leg | Choose where any of that money goes; every payout goes to addresses fixed at funding |
| Owner | Set plug levels (affects new deals only); pause new deals; sweep USDC above what deals are owed; transfer ownership in two steps | Move any USDC owed to a deal; block any exit (pause stops `pay` only); renounce ownership |

Every payout goes to one of three addresses written at funding (refund address, seller, plug), in the amounts below. With `f` the plug fee and `h = f / 2`, the buyer escrows `price + h`:

| Outcome | Refund address | Seller | Plug |
|---|---|---|---|
| Settled (window ended, buyer released, or plug rejected the dispute) | 0 | price - h | f |
| Seller sends the money back | price + h | 0 | 0 |
| Plug rules for the buyer | price | 0 | h |
| Plug misses the 7-day deadline | price + h | 0 | 0 |

## Design decisions that carry security weight

- Isolated accounting per deal. There is no pooled balance a deal can draw from beyond its own escrow. The design is modeled on Circle Research's Refund Protocol, whose repository carries an open notice about an arbiter draining other users' payments through early withdrawal; DealEscrow has no early-withdrawal path and no shared balances.
- Deal ID is `keccak256(seller, orderId)`, so a set of signed terms can fund at most one deal.
- The plug must sign an acceptance of the exact terms hash, so a seller cannot name someone as plug without their consent. Only plugs the owner has listed (level 1 to 5) can be named, and the price must fit the plug's level cap.
- EIP-712 signatures bind the chain ID and this contract's address. ECDSA signatures must use low `s`; ERC-1271 contract wallets are supported.
- Release signatures carry a per-buyer nonce that is consumed on use and can be cancelled, and a deadline no later than the window end.
- A dispute requires `now < releaseAt` and a withdrawal from Held requires `now >= releaseAt`, so the two can never both succeed, even when several Arc blocks share a timestamp.
- Every final transition writes its status first. Each payout leg is sent with a low-level call; if it fails (for example, the recipient is on the USDC blocklist), the leg is parked on that deal alone and anyone can retry it later to the same address. One blocked address cannot freeze another deal. This behavior is tested against Arc's real USDC contract on a testnet fork (`test/arc/`).
- The contract reads USDC only through its 6-decimal ERC-20 interface and never uses `msg.value` or native balances.
- `pay` checks that the contract received exactly `price + h`, so a fee-on-transfer token cannot under-fund a deal.

## Test evidence

| Check | Result | Command |
|---|---|---|
| Unit and fuzz tests | 79 tests | `make test` |
| Invariant suite | 9 invariant tests covering the 10 money and state rules, 256 runs x 128 calls locally, 10,000 runs in CI | `make test` / `make test-ci` |
| Invariant campaign coverage | Per-action counts across runs (deals funded, disputes, rulings, timeouts, withdrawals, retries, pauses, blocklist toggles) | `make invariant-stats` |
| Line, statement, branch and function coverage | 100% of `DealEscrow.sol` | `make coverage` |
| Mutation check | 24 deliberate bugs (boundaries, signatures, payout amounts, pause, sweep, parking); all must be caught | `make mutate` |
| Arc behavior on a testnet fork | Blocklisted transfers are catchable and other legs still pay | `make test-arc` |
| Static analysis | No high or medium findings; low and informational findings triaged below | `make slither` |

The invariant suite runs with `fail_on_revert`: the handler only makes calls that must succeed, so any valid exit that reverts (while paused, or with a blocklisted party) fails the run.

## Slither triage

| Detector | Location | Decision |
|---|---|---|
| reentrancy-no-eth | `_withdraw`, `plugRefund`, `retryPayout` (state written after a payout call) | Accepted. The only callee is the USDC contract, which does not call back into contracts. Every state-changing entry point is `nonReentrant`. `totalHeld` is reduced before the call and restored only if the transfer fails. Suppressed inline with a pointer to this file. |
| calls-loop, costly-loop | `withdrawMany` | Accepted. Bounded at 50 deals; all or nothing by design. |
| low-level-calls | `_transfer` | Intentional. A low-level call turns any transfer failure, including a malformed return value, into a parked leg instead of a reverted transition. |
| timestamp | Window and deadline checks | Accepted. Windows are measured in days; a few seconds of validator drift changes no outcome. |
| cyclomatic-complexity | `_checkTerms` | Accepted. It is the flat list of funding rules. |
| naming-convention | `USDC` | Immutable named in upper case by convention. |

## Known limitations

- Unaudited. Caps: 100 USDC per deal, 2,500 USDC held in total.
- Plug levels are set by hand by the owner. A listed plug who colludes with one side can rule wrongly on a disputed deal up to their level's cap.
- One plug per deal, no appeals, full refunds only, USDC only.
- When the plug rules for the buyer, the buyer's half of the fee pays the plug.
- Order tags through Arc's Memo contract work only for transactions an ordinary wallet sends itself; the contract's own events carry the order ID for every wallet type.
- A buyer who signs two early-release signatures before either is used must have them relayed in nonce order.

## Address poisoning

Bots watch Arc and send tiny USDC transfers from addresses that share the first and last characters of real ones, hoping someone copies the fake from their history. They hit this project's test wallets within seconds of real transactions. Defences:

- The plug field only accepts listed plugs, so a look-alike plug address fails the listing check. A look-alike seller address cannot produce the real seller's signature, so the deal cannot be paid.
- The refund address is the one field where a wrong paste would lose money. The app defaults it to the buyer's own wallet and blocks any address that matches a known address at both ends but differs in the middle. The same check runs on the plug and seller fields (`apps/web/src/lib/lookalike.ts`).
- Addresses always show in full, grouped in fours. The app never shortens an address where someone has to compare it.
- Deal state comes from `getDeal` and escrow events, never from balances. Anyone can send USDC to any address, the escrow included, so balances only ever count as "at least". A test fails if web code reads balances outside the funding and gas checks (`apps/web/test/balance-guard.test.ts`). The proof checker and the end-to-end run verify refunds and payouts through the escrow's own transfer logs, and treat stray dust in the escrow as sweepable excess.

## Leaving a deal without the website

Every exit is a plain contract call. With Foundry's `cast` (or `arc-cast`) and the deal ID:

```sh
ESCROW=<DealEscrow address>
RPC=https://rpc.mainnet.arc.io
# Buyer releases early
cast send $ESCROW "release(uint256)" $DEAL --rpc-url $RPC --private-key $KEY --gas-price 25gwei
# Seller sends the money back
cast send $ESCROW "refund(uint256)" $DEAL --rpc-url $RPC --private-key $KEY --gas-price 25gwei
# Anyone: pay out after the window or a release
cast send $ESCROW "withdraw(uint256)" $DEAL --rpc-url $RPC --private-key $KEY --gas-price 25gwei
# Anyone: refund the buyer after the plug's 7 days pass
cast send $ESCROW "finalizeExpiredDispute(uint256)" $DEAL --rpc-url $RPC --private-key $KEY --gas-price 25gwei
# Anyone: retry a parked payout
cast send $ESCROW "retryPayout(uint256)" $DEAL --rpc-url $RPC --private-key $KEY --gas-price 25gwei
# Read a deal
cast call $ESCROW "getDeal(uint256)" $DEAL --rpc-url $RPC
```

Arc drops transactions priced under 20 gwei, so always set a gas price of at least 25 gwei.
