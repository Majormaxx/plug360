# Plug360 / DealEscrow — Security Review

**Scope:** `contracts/src/DealEscrow.sol`, its interfaces, and the off-chain services (`services/sponsor`, `services/keeper`, `apps/web`).  
**Date:** October 2026  
**Reviewer:** Arc Studio (independent analysis, not a formal audit)

---

## Summary

DealEscrow is a well-structured, deliberately constrained escrow. The threat surface is narrow by design: low caps (100 USDC / deal, 2,500 USDC total), fixed payout addresses, no owner custody of deal funds, and a state machine that guards every transition. The test suite is exceptional for an unaudited project (100% coverage, mutation testing, invariant suite, Arc fork tests). No critical or high-severity issues were found. Several medium and low items warrant attention before raising the caps or pursuing an external audit.

---

## Findings

### Medium

#### M-01 — Plug fee accounting asymmetry: seller pays nothing, buyer absorbs the whole cost in a plug-wins scenario

**Location:** `DealEscrow.sol` → `plugRefund()`, `_refundInFull()`, settlement table in SECURITY.md

**Detail:**  
The buyer escrows `price + plugFee / 2`. In a normal settlement the seller effectively pays the other half (`price - sellerHalf` goes to the seller, `plugFee` goes to the plug). But when the plug rules **for the buyer** the contract pays `price` to the buyer and `plugFee / 2` to the plug — the buyer receives back _less_ than they paid in. The buyer entered in good faith, raised a dispute, and still loses half the plug fee even when they win. This is acknowledged in the docs, but it creates a perverse incentive: a plug who knows a deal will resolve for the buyer is economically motivated to rule quickly (they get `plugFee / 2`) while a buyer who predicts a plug ruling may prefer to wait for a timeout (they recover `price + plugFee / 2`). The asymmetry is exploitable if a buyer coordinates with a plug to deliberately time out disputes when the buyer wins.

**Impact:** Users may not understand they lose part of a fee they paid on a successful dispute. An unsophisticated buyer who "won" the dispute could be confused and feel cheated.

**Recommendation:** Either (a) document this prominently in the UI at dispute-open time ("you will recover _price_ USDC, the referee keeps their half of the fee even if they rule for you"), or (b) redesign to refund the buyer's full deposit and deduct the plug fee from the deal price on the happy path only (requires a contract change and re-audit of the accounting invariant).

---

#### M-02 — Single-owner EOA on mainnet: the owner key is the protocol's single point of failure

**Location:** `DealEscrow.sol` → `Ownable2Step`, `OPERATIONS.md`

**Detail:**  
OPERATIONS.md acknowledges this: "Single owner key for launch week; moving to a multisig is the next operations task." The owner can pause new deals, list or delist plugs, and sweep excess USDC. A compromised owner key could:
1. Delist all honest plugs and list a colluding one.
2. Pause the contract indefinitely (exit paths remain open, but new deals cannot be created, which halts the product).
3. Sweep stray USDC (dust amounts, no deal funds).

`Ownable2Step` prevents a typo from transferring ownership to the wrong address, which is good. But a single stolen key is enough to damage the protocol.

**Impact:** Owner compromise silently poisons all future deals for up to 30 days (the max terms lifetime) if an attacker lists a colluding plug before anyone notices.

**Recommendation:** Move to a 2-of-3 Safe as planned. Additionally, consider emitting a `PlugLevelSet` event on every level change (it already does) and having the keeper's alert reach an independent channel (Telegram, PagerDuty) with a sub-minute SLA so a rogue plug listing is caught before any user can fund a deal through it.

---

#### M-03 — Gas sponsor wallet is a single hot key holding real USDC

**Location:** `services/sponsor/src/sponsor.ts`, `OPERATIONS.md`

**Detail:**  
The sponsor sends native USDC to arbitrary EOA addresses supplied in API requests, validated only by checking chain state (deal exists, caller is eligible). The validation is sound for the happy path. The risk is:
- The sponsor endpoint is HTTP-accessible. If the rate-limiter (`apps/web/src/lib/rateLimit.ts`) is misconfigured or absent on a new deployment, an attacker can drain the sponsor with repeated requests for any eligible address on real deals.
- `fundGas` calls `publicClient.estimateContractGas` with `account = target`, the user-supplied address. A carefully crafted scenario where `estimateContractGas` is unreliable (e.g. ARC RPC quirk, contract paused between estimate and send) could cause the sponsor to send without the sponsored call actually succeeding, wasting gas.
- The `maxTopUp` cap limits single-call drain but not repeated calls.

