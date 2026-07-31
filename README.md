# ehealth-evaluation

Design Science Research (DSR) evaluation harness for the eHealth ZKP/DAO prototype.
One reproducible package that measures artifacts living across the component repos —
without duplicating test code into each one.

> **Just want to run it and see results?** Follow **[QUICKSTART.md](QUICKSTART.md)** — a
> from-scratch, step-by-step guide (clone → `./run-e2e.sh` → `npm run report:allure`).

## Evaluation design (for the paper)

Ex-post, **artificial/technical** evaluation (FEDS "Technical Risk & Efficacy" quadrant):
controlled, reproducible measurements of a working artifact, not a naturalistic clinical
deployment. External validity limits (synthetic load, single-host stack) are reported under
Threats to Validity.

### Research questions → benchmark → data

| RQ | Question | Bench | Output |
|----|----------|-------|--------|
| RQ1 | Are the claimed guarantees implemented correctly across all 7 scenarios? | `bench-correctness` | `correctness.csv` |
| RQ2 | How do proof-gen time and gas scale with circuit / policy size? | `bench-zkp`, `bench-gas` | `zkp-scaling.csv`, `gas.csv` |
| RQ3 | What is the overhead of privacy + decentralisation vs a naive baseline? | `bench-e2e` | `e2e.csv` |
| RQ4 | What does k-of-n conflict resolution cost (txs / gas / time / scaling)? | `bench-dao`, `bench-gas` | `dao-conflict.csv`, `gas.csv` |

Headline result to foreground: Groth16 **verification gas and proof size are O(1)** —
constant regardless of circuit size (contrast with the growing proof-gen cost in RQ2).

## Layout

```
config/stack.json   endpoints + versions of the stack under test
lib/                shared config / api / rpc / timer / csv helpers (no per-bench duplication)
bench-correctness/  RQ1      7-scenario contract    -> results/correctness.csv  [runnable]
  scenarios.mjs       shared scenario definitions (single source of truth)
  run.mjs             framework-free CSV runner (container)
  correctness.test.mjs  vitest + Allure suite (npm test)
report.mjs          results/*.csv -> results/REPORT.md (markdown summary)
bench-gas/          RQ2/RQ4  on-chain gas           -> results/gas.csv          [runnable]
bench-e2e/          RQ3      end-to-end latency      -> results/e2e.csv          [TODO]
bench-dao/          RQ4      conflict round-trip     -> results/dao-conflict.csv [TODO]
bench-zkp/          RQ2      circuit scaling         -> results/zkp-scaling.csv  [TODO]
results/            raw CSV — one row per run, committed as primary data
notebooks/plots.py  CSV -> IEEE figures in figures/
figures/            exported .pdf/.eps for LaTeX
```

### bench-correctness outcomes

`PASS` / `FAIL` (artifact behaved / did not behave as specified), plus `BLOCKED` — a
precondition could not be established (e.g. consent never anchored in the DKG, typically an
unhealthy `dkg-node`), which is **not** an artifact defect — and `SKIP` (the slow timed
freshness scenario, validated manually per the governance-demo README). Sc4/Sc5 assert the
core claim deterministically and DKG-write-independently: a semantic conflict is detected and
resolving theory T is refused (403) until the DAO proposal reaches on-chain quorum.

## Run

Two entry points — pick one:

| Script | What it does |
|--------|--------------|
| `./run-env.sh` | **Environment only** (the stack as before) — for the demo / recording. |
| `./run-e2e.sh` | **Environment + dockerized tests** — brings up the stack, then a containerized `evaluation` service (in the same compose project) waits for readiness, runs the benches, writes CSVs to `./results/`, and exits. The stack is left running. |

Both do a clean `down -v` first (skip with `KEEP_STATE=1`) and expect the orchestrator repo
as a sibling (`../ehealth-governance-demo`, override with `BASE=`).

### How the dockerized runner is wired

