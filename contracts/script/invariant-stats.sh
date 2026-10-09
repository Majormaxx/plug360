#!/usr/bin/env bash
# Summarizes how often each handler action ran across an invariant campaign.
# Usage: rm -f cache/invariant-stats.csv && forge test --match-path 'test/invariant/**' --mt invariant_heldCap && script/invariant-stats.sh
set -euo pipefail
f=${1:-cache/invariant-stats.csv}
awk -F, 'BEGIN{split("pay openDispute release sellerRefund plugRule finalize withdraw retry togglePause toggleBlock",n," ")}
  {runs++; for(i=1;i<=NF;i++){t[i]+=$i; if($i>0) hit[i]++}}
  END{printf "runs=%d\n", runs; for(i=1;i<=10;i++) printf "%-13s total=%-7d runs_with_any=%d\n", n[i], t[i], hit[i]}' "$f"
