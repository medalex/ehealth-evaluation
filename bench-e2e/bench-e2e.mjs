// RQ3 — end-to-end latency (cost of privacy + decentralisation vs a naive baseline).
//
// Times the full prescription lifecycle against the running stack and breaks it down by
// stage so the ZKP/DAO overhead is separable from ordinary REST/DKG work:
//   issuance:  access-gate -> semantic-conflict checks -> witness-gen -> proof-gen -> anchor
//   dispense:  fetch -> off-circuit freshness/replay check -> on-chain verify -> record
//
// Output: results/e2e.csv (one row per stage per run).
//
// TODO(impl):
//   1. loadConfig(); POST hospitalApi /api/prescriptions with a fixed valid payload.
//   2. Time the whole call; if the API returns per-stage timings, record them; otherwise
//      wrap the coarse phases the client can see.
//   3. Take the returned proof + send to pharmacyApi verify/dispense; time those.
//   4. Also run a "baseline" variant (env BASELINE=1) that hits a mock endpoint doing the
//      same CRUD WITHOUT proving/anchoring, to quantify the delta.
//   5. writeCsv(results/e2e.csv, rows) with columns: stage, run, ms, variant.

console.error('bench-e2e: not yet implemented — see the TODO block in this file.');
process.exit(1);
