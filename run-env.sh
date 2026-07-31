#!/usr/bin/env bash
# Launch ONLY the environment (the stack as before) — no tests.
# Use this for the demo / recording. For env + dockerized tests, use run-e2e.sh.
#
#   ./run-env.sh              # clean bring-up (down -v first)
#   KEEP_STATE=1 ./run-env.sh # reuse existing volumes
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="${BASE:-$HERE/../ehealth-governance-demo/docker-compose.yml}"

cd "$(dirname "$BASE")" || { echo "base compose not found: $BASE"; exit 1; }
if [ "${KEEP_STATE:-0}" != "1" ]; then
  echo "==> Clean state: docker compose down -v"; docker compose down -v --remove-orphans
fi
echo "==> docker compose up -d (dkg-node is slow — this is expected)"
docker compose up -d
echo "==> Stack starting. Watch: docker compose logs -f dkg-node"
