// Shared HTTP client for the running stack. Both bench-correctness (assert on outcomes)
// and bench-e2e (time the same calls) build on this layer so request logic is not
// duplicated. Every method returns { status, body } — the caller decides what to assert.
//
// Endpoints & ports are the docker-compose host mappings (config/stack.json):
//   hospital  :3003  /api/prescriptions, /api/allergies, /api/doctors
//   pharmacy  :3004  /api/prescriptions/receive, /{id}/verify, /{id}/dispense
//   patient   :3001  /api/patients, /api/consents (+ /check)
//   lab       :3002
//   mfssia    :4000/api  /rx-governance/{policies,bridges,terminology}
//   evm       :3010  /governance/{propose,vote,approved,proposals}

import { loadConfig } from './config.mjs';

const cfg = loadConfig();

// Known seed identifiers (hospital/patient Seeder.cs, prover.service.ts DRUG_IDS).
export const SEED = {
  patient: '00000000-0000-0000-0000-000000000001',
  doctorInRegistry: '00000000-0000-0000-0002-000000000001',
  doctorNotInRegistry: '00000000-0000-0000-0002-000000000099', // for the access-gate demo
  drug: { metformin: 105, penicillin: 103, amoxicillin: 107 },
};

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  const text = await res.text();
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  return { status: res.status, body: parsed };
}

// mfssia (NestJS) wraps every success in { success, message, data, statusCode }. Unwrap to
// the inner payload so callers see the domain object directly; errors pass through as-is.
async function mreq(method, url, body) {
  const r = await req(method, url, body);
  if (r.body && typeof r.body === 'object' && 'data' in r.body && 'success' in r.body) {
    return { status: r.status, body: r.body.data };
  }
  return r;
}

// ── Hospital ────────────────────────────────────────────────────────────────
export const hospital = {
  doctors: () => req('GET', `${cfg.hospitalApi}/api/doctors`),
  addAllergy: (a) => req('POST', `${cfg.hospitalApi}/api/allergies`, a),
  // { patientId, substance, snomedCode, codeSystem, source }
  issue: (p) => req('POST', `${cfg.hospitalApi}/api/prescriptions`, p),
  // { doctorId, patientId, drugId, dosage, patientAge, workflowId }
  get: (id) => req('GET', `${cfg.hospitalApi}/api/prescriptions/${id}`),
};

// ── Pharmacy ────────────────────────────────────────────────────────────────
export const pharmacy = {
  receive: (r) => req('POST', `${cfg.pharmacyApi}/api/prescriptions/receive`, r),
  // { drugId, drugName, dosage, patientId, stmtHash, proofJson, publicSignalsJson, outcome }
  verify: (id) => req('POST', `${cfg.pharmacyApi}/api/prescriptions/${id}/verify`),
  dispense: (id) => req('POST', `${cfg.pharmacyApi}/api/prescriptions/${id}/dispense`),
  list: () => req('GET', `${cfg.pharmacyApi}/api/prescriptions`),
};

// ── Patient (consent) ─────────────────────────────────────────────────────────
export const patient = {
  grantConsent: (c) => req('POST', `${cfg.patientApi}/api/consents`, c),
  // { patientId, organizationId, expiresAt? }
  checkConsent: (patientId, organizationId) =>
    req('GET', `${cfg.patientApi}/api/consents/check?patientId=${patientId}&organizationId=${organizationId}`),
};

// ── MFSSIA governance (theory T) ───────────────────────────────────────────────
export const mfssia = {
  // Clinical policies (Pol(m,t,op,θ) + Δmax).
  proposePolicy: (dto) => mreq('POST', `${cfg.mfssiaApi}/rx-governance/policies/propose`, dto),
  publishPolicy: (dto, direct = false) =>
    mreq('POST', `${cfg.mfssiaApi}/rx-governance/policies${direct ? '?direct=true' : ''}`, dto),
  listPolicies: () => mreq('GET', `${cfg.mfssiaApi}/rx-governance/policies`),

  // Numeric bridges (unit conversion).
  normalize: (b) => mreq('POST', `${cfg.mfssiaApi}/rx-governance/bridges/normalize`, b),
  // { metric, value, unit }
  proposeBridge: (b) => mreq('POST', `${cfg.mfssiaApi}/rx-governance/bridges/propose`, b),
  publishBridge: (b, direct = false) =>
    mreq('POST', `${cfg.mfssiaApi}/rx-governance/bridges${direct ? '?direct=true' : ''}`, b),

  // Terminology bridges (rx:alignsTo).
  align: (t) => mreq('POST', `${cfg.mfssiaApi}/rx-governance/terminology/align`, t),
  // { system, code, term? }
  proposeTerm: (t) => mreq('POST', `${cfg.mfssiaApi}/rx-governance/terminology/propose`, t),
  publishTerm: (t, direct = false) =>
    mreq('POST', `${cfg.mfssiaApi}/rx-governance/terminology${direct ? '?direct=true' : ''}`, t),
};

// ── EVM DAO (on the dedicated chain) ───────────────────────────────────────────
export const dao = {
  vote: (id, member) => req('POST', `${cfg.evmApi}/governance/vote`, { id, member }),
  approved: (hash) => req('POST', `${cfg.evmApi}/governance/approved`, { hash }),
  proposals: () => req('GET', `${cfg.evmApi}/governance/proposals`),
};

// Cast votes (members 1..k; member 0 is the proposer) until the proposal is approved.
export async function voteToQuorum(proposalId, maxMembers = cfg.daoMembers) {
  let last;
  for (let m = 1; m < maxMembers; m++) {
    last = await dao.vote(proposalId, m);
    if (last.body?.approved) return { approved: true, votes: m };
  }
  return { approved: false, votes: maxMembers - 1, last: last?.body };
}

// Grant consent, then poll the physician-access gate until C-DOC-AUTHZ passes (consent must
// propagate into the DKG). Returns true if the gate opened within the timeout. On a freshly
// brought-up stack the DKG can be slow to accept the first writes, so the timeout is
// generous and overridable via CONSENT_TIMEOUT_MS (the one-shot orchestrator sets it high).
export async function ensureConsentAnchored(
  patientId, doctorId, organizationId,
  timeoutMs = Number(process.env.CONSENT_TIMEOUT_MS ?? 60000),
) {
  await patient.grantConsent({ patientId, organizationId, expiresAt: '2027-12-31T00:00:00Z' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await req('POST', `${cfg.mfssiaApi}/physician-access/check`, { doctorId, patientId });
    if (r.body?.data?.authz === true || r.body?.authz === true) return true;
    await new Promise((res) => setTimeout(res, 5000));
  }
  return false;
}
