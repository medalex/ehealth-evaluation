// Functional readiness gate — polls the real HTTP endpoints of every service the benches
// need until each returns 200, then settles briefly for the DKG. Used as the evaluation
// container's entrypoint (container healthchecks are unreliable on this stack). Endpoints are
// resolved from config, so it works both in-network (service names) and from the host.
import { loadConfig } from './config.mjs';

const cfg = loadConfig();
const TIMEOUT_S = Number(process.env.READY_TIMEOUT_S ?? 2400);
const SETTLE_S = Number(process.env.DKG_SETTLE_S ?? 60);

const targets = [
  ['evm', `${cfg.evmApi}/health`],
  ['mfssia', `${cfg.mfssiaApi}/rx-governance/policies`],
  ['patient', `${cfg.patientApi}/api/patients`],
  ['lab', `${cfg.labApi}/api/results`],
  ['hospital', `${cfg.hospitalApi}/api/doctors`],
  ['pharmacy', `${cfg.pharmacyApi}/api/prescriptions`],
];

async function ok(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 5000);
    const r = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    return r.status === 200;
  } catch { return false; }
}

async function main() {
  console.log(`[wait-ready] waiting up to ${TIMEOUT_S}s for the stack...`);
  const deadline = Date.now() + TIMEOUT_S * 1000;
  let pending = [...targets];
  while (pending.length) {
    if (Date.now() > deadline) {
      console.error(`[wait-ready] TIMEOUT — still down: ${pending.map((p) => p[0]).join(', ')}`);
      process.exit(1);
    }
    const still = [];
    for (const [name, url] of pending) {
      if (await ok(url)) console.log(`   ✓ ${name} ready`);
      else still.push([name, url]);
    }
    pending = still;
    if (pending.length) {
      console.log(`   waiting on: ${pending.map((p) => p[0]).join(', ')}`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  console.log(`[wait-ready] all endpoints up. Settling ${SETTLE_S}s for the DKG.`);
  await new Promise((r) => setTimeout(r, SETTLE_S * 1000));
  console.log('[wait-ready] ready.');
}

main();
