#!/usr/bin/env bash
# Container entrypoint: wait for the stack to be functionally ready, then run the benches.
# Correctness and gas both run even if the first fails; the container exits with the first
# non-zero code so `docker wait` / CI can see failure.
set -uo pipefail

node lib/wait-ready.mjs || { echo "[eval] stack not ready — aborting"; exit 1; }

echo "[eval] === RQ1 bench:correctness ==="
node bench-correctness/run.mjs; CORR=$?

echo "[eval] === RQ2/RQ4 bench:gas ==="
node bench-gas/bench-gas.mjs; GAS=$?

echo "[eval] done. correctness=$CORR gas=$GAS. CSVs in /app/results."
if [ "$CORR" -ne 0 ]; then exit "$CORR"; fi
exit "$GAS"
