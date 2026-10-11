#!/usr/bin/env bash
# Sends gas USDC from the deployer to the owner, plug, seller and keeper (native transfers; 1 USDC = 1e18 units).
# Skips any role that already holds at least its target. Usage: script/fund-roles.sh [env-file]
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.foundry/bin:$PATH"
ENV_FILE=${1:-$HOME/plug360-internal/testnet.env}
set -a; . "$ENV_FILE"; set +a
USDC=0x3600000000000000000000000000000000000000
bal() { cast call $USDC 'balanceOf(address)(uint256)' "$1" --rpc-url "$RPC_URL" | awk '{print $1}'; }
send() { # address, whole USDC
  local have; have=$(bal "$1")
  if [ "$have" -ge $(( $2 * 1000000 )) ]; then echo "skip $1 (has $have)"; return; fi
  cast send "$1" --value "$2ether" --private-key "$DEPLOYER_KEY" --rpc-url "$RPC_URL" \
    --gas-price 25gwei --priority-gas-price 1gwei --json \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["transactionHash"], "status", d["status"])'
}
send "$OWNER_ADDR" 1
send "$PLUG_ADDR" 1
send "$SELLER_ADDR" 1
send "$KEEPER_ADDR" 2
for r in DEPLOYER OWNER PLUG SELLER KEEPER BUYER; do a="${r}_ADDR"; echo "$r ${!a} $(bal "${!a}")"; done
