#!/usr/bin/env bash
#
# MiniLedger end-to-end demo — walks the full ledger flow against a running instance.
#
#   BASE_URL=https://ledger.deviego.xyz TOKEN=<accesscore-jwt> ./scripts/demo.sh
#
# TOKEN must be an AccessCore bearer for a subject granted ledger.* on
# {type:"ledger", id:"miniledger"}. Requires: bash, curl, jq. No token is printed.
#
set -euo pipefail

BASE_URL="${BASE_URL:-https://ledger.deviego.xyz}"
: "${TOKEN:?set TOKEN to an AccessCore bearer (ledger.* on ledger:miniledger)}"

auth=(-H "Authorization: Bearer ${TOKEN}")
json=(-H 'Content-Type: application/json')

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
api() { curl -sS "$@"; }
body() { jq -nc "$@"; }

step "1/9  Liveness & readiness (public — no token)"
api "${BASE_URL}/health" | jq .
api "${BASE_URL}/ready" | jq .

step "2/9  Accounts visible to the caller — locate the @world USD system account"
accounts="$(api "${auth[@]}" "${BASE_URL}/accounts")"
echo "$accounts" | jq .
world="$(echo "$accounts" | jq -r '[.[] | select(.type=="system" and .currency=="USD")][0].id')"
printf '   @world USD → %s\n' "$world"

step "3/9  Open two USD accounts (A, B)"
a_resp="$(api "${auth[@]}" "${json[@]}" -d '{"currency":"USD"}' "${BASE_URL}/accounts")"
echo "$a_resp" | jq .
a="$(echo "$a_resp" | jq -r .id)"
b_resp="$(api "${auth[@]}" "${json[@]}" -d '{"currency":"USD"}' "${BASE_URL}/accounts")"
echo "$b_resp" | jq .
b="$(echo "$b_resp" | jq -r .id)"

step "4/9  Deposit 1000 from @world to A  (Idempotency-Key: demo-deposit-1)"
api "${auth[@]}" "${json[@]}" -H 'Idempotency-Key: demo-deposit-1' \
  -d "$(body --arg f "$world" --arg t "$a" '{from:$f,to:$t,amount:"1000",currency:"USD"}')" \
  "${BASE_URL}/transfers" | jq .

step "5/9  Retry the SAME deposit (same Idempotency-Key) — a no-op, never a double spend"
api "${auth[@]}" "${json[@]}" -H 'Idempotency-Key: demo-deposit-1' \
  -d "$(body --arg f "$world" --arg t "$a" '{from:$f,to:$t,amount:"1000",currency:"USD"}')" \
  "${BASE_URL}/transfers" | jq .

step "6/9  Transfer 300 from A to B"
transfer="$(api "${auth[@]}" "${json[@]}" \
  -d "$(body --arg f "$a" --arg t "$b" '{from:$f,to:$t,amount:"300",currency:"USD"}')" \
  "${BASE_URL}/transfers")"
echo "$transfer" | jq .
txid="$(echo "$transfer" | jq -r .id)"

step "7/9  A's statement — double-entry history with running balance"
api "${auth[@]}" "${BASE_URL}/accounts/${a}/statement" | jq .

step "8/9  Reverse the A→B transfer (compensating entry, once-only)"
api "${auth[@]}" "${json[@]}" \
  -d "$(body --arg id "$txid" '{transactionId:$id}')" \
  "${BASE_URL}/reversals" | jq .

step "9/9  Audit — verify A's hash chain, then system-wide conservation of money"
api "${auth[@]}" "${BASE_URL}/audit/accounts/${a}" | jq .
api "${auth[@]}" "${BASE_URL}/audit/conservation" | jq .

printf '\n\033[1;32m✓ demo complete\033[0m\n'