**Impact:** Sponsor balance drained over time; users without USDC for gas are left unable to act on deals.

**Recommendation:** Add a per-address and per-deal rate limit on the sponsor endpoint (e.g. one top-up per address per 10 minutes, one `prepare-signer` per (terms hash, kind) tuple). Log every sponsorship with the deal ID and the amount sent so the operator can detect anomalies. Consider a small balance floor on the sponsor address that triggers an alert before it reaches zero.

---

### Low

#### L-01 — `releaseWithSig` deadline can be set to `releaseAt` exactly: off-by-one allows a signature to race with the window boundary

**Location:** `DealEscrow.sol:132` — `if (deadline > d.releaseAt) revert DeadlineAfterWindow()`

**Detail:**  
The check is `deadline > releaseAt` (strict), so `deadline == releaseAt` is allowed. Meanwhile `openDispute` checks `block.timestamp >= releaseAt` (revert if window closed). On Arc, multiple transactions in the same block can have the same timestamp. A release signature with `deadline == releaseAt` and a simultaneous `openDispute` call, both in the same block at `timestamp == releaseAt`, would both pass their respective timestamp guards: `openDispute` passes because `block.timestamp < releaseAt` is still true, and `releaseWithSig` passes because `block.timestamp <= deadline`. Whichever lands first in the block wins; the second reverts with `InvalidStatus`. This is mostly harmless — only one can succeed — but the ordering is miner-controlled and could be gamed if the stakes were higher.

**Impact:** Negligible at current caps (100 USDC). Noteworthy at higher caps.

**Recommendation:** Change the deadline guard to `if (deadline >= d.releaseAt) revert DeadlineAfterWindow()` so signatures cannot reach into the dispute window.

---

#### L-02 — `withdrawMany` is all-or-nothing: one un-withdrawable deal blocks the entire batch

**Location:** `DealEscrow.sol:197-202`

**Detail:**  
The comment reads "All or nothing: one deal that cannot be withdrawn reverts the whole batch." A deal whose window has not yet closed, or that is in `Disputed` / `Refunded` / `Settled` status, will revert with `WindowOpen` or `InvalidStatus`. A keeper submitting a 50-deal batch fails entirely if any single deal has moved to a non-withdrawable state between event scan and submission. The keeper currently deals with this by tracking deal state, but a race condition between the scan and the `withdrawMany` call could still cause spurious failures and wasted gas.

**Impact:** Low. The keeper retries on the next tick, so no funds are stuck. Gas is wasted.

**Recommendation:** Either provide a `withdrawMany` variant that skips non-withdrawable deals (emit an event for each skip), or have the keeper always use single `withdraw` calls to avoid cross-deal dependency.

---

#### L-03 — `_park` silently accumulates: repeated failed legs can overflow the `uint96` packed struct

**Location:** `DealEscrow.sol:448` — `p.toRefund += parked`

**Detail:**  
`_park` does `p.toRefund += parked` (and similarly for `toSeller`, `toPlug`). In the current design each leg is only parked once per final transition, so the accumulation is at most two for `Refund` and `Seller` combined (once from the transition, once if `retryPayout` also fails). But the logic technically allows parking the same leg multiple times if `retryPayout` is called repeatedly and fails every time. `uint96` can hold up to ~79,228 USDC before overflowing; at the current 100 USDC cap this requires hundreds of thousands of failed retries, making it practically impossible. However, this is a structural fragility: if the cap is ever raised or if the parking logic is extended, overflow could silently corrupt the pending amount for a deal.

**Impact:** Negligible at current caps. Would need a re-audit before raising caps.

**Recommendation:** Add an overflow check in `_park` (use checked arithmetic or assert `uint96(amount) <= type(uint96).max - existing`) and document the invariant that each leg is parked at most once per deal lifecycle.

---

#### L-04 — No permit/EIP-2612 support: buyer must do a separate `approve` transaction

**Location:** `DealEscrow.sol:96` — `USDC.safeTransferFrom(buyer, address(this), escrowed)`

**Detail:**  
Every buyer must pre-approve the escrow contract before calling `pay`. For EOA wallets this costs an extra transaction and a separate gas fee. The one-click path (`pay.ts` / `oneClickCalls`) handles this through Multicall3From with `allowFailure: false`, but that path only works for plain EOAs (the comment in `pay.ts` says so explicitly: "Only works when the wallet sends from a plain EOA, because Memo and Multicall3From check tx.origin"). Smart wallet users (Circle wallets, Safes) must approve separately. Arc's USDC supports EIP-2612 `permit`, so the escrow could accept a signed permit alongside the payment, removing the separate step for all wallet types.

