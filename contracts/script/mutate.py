#!/usr/bin/env python3
"""Mutation check for DealEscrow: apply one deliberate bug at a time and require the test suite to fail.

Usage: python3 script/mutate.py   (restores the source after every mutant; exits 1 if any mutant survives)
"""
import os
import subprocess
import sys
from pathlib import Path

SRC = Path("src/DealEscrow.sol")
MUTANTS = [
    ("seller paid full price on settle", "uint256 toSeller = d.price - (fee - fee / 2);", "uint256 toSeller = d.price;"),
    ("plug ruling refund pays escrow", "_pay(dealId, d.refundTo, d.price, Leg.Refund);", "_pay(dealId, d.refundTo, _escrowed(d), Leg.Refund);"),
    ("plug paid on seller refund", "emit Refunded(dealId, reason, amount, 0);", "emit Refunded(dealId, reason, amount, 0);\n        _pay(dealId, d.plug, d.plugFee / 2, Leg.Plug);"),
    ("dispute boundary off by one", "if (block.timestamp >= d.releaseAt) revert WindowClosed();", "if (block.timestamp > d.releaseAt) revert WindowClosed();"),
    ("withdraw boundary off by one", "if (block.timestamp < d.releaseAt) revert WindowOpen();", "if (block.timestamp <= d.releaseAt) revert WindowOpen();"),
    ("plug deadline off by one", "if (block.timestamp >= uint256(d.disputedAt) + PLUG_WINDOW) revert PlugDeadlinePassed();", "if (block.timestamp > uint256(d.disputedAt) + PLUG_WINDOW) revert PlugDeadlinePassed();"),
    ("timeout finalize early", "if (block.timestamp < uint256(d.disputedAt) + PLUG_WINDOW) revert PlugDeadlineNotReached();", "if (block.timestamp < uint256(d.disputedAt)) revert PlugDeadlineNotReached();"),
    ("no same-party check", "if (terms.plug == terms.seller || terms.plug == buyer || terms.seller == buyer) revert SameParty();", ""),
    ("refundTo may be seller", "if (refundTo == terms.seller || refundTo == terms.plug) revert InvalidRefundTo();", ""),
    ("no level cap", "if (terms.price > levelCap(level)) revert ExceedsPlugLevel();", ""),
    ("no fee cap", "if (terms.plugFee > terms.price || terms.plugFee * 10_000 > terms.price * MAX_FEE_BPS) revert FeeTooHigh();", "if (terms.plugFee > terms.price) revert FeeTooHigh();"),
    ("no plug signature check", "if (!SignatureChecker.isValidSignatureNow(terms.plug, acceptDigest(th, terms.plug), plugSig)) {", "if (false) {"),
    ("no seller signature check", "if (!SignatureChecker.isValidSignatureNow(terms.seller, _hashTypedDataV4(th), sellerSig)) {", "if (false) {"),
    ("deal can be funded twice", "if (_deals[dealId].status != Status.None) revert OrderAlreadyPaid();", ""),
    ("held cap ignored", "if (totalHeld + escrowed > MAX_TOTAL_HELD) revert HeldCapExceeded();", ""),
    ("release nonce not consumed", "releaseNonce[buyer] = nonce + 1;", ""),
    ("anyone can refund as seller", "if (msg.sender != d.seller) revert CallerNotAllowed();\n        if (d.status != Status.Held && d.status != Status.Disputed) revert InvalidStatus();\n        _refundInFull", "if (d.status != Status.Held && d.status != Status.Disputed) revert InvalidStatus();\n        _refundInFull"),
    ("failed leg forgotten (not parked)", "        totalHeld += amount;\n        _park(dealId, leg, amount);\n        emit PayoutDeferred", "        emit PayoutDeferred"),
    ("retry drops failed leg", "        totalHeld += amount;\n        _park(dealId, leg, amount);\n    }", "    }"),
    ("sweep takes held funds", "uint256 amount = balance - totalHeld;", "uint256 amount = balance;"),
    ("pause blocks exits", "function withdraw(uint256 dealId) external nonReentrant {", "function withdraw(uint256 dealId) external nonReentrant whenNotPaused {"),
    ("dispute allowed twice", "if (d.status == Status.Disputed) revert AlreadyDisputed();\n        if (d.status != Status.Held) revert InvalidStatus();", "if (d.status != Status.Held && d.status != Status.Disputed) revert InvalidStatus();"),
    ("transfer mismatch unchecked", "if (USDC.balanceOf(address(this)) - balanceBefore != escrowed) revert TransferAmountMismatch();", ""),
    ("odd fee allowed", "if (terms.plugFee % 2 != 0) revert FeeNotEven();", ""),
]

env = dict(os.environ, FOUNDRY_INVARIANT_RUNS="64", FOUNDRY_FUZZ_RUNS="256")
original = SRC.read_text()
survivors = []
try:
    for name, find, replace in MUTANTS:
        if find not in original:
            print(f"SKIP (pattern not found) {name}")
            survivors.append(name + " [pattern missing]")
            continue
        SRC.write_text(original.replace(find, replace, 1))
        r = subprocess.run(["forge", "test", "--no-match-path", "test/arc/**", "--fail-fast"],
                           capture_output=True, text=True, env=env)
        killed = r.returncode != 0 and "Compiler run failed" not in r.stdout + r.stderr
        compile_err = "Compiler run failed" in r.stdout + r.stderr
        status = "killed" if killed else ("COMPILE ERROR" if compile_err else "SURVIVED")
        print(f"{status:14} {name}", flush=True)
        if not killed:
            survivors.append(name)
finally:
    SRC.write_text(original)
print(f"\n{len(MUTANTS) - len(survivors)}/{len(MUTANTS)} mutants killed")
sys.exit(1 if survivors else 0)
