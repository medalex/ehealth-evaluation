# Reproducing the evaluation — step by step

This guide takes a reviewer from nothing to the results (Allure dashboard + CSV + figures).
Everything runs from **pre-built images** — no per-service source build is needed.

## 0. Prerequisites

| Tool | Version used | For |
|------|--------------|-----|
| Docker + Compose v2 | 20.10 / v2.5 | running the stack |
| Node.js | 20.x | the benches / report generator |
| Java (JRE/JDK) | 17 | rendering the Allure HTML report |
| Python + pip | 3.x | figures (optional) |

> The `allure` CLI itself is bundled as an npm dependency (`allure-commandline`) — no separate
> install; it just needs Java on the PATH.

## 1. Get the two repos (siblings)

The evaluation harness drives the orchestrator repo, which pulls every service image from
`ghcr.io/medalex/*`. Clone them **next to each other**:

```bash
git clone https://github.com/medalex/ehealth-governance-demo.git
git clone https://github.com/medalex/ehealth-evaluation.git
cd ehealth-evaluation
npm install
```

## 2. Run everything from a clean state (one command)

```bash
./run-e2e.sh
```

What it does, in order:
1. `docker compose down -v` — **clean state** (this matters: see §5).
2. `docker compose up` — brings up the whole stack. **This is slow** (`dkg-node` deploys 2
   local chains + 5 OriginTrail nodes). That is expected and fine — this is a one-shot, not CI.
3. Waits until every service answers on HTTP (not just "container healthy", which is
   unreliable here), then settles briefly for the DKG.
4. Runs the benchmarks inside a container (`evaluation` service):
   - **RQ1 correctness** — 7 scenarios under vitest → `allure-results/` + `results/correctness.csv`
   - **RQ2/RQ4 gas** → `results/gas.csv`
   - a markdown summary → `results/REPORT.md`
5. Leaves the stack running so you can inspect the apps / record.

The results land in `ehealth-evaluation/results/` and `ehealth-evaluation/allure-results/` on
your host (bind-mounted out of the container).

## 3. See the results

**Allure dashboard** (the rich view):

```bash
npm run report:allure          # renders allure-results/ and opens the HTML report
```

Each scenario shows its status with `epic`/`feature`/`severity` labels and `expected`/`actual`
values. `BLOCKED`/`SKIP` appear as *skipped* (a precondition wasn't met, or the scenario is
manual) — those are **not** failures.

**Markdown summary** (quick, no Java):

```bash
npm run report                 # writes + prints results/REPORT.md
cat results/REPORT.md
```

**Figures for the paper** (optional):

```bash
pip install pandas matplotlib
python notebooks/plots.py       # -> figures/*.{pdf,eps}
```

**Raw data**: `results/*.csv` — one row per measurement, the primary committed data.

## 4. Expected outcome (clean run)

| Scenario | Expected |
|----------|----------|
| Sc1 valid prescription issued | ✅ PASS |
| Sc2 ZKP-rejected not issued | ✅ PASS |
| Sc3 access gate blocks unregistered doctor | ✅ PASS |
| Sc4 numeric conflict needs DAO consensus | ✅ PASS |
| Sc5 terminology conflict needs DAO consensus | ✅ PASS |
| Sc6 proof freshness / validity window | ⏭ SKIP (timed, validated manually) |
| Sc7 replay single-use | ✅ PASS |

Gas: `verifyProof` is **constant** regardless of circuit size (Groth16 O(1) verification) —
the headline result — while governance ops (`propose`/`vote`/`record`) are small fixed costs.

## 5. If scenarios come up 🚧 BLOCKED

`BLOCKED` on Sc1/Sc2/Sc7 means a precondition failed — almost always a **non-clean
environment**. If `dkg-node` was restarted *under* already-running services, their cached web3
nonce drifts from the fresh DKG chain, DKG writes fail ("Nonce too high"), consent never
anchors, and the access gate stays shut. Fix: re-run from clean (`./run-e2e.sh` does
`down -v` for you). Do **not** hand-patch a running stack — results must be reproducible.

## Alternatives

- **Environment only** (no tests, e.g. to record the demo): `./run-env.sh`
- **Host-based run** (benches on the host instead of in a container): `./run-eval.sh`
- **Just the tests** against an already-running clean stack: `npm test && npm run report:allure`
