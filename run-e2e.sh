#!/usr/bin/env bash
# Launch the environment PLUS the dockerized e2e/benchmark runner.
# The `evaluation` container waits (in-network) until the stack is functionally ready, runs
# the benches, writes CSVs to ./results, then exits. The rest of the stack is left running.
#
#   ./run-e2e.sh              # clean bring-up (down -v first) + tests
#   KEEP_STATE=1 ./run-e2e.sh # reuse existing volumes
set -uo pipefail

# Use the legacy builder: BuildKit fails on this host with a ~/.docker/.token_seed permission
# error. Override by exporting DOCKER_BUILDKIT=1 if your machine is fine.
export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-0}"
export COMPOSE_DOCKER_CLI_BUILD="${COMPOSE_DOCKER_CLI_BUILD:-0}"

HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="${BASE:-$HERE/../ehealth-governance-demo/docker-compose.yml}"
EVAL="$HERE/docker-compose.eval.yml"
DC=(docker compose -f "$BASE" -f "$EVAL")

[ -f "$BASE" ] || { echo "base compose not found: $BASE"; exit 1; }

if [ "${KEEP_STATE:-0}" != "1" ]; then
  echo "==> Clean state: down -v"; "${DC[@]}" down -v --remove-orphans
fi

echo "==> Building + starting stack and evaluation runner"
"${DC[@]}" up -d --build || { echo "compose up failed"; exit 1; }

echo "==> Following evaluation logs (it waits for readiness, then runs the benches)"
"${DC[@]}" logs -f evaluation

cid="$("${DC[@]}" ps -q evaluation)"
code="$(docker inspect -f '{{.State.ExitCode}}' "$cid" 2>/dev/null || echo '?')"
echo "==> evaluation exited: $code   (CSVs in $HERE/results/, stack left running)"
echo "    plots: python notebooks/plots.py"
[ "$code" = "0" ] && exit 0 || exit 1
