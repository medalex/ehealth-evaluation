// RQ1 correctness as a vitest suite with Allure metadata. Reuses the exact scenarios from
// scenarios.mjs (single source of truth) so the Allure report and the CSV never diverge.
// Also writes results/correctness.csv in afterAll, so `npm test` produces both artifacts.
//
//   npm test                # runs this suite -> allure-results/ + results/correctness.csv
//   npm run report:allure   # renders + opens the Allure HTML report
//
// BLOCKED/SKIP scenarios are marked skipped in Allure (a precondition wasn't met, e.g. consent
// not anchored — not an artifact defect); PASS/FAIL map to the assertion.

import { describe, test, expect, afterAll } from 'vitest';
import { epic, feature, severity, parameter, description } from 'allure-js-commons';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCENARIOS } from './scenarios.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const rows = [];

describe('RQ1 — Correctness', () => {
  for (const sc of SCENARIOS) {
    test(`${sc.id} — ${sc.name}`, async (ctx) => {
      await epic('RQ1 — Correctness');
      await feature(sc.feature);
      await severity(sc.severity);

      console.log(`\n▶ ${sc.id} — ${sc.what}`);
      const r = await sc.run();
      const icon = { PASS: '✅ PASS', FAIL: '❌ FAIL', BLOCKED: '🚧 BLOCKED (precondition not met — not a defect)', SKIP: '⏭  SKIPPED' }[r.status] ?? r.status;
      console.log(`  ${icon}  (${r.actual})`);
      rows.push({ id: sc.id, name: sc.name, expected: r.expected, actual: r.actual, status: r.status, notes: r.notes });

      await parameter('expected', String(r.expected));
      await parameter('actual', String(r.actual));
      if (r.notes) await description(r.notes);

      if (r.status === 'BLOCKED' || r.status === 'SKIP') {
        ctx.skip(); // shows as skipped in Allure — precondition unmet / not applicable
      }
      expect(r.status, `${r.actual}${r.notes ? ` — ${r.notes}` : ''}`).toBe('PASS');
    });
  }

  afterAll(() => {
    if (!rows.length) return;
    const cols = ['id', 'name', 'expected', 'actual', 'status', 'notes'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
    const out = join(__dir, '..', 'results');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'correctness.csv'), csv);
  });
});
