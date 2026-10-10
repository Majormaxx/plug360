#!/usr/bin/env bash
# Full dress rehearsal on a local fork of Arc testnet (real Arc USDC, Memo and blocklist behavior, no real funds):
# deploy -> list a plug -> run every proof path -> check the escrow balances to zero. Uses fresh random keys,
# because Arc testnet blocklists the well-known Foundry/Hardhat test accounts.
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."
PORT=${PORT:-8547}
RPC=http://127.0.0.1:$PORT
FORK=${FORK_URL:-https://rpc.testnet.arc.io}
GAS=(--network arc --with-gas-price 25gwei --priority-gas-price 1gwei)

arc-anvil --network arc --fork-url "$FORK" --port "$PORT" --silent \
  --retries 30 --fork-retry-backoff 3000 --timeout 120000 &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
for _ in $(seq 1 45); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 2; done
echo "fork ready: chain $(cast chain-id --rpc-url "$RPC") block $(cast block-number --rpc-url "$RPC")"

key() { cast wallet new --json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["private_key"])'; }
fund() { cast rpc anvil_setBalance "$(cast wallet address "$1")" 0x3635C9ADC5DEA00000 --rpc-url "$RPC" >/dev/null; }
DEPLOYER=$(key); OWNER_KEY=$(key); SELLER=$(key); PLUG=$(key); BUYER=$(key)
for k in "$DEPLOYER" "$OWNER_KEY" "$SELLER" "$PLUG" "$BUYER"; do fund "$k"; done

echo "== deploy"
OWNER=$(cast wallet address "$OWNER_KEY") arc-forge script script/Deploy.s.sol --rpc-url "$RPC" \
  --private-key "$DEPLOYER" --broadcast "${GAS[@]}" >/tmp/rehearse-deploy.log 2>&1 || { tail -20 /tmp/rehearse-deploy.log; exit 1; }
ESCROW=$(python3 -c 'import json; print(json.load(open("deployments/5042002.json"))["escrow"])')
echo "escrow $ESCROW"

echo "== list plug"
ESCROW=$ESCROW arc-forge script script/Admin.s.sol --sig "setPlugLevel(address,uint8)" "$(cast wallet address "$PLUG")" 1 \
  --rpc-url "$RPC" --private-key "$OWNER_KEY" --broadcast "${GAS[@]}" >/tmp/rehearse-admin.log 2>&1 || { tail -20 /tmp/rehearse-admin.log; exit 1; }

echo "== proofs"
# The fork pulls Arc state over the network; on a flaky connection a broadcast can stall mid-run.
# --resume continues the same broadcast from the last confirmed transaction instead of starting over.
proofs() { ESCROW=$ESCROW SELLER_KEY=$SELLER PLUG_KEY=$PLUG BUYER_KEY=$BUYER arc-forge script script/Proofs.s.sol \
  --rpc-url "$RPC" --broadcast --slow "${GAS[@]}" "$@" >>/tmp/rehearse-proofs.log 2>&1; }
: >/tmp/rehearse-proofs.log
proofs || { for i in 1 2 3; do echo "proof broadcast interrupted; resuming ($i)"; sleep 15; proofs --resume && break; done; } \
  || { tail -30 /tmp/rehearse-proofs.log; exit 1; }
python3 script/proof-table.py 5042002 | tee /tmp/rehearse-table.md
rows=$(grep -c '^| \(canary\|P[1-5]\) ' /tmp/rehearse-table.md || true)
bad=$(grep -c 'status ' /tmp/rehearse-table.md || true)
[ "$rows" -ge 16 ] && [ "$bad" = 0 ] || { echo "proof receipts incomplete: rows=$rows failed=$bad"; exit 1; }

held=$(cast call "$ESCROW" 'totalHeld()(uint256)' --rpc-url "$RPC")
bal=$(cast call 0x3600000000000000000000000000000000000000 'balanceOf(address)(uint256)' "$ESCROW" --rpc-url "$RPC")
echo "totalHeld=$held escrowBalance=$bal"
[ "$held" = 0 ] && [ "$bal" = 0 ] || { echo "rehearsal left funds in the escrow"; exit 1; }
# The rehearsal writes fork artifacts; keep them out of the real deployment record.
rm -f deployments/5042002.json deployments/5042002-proofs.json
rm -rf broadcast/*/5042002
echo "== rehearsal passed"
