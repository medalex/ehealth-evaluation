// RQ2 — ZKP circuit scaling (host-side; needs Docker + the prover repo as a sibling).
//
// Sweeps the circuit-size parameters, rebuilding the circuit from source via the prover's
// Dockerfile.setup image on each point, and records how cost scales. This is the only bench
// that needs the circom toolchain — it does NOT hit the running prover; it recompiles.
//
//   node bench-zkp/bench-zkp.mjs
//
// Per point it records: R1CS constraints, compile time, trusted-setup time, and artifact
// sizes (.zkey / .wasm / vkey). These are the no-witness scaling metrics — fully deterministic.
// Prove/verify TIME per size needs a valid per-size witness (Merkle proofs etc.); that is out
// of scope here — proof-gen at the deployed size is measured via the prover, and Groth16 prove
// time is ~linear in constraints, so the constraint curve is the scaling proxy.
//
// Output: results/zkp-scaling.csv (one row per parameter point).
//
// component main = PrescriptionValidation(N_DRUGS, N_max, N_PRESC, BITLEN, MERKLE_DEPTH, N_LAB, CONTRA_DEPTH, LAB_DEPTH)

import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PROVER = process.env.PROVER_DIR ?? join(__dir, '..', '..', 'ehealth-zkp-prover');
const PTAU = process.env.ZKP_PTAU ?? '15';           // 2^15 = 32768 constraints headroom
// Dockerfile.setup fetches circom-linux-amd64, so force amd64 (emulated on Apple Silicon).
const PLATFORM = process.env.ZKP_PLATFORM ?? 'linux/amd64';
const IMAGE = 'zkp-setup';
const CIRCUIT = 'prescription_validation_poseidon_merkle';

// Base params and the two sweep axes the paper argues (allergies, drugs).
const BASE = { N_DRUGS: 3, N_max: 3, N_PRESC: 1, BITLEN: 32, MERKLE_DEPTH: 3, N_LAB: 2, CONTRA_DEPTH: 4, LAB_DEPTH: 3 };
const ORDER = ['N_DRUGS', 'N_max', 'N_PRESC', 'BITLEN', 'MERKLE_DEPTH', 'N_LAB', 'CONTRA_DEPTH', 'LAB_DEPTH'];

function grid() {
  const points = [{ label: 'base', axis: 'base', params: { ...BASE } }];
  for (const d of [6, 8, 10]) points.push({ label: `allergies-d${d}`, axis: 'allergies', params: { ...BASE, CONTRA_DEPTH: d } });
  for (const n of [2, 3]) points.push({ label: `drugs-n${n}`, axis: 'drugs', params: { ...BASE, N_PRESC: n } });
  return points;
}

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
}

function imageExists() {
  try { sh(`docker image inspect ${IMAGE}`); return true; } catch { return false; }
}

function buildImage() {
  if (imageExists() && process.env.FORCE_BUILD !== '1') {
    console.log(`[zkp] reusing existing ${IMAGE} image (set FORCE_BUILD=1 to rebuild)`);
    return;
  }
  // BuildKit is required to cross-build the amd64 circom image on Apple Silicon. If it fails
  // with a ~/.docker/.token_seed permission error, remove that root-owned file (the ~/.docker
  // dir is user-owned so no sudo needed) and retry.
  console.log('[zkp] building the setup image (BuildKit, --platform ' + PLATFORM + ')...');
  sh(`docker build --platform ${PLATFORM} -f "${PROVER}/Dockerfile.setup" -t ${IMAGE} "${PROVER}"`, {
    env: { ...process.env, DOCKER_BUILDKIT: '1' }, stdio: 'inherit',
  });
}

function variantSource(params) {
  const src = readFileSync(join(PROVER, 'circuits', 'src', `${CIRCUIT}.circom`), 'utf8');
  const args = ORDER.map((k) => params[k]).join(', ');
  // Match only the `component main = PrescriptionValidation(...)` instantiation (prefixed by
  // `=`), NOT the `template PrescriptionValidation(N_DRUGS, ...)` definition.
  const re = /=\s*PrescriptionValidation\s*\([^)]*\)/;
  if (!re.test(src)) throw new Error('could not locate the PrescriptionValidation instantiation');
  return src.replace(re, `= PrescriptionValidation(${args})`);
}

