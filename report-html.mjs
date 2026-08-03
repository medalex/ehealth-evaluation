// Renders results/*.csv into a SELF-CONTAINED, self-explanatory results/report.html — a single
// local file (inline CSS/JS, no external resources, no server) you open in a browser on the
// machine that ran the tests. Tabbed by test type, each with a plain-language explanation.
//
//   node report-html.mjs        # -> results/report.html
//   open results/report.html    # (macOS)  ·  xdg-open on Linux

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { summarize } from './lib/timer.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const R = (f) => join(__dir, 'results', f);

function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}
function parseCsv(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim();
  const [head, ...rows] = text.split('\n');
  const cols = splitCsvLine(head);
  return rows.filter(Boolean).map((l) => { const v = splitCsvLine(l); const o = {}; cols.forEach((c, i) => (o[c] = v[i] ?? '')); return o; });
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nfmt = (v) => Number(v).toLocaleString('en-US');

function table(headers, rows) {
  const th = headers.map((h) => `<th>${h}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}
function nielsen(ms) {
  if (ms < 100) return ['instant', 'ok', '&lt; 0.1 s'];
  if (ms < 1000) return ['fluid', 'ok', '&lt; 1 s'];
  if (ms < 10000) return ['acceptable', 'warn', '&lt; 10 s (attention limit)'];
  return ['too slow', 'bad', '&gt; 10 s'];
}

// Plain-language descriptions of each correctness scenario.
const WHAT = {
  Sc1: 'A valid prescription is written and successfully issued.',
  Sc2: 'An unsafe prescription (drug the patient is allergic to) is rejected, not issued.',
  Sc3: 'A doctor who is not in the trust registry is blocked from prescribing.',
  Sc4: 'A units mismatch between labs can only be fixed by a DAO vote — not unilaterally.',
  Sc5: 'A local drug code with no standard mapping is resolved only after a DAO vote.',
  Sc6: 'A prescription proof expires after its validity window; a stale one is refused.',
  Sc7: 'The same prescription proof can be dispensed only once (no replay).',
};
const GAS_WHAT = {
  propose: 'Submit a governance proposal (a change to the medical rules).',
  vote: 'Cast one vote on a proposal.',
  record: 'Record a dispensed prescription on the immutable ledger.',
  verifyProof: 'Verify a zero-knowledge proof on-chain.',
};
// Which smart contract each operation belongs to.
const GAS_CONTRACT = {
  propose: 'MinimalGovernance.sol',
  vote: 'MinimalGovernance.sol',
  record: 'DecisionRegistry.sol',
  verifyProof: 'Groth16Verifier.sol',
};
// The on-chain function signature (its parameters = the inputs the contract was called with).
const GAS_SIG = {
  propose: 'propose(bytes32 policyHash)',
  vote: 'vote(uint256 id)',
  record: 'record(bytes32 stmtHash, bool outcome)',
  verifyProof: 'verifyProof(uint[2] a, uint[2][2] b, uint[2] c, uint[21] pubSignals)',
};
const shortHex = (h) => (typeof h === 'string' && h.startsWith('0x') && h.length > 16) ? `${h.slice(0, 10)}…${h.slice(-6)}` : String(h);
const inputStr = (op, inputs) => {
  const v = inputs?.[op];
  return v ? Object.entries(v).map(([k, val]) => `${k}=${esc(shortHex(val))}`).join(', ') : '';
};

const tabs = [];

// ── RQ1 correctness ──────────────────────────────────────────────────────────
const corr = parseCsv(R('correctness.csv'));
if (corr) {
  const badge = (s) => `<span class="badge ${{ PASS: 'pass', FAIL: 'fail', BLOCKED: 'block', SKIP: 'skip' }[s] ?? 'skip'}">${esc(s)}</span>`;
  const n = (s) => corr.filter((r) => r.status === s).length;
  const rows = corr.map((r) => [
    `<b>${esc(r.id)}</b>`,
    esc(WHAT[r.id] ?? r.name),
    badge(r.status),
    `<code>${esc(r.actual)}</code>`,
  ]);
  tabs.push({
    id: 'correctness', label: 'Correctness', badge: n('FAIL') ? `${n('FAIL')}✗` : '✓',
    body: `<h2>Correctness — does the system do the right thing?</h2>
      <p class="intro">Each row is one real end-to-end scenario, run against the live system. It
      checks that the described behaviour actually happens. <b class="pass-t">PASS</b> = behaved
      as required; <b class="fail-t">FAIL</b> = did not; <b class="block-t">BLOCKED</b> = a
      setup step didn't complete (an environment issue, not a defect); <b>SKIPPED</b> = an
      optional slow test that was not run.</p>
      <p class="sum">${n('PASS')} passed · ${n('FAIL')} failed · ${n('BLOCKED')} blocked · ${n('SKIP')} skipped</p>
      ${table(['#', 'What it checks', 'Result', 'Observed'], rows)}
      <p class="note">“Observed” is the raw outcome (HTTP code / flags) for the record.</p>`,
  });
}

// ── Gas ──────────────────────────────────────────────────────────────────────
const gas = parseCsv(R('gas.csv'));
if (gas) {
  // Read the environment (has example call inputs) before building the rows.
  let e = null;
  try { e = JSON.parse(readFileSync(R('gas-env.json'), 'utf8')); } catch { /* no env file */ }
  const inputs = e?.inputs ?? {};

  const ops = [...new Set(gas.map((r) => r.op))];
  const rows = ops.map((op) => {
    const s = summarize(gas.filter((r) => r.op === op).map((r) => Number(r.gasUsed)));
    const inp = inputStr(op, inputs);
    const call = `<code>${esc(GAS_SIG[op] ?? op)}</code>${inp ? `<div class="dim mono">called with: ${inp}</div>` : ''}`;
    return [`<b>${esc(op)}</b>`, `<code>${esc(GAS_CONTRACT[op] ?? '—')}</code>`, call, esc(GAS_WHAT[op] ?? ''), nfmt(Math.round(s.median)), nfmt(Math.round(s.p95)), s.n];
  });
  // Measurement environment block.
  let envHtml = '';
  if (e) {
    const envRows = [
      ['Chain', `${esc(e.chain)} (chainId ${esc(e.chainId)})`],
      ['EVM client', esc(e.client)],
      ['Solidity compiler', `solc ${esc(e.solc)}`],
      ['Contracts', esc(e.contracts)],
      ['Tooling', `ethers ${esc(e.ethers)} · Node ${esc(e.node)}`],
      ['Runs per operation', esc(e.runs)],
      ['Measured at', esc(new Date(e.at).toLocaleString())],
    ];
    envHtml = `<h3 class="sub">Test environment</h3>
      <div class="tw"><table class="kv">${envRows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table></div>
      <p class="note">${esc(e.note)}</p>`;
  }
  tabs.push({
    id: 'gas', label: 'Cost (gas)',
    body: `<h2>On-chain cost — how expensive is each blockchain operation?</h2>
      <p class="intro">“Gas” is the standard unit of on-chain computation — think of it as the
      price of a transaction. <b>Lower is cheaper.</b> Each row is one smart-contract function,
      the exact <b>inputs it was called with</b>, and the resulting gas. For scale, one Ethereum
      block holds about <b>30,000,000</b> gas, so every operation below is a tiny fraction.</p>
      ${table(['Operation', 'Contract', 'Call &amp; example input', 'What it is', 'Typical gas', 'Worst case (p95)', 'runs'], rows)}
      <p class="note">The zero-knowledge <code>verifyProof</code> cost is <b>constant</b> no matter
      how complex the medical check is — a key property of the design.</p>
      ${envHtml}`,
  });
}

// ── RQ4 feasibility ──────────────────────────────────────────────────────────
const e2e = parseCsv(R('e2e.csv'));
if (e2e) {
  const rows2 = e2e.map((r) => ({ ...r, ms: Number(r.ms), run: Number(r.run) }));
  const runs = [...new Set(rows2.map((r) => r.run))];
  const issue = runs.map((run) => rows2.find((r) => r.run === run && r.action === 'issue' && r.stage === 'total')?.ms).filter((x) => x != null);
  const disp = runs.map((run) => rows2.filter((r) => r.run === run && r.action === 'dispense').reduce((a, r) => a + r.ms, 0)).filter((x) => x > 0);
  const onchain = rows2.filter((r) => r.stage === 'onchain_verify').map((r) => r.ms);
  const row = (label, xs) => {
    const s = summarize(xs); const [word, cls, limit] = nielsen(s.median);
    return [label, `${(s.median / 1000).toFixed(1)} s`, `${(s.p95 / 1000).toFixed(1)} s`, `<span class="badge ${cls}">${word}</span> <span class="dim">${limit}</span>`];
  };
  const rows = [];
  if (issue.length) rows.push(row('Doctor: write &amp; issue a prescription', issue));
  if (disp.length) rows.push(row('Pharmacist: verify &amp; dispense', disp));
  let extra = '';
  if (onchain.length) {
    const a = summarize(onchain); const im = issue.length ? summarize(issue).median : 0;
    extra = `<p class="note">Of the doctor's wait, the actual cryptographic/blockchain work
      (on-chain proof verification) is only <b>${Math.round(a.median)} ms</b>${im ? ` (${((a.median / im) * 100).toFixed(1)}%)` : ''} —
      the rest is ordinary database/record-keeping. And it stays constant regardless of scale.</p>`;
  }
  tabs.push({
    id: 'feasibility', label: 'Speed',
    body: `<h2>Speed — how long does a real person wait?</h2>
      <p class="intro">Time from starting an action to seeing the result. Judged against the
      well-known <b>Nielsen usability limits</b>: under 1 s feels instant, under 10 s keeps the
      user's attention. “Typical” is the median; “worst case” is the 95th percentile (19 of 20
      runs are faster).</p>
      ${table(['User action', 'Typical wait', 'Worst case', 'Verdict'], rows)}${extra}`,
  });
}

// ── DAO k-of-n ───────────────────────────────────────────────────────────────
const dao = parseCsv(R('dao-conflict.csv'));
if (dao) {
  const rows = dao.map((r) => [
    `<b>${esc(r.members)}</b>`, esc(r.threshold),
    nfmt(r.deployGas), nfmt(r.resolutionGas), `${Math.round(Number(r.wallMs))} ms`,
  ]);
  tabs.push({
    id: 'dao', label: 'Governance',
    body: `<h2>Governance cost — resolving a conflict by committee vote</h2>
      <p class="intro">When labs disagree on a standard, the fix must be approved by a committee
      (a “k-of-n” vote: <b>k</b> approvals out of <b>n</b> members). This shows the cost as the
      committee grows — one-time setup vs. the cost of resolving one conflict.</p>
      ${table(['Committee size (n)', 'Votes needed (k)', 'One-time setup gas', 'Per-conflict gas', 'Time'], rows)}
      <p class="note">Per-conflict cost grows gently (roughly one small vote each); nothing here
      is expensive by blockchain standards.</p>`,
  });
}

// ── ZKP scaling ──────────────────────────────────────────────────────────────
const zkp = parseCsv(R('zkp-scaling.csv'));
if (zkp) {
  const kb = (b) => (b ? `${Math.round(Number(b) / 1024)} KB` : '—');
  const rows = zkp.map((r) => [
    esc(r.label), esc(r.axis), nfmt(r.constraints),
    `${(Number(r.compileMs) / 1000).toFixed(1)} s`, `${(Number(r.setupMs) / 1000).toFixed(1)} s`, kb(r.zkeyBytes),
  ]);
  tabs.push({
    id: 'zkp', label: 'ZKP scaling',
    body: `<h2>Zero-knowledge proof — how does it scale?</h2>
      <p class="intro">As the medical check gets bigger (more allergies / more drugs), the proof
      circuit grows. “Constraints” is the size of the circuit; the build/setup times and key
      size grow with it. Proof <i>verification</i>, though, stays constant (see the Cost tab).</p>
      ${table(['Variant', 'Growing axis', 'Circuit size (constraints)', 'Compile', 'Setup', 'Key size'], rows)}`,
  });
}

// Placeholder tab for benches not yet produced.
const missing = [['e2e.csv', 'Speed', 'e2e'], ['dao-conflict.csv', 'Governance', 'dao'], ['zkp-scaling.csv', 'ZKP scaling', 'zkp']].filter(([f]) => !existsSync(R(f)));
if (missing.length) {
  tabs.push({
    id: 'pending', label: 'Not run yet',
    body: `<h2>Benchmarks not run yet</h2>
      <p class="intro">These produce no data until you run the matching command:</p>
      <ul>${missing.map(([f, n, cmd]) => `<li><b>${esc(n)}</b> — <code>npm run bench:${cmd}</code> → <code>${f}</code></li>`).join('')}</ul>`,
  });
}

const tabBar = tabs.map((t, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${esc(t.label)}${t.badge ? ` <span class="tbadge">${esc(t.badge)}</span>` : ''}</button>`).join('');
const panels = tabs.map((t, i) => `<section class="panel${i === 0 ? ' active' : ''}" id="panel-${t.id}">${t.body}</section>`).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>eHealth evaluation — results</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.55 -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f6f7f9; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #14161a; color: #e6e6e6; } .panel { background: #1e2127 !important; border-color: #2a2e36 !important; } th { background: #262a32 !important; } code { background: #262a32 !important; } tr:nth-child(even) td { background: #1a1d23 !important; } .tabs { background: #14161a !important; border-color: #2a2e36 !important; } .tab { color: #cbd2dc; } .intro { background: #1a1d23 !important; border-color: #2a2e36 !important; } }
  header { padding: 24px; background: linear-gradient(135deg,#3b5bdb,#7048e8); color: #fff; }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header p { margin: 0; opacity: .9; font-size: 13px; max-width: 760px; }
  main { max-width: 1000px; margin: 0 auto; padding: 0 16px 60px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 4px; position: sticky; top: 0; background: #f6f7f9; padding: 12px 0; border-bottom: 1px solid #e5e7eb; z-index: 5; }
  .tab { border: 1px solid transparent; background: transparent; color: #444; font: inherit; font-size: 14px; padding: 7px 14px; border-radius: 8px; cursor: pointer; }
  .tab:hover { background: rgba(112,72,232,.12); }
  .tab.active { background: #7048e8; color: #fff; }
  .tbadge { font-size: 11px; opacity: .9; }
  .panel { display: none; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 22px; margin: 16px 0; }
  .panel.active { display: block; }
  h2 { font-size: 17px; margin: 0 0 12px; }
  h3.sub { font-size: 14px; margin: 22px 0 8px; opacity: .85; }
  table.kv th { width: 190px; white-space: nowrap; } table.kv td { width: auto; }
  .intro { font-size: 14px; background: #f4f2fd; border: 1px solid #e7e0fb; border-radius: 8px; padding: 12px 14px; margin: 0 0 16px; }
  .sum { font-weight: 600; margin: 0 0 12px; }
  .note { font-size: 13px; opacity: .78; margin: 12px 0 0; }
  .dim { opacity: .6; font-size: 12px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin-top: 3px; }
  .tw { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 8px 11px; border-bottom: 1px solid #eceef1; vertical-align: top; }
  th { background: #f2f4f7; font-weight: 600; white-space: nowrap; }
  tr:nth-child(even) td { background: #fafbfc; }
  code { background: #f2f4f7; padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
  .badge { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #fff; }
  .badge.pass, .badge.ok { background: #2f9e44; } .badge.fail, .badge.bad { background: #e03131; }
  .badge.block, .badge.warn { background: #f08c00; } .badge.skip { background: #868e96; }
  .pass-t { color: #2f9e44; } .fail-t { color: #e03131; } .block-t { color: #f08c00; }
</style></head>
<body>
<header><h1>eHealth prototype — evaluation results</h1>
<p>Three questions: <b>does it work correctly?</b> · <b>what does it cost?</b> · <b>is it fast
enough?</b> — Generated ${new Date().toLocaleString()}. This file is self-contained: open it in any
browser, no server or internet needed. Click the tabs below.</p></header>
<main>
  <nav class="tabs">${tabBar || ''}</nav>
  ${panels || '<section class="panel active"><p class="note">No results yet — run ./run-e2e.sh</p></section>'}
</main>
<script>
  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      var p = document.getElementById('panel-' + b.dataset.tab);
      if (p) p.classList.add('active');
    });
  });
</script>
</body></html>`;

writeFileSync(R('report.html'), html);
console.log(`[report-html] wrote results/report.html — open it in a browser (open results/report.html)`);
