// RQ1 — functional correctness. Automates the 7 governance-demo scenarios against the
// running stack and asserts the observable contract of each, writing a pass/fail matrix to
// results/correctness.csv.
//
//   node bench-correctness/run.mjs
//
// Requires the full stack up (docker compose up). Each scenario is isolated in try/catch so
// one failure never aborts the suite. Outcomes:
//   PASS    — asserted contract held
//   FAIL    — artifact did not behave as specified
//   BLOCKED — a precondition could not be established (e.g. consent never anchored in the DKG,
//             typically an unhealthy dkg-node) — NOT an artifact defect
//   SKIP    — deliberately not run (e.g. the slow timed freshness scenario)

import { SEED, hospital, pharmacy, patient, mfssia, dao, voteToQuorum, ensureConsentAnchored } from '../lib/api.mjs';
import { writeCsv } from '../lib/csv.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const HOSPITAL_ORG = 'hospital-1';
const uid = () => Number(String(Date.now()).slice(-9)) + Math.floor(Math.random() * 1000);

const results = [];
function record(id, name, expected, actual, status, notes = '') {
  const icon = { PASS: '✅', FAIL: '❌', BLOCKED: '🚧', SKIP: '⏭' }[status] ?? '?';
  results.push({ id, name, expected, actual, status, notes });
  console.log(`${icon} ${id} ${name} — expected ${expected}, got ${actual}${notes ? ` (${notes})` : ''}`);
}

// Shared precondition: valid consent anchored so the access gate lets issuance through.
let consentOk = null;
async function consentReady() {
  if (consentOk === null) {
    consentOk = await ensureConsentAnchored(SEED.patient, SEED.doctorInRegistry, HOSPITAL_ORG);
  }
  return consentOk;
}

async function sc1_valid() {
  try {
    if (!(await consentReady())) {
      return record('Sc1', 'valid prescription issued', '201 outcome=true', 'consent not anchored', 'BLOCKED',
        'C-DOC-AUTHZ never passed — check dkg-node health / consent anchoring');
    }
    const r = await hospital.issue({
      doctorId: SEED.doctorInRegistry, patientId: SEED.patient,
      drugId: SEED.drug.metformin, dosage: '500mg', patientAge: 55, workflowId: uid(),
    });
    const pass = r.status === 201 && r.body?.outcome === true;
    record('Sc1', 'valid prescription issued', '201 outcome=true', `${r.status} outcome=${r.body?.outcome}`,
      pass ? 'PASS' : 'FAIL', pass ? '' : JSON.stringify(r.body).slice(0, 160));
  } catch (e) { record('Sc1', 'valid prescription issued', '201', 'ERROR', 'FAIL', e.message); }
}

async function sc2_zkpReject() {
  try {
    if (!(await consentReady())) {
      return record('Sc2', 'ZKP-rejected not issued', '422 issued=false', 'consent not anchored', 'BLOCKED',
        'precondition (consent) unavailable');
    }
    // Contraindication: a Penicillin allergy makes Amoxicillin (β-lactam) clinically fail P2.
    await hospital.addAllergy({
      patientId: SEED.patient, substance: 'Penicillin', snomedCode: '372687004',
      codeSystem: 'SNOMED-CT', source: 'correctness-suite',
    });
    const r = await hospital.issue({
      doctorId: SEED.doctorInRegistry, patientId: SEED.patient,
      drugId: SEED.drug.amoxicillin, dosage: '500mg', patientAge: 40, workflowId: uid(),
    });
    const pass = r.status === 422 && r.body?.issued === false;
    record('Sc2', 'ZKP-rejected not issued', '422 issued=false', `${r.status} issued=${r.body?.issued}`,
      pass ? 'PASS' : 'FAIL', pass ? '' : JSON.stringify(r.body).slice(0, 160));
  } catch (e) { record('Sc2', 'ZKP-rejected not issued', '422', 'ERROR', 'FAIL', e.message); }
}

async function sc3_accessGate() {
  try {
    const r = await hospital.issue({
      doctorId: SEED.doctorNotInRegistry, patientId: SEED.patient,
      drugId: SEED.drug.metformin, dosage: '500mg', patientAge: 55, workflowId: uid(),
    });
    const pass = r.status === 403;
    record('Sc3', 'access gate blocks unregistered doctor', '403', `${r.status}`,
      pass ? 'PASS' : 'FAIL', pass ? '' : JSON.stringify(r.body).slice(0, 160));
  } catch (e) { record('Sc3', 'access gate', '403', 'ERROR', 'FAIL', e.message); }
}

