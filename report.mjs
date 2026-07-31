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

// ── Latency / scaling (present once those benches are implemented) ──────────────
for (const [file, title, xcol, ycol] of [
  ['e2e.csv', 'RQ3 — End-to-end latency (ms)', 'stage', 'ms'],
  ['zkp-scaling.csv', 'RQ2 — ZKP scaling', 'constraints', 'proveMs'],
  ['dao-conflict.csv', 'RQ4 — DAO conflict round-trip', 'members', 'totalGas'],
]) {
  if (!existsSync(R(file))) continue;
  const rows = parseCsv(R(file));
  p(`## ${title}`);
  p('');
  p(`\`${file}\` — ${rows.length} rows. See \`notebooks/plots.py\` for figures.`);
  p('');
}

const notRun = ['e2e.csv', 'dao-conflict.csv', 'zkp-scaling.csv'].filter((f) => !existsSync(R(f)));
if (notRun.length) {
  p('---');
  p(`_Not yet produced: ${notRun.join(', ')} (benches pending)._`);
}

writeFileSync(R('REPORT.md'), out.join('\n') + '\n');
console.log(`\n[report] wrote results/REPORT.md`);
