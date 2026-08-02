# Evaluation report

Generated 2026-08-02T08:23:24.095Z

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

---
_Not yet produced: e2e.csv, gas.csv, dao-conflict.csv, zkp-scaling.csv (benches pending)._
