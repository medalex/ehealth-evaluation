# Evaluation report

Generated 2026-08-02T19:43:47.885Z

## RQ1 — Correctness

**3 passed · 0 failed · 3 blocked · 1 skipped** of 7

| Scenario | Result | Expected | Actual | Notes |
|----------|--------|----------|--------|-------|
| Sc1 valid prescription issued | 🚧 BLOCKED | 201 outcome=true | consent not anchored | C-DOC-AUTHZ never passed — check dkg-node health / consent anchoring |
| Sc2 ZKP-rejected not issued | 🚧 BLOCKED | 422 issued=false | consent not anchored | precondition (consent) unavailable |
| Sc3 access gate blocks unregistered doctor | ✅ PASS | 403 | 403 |  |
| Sc4 numeric bridge needs DAO consensus | ✅ PASS | gate 403 then approved | proposal=16 gate403=true approved=true |  |
| Sc5 terminology alignment needs DAO consensus | ✅ PASS | conflict, gate 403, approved | conflict=true gate403=true approved=true |  |
| Sc6 proof freshness / validity window | ⏭ SKIP | expired after window | SKIPPED | timed setup — validated manually per README Scenario 6 |
| Sc7 replay single-use | 🚧 BLOCKED | first ok, second rejected | consent not anchored | needs a valid issued prescription to replay |

## RQ2/RQ4 — On-chain gas

| Operation | n | median | p95 | min | max |
|-----------|---|--------|-----|-----|-----|
| propose | 15 | 79,944 | 79,944 | 79,932 | 79,944 |
| vote | 15 | 76,987 | 76,987 | 76,987 | 76,987 |
| record | 15 | 90,974 | 90,974 | 90,962 | 90,974 |

> Groth16 `verifyProof` gas is expected to be **constant** regardless of circuit size.

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

---
_Not yet produced: e2e.csv, zkp-scaling.csv (benches pending)._
