#!/usr/bin/env bash
# One-shot evaluation run for the paper (NOT a CI pipeline).
#
# Brings the whole stack up from a clean state, waits — however long dkg-node needs — until
# the system is FUNCTIONALLY ready (real HTTP responses, not just container "healthy", which
# lies), then runs the benchmarks and leaves the stack up so you can inspect / record.
#
#   ./run-eval.sh                 # clean bring-up + correctness + gas
#   KEEP_STATE=1 ./run-eval.sh    # skip the destructive `down -v` (reuse current volumes)
#   COMPOSE_DIR=/path ./run-eval.sh
#
# Readiness is gated on functional endpoints because on this stack the container healthchecks
# are unreliable (evm reports unhealthy while serving; dkg-node reports healthy before it can
# accept writes). A clean bring-up is what avoids the web3 nonce-drift that otherwise blocks
# DKG writes — see README.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_DIR="${COMPOSE_DIR:-$HERE/../ehealth-governance-demo}"
READY_TIMEOUT="${READY_TIMEOUT:-2400}"   # seconds to wait for the stack (dkg-node is slow)
DKG_SETTLE="${DKG_SETTLE:-60}"           # extra settle after HTTP is up, for DKG to stabilise

# Endpoints to poll (host mappings). name|url
SERVICES=(
  "evm|http://127.0.0.1:3010/health"
  "mfssia|http://127.0.0.1:4000/api/rx-governance/policies"
  "patient|http://127.0.0.1:3001/api/patients"
  "lab|http://127.0.0.1:3002/api/results"
  "hospital|http://127.0.0.1:3003/api/doctors"
  "pharmacy|http://127.0.0.1:3004/api/prescriptions"
)

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

http_ok() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1" 2>/dev/null)" = "200" ]; }

wait_ready() {
  local deadline=$(( $(date +%s) + READY_TIMEOUT ))
  local pending=("${SERVICES[@]}")
  while [ "${#pending[@]}" -gt 0 ]; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "TIMEOUT after ${READY_TIMEOUT}s — still not ready:"; printf '   - %s\n' "${pending[@]%%|*}"
      return 1
    fi
    local still=()
    for s in "${pending[@]}"; do
      if http_ok "${s#*|}"; then echo "   ✓ ${s%%|*} ready"; else still+=("$s"); fi
    done
    pending=("${still[@]}")
    [ "${#pending[@]}" -gt 0 ] && { echo "   waiting on: ${pending[*]%%|*}"; sleep 10; }
  done
}

# ── 1. Clean bring-up ──────────────────────────────────────────────────────────
cd "$COMPOSE_DIR" || { echo "compose dir not found: $COMPOSE_DIR"; exit 1; }
if [ "${KEEP_STATE:-0}" = "1" ]; then
  log "Bringing stack up (reusing existing volumes)"
else
  log "Tearing down (clean state: down -v)"; docker compose down -v --remove-orphans
fi
log "docker compose up -d (this is slow — dkg-node deploys 2 chains + 5 ot-nodes)"
docker compose up -d || { echo "compose up failed"; exit 1; }

# ── 2. Wait for functional readiness ───────────────────────────────────────────
log "Waiting for the stack to be functionally ready (up to ${READY_TIMEOUT}s)"
wait_ready || { echo "stack not ready — aborting before tests"; exit 1; }
log "All HTTP endpoints up. Settling ${DKG_SETTLE}s for the DKG to stabilise."
sleep "$DKG_SETTLE"

# ── 3. Run benchmarks ──────────────────────────────────────────────────────────
cd "$HERE"
[ -d node_modules ] || { log "npm install"; npm install; }

# Generous consent-anchor timeout: first DKG writes on a fresh stack can lag.
export CONSENT_TIMEOUT_MS="${CONSENT_TIMEOUT_MS:-600000}"

log "RQ1 — bench:correctness"
npm run --silent bench:correctness; CORR=$?

log "RQ2/RQ4 — bench:gas"
npm run --silent bench:gas; GAS=$?

# ── 4. Summary ─────────────────────────────────────────────────────────────────
log "Done. Results in $HERE/results/ (stack left running)."
echo "   correctness exit=$CORR   gas exit=$GAS"
echo "   plots:  python notebooks/plots.py"
exit $(( CORR != 0 ? CORR : GAS ))
