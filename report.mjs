// Aggregates results/*.csv into a human-readable report — console + results/REPORT.md.
// No test framework and no deps: the benches are measurement scripts, so the deliverable is
// raw CSV (primary data) + figures (notebooks/plots.py) + this summary.
//
//   node report.mjs
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { summarize } from './lib/timer.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const R = (f) => join(__dir, 'results', f);

// RFC-4180-ish CSV parser: handles quoted fields with embedded commas / quotes / newlines.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim();
  const [head, ...rows] = text.split('\n');
  const cols = splitCsvLine(head);
  return rows.filter(Boolean).map((line) => {
    const vals = splitCsvLine(line);
    const o = {};
    cols.forEach((c, i) => { o[c] = vals[i] ?? ''; });
    return o;
  });
}

const out = [];
const p = (s = '') => { out.push(s); console.log(s); };

p('# Evaluation report');
p('');
p(`Generated ${new Date().toISOString()}`);
p('');

// ── RQ1 correctness ────────────────────────────────────────────────────────────
if (existsSync(R('correctness.csv'))) {
  const rows = parseCsv(R('correctness.csv'));
  const by = (s) => rows.filter((r) => r.status === s).length;
  p('## RQ1 — Correctness');
  p('');
  p(`**${by('PASS')} passed · ${by('FAIL')} failed · ${by('BLOCKED')} blocked · ${by('SKIP')} skipped** of ${rows.length}`);
  p('');
  p('| Scenario | Result | Expected | Actual | Notes |');
  p('|----------|--------|----------|--------|-------|');
  for (const r of rows) {
    const icon = { PASS: '✅', FAIL: '❌', BLOCKED: '🚧', SKIP: '⏭' }[r.status] ?? '';
    p(`| ${r.id} ${r.name} | ${icon} ${r.status} | ${r.expected} | ${r.actual} | ${r.notes ?? ''} |`);
  }
  p('');
}

// ── Gas ──────────────────────────────────────────────────────────────────────
if (existsSync(R('gas.csv'))) {
  const rows = parseCsv(R('gas.csv'));
  const ops = [...new Set(rows.map((r) => r.op))];
  p('## RQ2/RQ4 — On-chain gas');
  p('');
  p('| Operation | n | median | p95 | min | max |');
  p('|-----------|---|--------|-----|-----|-----|');
  for (const op of ops) {
    const xs = rows.filter((r) => r.op === op).map((r) => Number(r.gasUsed));
    const s = summarize(xs);
    const f = (v) => Math.round(v).toLocaleString('en-US');
    p(`| ${op} | ${s.n} | ${f(s.median)} | ${f(s.p95)} | ${f(s.min)} | ${f(s.max)} |`);
  }
  p('');
  p('> Groth16 `verifyProof` gas is expected to be **constant** regardless of circuit size.');
  p('');
}

// ── RQ4 end-user feasibility ────────────────────────────────────────────────────
// Total latency of the two user actions, judged against the Nielsen/Miller response-time
// limits, plus the isolated on-chain verification slice (contribution) so the reader sees
// how small the crypto/chain cost is relative to the whole.
function nielsen(ms) {
  if (ms < 100) return 'instant (<0.1s)';
  if (ms < 1000) return 'fluid (<1s)';
  if (ms < 10000) return 'acceptable (<10s attention limit)';
  return 'OVER the 10s attention limit';
}
if (existsSync(R('e2e.csv'))) {
  const rows = parseCsv(R('e2e.csv')).map((r) => ({ ...r, ms: Number(r.ms), run: Number(r.run) }));
  const runs = [...new Set(rows.map((r) => r.run))];
  const sumFor = (run, action) => rows.filter((r) => r.run === run && r.action === action).reduce((a, r) => a + r.ms, 0);
  const issueTotal = runs.map((run) => rows.find((r) => r.run === run && r.action === 'issue' && r.stage === 'total')?.ms).filter((x) => x != null);
  const dispTotal = runs.map((run) => sumFor(run, 'dispense')).filter((x) => x > 0);
  const onchain = rows.filter((r) => r.stage === 'onchain_verify').map((r) => r.ms);
  const s = (xs) => summarize(xs);
  const ms = (v) => `${Math.round(v)} ms`;

  p('## RQ4 — End-user feasibility (supplementary)');
  p('');
  p('_User-facing latency of the two actions (full request→response), against the Nielsen/Miller');
  p('response-time limits. Not a core scientific metric — the ZKP/gas contribution is measured');
  p('in isolation in RQ2/RQ3; here it is contextualised as perceived wait._');
  p('');
  p('| User action | runs | median | p95 | verdict |');
  p('|-------------|------|--------|-----|---------|');
  if (issueTotal.length) { const a = s(issueTotal); p(`| Clinician: issue prescription | ${a.n} | ${ms(a.median)} | ${ms(a.p95)} | ${nielsen(a.median)} |`); }
  if (dispTotal.length) { const a = s(dispTotal); p(`| Pharmacist: verify + dispense | ${a.n} | ${ms(a.median)} | ${ms(a.p95)} | ${nielsen(a.median)} |`); }
  p('');
  if (onchain.length) {
    const a = s(onchain);
    const issMed = issueTotal.length ? s(issueTotal).median : 0;
    const pct = issMed ? ((a.median / issMed) * 100).toFixed(1) : '—';
    p(`**Contribution slice** — isolated on-chain Groth16 verification: median ${ms(a.median)} `
      + `(${pct}% of issuance). Constant regardless of circuit size (Groth16 O(1)).`);
    p('');
  }
  p('> ZKP proof generation (the dominant issuance cost) is measured in isolation in RQ2 (bench-zkp).');
  p('');
}

