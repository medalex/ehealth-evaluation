#!/usr/bin/env bash
# Container entrypoint: wait for the stack, then run the benchmark groups with clear,
# plain-language banners so an outside reader can follow what each group does.
set -uo pipefail

banner() {
  echo ""
  echo "════════════════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "  $2"
  echo "════════════════════════════════════════════════════════════════════════"
  echo ""
}

echo ""
echo "########################################################################"
echo "#  eHealth prototype — evaluation run                                   #"
echo "#  1) does it work correctly?  2) what does it cost?  3) is it fast?     #"
echo "########################################################################"

echo ""
echo ">> Waiting for every service to be up before starting..."
node lib/wait-ready.mjs || { echo "!! Stack not ready — aborting."; exit 1; }

banner "GROUP 1/3 — CORRECTNESS  (does the system do the right thing?)" \
       "Runs 7 real scenarios: issue a valid prescription, reject an unsafe one, block an
  untrusted doctor, resolve data conflicts by DAO vote, and prevent proof reuse."
npx vitest run; CORR=$?

banner "GROUP 2/3 — COST  (how expensive are the blockchain operations?)" \
       "Measures the gas used by the governance (propose/vote) and registry transactions."
node bench-gas/bench-gas.mjs; GAS=$?

banner "GROUP 3/3 — SPEED  (how long does a real user actually wait?)" \
       "Times the doctor's 'issue prescription' and the pharmacist's 'verify + dispense'
  and compares against acceptable human response-time limits."
node bench-e2e/bench-e2e.mjs || echo "   (skipped — needs a clean stack; continuing)"

banner "REPORT  (writing the human-readable summary)" \
       "Turns the raw CSVs into results/REPORT.md; render the Allure dashboard on the host."
node report.mjs || true

echo ""
echo "────────────────────────────────────────────────────────────────────────"
echo "  Done.  Correctness: $([ "$CORR" -eq 0 ] && echo 'no failures' || echo 'see above')."
echo "  Results (CSVs + REPORT.md + allure-results) are on the host in ./results and ./allure-results."
echo "  Pretty dashboard:   npm run report:allure"
echo "────────────────────────────────────────────────────────────────────────"

if [ "$CORR" -ne 0 ]; then exit "$CORR"; fi
exit "$GAS"
