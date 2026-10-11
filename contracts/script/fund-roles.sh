#!/usr/bin/env bash
# Sends gas USDC from the deployer to the owner, plug, seller, keeper and buyer (native transfers; 1 USDC = 1e18
# units). Targets are in USDC and can be fractional; override with FUND_OWNER, FUND_PLUG, FUND_SELLER,
# FUND_KEEPER, FUND_BUYER. Skips any role that already holds its target. Usage: script/fund-roles.sh [env-file]
# A full mainnet run (deploy, list a plug, all proof paths, keeper headroom) fits in about 2 USDC:
#   FUND_OWNER=0.05 FUND_PLUG=0.05 FUND_SELLER=0.15 FUND_KEEPER=0.3 FUND_BUYER=1.2 script/fund-roles.sh mainnet.env
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.foundry/bin:$PATH"
ENV_FILE=${1:-$HOME/plug360-internal/testnet.env}
set -a; . "$ENV_FILE"; set +a
USDC=0x3600000000000000000000000000000000000000
bal() { cast call $USDC 'balanceOf(address)(uint256)' "$1" --rpc-url "$RPC_URL" | awk '{print $1}'; }
units() { python3 -c "import sys; from decimal import Decimal; print(int(Decimal(sys.argv[1]) * 1000000))" "$1"; }
send() { # address, USDC amount (fractional allowed)
  local have want; have=$(bal "$1"); want=$(units "$2")
  if [ "$have" -ge "$want" ]; then echo "skip $1 (has $have)"; return; fi
  cast send "$1" --value "$2ether" --private-key "$DEPLOYER_KEY" --rpc-url "$RPC_URL" \
    --gas-price 25gwei --priority-gas-price 1gwei --json \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["transactionHash"], "status", d["status"])'
}
send "$OWNER_ADDR" "${FUND_OWNER:-1}"
send "$PLUG_ADDR" "${FUND_PLUG:-1}"
send "$SELLER_ADDR" "${FUND_SELLER:-1}"
send "$KEEPER_ADDR" "${FUND_KEEPER:-2}"
[ -n "${FUND_BUYER:-}" ] && send "$BUYER_ADDR" "$FUND_BUYER"
for r in DEPLOYER OWNER PLUG SELLER KEEPER BUYER; do a="${r}_ADDR"; echo "$r ${!a} $(bal "${!a}")"; done