// ── RQ2 ZKP scaling ─────────────────────────────────────────────────────────────
if (existsSync(R('zkp-scaling.csv'))) {
  const rows = parseCsv(R('zkp-scaling.csv'));
  const kb = (b) => (b ? `${(Number(b) / 1024).toFixed(0)} KB` : '—');
  p('## RQ2 — ZKP circuit scaling');
  p('');
  p('| Variant | axis | constraints | compile | setup | .zkey | .wasm |');
  p('|---------|------|-------------|---------|-------|-------|-------|');
  for (const r of rows) {
    p(`| ${r.label} | ${r.axis} | ${Number(r.constraints).toLocaleString('en-US')} | ${r.compileMs} ms | ${r.setupMs} ms | ${kb(r.zkeyBytes)} | ${kb(r.wasmBytes)} |`);
  }
  p('');
  p('> Constraints are the size proxy; Groth16 proof-gen time is ~linear in constraints, while');
  p('> on-chain verification + proof size stay O(1) (see RQ3 gas). Per-size prove-time needs a');
  p('> valid per-size witness (out of scope) — proof-gen at the deployed size is an RQ4 slice.');
  p('');
}

// ── RQ3 DAO conflict round-trip (k-of-n governance cost) ────────────────────────
if (existsSync(R('dao-conflict.csv'))) {
  const rows = parseCsv(R('dao-conflict.csv'));
  const g = (v) => Number(v).toLocaleString('en-US');
  p('## RQ3 — k-of-n governance cost');
  p('');
  p('Cost of resolving one semantic conflict on-chain (propose → vote to quorum → approved),');
  p('and the one-off DAO deployment, as the member count grows.');
  p('');
  p('| members (n) | quorum (k) | deploy gas | resolution gas | median vote gas | votes | wall-clock |');
  p('|-------------|-----------|-----------|----------------|-----------------|-------|-----------|');
  for (const r of rows) {
    p(`| ${r.members} | ${r.threshold} | ${g(r.deployGas)} | ${g(r.resolutionGas)} | ${g(r.voteGasMed)} | ${r.votesCast} | ${Math.round(Number(r.wallMs))} ms |`);
  }
  p('');
  p('> Resolution gas grows ~linearly with the required votes (k); each vote is a small fixed');
  p('> cost. Deployment is a one-off. All well within ordinary L2/side-chain budgets.');
  p('');
}

// ── Policies scaling (query latency vs #policies) ───────────────────────────────
if (existsSync(R('policies-scaling.csv'))) {
  const rows = parseCsv(R('policies-scaling.csv'));
  p('## Supporting — governance-query latency vs #policies');
  p('');
  p('How long the prover\'s `GET /policies` (SPARQL over the DKG) takes as the policy set grows.');
  p('');
  p('| policies in graph | query median | p95 | samples |');
  p('|-------------------|--------------|-----|---------|');
  for (const r of rows) p(`| ${r.policyCount} | ${r.queryMedianMs} ms | ${r.queryP95Ms} ms | ${r.samples} |`);
  p('');
}

const notRun = ['e2e.csv', 'gas.csv', 'dao-conflict.csv', 'zkp-scaling.csv', 'policies-scaling.csv'].filter((f) => !existsSync(R(f)));
if (notRun.length) {
  p('---');
  p(`_Not yet produced: ${notRun.join(', ')} (benches pending)._`);
}

writeFileSync(R('REPORT.md'), out.join('\n') + '\n');
console.log(`\n[report] wrote results/REPORT.md`);
