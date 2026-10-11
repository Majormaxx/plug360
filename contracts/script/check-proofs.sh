#!/usr/bin/env bash
# Independently checks a proof run on-chain: every broadcast transaction must have a successful receipt and
# the escrow must end owing nothing. Usage: script/check-proofs.sh [env-file]
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."
ENV_FILE=${1:-$HOME/plug360-internal/testnet.env}
set -a
. "$ENV_FILE"
set +a
USDC=0x3600000000000000000000000000000000000000
RUN="broadcast/Proofs.s.sol/$CHAIN/run-latest.json"
ESCROW=$(python3 -c "import json; print(json.load(open('deployments/$CHAIN.json'))['escrow'])")

ok=0
bad=0
for h in $(python3 -c "import json; print(' '.join(t['hash'] for t in json.load(open('$RUN'))['transactions']))"); do
  status=$(cast receipt "$h" status --rpc-url "$RPC_URL")
  if [ "$status" = true ] || [ "$status" = 1 ]; then
    ok=$((ok + 1))
  else
    bad=$((bad + 1))
    echo "FAILED $h ($status)"
  fi
done
echo "receipts: ok=$ok failed=$bad"

held=$(cast call "$ESCROW" 'totalHeld()(uint256)' --rpc-url "$RPC_URL" | cut -d' ' -f1)
balance=$(cast call "$USDC" 'balanceOf(address)(uint256)' "$ESCROW" --rpc-url "$RPC_URL" | cut -d' ' -f1)
echo "escrow $ESCROW totalHeld=$held balance=$balance"
for role in SELLER PLUG BUYER; do
  var="${role}_ADDR"
  echo "$role ${!var} $(cast call "$USDC" 'balanceOf(address)(uint256)' "${!var}" --rpc-url "$RPC_URL" | cut -d' ' -f1)"
done

[ "$bad" = 0 ] && [ "$held" = 0 ] && [ "$balance" = 0 ] && echo "proof run verified" || { echo "proof run NOT verified"; exit 1; }