`docker-compose.eval.yml` adds one `evaluation` service (built from this repo's `Dockerfile`)
with `depends_on` every stack service, so it starts after them. `run-e2e.sh` merges it with
the base compose:

```bash
docker compose -f ../ehealth-governance-demo/docker-compose.yml -f docker-compose.eval.yml up
```

Inside the compose network the runner talks to services by name (`http://evm:3010`,
`http://mfssia-ehealth:4000/api`, …); its entrypoint (`lib/wait-ready.mjs`) polls those real
endpoints until 200 (container `healthy` is unreliable here), then runs the benches. Results
are bind-mounted back to `./results/`.

> BuildKit fails on the dev host with a `~/.docker/.token_seed` permission error, so
> `run-e2e.sh` forces the legacy builder (`DOCKER_BUILDKIT=0`). Set `DOCKER_BUILDKIT=1` if
> your machine is fine.

### Host-based alternative (no eval container)

`./run-eval.sh` does the same clean bring-up + wait + benches, but runs the benches directly
on the host (Node) instead of in a container. Knobs: `READY_TIMEOUT`, `DKG_SETTLE`,
`KEEP_STATE=1`, `COMPOSE_DIR`.

### Manual

> **Run against a CLEAN stack.** Bring the environment up fresh before benchmarking:
> `docker compose up` from a clean state (so every service starts *after* `dkg-node`). Do not
> benchmark a long-running stack, and do not hand-patch it into a working state — results must
> be reproducible. In particular, if `dkg-node` restarts under already-running services, their
> cached web3 nonce drifts from the fresh DKG chain and DKG writes fail ("Nonce too high"),
> which shows up as `BLOCKED` correctness scenarios (consent never anchors → C-DOC-AUTHZ
> stays false). That is a dirty-environment artifact, not a defect.

```bash
npm install
cp .env.example .env         # adjust ports if needed
npm test                     # RQ1 correctness under vitest → allure-results/ + results/correctness.csv
npm run bench:gas            # RQ2/RQ4 — on-chain gas (needs the evm)
python notebooks/plots.py    # pip install pandas matplotlib
```

`npm run bench:correctness` still exists as a framework-free CSV-only runner (used by the
container); `npm test` is the same 7 scenarios under vitest and additionally emits Allure.

## Reports

Three views of the results, from richest to simplest:

- **Allure** (test dashboard). `npm test` runs the correctness suite under vitest with the
  `allure-vitest` adapter and writes `allure-results/`. Render + open the HTML dashboard:
  ```bash
  npm run report:allure     # allure generate + open  (needs Java + the allure CLI, bundled via allure-commandline)
  ```
  Each scenario carries `epic`/`feature`/`severity` labels and `expected`/`actual`
  parameters; `BLOCKED`/`SKIP` show as *skipped* (precondition unmet / not applicable), not
  failed. The dockerized `run-e2e.sh` produces `allure-results/` on the host too — just run
  `npm run report:allure` afterwards.
- **Markdown summary.** `npm run report` (`report.mjs`) turns `results/*.csv` into
  `results/REPORT.md` — the correctness matrix + a gas median/p95 table. No deps.
- **Figures for LaTeX.** `python notebooks/plots.py` → `figures/*.{pdf,eps}`.

Raw `results/*.csv` remain the primary committed data; the reports are derived views.

### Reproducibility

`config/stack.json` records the endpoints and a `stackVersions` map (git-sha / image-digest
per repo). Fill it in for each run and copy it into `results/` next to the CSV, so every
dataset is traceable to the exact stack it was measured against.

## Implementation order

1. **bench-gas** (done) — nothing to recompile, hits deployed contracts over RPC.
2. **bench-e2e** — times HTTP issuance/dispense, with a no-ZKP baseline variant.
3. **bench-dao** — deploys `MinimalGovernance` at varying member counts, drives the loop.
4. **bench-zkp** — last: needs the circom toolchain.

### ZKP scaling (bench-zkp) — how the Docker recompile works

The prover already ships a builder: `ehealth-zkp-prover/Dockerfile.setup` (circom 2.1.6 +
snarkjs 0.7.6 + circomlib) whose `scripts/setup.sh` runs the full compile + trusted setup,
with `circuits/` mounted as a volume. To sweep sizes:

1. Pull the prover source pinned to a commit — add to `package.json`:
   `"ehealth-zkp-prover": "github:medalex/ehealth-zkp-prover#<sha>"` (gives `.circom` +
   `setup.sh`; the Docker image does the compilation, so no submodule).
2. Build the image once: `docker build -f <prover>/Dockerfile.setup -t zkp-setup <prover>`.
3. For each parameter point, generate a `variant.circom` by `sed`-replacing the
   `PrescriptionValidation(...)` argument list (last line of the source), then
   `docker run --rm -v <tmp>/circuits:/work/circuits zkp-setup bash scripts/setup.sh variant`.
4. Parse `snarkjs r1cs info` for constraint count; `time` the phases; stat the artifacts.

One small upstream change is needed: `setup.sh` currently hardcodes the circuit name — give
it a `CIRCUIT_NAME=${1:-prescription_validation_poseidon_merkle}` argument (~3 lines) so the
same image can build any variant without an image rebuild.

### verifyProof gas fixture (bench-gas)

`verifyProof` is a view function; its gas is measured via `estimateGas` against a **real**
proof. Drop a live proof at `bench-gas/fixtures/proof.json` + `public.json` (grab one from a
successful issuance) and re-run `bench:gas` to populate the `verifyProof` rows.
