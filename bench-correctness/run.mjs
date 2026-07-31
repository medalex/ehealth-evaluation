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
const icon = (s) => ({ PASS: '✅', FAIL: '❌', BLOCKED: '🚧', SKIP: '⏭' }[s] ?? '?');

async function main() {
  console.log('[correctness] running against the live stack...\n');
  const results = [];
  for (const sc of SCENARIOS) {
    let r;
    try { r = await sc.run(); }
    catch (e) { r = { status: 'FAIL', expected: '(no error)', actual: 'ERROR', notes: e.message }; }
    results.push({ id: sc.id, name: sc.name, expected: r.expected, actual: r.actual, status: r.status, notes: r.notes });
    console.log(`${icon(r.status)} ${sc.id} ${sc.name} — expected ${r.expected}, got ${r.actual}${r.notes ? ` (${r.notes})` : ''}`);
  }

  writeCsv(join(__dir, '..', 'results', 'correctness.csv'), results);
  const n = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n[correctness] ${n('PASS')} passed, ${n('FAIL')} failed, ${n('BLOCKED')} blocked, ${n('SKIP')} skipped of ${results.length}.`);
  process.exit(n('FAIL') > 0 ? 1 : 0);
}

main().catch((e) => { console.error('[correctness] FATAL:', e.message); process.exit(1); });
