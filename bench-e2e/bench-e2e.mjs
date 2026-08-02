// RQ4 — end-user FEASIBILITY (supplementary, not a core scientific metric).
//
// The scientific contribution (ZKP efficiency, on-chain gas) is measured in isolation by
// bench-zkp / bench-gas. This bench answers a different, user-facing question: "how long does
// a clinician / pharmacist actually wait, and is that within acceptable bounds?" — framed
// against the Nielsen/Miller response-time limits (0.1s instant · 1s fluid · 10s attention).
//
// It times the two user actions end-to-end (full request→response the user waits on; the
// static HTML UI adds sub-ms and is out of scope). It also isolates the one contribution
// slice that IS cleanly measurable at the API boundary — on-chain Groth16 verification, via
// the evm /verify endpoint — so the report can show how small the crypto/chain cost is
// relative to the whole. ZKP proof generation (the dominant issuance cost) is measured
// separately in RQ2 (bench-zkp) and cross-referenced there.
//
//   node bench-e2e/bench-e2e.mjs [--runs 15]
//
// Requires a CLEAN stack (issuance needs consent anchored in the DKG). Output: results/e2e.csv
// (one row per stage per run).

import { SEED, hospital, pharmacy, patient, evm, ensureConsentAnchored } from '../lib/api.mjs';
import { writeCsv } from '../lib/csv.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv.includes('--runs') ? process.argv[process.argv.indexOf('--runs') + 1] : 15);
const uid = () => Number(String(Date.now()).slice(-9)) + Math.floor(Math.random() * 1000);

async function timed(fn) {
  const t0 = process.hrtime.bigint();
  const value = await fn();
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, value };
}

async function main() {
  // Preconditions: issuance needs DKG-anchored consent (hospital-1); dispense needs a simple
  // DB consent (pharmacy-1, checked by patient-api, not the DKG).
  console.log('[e2e] establishing consent (issuance needs the DKG — clean stack required)...');
  const ok = await ensureConsentAnchored(SEED.patient, SEED.doctorInRegistry, 'hospital-1');
  await patient.grantConsent({ patientId: SEED.patient, organizationId: 'pharmacy-1', expiresAt: '2027-12-31T00:00:00Z' });
  if (!ok) {
    console.error('[e2e] ABORT: consent never anchored — run against a CLEAN stack (see README/QUICKSTART).');
    process.exit(2);
  }

  const rows = [];
  // stage kinds: total | contribution | plumbing — for the report's contribution/plumbing split.
  const push = (run, action, stage, kind, ms) => rows.push({ run, action, stage, kind, ms: ms.toFixed(1) });

  let completed = 0;
  for (let run = 0; run < RUNS; run++) {
    // ── Action A: clinician issues a prescription (proof generated + anchored server-side) ──
    const issue = await timed(() => hospital.issue({
      doctorId: SEED.doctorInRegistry, patientId: SEED.patient,
      drugId: SEED.drug.metformin, dosage: '500mg', patientAge: 55, workflowId: uid(),
    }));
    if (issue.value.status !== 201) {
      console.warn(`[e2e] run ${run}: issuance ${issue.value.status} — skipping run`);
      continue;
    }
    push(run, 'issue', 'total', 'total', issue.ms);
    const p = issue.value.body;
    const proof = typeof p.proofJson === 'string' ? JSON.parse(p.proofJson) : (p.proof ?? p.proofJson);
    const pub = typeof p.publicSignalsJson === 'string' ? JSON.parse(p.publicSignalsJson) : (p.publicSignals ?? p.publicSignalsJson);

    // Contribution slice: isolated on-chain Groth16 verification (evm /verify).
    const onchain = await timed(() => evm.verify(proof, pub));
    push(run, 'issue', 'onchain_verify', 'contribution', onchain.ms);

    // ── Action B: pharmacist verifies + dispenses ──────────────────────────────
    const receipt = {
      drugId: SEED.drug.metformin, drugName: 'Metformin', dosage: '500mg', patientId: SEED.patient,
      stmtHash: p.stmtHash, proofJson: JSON.stringify(proof), publicSignalsJson: JSON.stringify(pub), outcome: true,
    };
    const recv = await timed(() => pharmacy.receive(receipt));
    const pid = recv.value.body?.id;
    push(run, 'dispense', 'receive', 'plumbing', recv.ms);

    const pverify = await timed(() => pharmacy.verify(pid));   // on-chain verify inside the pharmacy
    push(run, 'dispense', 'pharmacy_verify', 'contribution', pverify.ms);

    const disp = await timed(() => pharmacy.dispense(pid));    // record on-chain + consent
    push(run, 'dispense', 'record', 'plumbing', disp.ms);

    completed++;
    process.stdout.write(`\r[e2e] run ${run + 1}/${RUNS} (issue ${issue.ms.toFixed(0)}ms, verify ${pverify.ms.toFixed(0)}ms, dispense ${disp.ms.toFixed(0)}ms)   `);
  }
  console.log('');

  if (completed === 0) {
    console.error('[e2e] no runs completed — is the stack clean and healthy?');
    process.exit(1);
  }
  writeCsv(join(__dir, '..', 'results', 'e2e.csv'), rows);
  console.log(`[e2e] done — ${completed}/${RUNS} runs. See report.mjs for the feasibility summary.`);
}

main().catch((e) => { console.error('[e2e] FAILED:', e.message); process.exit(1); });
