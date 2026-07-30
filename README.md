# ehealth-evaluation

Design Science Research (DSR) evaluation harness for the eHealth ZKP/DAO prototype.
One reproducible package that measures artifacts living across the component repos —
without duplicating test code into each one.

## Evaluation design (for the paper)

Ex-post, **artificial/technical** evaluation (FEDS "Technical Risk & Efficacy" quadrant):
controlled, reproducible measurements of a working artifact, not a naturalistic clinical
deployment. External validity limits (synthetic load, single-host stack) are reported under
Threats to Validity.

### Research questions → benchmark → data

| RQ | Question | Bench | Output |
|----|----------|-------|--------|
| RQ1 | Are the claimed guarantees implemented correctly across all 7 scenarios? | (regression suite, see governance-demo README) | pass/fail matrix |
| RQ2 | How do proof-gen time and gas scale with circuit / policy size? | `bench-zkp`, `bench-gas` | `zkp-scaling.csv`, `gas.csv` |
| RQ3 | What is the overhead of privacy + decentralisation vs a naive baseline? | `bench-e2e` | `e2e.csv` |
| RQ4 | What does k-of-n conflict resolution cost (txs / gas / time / scaling)? | `bench-dao`, `bench-gas` | `dao-conflict.csv`, `gas.csv` |

Headline result to foreground: Groth16 **verification gas and proof size are O(1)** —
constant regardless of circuit size (contrast with the growing proof-gen cost in RQ2).

## Layout

```
config/stack.json   endpoints + versions of the stack under test
lib/                shared rpc / timer / csv helpers (no per-bench duplication)
bench-gas/          RQ2/RQ4  on-chain gas          -> results/gas.csv          [runnable]
bench-e2e/          RQ3      end-to-end latency     -> results/e2e.csv          [TODO]
bench-dao/          RQ4      conflict round-trip    -> results/dao-conflict.csv [TODO]
bench-zkp/          RQ2      circuit scaling        -> results/zkp-scaling.csv  [TODO]
results/            raw CSV — one row per run, committed as primary data
notebooks/plots.py  CSV -> IEEE figures in figures/
figures/            exported .pdf/.eps for LaTeX
```

## Run

```bash
npm install
cp .env.example .env         # adjust ports if needed
npm run bench:gas            # needs the evm + stack up (docker compose up)
python notebooks/plots.py    # pip install pandas matplotlib
```

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
