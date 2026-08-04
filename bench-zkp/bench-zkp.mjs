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

// Base params — matches the DEPLOYED circuit (N_max=5 patient-allergy slots).
// component main = PrescriptionValidation(3, 5, 1, 32, 3, 2, 4, 3).
const BASE = { N_DRUGS: 3, N_max: 5, N_PRESC: 1, BITLEN: 32, MERKLE_DEPTH: 3, N_LAB: 2, CONTRA_DEPTH: 4, LAB_DEPTH: 3 };
const ORDER = ['N_DRUGS', 'N_max', 'N_PRESC', 'BITLEN', 'MERKLE_DEPTH', 'N_LAB', 'CONTRA_DEPTH', 'LAB_DEPTH'];

// Patient allergies = N_max (number of allergy slots the circuit checks per prescription).
// The deployed circuit uses N_max=5; sweep 1..5 (override with ALLERGIES="1,2,3,4,5").
const ALLERGIES = (process.env.ALLERGIES ?? '1,2,3,4,5').split(',').map(Number);

function grid() {
  return ALLERGIES.map((n) => ({ label: `${n} allergies`, axis: 'allergies (N_max)', allergies: n, params: { ...BASE, N_max: n } }));
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

// COMPILE_ONLY=1 → only constraints + compile time (fastest). Default also runs the Groth16
// trusted setup (compile + setup time + proving-key size), reusing ONE shared powers-of-tau
// so the slow ceremony runs once, not per point.
const COMPILE_ONLY = process.env.COMPILE_ONLY === '1';
const ARTIFACTS = join(__dir, '.artifacts'); // persistent shared ptau

function ensurePtau() {
  mkdirSync(ARTIFACTS, { recursive: true });
  if (existsSync(join(ARTIFACTS, 'pot.ptau'))) { console.log('[zkp] reusing shared powers-of-tau'); return; }
  console.log(`[zkp] generating the shared powers-of-tau (2^${PTAU}) once — slow under emulation, reused for every point...`);
  sh(`docker run --rm --platform ${PLATFORM} -v "${ARTIFACTS}:/work/ptau" ${IMAGE} bash -c `
    + `'cd /work/ptau && snarkjs powersoftau new bn128 ${PTAU} p0.ptau -v && snarkjs powersoftau contribute p0.ptau p1.ptau --name=dev -e=rand && snarkjs powersoftau prepare phase2 p1.ptau pot.ptau -v && rm -f p0.ptau p1.ptau'`,
    { env: { ...process.env, DOCKER_BUILDKIT: '0' }, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 });
}

function runPoint(point) {
  const tmp = mkdtempSync(join(tmpdir(), 'zkp-'));
  mkdirSync(join(tmp, 'src'), { recursive: true });
  const name = 'v';
  writeFileSync(join(tmp, 'src', `${name}.circom`), variantSource(point.params));
  const dockerEnv = { env: { ...process.env, DOCKER_BUILDKIT: '0' }, maxBuffer: 64 * 1024 * 1024 };
  const size = (f) => (existsSync(join(tmp, f)) ? statSync(join(tmp, f)).size : '');

  const compileCmd = `T0=$(date +%s%3N); circom circuits/src/${name}.circom --r1cs --wasm --output circuits -l node_modules; T1=$(date +%s%3N); echo "TIMING compile $((T1-T0))"; snarkjs r1cs info circuits/${name}.r1cs`;
  const setupCmd = `T2=$(date +%s%3N); snarkjs groth16 setup circuits/${name}.r1cs /work/ptau/pot.ptau circuits/${name}_0.zkey; snarkjs zkey contribute circuits/${name}_0.zkey circuits/${name}_final.zkey --name=dev -e=rand; snarkjs zkey export verificationkey circuits/${name}_final.zkey circuits/${name}_vkey.json; T3=$(date +%s%3N); echo "TIMING setup $((T3-T2))"`;
  const inner = COMPILE_ONLY ? `cd /work && ${compileCmd}` : `cd /work && ${compileCmd}; ${setupCmd}`;
  const mounts = COMPILE_ONLY ? `-v "${tmp}:/work/circuits"` : `-v "${tmp}:/work/circuits" -v "${ARTIFACTS}:/work/ptau"`;

  const out = sh(`docker run --rm --platform ${PLATFORM} ${mounts} ${IMAGE} bash -c '${inner}'`, dockerEnv);

  const num = (re) => { const mm = out.match(re); return mm ? Number(mm[1]) : null; };
  const cm = out.match(/# of Constraints:\s*(\d+)/i) || out.match(/non-linear constraints:\s*(\d+)/i);
  const row = {
    allergies: point.allergies, label: point.label, axis: point.axis,
    constraints: cm ? Number(cm[1]) : null,
    compileMs: num(/TIMING compile\s+(\d+)/),
    setupMs: COMPILE_ONLY ? '' : num(/TIMING setup\s+(\d+)/),
    zkeyBytes: COMPILE_ONLY ? '' : size(`${name}_final.zkey`),
    wasmBytes: size(`${name}_js/${name}.wasm`),
  };
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
  if (!COMPILE_ONLY) ensurePtau();
  const rows = [];
  for (const point of grid()) {
    console.log(`\n[zkp] ==> ${point.label} (${point.axis})`);
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