**Impact:** UX friction, not a security vulnerability. Increases the chance a user sees two wallet prompts and abandons.

**Recommendation:** Add an optional `payWithPermit` entry point that accepts a permit signature and calls `permit` before `safeTransferFrom`. This is additive and does not change the existing path.

---

#### L-05 — Terms expiry allows a 30-day re-use window for off-chain signed data

**Location:** `DealEscrow.sol:351` — `if (terms.expiry > block.timestamp + MAX_TERMS_LIFETIME) revert TermsLifetimeTooLong()`

**Detail:**  
`MAX_TERMS_LIFETIME` is 30 days. A seller who signs terms and shares the link could have those terms funded by any buyer who receives the link, up to 30 days later. If the seller intended a one-time deal with a specific buyer, the link (which encodes the signed terms) remains valid for anyone who intercepts it. The design assumes the link is shared only with the intended buyer, but the contract itself has no buyer binding in the terms: the buyer is `msg.sender`, not a field in `Terms`.

**Impact:** A shared or leaked link could allow an unintended buyer to fund the deal. For informal deals between people who know each other this is low risk in practice. At higher caps or for more formal use cases it would be a real issue.

**Recommendation:** Add an optional `buyer` field to `Terms` (address(0) means anyone). If non-zero, `_checkTerms` should assert `buyer == msg.sender`. This is a contract change and needs a re-audit; for now, document it prominently: "share this link only with the specific buyer."

---

#### L-06 — `sweepExcess` can be called while paused: no check that paused state blocks the sweep path

**Location:** `DealEscrow.sol:242` — `sweepExcess` has no `whenNotPaused` modifier

**Detail:**  
`pause()` is documented as blocking new deals only, and all exit paths remain open while paused. `sweepExcess` is an owner-only function, so it cannot be called by an attacker. However, an operator who pauses due to a suspected bug and then calls `sweepExcess` (to move "excess") while an accounting discrepancy is still being investigated could accidentally sweep funds. The difference `balance - totalHeld` should be zero during normal operation; any non-zero amount is either a donation or an accounting bug. Allowing the sweep while paused adds an operational risk.

**Impact:** Low. Only the owner can call it, and the invariant prevents sweeping deal funds.

**Recommendation:** Add a comment (or a revert) clarifying that `sweepExcess` should only be called after verifying the balance discrepancy is not due to a totalHeld bug. Consider adding a `whenNotPaused` guard or requiring a minimum delay between pause and sweep.

---

### Informational

#### I-01 — Plug can rule on a deal in any disputed state regardless of their level being revoked

**Location:** `DealEscrow.sol:375` — `_checkPlugRuling` checks only `msg.sender == d.plug`

**Detail:**  
A plug whose level is set to 0 after a deal is funded can still rule on open disputes for deals they were named in. `plugLevel` only gates new deals (`_checkTerms`); existing deals retain their original plug. This is by design and documented. It means that if a plug is delisted for misbehaviour, their pending rulings on existing deals still go through. The mitigant is that the addresses are fixed at funding and the owner can alert via the keeper.

**Recommendation:** Document clearly that delist-and-replace is not possible mid-deal. Consider an emergency "block this plug's rulings" path if future caps justify it.

---

#### I-02 — `cancelNonce` increments the nonce by exactly one: multiple pending signatures require multiple cancel calls

**Location:** `DealEscrow.sol:259` — `releaseNonce[msg.sender]++`

**Detail:**  
A buyer who signed multiple early-release signatures (valid by design: nonce-ordered) and wants to cancel all of them must call `cancelNonce` once per signature. There is no "cancel all" or "advance nonce by N" function. This is a minor UX issue, not a security issue.

**Recommendation:** Add a `cancelNonceTo(uint256 target)` function that advances the nonce directly to a caller-supplied value (with `target > current` enforced). This saves N-1 transactions for a buyer who issued multiple signatures.

---

#### I-03 — `_withdraw` pays the plug the full `plugFee` on normal settlement, but terms show `f - f/2` to seller

**Location:** `DealEscrow.sol:406-413`

**Detail:**  
On withdrawal: `toSeller = price - (fee - fee/2)` and then `_pay(dealId, d.plug, fee, Leg.Plug)`. The plug receives `fee` (the full plug fee) while the seller receives `price - sellerHalf`. But at funding, the buyer only paid `price + buyerHalf` where `buyerHalf = fee/2`. The seller effectively contributes `sellerHalf = fee - fee/2`. If `plugFee` is odd (e.g. 1 unit), `fee/2` rounds down, `fee - fee/2` rounds up, and the seller loses an extra unit. The `FeeNotEven` check in `_checkTerms` prevents odd fees, so this is currently guarded. But the guard is a validation rule, not a mathematical invariant in the payout logic — removing or relaxing it in a future version could silently break accounting.

