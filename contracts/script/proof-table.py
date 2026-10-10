#!/usr/bin/env python3
"""Turns a Proofs.s.sol broadcast into the README proof table (path, step, transaction link).

Usage: python3 script/proof-table.py <chainId>
Reads broadcast/Proofs.s.sol/<chainId>/run-latest.json and deployments/<chainId>-proofs.json.
"""
import json
import sys
from pathlib import Path

EXPLORERS = {5042: "https://explorer.arc.io/tx/", 5042002: "https://explorer.testnet.arc.io/tx/"}
STEPS = {
    "approve": "buyer approves escrow",
    "pay": "buyer pays",
    "refund": "seller sends it back",
    "openDispute": "buyer disputes",
    "plugRefund": "plug rules for the buyer",
    "plugReject": "plug rejects the dispute",
    "withdraw": "payout",
    "releaseWithSig": "signed release, relayed",
}
ORDER = ["canary", "P1", "P2", "P3", "P4", "P5"]


def main(chain_id: int) -> None:
    run = json.loads(Path(f"broadcast/Proofs.s.sol/{chain_id}/run-latest.json").read_text())
    receipts = {r["transactionHash"]: r for r in run.get("receipts", [])}
    base = EXPLORERS.get(chain_id, "")
    rows, path_idx = [], -1
    for tx in run["transactions"]:
        fn = (tx.get("function") or "").split("(")[0]
        if fn == "pay":
            path_idx += 1
        label = ORDER[path_idx] if 0 <= path_idx < len(ORDER) else "setup"
        h = tx["hash"]
        status = receipts.get(h, {}).get("status")
        ok = "ok" if status in ("0x1", 1, True) else f"status {status}"
        rows.append(f"| {label} | {STEPS.get(fn, fn)} | [{h[:10]}...]({base}{h}) | {ok} |")
    print("| Path | Step | Transaction | Result |\n|---|---|---|---|")
    print("\n".join(rows))


if __name__ == "__main__":
    main(int(sys.argv[1]))