// FULL=1 also runs the (slow, emulated) trusted setup for setup-time + key sizes. Default is
// compile-only: circom --r1cs + snarkjs r1cs info, which gives the constraint-count scaling
// (the size proxy) fast, without the powersoftau ceremony that is very slow under amd64
// emulation on Apple Silicon.
const FULL = process.env.FULL === '1';

function runPoint(point) {
  const tmp = mkdtempSync(join(tmpdir(), 'zkp-'));
  mkdirSync(join(tmp, 'src'), { recursive: true });
  const name = `variant_${point.label.replace(/[^a-z0-9]/gi, '_')}`;
  writeFileSync(join(tmp, 'src', `${name}.circom`), variantSource(point.params));
  const dockerEnv = { env: { ...process.env, DOCKER_BUILDKIT: '0' }, maxBuffer: 64 * 1024 * 1024 };
  const size = (f) => (existsSync(join(tmp, f)) ? statSync(join(tmp, f)).size : '');

  let row;
  if (!FULL) {
    // Compile only → constraint count + compile wall-clock.
    const t0 = Date.now();
    const out = sh(
      `docker run --rm --platform ${PLATFORM} -v "${tmp}:/work/circuits" ${IMAGE} `
      + `bash -c "cd /work && circom circuits/src/${name}.circom --r1cs --wasm --output circuits -l node_modules && snarkjs r1cs info circuits/${name}.r1cs"`,
      dockerEnv,
    );
    const compileMs = Date.now() - t0;
    const m = out.match(/# of Constraints:\s*(\d+)/i) || out.match(/non-linear constraints:\s*(\d+)/i);
    row = {
      label: point.label, axis: point.axis,
      N_PRESC: point.params.N_PRESC, N_LAB: point.params.N_LAB,
      CONTRA_DEPTH: point.params.CONTRA_DEPTH, MERKLE_DEPTH: point.params.MERKLE_DEPTH,
      constraints: m ? Number(m[1]) : null, compileMs, setupMs: '', wallMs: compileMs,
      zkeyBytes: '', wasmBytes: size(`${name}_js/${name}.wasm`), vkeyBytes: '',
    };
  } else {
    // Full compile + trusted setup (slow under emulation).
    const t0 = Date.now();
    const out = sh(
      `docker run --rm --platform ${PLATFORM} -e PTAU_POWER=${PTAU} -v "${tmp}:/work/circuits" ${IMAGE} bash scripts/setup.sh ${name}`,
      dockerEnv,
    );
    const wallMs = Date.now() - t0;
    const num = (re) => { const mm = out.match(re); return mm ? Number(mm[1]) : null; };
    row = {
      label: point.label, axis: point.axis,
      N_PRESC: point.params.N_PRESC, N_LAB: point.params.N_LAB,
      CONTRA_DEPTH: point.params.CONTRA_DEPTH, MERKLE_DEPTH: point.params.MERKLE_DEPTH,
      constraints: num(/CONSTRAINTS\s+(\d+)/), compileMs: num(/TIMING compile\s+(\d+)/),
      setupMs: num(/TIMING setup\s+(\d+)/), wallMs,
      zkeyBytes: size(`${name}_final.zkey`), wasmBytes: size(`${name}.wasm`), vkeyBytes: size(`${name}_vkey.json`),
    };
  }
  rmSync(tmp, { recursive: true, force: true });
  return row;
}

function writeCsv(path, rows) {
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => r[c] ?? '').join(','))];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n') + '\n');
  console.log(`[zkp] wrote ${rows.length} rows -> ${path}`);
}

function main() {
  if (!existsSync(join(PROVER, 'Dockerfile.setup'))) {
    console.error(`[zkp] prover repo not found at ${PROVER} (set PROVER_DIR). Clone ehealth-zkp-prover as a sibling.`);
    process.exit(1);
  }
  buildImage();
  const rows = [];
  for (const point of grid()) {
    console.log(`\n[zkp] ==> ${point.label} (${point.axis})  params=${JSON.stringify(point.params)}`);
    try {
      const r = runPoint(point);
      console.log(`[zkp]     constraints=${r.constraints} compile=${r.compileMs}ms setup=${r.setupMs}ms zkey=${r.zkeyBytes}B`);
      rows.push(r);
    } catch (e) {
      console.error(`[zkp]     FAILED: ${e.message.split('\n').slice(-3).join(' ')}`);
    }
  }
  if (!rows.length) { console.error('[zkp] no points completed'); process.exit(1); }
  writeCsv(join(__dir, '..', 'results', 'zkp-scaling.csv'), rows);
}

main();
