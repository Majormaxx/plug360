#!/usr/bin/env bash
# Puts the mainnet secrets on Vercel production and redeploys, without pasting keys into the shell.
# Each value is typed at a hidden prompt, so it never lands in shell history or on screen.
# The gas sponsor key is read from the mainnet env file. Leave a prompt empty to skip that value.
# Usage: scripts/vercel-mainnet-env.sh [env-file]   (default ~/plug360-internal/mainnet.env)
set -euo pipefail
cd "$(dirname "$0")/.."
env_file=${1:-$HOME/plug360-internal/mainnet.env}

put() { # name value [--sensitive]
  printf '%s' "$2" | vercel env add "$1" production ${3:-} --force -y >/dev/null
  echo "set $1"
}

vercel env add NEXT_PUBLIC_CHAIN_ID production --value 5042 --no-sensitive --force -y >/dev/null && echo "set NEXT_PUBLIC_CHAIN_ID=5042"

sponsor=$(set -a; . "$env_file"; printf '%s' "${SPONSOR_KEY:-}")
[ -n "$sponsor" ] && put SPONSOR_PRIVATE_KEY "$sponsor" --sensitive || echo "skipped SPONSOR_PRIVATE_KEY (not in $env_file)"

read -rsp "Circle MAINNET App ID (Enter to skip): " app_id; echo
[ -n "$app_id" ] && put NEXT_PUBLIC_CIRCLE_APP_ID "$app_id"
read -rsp "Circle MAINNET API key, starts with LIVE_API_KEY: (Enter to skip): " api_key; echo
if [ -n "$api_key" ]; then
  case $api_key in LIVE_API_KEY:*) put CIRCLE_API_KEY "$api_key" --sensitive ;; *) echo "that is not a mainnet key (expected LIVE_API_KEY:...), skipped" ;; esac
fi
if [ -n "$app_id" ] && [ -z "$api_key" ] || [ -z "$app_id" ] && [ -n "$api_key" ]; then
  echo "warning: Google sign-in needs both the App ID and the API key; set the other one before relying on it"
fi

vercel deploy --prod --yes | grep -E 'Aliased|Error' || true
