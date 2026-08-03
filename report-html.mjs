// Renders results/*.csv into a SELF-CONTAINED results/report.html — a single local file
// (inline CSS/JS, no external resources, no server) you open in a browser on the machine that
// ran the tests. Tabbed by test type. Complements results/REPORT.md and the Allure dashboard.
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
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}
function nielsen(ms) {
  if (ms < 100) return ['instant (&lt;0.1s)', 'ok'];
  if (ms < 1000) return ['fluid (&lt;1s)', 'ok'];
  if (ms < 10000) return ['acceptable (&lt;10s)', 'warn'];
  return ['over 10s limit', 'bad'];
}

// Each tab: { id, label, badge?, body }
const tabs = [];

// ── RQ1 correctness ──────────────────────────────────────────────────────────
const corr = parseCsv(R('correctness.csv'));
if (corr) {
  const badge = (s) => `<span class="badge ${{ PASS: 'pass', FAIL: 'fail', BLOCKED: 'block', SKIP: 'skip' }[s] ?? 'skip'}">${esc(s)}</span>`;
  const n = (s) => corr.filter((r) => r.status === s).length;
  const rows = corr.map((r) => [`<b>${esc(r.id)}</b>`, esc(r.name), badge(r.status), `<code>${esc(r.actual)}</code>`, esc(r.notes)]);
  tabs.push({
    id: 'correctness', label: 'Correctness', badge: n('FAIL') ? `${n('FAIL')}✗` : '✓',
    body: `<h2>Correctness — does the system do the right thing?</h2>
      <p class="sum">${n('PASS')} passed · ${n('FAIL')} failed · ${n('BLOCKED')} blocked · ${n('SKIP')} skipped</p>
      ${table(['#', 'Scenario', 'Result', 'Actual', 'Notes'], rows)}`,
  });
}

