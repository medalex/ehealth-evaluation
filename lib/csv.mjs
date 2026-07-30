// Minimal CSV writer. One row = one raw measurement (never pre-aggregated).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeCsv(path, rows) {
  if (rows.length === 0) {
    console.warn(`[csv] no rows for ${path}`);
    return;
  }
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join('\n') + '\n');
  console.log(`[csv] wrote ${rows.length} rows -> ${path}`);
}
