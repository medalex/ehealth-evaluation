// Supporting scaling metric — governance-query latency vs the number of clinical policies.
//
// Answers the "does it scale with the number of policies?" axis that the other benches don't
// cover: publishes policies in batches and, at each checkpoint, times the SPARQL-backed
// `GET /rx-governance/policies` query (what the prover reads at issuance time). This isolates
// how the read cost grows as theory T (the policy set in the DKG) grows.
//
//   node bench-policies/bench-policies.mjs   [--batch 10 --steps 3 --samples 8]
//
// Needs mfssia up (DKG writes must work — a clean stack; see README). Policies are published
// directly (?direct=true) as load records. Output: results/policies-scaling.csv.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { summarize } from '../lib/timer.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg = loadConfig();
const arg = (name, def) => (process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : def);
const BATCH = arg('--batch', 10);     // policies added per step
const STEPS = arg('--steps', 3);      // number of batches (checkpoints = STEPS + 1)
const SAMPLES = arg('--samples', 8);  // timed GET /policies calls per checkpoint
const ANCHOR_TIMEOUT_MS = Number(process.env.ANCHOR_TIMEOUT_MS ?? 120000);
const uid = () => Number(String(Date.now()).slice(-9)) + Math.floor(Math.random() * 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function policyCountOnce() {
  const res = await fetch(`${cfg.mfssiaApi}/rx-governance/policies`);
  const b = await res.json().catch(() => ({}));
  const list = b?.data?.data ?? b?.data ?? [];
  return Array.isArray(list) ? list.length : 0;
}
// The DKG SPARQL query can transiently return empty under finality backlog; take the max of a
// few reads so a momentary glitch doesn't record a bogus count of 0.
async function policyCount() {
  let max = 0;
  for (let i = 0; i < 3; i++) { max = Math.max(max, await policyCountOnce()); if (i < 2) await sleep(500); }
  return max;
}

async function timeQuery() {
  const t0 = process.hrtime.bigint();
  const res = await fetch(`${cfg.mfssiaApi}/rx-governance/policies`);
  await res.text();
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

async function publishOne(i) {
  const dto = {
    code: `pol:load-${i}-${uid()}`, name: `Load policy ${i}`,
    medicationCode: `loadtest${i}`, clinicalCondition: 'eGFR',
    comparisonOperator: '>=', threshold: 30, deltaMax: 7776000,
  };
  const res = await fetch(`${cfg.mfssiaApi}/rx-governance/policies?direct=true`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dto),
  });
  return res.ok;
}

const WARMUP = Number(process.env.WARMUP ?? 3);

async function measure() {
  const count = await policyCount();
  // Discard warm-up queries so cold-start / connection / cache effects don't skew the first
  // checkpoint (otherwise latency appears to *drop* as the stack warms up, not as a scaling).
  for (let i = 0; i < WARMUP; i++) await timeQuery();
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) samples.push(await timeQuery());
  const s = summarize(samples);
  return { policyCount: count, queryMedianMs: s.median.toFixed(1), queryP95Ms: s.p95.toFixed(1), samples: SAMPLES };
}

async function waitForCount(target) {
  const deadline = Date.now() + ANCHOR_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await policyCount()) >= target) return true;
    await sleep(3000);
  }
  return false;
}

async function main() {
  try { await policyCount(); }
  catch { console.error(`[policies] cannot reach mfssia at ${cfg.mfssiaApi} — is the stack up?`); process.exit(1); }

  const rows = [];
  console.log('[policies] checkpoint 0 (baseline)...');
  rows.push(await measure());
  console.log(`[policies]   count=${rows[0].policyCount} queryMedian=${rows[0].queryMedianMs}ms`);

  for (let step = 1; step <= STEPS; step++) {
    const before = await policyCount();
    console.log(`[policies] publishing ${BATCH} policies (step ${step}/${STEPS})...`);
    let ok = 0;
    for (let i = 0; i < BATCH; i++) {
      if (await publishOne(before * 1000 + step * 100 + i)) ok++;
      await sleep(800); // gap so rapid DKG writes don't collide
    }
    console.log(`[policies]   ${ok}/${BATCH} published; waiting for the DKG to make them queryable (finality ~10s each)...`);
    await sleep(12000); // settle for finality/indexing
    const anchored = await waitForCount(before + ok);
    if (!anchored) console.warn(`[policies]   only ${await policyCount()} of ${before + ok} queryable within timeout — recording actual`);
    const m = await measure();
    // Skip a checkpoint whose count regressed (finality stalled / DKG glitch) — not a valid point.
    const lastCount = rows.length ? Number(rows[rows.length - 1].policyCount) : 0;
    if (m.policyCount < lastCount || m.policyCount === 0) {
      console.warn(`[policies]   skipping checkpoint — count regressed to ${m.policyCount} (was ${lastCount}); DKG likely backlogged`);
      break;
    }
    console.log(`[policies]   count=${m.policyCount} queryMedian=${m.queryMedianMs}ms`);
    rows.push(m);
  }

  const cols = ['policyCount', 'queryMedianMs', 'queryP95Ms', 'samples'];
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => r[c]).join(','))].join('\n') + '\n';
  mkdirSync(join(__dir, '..', 'results'), { recursive: true });
  writeFileSync(join(__dir, '..', 'results', 'policies-scaling.csv'), csv);
  console.log(`[policies] wrote ${rows.length} checkpoints -> results/policies-scaling.csv`);
}

main().catch((e) => { console.error('[policies] FAILED:', e.message); process.exit(1); });