// ── Gas ──────────────────────────────────────────────────────────────────────
const gas = parseCsv(R('gas.csv'));
if (gas) {
  const ops = [...new Set(gas.map((r) => r.op))];
  const rows = ops.map((op) => {
    const s = summarize(gas.filter((r) => r.op === op).map((r) => Number(r.gasUsed)));
    return [`<b>${esc(op)}</b>`, s.n, nfmt(Math.round(s.median)), nfmt(Math.round(s.p95)), nfmt(Math.round(s.min)), nfmt(Math.round(s.max))];
  });
  tabs.push({
    id: 'gas', label: 'Gas (cost)',
    body: `<h2>On-chain gas — how expensive are the blockchain ops?</h2>
      ${table(['Operation', 'n', 'median', 'p95', 'min', 'max'], rows)}
      <p class="note">Groth16 <code>verifyProof</code> is expected to be constant regardless of circuit size.</p>`,
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
  const row = (label, xs) => { const s = summarize(xs); const [v, cls] = nielsen(s.median); return [label, s.n, `${Math.round(s.median)} ms`, `${Math.round(s.p95)} ms`, `<span class="badge ${cls}">${v}</span>`]; };
  const rows = [];
  if (issue.length) rows.push(row('Clinician: issue prescription', issue));
  if (disp.length) rows.push(row('Pharmacist: verify + dispense', disp));
  let extra = '';
  if (onchain.length) {
    const a = summarize(onchain); const im = issue.length ? summarize(issue).median : 0;
    extra = `<p class="note">Contribution slice — on-chain Groth16 verification: <b>${Math.round(a.median)} ms</b>${im ? ` (${((a.median / im) * 100).toFixed(1)}% of issuance)` : ''}, constant (O(1)).</p>`;
  }
  tabs.push({
    id: 'feasibility', label: 'Speed (feasibility)',
    body: `<h2>End-user feasibility — how long does a real user wait?</h2>
      ${table(['User action', 'runs', 'median', 'p95', 'verdict (Nielsen)'], rows)}${extra}
      <p class="note">Supplementary metric; the ZKP/gas contribution is measured in isolation in the other tabs.</p>`,
  });
}

// ── DAO k-of-n ───────────────────────────────────────────────────────────────
const dao = parseCsv(R('dao-conflict.csv'));
if (dao) {
  const rows = dao.map((r) => [r.members, r.threshold, nfmt(r.deployGas), nfmt(r.resolutionGas), nfmt(r.voteGasMed), r.votesCast, `${Math.round(Number(r.wallMs))} ms`]);
  tabs.push({
    id: 'dao', label: 'DAO (k-of-n)',
    body: `<h2>k-of-n governance cost — resolving a conflict on-chain</h2>
      ${table(['members', 'quorum', 'deploy gas', 'resolution gas', 'median vote gas', 'votes', 'wall-clock'], rows)}`,
  });
}

// ── ZKP scaling ──────────────────────────────────────────────────────────────
const zkp = parseCsv(R('zkp-scaling.csv'));
if (zkp) {
  const kb = (b) => (b ? `${Math.round(Number(b) / 1024)} KB` : '—');
  const rows = zkp.map((r) => [esc(r.label), esc(r.axis), nfmt(r.constraints), `${r.compileMs} ms`, `${r.setupMs} ms`, kb(r.zkeyBytes), kb(r.wasmBytes)]);
  tabs.push({
    id: 'zkp', label: 'ZKP (scaling)',
    body: `<h2>ZKP circuit scaling</h2>
      ${table(['variant', 'axis', 'constraints', 'compile', 'setup', '.zkey', '.wasm'], rows)}`,
  });
}

// Placeholder tab for benches not yet produced.
const missing = [['e2e.csv', 'Speed'], ['dao-conflict.csv', 'DAO'], ['zkp-scaling.csv', 'ZKP']].filter(([f]) => !existsSync(R(f)));
if (missing.length) {
  tabs.push({
    id: 'pending', label: 'Pending',
    body: `<h2>Not yet produced</h2><p class="note">Run the matching bench to fill these in:</p>
      <ul>${missing.map(([f, n]) => `<li><code>${f}</code> — ${n} — <code>npm run bench:${n.toLowerCase() === 'speed' ? 'e2e' : n.toLowerCase()}</code></li>`).join('')}</ul>`,
  });
}

const tabBar = tabs.map((t, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-tab="${t.id}">${esc(t.label)}${t.badge ? ` <span class="tbadge">${esc(t.badge)}</span>` : ''}</button>`).join('');
const panels = tabs.map((t, i) => `<section class="panel${i === 0 ? ' active' : ''}" id="panel-${t.id}">${t.body}</section>`).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>eHealth evaluation — results</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f6f7f9; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #14161a; color: #e6e6e6; } .panel { background: #1e2127 !important; border-color: #2a2e36 !important; } th { background: #262a32 !important; } code { background: #262a32 !important; } tr:nth-child(even) td { background: #1a1d23 !important; } .tabs { background: #1e2127 !important; border-color: #2a2e36 !important; } .tab { color: #cbd2dc; } }
  header { padding: 24px; background: linear-gradient(135deg,#3b5bdb,#7048e8); color: #fff; }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header p { margin: 0; opacity: .85; font-size: 13px; }
  main { max-width: 1000px; margin: 0 auto; padding: 0 16px 60px; }
  .tabs { display: flex; flex-wrap: wrap; gap: 4px; position: sticky; top: 0; background: #f6f7f9; padding: 12px 0; border-bottom: 1px solid #e5e7eb; z-index: 5; }
  .tab { border: 1px solid transparent; background: transparent; color: #444; font: inherit; font-size: 14px; padding: 7px 14px; border-radius: 8px; cursor: pointer; }
  .tab:hover { background: rgba(112,72,232,.1); }
  .tab.active { background: #7048e8; color: #fff; }
  .tbadge { font-size: 11px; opacity: .9; }
  .panel { display: none; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 20px; margin: 16px 0; }
  .panel.active { display: block; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  .sum { font-weight: 600; margin: 0 0 12px; }
  .note { font-size: 13px; opacity: .75; margin: 10px 0 0; }
  .tw { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #eceef1; white-space: nowrap; }
  th { background: #f2f4f7; font-weight: 600; }
  tr:nth-child(even) td { background: #fafbfc; }
  code { background: #f2f4f7; padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #fff; }
  .badge.pass, .badge.ok { background: #2f9e44; } .badge.fail, .badge.bad { background: #e03131; }
  .badge.block, .badge.warn { background: #f08c00; } .badge.skip { background: #868e96; }
</style></head>
<body>
<header><h1>eHealth prototype — evaluation results</h1>
<p>Generated ${new Date().toLocaleString()} · self-contained (open in any browser, no server)</p></header>
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
