#!/usr/bin/env bash
# Container entrypoint: wait for the stack, then run the benches.
#   - correctness runs under vitest → emits allure-results/ (rendered to HTML on the host)
#     and results/correctness.csv
#   - gas writes results/gas.csv
#   - report.mjs writes results/REPORT.md
# Exits non-zero if correctness fails (skips/blocked do not fail the run).
set -uo pipefail

node lib/wait-ready.mjs || { echo "[eval] stack not ready — aborting"; exit 1; }

echo "[eval] === RQ1 correctness (vitest + allure) ==="
npx vitest run; CORR=$?

echo "[eval] === RQ2/RQ4 bench:gas ==="
node bench-gas/bench-gas.mjs; GAS=$?

echo "[eval] === summary report ==="
node report.mjs || true

echo "[eval] done. correctness=$CORR gas=$GAS. CSVs + allure-results are on the host."
echo "[eval] render the Allure report on the host:  npm run report:allure"
if [ "$CORR" -ne 0 ]; then exit "$CORR"; fi
exit "$GAS"
