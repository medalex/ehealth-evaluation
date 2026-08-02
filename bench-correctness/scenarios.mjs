// Single source of truth for the 7 RQ1 scenarios. Each scenario's run() performs the work
// against the live stack and returns { status, expected, actual, notes } where status is
// PASS | FAIL | BLOCKED | SKIP. Two consumers share this: run.mjs (writes the CSV, used by
// the container) and correctness.test.mjs (vitest + Allure report).

import { SEED, hospital, pharmacy, mfssia, dao, voteToQuorum, ensureConsentAnchored } from '../lib/api.mjs';

const HOSPITAL_ORG = 'hospital-1';
const uid = () => Number(String(Date.now()).slice(-9)) + Math.floor(Math.random() * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ANCHOR_TIMEOUT_MS = Number(process.env.ANCHOR_TIMEOUT_MS ?? 90000);

// Shared precondition: consent anchored so the access gate lets issuance through.
let consentOk = null;
async function consentReady() {
  if (consentOk === null) {
    consentOk = await ensureConsentAnchored(SEED.patient, SEED.doctorInRegistry, HOSPITAL_ORG);
  }
  return consentOk;
}

export const SCENARIOS = [
  {
    id: 'Sc1', name: 'valid prescription issued', feature: 'Issuance', severity: 'blocker',
    async run() {
      if (!(await consentReady())) {
        return { status: 'BLOCKED', expected: '201 outcome=true', actual: 'consent not anchored',
          notes: 'C-DOC-AUTHZ never passed — check dkg-node health / consent anchoring' };
      }
      const r = await hospital.issue({
        doctorId: SEED.doctorInRegistry, patientId: SEED.patient,
        drugId: SEED.drug.metformin, dosage: '500mg', patientAge: 55, workflowId: uid(),
      });
      const pass = r.status === 201 && r.body?.outcome === true;
      return { status: pass ? 'PASS' : 'FAIL', expected: '201 outcome=true',
        actual: `${r.status} outcome=${r.body?.outcome}`, notes: pass ? '' : JSON.stringify(r.body).slice(0, 200) };
    },
  },
  {
    id: 'Sc2', name: 'ZKP-rejected not issued', feature: 'Issuance', severity: 'critical',
    async run() {
      if (!(await consentReady())) {
        return { status: 'BLOCKED', expected: '422 issued=false', actual: 'consent not anchored',
          notes: 'precondition (consent) unavailable' };
      }
      // The contraindication (P2) is built from the DKG patient-record tree. Add a Penicillin
      // allergy (substanceId 1; CONTRA[1][Amoxicillin]=1), then WAIT until it actually appears
      // in the DKG-derived patient-record before issuing — the DKG write is async on a fresh
      // stack. This separates "allergy never anchored" (BLOCKED, environment) from "anchored
      // but contraindication did not fire" (FAIL, artifact).
      await hospital.addAllergy({
        patientId: SEED.patient, substance: 'Penicillin', snomedCode: '372687004',
        codeSystem: 'SNOMED-CT', source: 'correctness-suite',
      });
      let anchored = false;
      const deadline = Date.now() + ANCHOR_TIMEOUT_MS;
      const t0 = Date.now();
      console.log(`[Sc2] waiting for the Penicillin allergy to anchor into the DKG patient-record (up to ${Math.round(ANCHOR_TIMEOUT_MS / 1000)}s)...`);
      while (Date.now() < deadline) {
        const pr = await mfssia.patientRecord(SEED.patient);
        if ((pr.body?.substanceIds ?? []).includes(1)) { anchored = true; break; }
        console.log(`[Sc2] allergy not yet in patient-record (t+${Math.round((Date.now() - t0) / 1000)}s)...`);
        await sleep(6000);
      }
      if (!anchored) {
        return { status: 'BLOCKED', expected: '422 issued=false', actual: 'allergy not in patient-record',
          notes: 'Penicillin allergy never anchored into the DKG patient-record (write/latency) — check dkg-node' };
      }
      const r = await hospital.issue({
        doctorId: SEED.doctorInRegistry, patientId: SEED.patient,
        drugId: SEED.drug.amoxicillin, dosage: '500mg', patientAge: 40, workflowId: uid(),
      });
      const pass = r.status === 422 && r.body?.issued === false;
      return { status: pass ? 'PASS' : 'FAIL', expected: '422 issued=false',
        actual: `${r.status} issued=${r.body?.issued}`,
        notes: pass ? '' : 'allergy anchored but prescription not rejected — P2 contraindication did not fire' };
    },
  },
  {
    id: 'Sc3', name: 'access gate blocks unregistered doctor', feature: 'Access control', severity: 'critical',
    async run() {
      const r = await hospital.issue({
        doctorId: SEED.doctorNotInRegistry, patientId: SEED.patient,
        drugId: SEED.drug.metformin, dosage: '500mg', patientAge: 55, workflowId: uid(),
      });
      const pass = r.status === 403;
      return { status: pass ? 'PASS' : 'FAIL', expected: '403', actual: `${r.status}`,
        notes: pass ? '' : JSON.stringify(r.body).slice(0, 200) };
    },
  },
  {
    id: 'Sc4', name: 'numeric bridge needs DAO consensus', feature: 'Semantic governance', severity: 'critical',
    async run() {
      const unit = `zz-unit-${uid()}`;
      const bridge = { metric: 'eGFR', fromUnit: unit, toUnit: 'mL/min/1.73m²', factor: 1 };
      const prop = await mfssia.proposeBridge(bridge);
      const proposalId = prop.body?.proposalId;
      const hash = prop.body?.policyHash;
      const before = await mfssia.publishBridge(bridge);       // no votes yet
      const gated = before.status === 403;
      await voteToQuorum(proposalId);
      const appr = await dao.approved(hash);
      const approved = appr.body?.approved === true;
      const pass = proposalId != null && gated && approved;
      return { status: pass ? 'PASS' : 'FAIL', expected: 'gate 403 then approved',
        actual: `proposal=${proposalId} gate403=${gated} approved=${approved}`, notes: '' };
    },
  },
  {
    id: 'Sc5', name: 'terminology alignment needs DAO consensus', feature: 'Semantic governance', severity: 'critical',
    async run() {
      const code = `LOCAL-${uid()}`;
      const conflict = await mfssia.align({ system: 'AllergyDB-Local', code, term: 'test-substance' });
      const detected = conflict.status === 409 || conflict.body?.conflict === true;
      const term = { system: 'AllergyDB-Local', code, term: 'test-substance', alignsTo: 'rx:Penicillin' };
      const prop = await mfssia.proposeTerm(term);
      const proposalId = prop.body?.proposalId;
      const hash = prop.body?.policyHash;
      const before = await mfssia.publishTerm(term);           // no votes yet
      const gated = before.status === 403;
      await voteToQuorum(proposalId);
      const appr = await dao.approved(hash);
      const approved = appr.body?.approved === true;
      const pass = detected && proposalId != null && gated && approved;
      return { status: pass ? 'PASS' : 'FAIL', expected: 'conflict, gate 403, approved',
        actual: `conflict=${detected} gate403=${gated} approved=${approved}`, notes: '' };
    },
  },
  {
    id: 'Sc6', name: 'proof freshness / validity window', feature: 'Dispensing', severity: 'normal',
    async run() {
      return { status: 'SKIP', expected: 'expired after window', actual: 'SKIPPED',
        notes: 'timed setup — validated manually per README Scenario 6' };
    },
  },
  {
    id: 'Sc7', name: 'replay single-use', feature: 'Dispensing', severity: 'critical',
    async run() {
      if (!(await consentReady())) {
        return { status: 'BLOCKED', expected: 'first ok, second rejected', actual: 'consent not anchored',
          notes: 'needs a valid issued prescription to replay' };
      }
      const issued = await hospital.issue({
        doctorId: SEED.doctorInRegistry, patientId: SEED.patient,
        drugId: SEED.drug.metformin, dosage: '500mg', patientAge: 55, workflowId: uid(),
      });
      if (issued.status !== 201) {
        return { status: 'BLOCKED', expected: 'first ok, second rejected', actual: `issue=${issued.status}`,
          notes: 'could not issue a valid prescription to replay' };
      }
      const p = issued.body;
      // The hospital returns proofJson/publicSignalsJson already serialised as strings — pass
      // them through as-is; re-stringifying would double-encode and fail on-chain verification.
      const proofJson = typeof p.proofJson === 'string' ? p.proofJson : JSON.stringify(p.proof ?? {});
      const publicSignalsJson = typeof p.publicSignalsJson === 'string' ? p.publicSignalsJson : JSON.stringify(p.publicSignals ?? []);
      const receipt = {
        drugId: SEED.drug.metformin, drugName: 'Metformin', dosage: '500mg', patientId: SEED.patient,
        stmtHash: p.stmtHash, proofJson, publicSignalsJson, outcome: true,
      };
      const r1 = await pharmacy.receive(receipt);
      const v1 = await pharmacy.verify(r1.body?.id);
      const r2 = await pharmacy.receive(receipt); // same stmtHash again
      const v2 = await pharmacy.verify(r2.body?.id);
      const pass = v1.body?.verified === true && v2.body?.verified === false && /replay/i.test(v2.body?.reason ?? '');
      return { status: pass ? 'PASS' : 'FAIL', expected: 'first verified, second replay-rejected',
        actual: `v1=${v1.body?.verified} v2=${v2.body?.verified}`, notes: pass ? '' : (v2.body?.reason ?? '') };
    },
  },
];
