# Evaluation report

Generated 2026-08-03T22:29:56.870Z

## RQ1 — Correctness

**6 passed · 0 failed · 0 blocked · 1 skipped** of 7

| Scenario | Result | Expected | Actual | Notes |
|----------|--------|----------|--------|-------|
| Sc1 valid prescription issued | ✅ PASS | 201 outcome=true | 201 outcome=true |  |
| Sc2 ZKP-rejected not issued | ✅ PASS | 422 issued=false | 422 issued=false |  |
| Sc3 access gate blocks unregistered doctor | ✅ PASS | 403 | 403 |  |
| Sc4 numeric bridge needs DAO consensus | ✅ PASS | gate 403 then approved | proposal=23 gate403=true approved=true |  |
| Sc5 terminology alignment needs DAO consensus | ✅ PASS | conflict, gate 403, approved | conflict=true gate403=true approved=true |  |
| Sc6 proof freshness / validity window | ⏭ SKIP | expired after window | SKIPPED | timed setup — validated manually per README Scenario 6 |
| Sc7 replay single-use | ✅ PASS | first verified, second replay-rejected | v1=true v2=false |  |

## RQ2/RQ4 — On-chain gas

| Operation | n | median | p95 | min | max |
|-----------|---|--------|-----|-----|-----|
| propose | 10 | 79,944 | 79,944 | 79,932 | 79,944 |
| vote | 10 | 76,987 | 76,987 | 76,987 | 76,987 |
| record | 10 | 90,974 | 90,974 | 90,962 | 90,974 |

> Groth16 `verifyProof` gas is expected to be **constant** regardless of circuit size.

## RQ4 — End-user feasibility (supplementary)

_User-facing latency of the two actions (full request→response), against the Nielsen/Miller
response-time limits. Not a core scientific metric — the ZKP/gas contribution is measured
in isolation in RQ2/RQ3; here it is contextualised as perceived wait._

| User action | runs | median | p95 | verdict |
|-------------|------|--------|-----|---------|
| Clinician: issue prescription | 15 | 1964 ms | 2271 ms | acceptable (<10s attention limit) |
| Pharmacist: verify + dispense | 15 | 977 ms | 1029 ms | fluid (<1s) |

**Contribution slice** — isolated on-chain Groth16 verification: median 343 ms (17.5% of issuance). Constant regardless of circuit size (Groth16 O(1)).

> ZKP proof generation (the dominant issuance cost) is measured in isolation in RQ2 (bench-zkp).

## RQ3 — k-of-n governance cost

Cost of resolving one semantic conflict on-chain (propose → vote to quorum → approved),
and the one-off DAO deployment, as the member count grows.

| members (n) | quorum (k) | deploy gas | resolution gas | median vote gas | votes | wall-clock |
|-------------|-----------|-----------|----------------|-----------------|-------|-----------|
| 3 | 2 | 937,792 | 265,014 | 77,574 | 2 | 521 ms |
| 4 | 3 | 961,087 | 325,500 | 77,574 | 3 | 722 ms |
| 5 | 3 | 984,382 | 325,500 | 77,574 | 3 | 758 ms |
| 6 | 4 | 1,007,677 | 385,974 | 60,474 | 4 | 910 ms |
| 7 | 5 | 1,030,972 | 446,448 | 60,474 | 5 | 1062 ms |

> Resolution gas grows ~linearly with the required votes (k); each vote is a small fixed
> cost. Deployment is a one-off. All well within ordinary L2/side-chain budgets.

## Supporting — governance-query latency vs #policies

How long the prover's `GET /policies` (SPARQL over the DKG) takes as the policy set grows.

| policies in graph | query median | p95 | samples |
|-------------------|--------------|-----|---------|
| 9 | 24.7 ms | 39.2 ms | 10 |
| 19 | 22.4 ms | 24.9 ms | 10 |
| 29 | 24.2 ms | 27.1 ms | 10 |
| 39 | 25.5 ms | 27.6 ms | 10 |

---
_Not yet produced: zkp-scaling.csv (benches pending)._