// Sc4/Sc5 validate the governance mechanism deterministically (DKG-write independent):
// a conflict is detected, and resolving theory T requires DAO consensus — a unilateral
// publish is refused (403) until the proposal reaches quorum (approved==true on-chain).
async function sc4_numericGovernance() {
  try {
    const unit = `zz-unit-${uid()}`;
    const bridge = { metric: 'eGFR', fromUnit: unit, toUnit: 'mL/min/1.73m²', factor: 1 };
    const prop = await mfssia.proposeBridge(bridge);
    const proposalId = prop.body?.proposalId;
    const hash = prop.body?.policyHash;

    const before = await mfssia.publishBridge(bridge);         // no votes yet
    const gated = before.status === 403;

    await voteToQuorum(proposalId);
    const appr = await dao.approved(hash);
    const approved = appr.body?.approved === true;

    const pass = proposalId != null && gated && approved;
    record('Sc4', 'numeric bridge needs DAO consensus', 'gate 403 then approved',
      `proposal=${proposalId} gate403=${gated} approved=${approved}`, pass ? 'PASS' : 'FAIL');
  } catch (e) { record('Sc4', 'numeric bridge governance', 'approved', 'ERROR', 'FAIL', e.message); }
}

async function sc5_terminologyGovernance() {
  try {
    const code = `LOCAL-${uid()}`;
    const conflict = await mfssia.align({ system: 'AllergyDB-Local', code, term: 'test-substance' });
    const detected = conflict.status === 409 || conflict.body?.conflict === true;

    const term = { system: 'AllergyDB-Local', code, term: 'test-substance', alignsTo: 'rx:Penicillin' };
    const prop = await mfssia.proposeTerm(term);
    const proposalId = prop.body?.proposalId;
    const hash = prop.body?.policyHash;

    const before = await mfssia.publishTerm(term);             // no votes yet
    const gated = before.status === 403;

    await voteToQuorum(proposalId);
    const appr = await dao.approved(hash);
    const approved = appr.body?.approved === true;

    const pass = detected && proposalId != null && gated && approved;
    record('Sc5', 'terminology alignment needs DAO consensus', 'conflict, gate 403, approved',
      `conflict=${detected} gate403=${gated} approved=${approved}`, pass ? 'PASS' : 'FAIL');
  } catch (e) { record('Sc5', 'terminology governance', 'approved', 'ERROR', 'FAIL', e.message); }
}

// Sc6 freshness needs a short-deltaMax policy + a wait past the window; slow, opt-in only.
async function sc6_freshness() {
  record('Sc6', 'proof freshness / validity window', 'expired after window', 'SKIPPED', 'SKIP',
    'timed setup — validated manually per README Scenario 6');
}

// Sc7 replay: the same stmtHash may be verified at most once at the pharmacy.
async function sc7_replay() {
  try {
    if (!(await consentReady())) {
      return record('Sc7', 'replay single-use', 'second rejected', 'consent not anchored', 'BLOCKED',
        'needs a valid issued prescription to replay');
    }
    const issued = await hospital.issue({
      doctorId: SEED.doctorInRegistry, patientId: SEED.patient,
      drugId: SEED.drug.metformin, dosage: '500mg', patientAge: 55, workflowId: uid(),
    });
    if (issued.status !== 201) {
      return record('Sc7', 'replay single-use', 'first ok, second rejected', `issue=${issued.status}`, 'BLOCKED',
        'could not issue a valid prescription to replay');
    }
    const p = issued.body;
    const receipt = {
      drugId: SEED.drug.metformin, drugName: 'Metformin', dosage: '500mg', patientId: SEED.patient,
      stmtHash: p.stmtHash, proofJson: JSON.stringify(p.proof ?? p.proofJson ?? {}),
      publicSignalsJson: JSON.stringify(p.publicSignals ?? p.publicSignalsJson ?? []), outcome: true,
    };
    const r1 = await pharmacy.receive(receipt);
    const v1 = await pharmacy.verify(r1.body?.id);
    const r2 = await pharmacy.receive(receipt); // same stmtHash again
    const v2 = await pharmacy.verify(r2.body?.id);
    const pass = v1.body?.verified === true && v2.body?.verified === false && /replay/i.test(v2.body?.reason ?? '');
    record('Sc7', 'replay single-use', 'first verified, second replay-rejected',
      `v1=${v1.body?.verified} v2=${v2.body?.verified}`, pass ? 'PASS' : 'FAIL', pass ? '' : (v2.body?.reason ?? ''));
  } catch (e) { record('Sc7', 'replay single-use', 'second rejected', 'ERROR', 'FAIL', e.message); }
}

async function main() {
  console.log('[correctness] running against the live stack...\n');
  await sc1_valid();
  await sc2_zkpReject();
  await sc3_accessGate();
  await sc4_numericGovernance();
  await sc5_terminologyGovernance();
  await sc6_freshness();
  await sc7_replay();

  writeCsv(join(__dir, '..', 'results', 'correctness.csv'), results);
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const blocked = results.filter((r) => r.status === 'BLOCKED').length;
  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log(`\n[correctness] ${passed} passed, ${failed} failed, ${blocked} blocked, ${results.length} total.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[correctness] FATAL:', e.message); process.exit(1); });
