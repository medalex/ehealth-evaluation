// RQ1 — functional correctness, CSV runner (framework-free; used by the container and
// run-eval.sh). For the Allure report use `npm test` (vitest), which reuses the same
// scenarios from scenarios.mjs. Outcomes: PASS | FAIL | BLOCKED | SKIP.
//
//   node bench-correctness/run.mjs
//
// Requires the full stack up (docker compose up), ideally clean — see README.

import { SCENARIOS } from './scenarios.mjs';
import { writeCsv } from '../lib/csv.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const icon = (s) => ({ PASS: '✅ PASS', FAIL: '❌ FAIL', BLOCKED: '🚧 BLOCKED (precondition not met — not a defect)', SKIP: '⏭  SKIPPED' }[s] ?? s);

async function main() {
  console.log('Checking the system behaves correctly across 7 real end-to-end scenarios.\n');
  const results = [];
  for (const sc of SCENARIOS) {
    console.log(`▶ ${sc.id} — ${sc.what}`);
    let r;
    try { r = await sc.run(); }
    catch (e) { r = { status: 'FAIL', expected: '(no error)', actual: 'ERROR', notes: e.message }; }
    results.push({ id: sc.id, name: sc.name, expected: r.expected, actual: r.actual, status: r.status, notes: r.notes });
    console.log(`  ${icon(r.status)}  (${r.actual})${r.notes ? ` — ${r.notes}` : ''}\n`);
  }

  writeCsv(join(__dir, '..', 'results', 'correctness.csv'), results);
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`Result: ${n('PASS')} passed · ${n('FAIL')} failed · ${n('BLOCKED')} blocked · ${n('SKIP')} skipped (of ${results.length}).`);
  process.exit(n('FAIL') > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[correctness] FATAL:', e.message); process.exit(1); });