**Recommendation:** Add a comment on the payout legs explaining that the even-fee invariant is load-bearing for the accounting.

---

#### I-04 — Off-chain metadata is trusted entirely: `metadataHash` in terms is a hash, but nobody verifies what it commits to

**Location:** `Terms.metadataHash`, used in `termsHash`

**Detail:**  
The deal terms include a `metadataHash` covering the off-chain job description. The contract commits to it cryptographically (it's in the EIP-712 hash), but neither the contract nor the sponsor verifies what the hash covers. A malicious app could display different deal descriptions to buyer, seller, and plug while all parties sign the same hash. This is an application-layer issue.

**Recommendation:** Ensure the app always derives the `metadataHash` client-side from the displayed content, and ideally makes the raw metadata retrievable from the deal link so any party can verify the hash independently.

---

## Overall Risk Matrix

| ID | Title | Severity | Ease of Exploit | Status |
|---|---|---|---|---|
| M-01 | Buyer loses fee on plug-wins dispute | Medium | Requires design knowledge | Known / accepted |
| M-02 | Single EOA owner | Medium | Requires key compromise | Planned fix (Safe) |
| M-03 | Gas sponsor drainable via API abuse | Medium | Moderate (rate limit needed) | Open |
| L-01 | `releaseWithSig` deadline off-by-one | Low | Miner-assisted, unlikely | Open |
| L-02 | `withdrawMany` all-or-nothing batch failure | Low | Benign race | Open |
| L-03 | `_park` uint96 silent accumulation | Low | Requires huge cap increase | Open (negligible now) |
| L-04 | No permit support for smart wallet buyers | Low | UX only | Open |
| L-05 | 30-day terms window, no buyer binding | Low | Requires link leak | Open |
| L-06 | `sweepExcess` callable while paused | Low | Owner only | Open |
| I-01 | Revoked plug can still rule on open disputes | Info | By design | Accepted |
| I-02 | `cancelNonce` only cancels one nonce | Info | UX | Open |
| I-03 | Even-fee guard is load-bearing, not documented | Info | Future regression risk | Open |
| I-04 | Off-chain metadata not client-verified | Info | Application layer | Open |

---

## What Is Done Well

- **No owner custody of deal funds.** The owner cannot move USDC owed to any deal. The `sweepExcess` function is bounded by `totalHeld`. This is the most important property of any escrow and it holds unconditionally.
- **Fixed payout addresses.** Every payout destination is written at funding time and never changes. A compromised owner, plug, or relay cannot redirect money.
- **Parking pattern.** Rather than reverting when a payout fails (e.g. blocklisted recipient), the contract parks the amount and allows anyone to retry later. This prevents one blocklisted address from freezing funds for everyone else.
- **`Ownable2Step`.** Ownership transfer requires a two-step acceptance, preventing accidental transfer to the zero address or a typo.
- **`ReentrancyGuard` on all state-changing paths.** All external entry points are `nonReentrant`. The residual Slither `reentrancy-no-eth` findings are accepted because the only callee is USDC (no callbacks).
- **EIP-712 with chain ID and contract address.** Signatures are domain-separated and cannot be replayed across chains or contracts.
- **Nonce-based release signatures.** The early-release signature includes a per-buyer nonce that is consumed on use and can be cancelled, preventing replay.
- **100% test coverage, mutation testing, invariant suite.** This is unusually thorough for an unaudited contract. All 9 invariant tests cover the money conservation properties that matter most.
- **Pause only blocks entry, never exit.** Users can always withdraw, refund, or dispute while the contract is paused. There is no griefing vector through the pause mechanism.

---

## Pre-Audit Checklist

Before seeking an external audit or raising the caps, address these in priority order:

1. **Move owner to a 2-of-3 Safe (M-02).** This is blocking.
2. **Rate-limit the gas sponsor endpoint (M-03).** Add per-address and per-deal limits with alerting.
3. **Document the plug-wins fee asymmetry in the UI (M-01).** At minimum, the dispute-open screen must show the buyer how much they will recover.
4. **Fix the `releaseWithSig` off-by-one (L-01).** Change `>` to `>=` in the deadline check.
5. **Add buyer binding to Terms (L-05).** Optional `buyer` field that defaults to `address(0)` for backward compatibility.
6. **Review `_park` overflow comment (L-03) and I-03.** Minimal cost, prevents future regressions.
