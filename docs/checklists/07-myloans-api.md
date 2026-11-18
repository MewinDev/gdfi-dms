# 07 myloans API (APIs 1, 2, 4, 5; contract; mock / live switch)

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

The DMS reads myloans only through its read-only API, never its database (v2 §11, D-022, D-036, D-040). One contract client serves the mock (local, staging) and live myloans (production); `MYLOANS_MODE` switches between them. No user role: the system calls it; Admin sees the run log and the mock panel in test mode.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | API 1, loan by PN: 404 not found, 422 not selectable with the status | ✅ Built (mock) | Find loan, Refresh | System | No | `lib/myloans/v1/client.ts`, `tests/contract` | Find a non-released PN: status card |
| 2 | API 2, changed loans: since minus 5 minutes, 500 per page, cursor, any status | ✅ Built (mock) | the sync | System | Interval | D-052, `lib/services/myloans-sync.ts` | Run now; run log |
| 3 | API 3, freshness check before key steps (Changed by D-036: API 3 dropped; Refresh calls API 1) | ✅ Built as decided | n/a | n/a | n/a | D-036 | n/a |
| 4 | API 4, branches; API 5, products | ✅ Built (mock) | Settings, Branches / Product classification | System | Daily time | D-054 | Kit: branch rename applies by itself |
| 5 | One client for mock and live; mock has its own tables and the agreed shapes | ✅ Built | n/a | n/a | `MYLOANS_MODE` | `lib/myloans/v1`, `docs/myloans/mock-and-contract.md` | n/a |
| 6 | Contract tests runnable against a live myloans (`npm run test:contract`) | ✅ Built | console | Developer | No | `scripts/contract.ts` | Go-live checklist step 1 |
| 7 | Contract verified against myloans staging | ⏸ Blocked (myloans team, infrastructure: staging access C5) | n/a | n/a | n/a | `docs/STATUS.md` | n/a |
| 8 | Authentication: v2 §11.7 asks OAuth client credentials; built: a Bearer API key (the agreed contract) | ⚠️ Partial (OAuth token exchange not built; confirm in the staging check) | n/a | n/a | `MYLOANS_API_KEY` | D-022 | n/a |
| 9 | Hash test vectors (ContentHash agrees with myloans) | ⏸ Blocked (myloans team: 3 vector outputs) | n/a | n/a | n/a | the one skipped test | n/a |
| 10 | Failure handling: time limit, hourly limit, circuit breaker; DMS keeps working on saved data | ✅ Built | n/a | n/a | Hourly limit, pause | `lib/myloans/resilience.ts`, e2e `sync-check.spec.ts` | Mock failure switch: Find loan says busy |
| 11 | Mock failure simulation and scenarios (test mode only) | ✅ Built | Settings, System and test mode | `simulator:use` | n/a | e2e `myloans-mock.spec.ts` | n/a |
| 12 | Production refuses `MYLOANS_MODE=mock` | ✅ Built | n/a | n/a | No | `lib/env/check.test.ts` | n/a |

## D. Known limits and open questions

- Waiting on myloans: staging access (C5), timings (R2-6), limits (A4, A5, C2), 200 vs 409 on API 1, whether cancel and deactivate always update `updated_at`, the hash vectors.
