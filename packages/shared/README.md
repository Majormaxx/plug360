# @plug360/shared

The contract boundary for every Plug360 component that runs off-chain. It holds the DealEscrow ABI, the Arc chain definitions, the EIP-712 typed data and hashing helpers, the funding-rule checks and the Arc fee rule. Anything that talks to DealEscrow imports from here instead of copying values.

## Contents

| File | What it holds |
|---|---|
| `src/abi.ts` | `dealEscrowAbi`, generated from the Foundry artifact. Do not edit by hand. |
| `src/chains.ts` | `arcMainnet` (viem's `arc`, id checked to be 5042), `arcTestnet` (current RPC and explorer), `USDC`, `MEMO`, `MULTICALL3FROM`, `MIN_FEE_GWEI`, `MAX_LOG_BLOCKS` |
| `src/eip712.ts` | `termsTypedData`, `acceptTypedData`, `releaseTypedData`, `termsHash`, `termsDigest`, `acceptDigest`, `releaseDigest`, `dealIdOf`, `escrowedAmount`, `splitFee`, `levelCap`, `validateTerms`, contract limit constants |
| `src/fees.ts` | `feeOverrides(publicClient)`: `maxFeePerGas = max(2 x baseFee, 25 gwei)`, priority 1 gwei |
| `src/types.ts` | `DealStatus`, `RefundReason`, `Deal` |

USDC amounts are 6-decimal base units everywhere in this package. The native gas balance on Arc is the same USDC reported with 18 decimals; the two scales are never mixed.

## Usage

```ts
import { acceptTypedData, feeOverrides, termsTypedData, validateTerms } from '@plug360/shared';

const domain = { chainId: 5042, escrow };
const problems = validateTerms(terms, { now, plugLevel, buyer, refundTo });
if (problems.length === 0) {
  const sellerSig = await sellerWallet.signTypedData(termsTypedData(domain, terms));
  const plugSig = await plugWallet.signTypedData(acceptTypedData(domain, terms));
  await buyerWallet.writeContract({ ..., ...(await feeOverrides(publicClient)) });
}
```

`validateTerms` returns every violated funding rule at once, each tagged with the contract's custom error name (`FeeTooHigh`, `ExceedsPlugLevel`, ...) so a form can point at the right field. Checks that need the buyer, refund address or `totalHeld` run only when those are passed. `InvalidValue` marks a value the ABI cannot encode at all.

## Regenerating the ABI

```sh
cd contracts && forge build && cd ..
pnpm --filter @plug360/shared gen:abi     # rewrite src/abi.ts
pnpm --filter @plug360/shared check:abi   # exit 1 if src/abi.ts is stale
```

The test suite runs the check too, so a contract change without a regenerated ABI fails the tests.

## Tests

```sh
pnpm --filter @plug360/shared test
```

Requires Foundry (`anvil`, `forge`) on `PATH` or in `~/.foundry/bin`, and the compiled artifacts in `contracts/out` (built automatically if missing).

- `test/contract.test.ts` starts anvil with chain id 5042, deploys the compiled DealEscrow and MockUSDC, and compares `termsHash`, `termsDigest`, `acceptDigest`, `releaseDigest`, `dealIdOf`, `levelCap` and the limit constants with the contract's own view functions over 150 random inputs each. It funds a deal with signatures from viem's `signTypedData`, relays a signed early release, and checks that `validateTerms` reports exactly the error `pay` reverts with for each broken rule.
- `test/validate.test.ts` covers every rule boundary of `validateTerms` and the fee helpers.
- `test/chains-fees.test.ts` covers the chain definitions, the fee rule (including against a node with a high base fee) and the ABI staleness check.
