// RQ4 — semantic-conflict resolution round-trip through the k-of-n DAO.
//
// Drives one full governance loop and records its cost:
//   escalate (409) -> propose -> k votes -> approved -> publish to DKG -> retry succeeds
// Metrics per loop: number of on-chain txs, total gasUsed, wall-clock, #votes to quorum.
// Sweep: DAO member count / quorum threshold (requires deploying a fresh MinimalGovernance
// per configuration — factory deploy also yields the deploy-gas curve for RQ4).
//
// Output: results/dao-conflict.csv (one row per loop, plus deploy-gas rows per member count).
//
// TODO(impl):
//   1. For n in [3,5,7,...]: deploy MinimalGovernance(n, quorum) via ContractFactory,
//      record deploy gasUsed.
//   2. propose a bridge hash; cast ceil(quorum*n) votes; measure total gas + wall-clock.
//   3. Optionally trigger the real mfssia escalate->publish path over HTTP and time it.
//   4. writeCsv with columns: members, quorum, txCount, totalGas, votesToQuorum, wallMs.

console.error('bench-dao: not yet implemented — see the TODO block in this file.');
process.exit(1);
