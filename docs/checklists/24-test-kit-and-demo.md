# 24 Test kit, seed data and demo

Last updated: 25 November 2026 (PHT)

## A. Purpose and roles

How the team tests by hand and shows the system: the Manual Test Kit (clean state with accounts and sample PNs), the scenario data, the demo script and the automated test databases. Roles: developer and testers (local only).

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Clean kit: accounts per role and situation, 44 sample PNs, nothing opened; reset, backup, restore, rebuild | ✅ Built | `npm run kit:*`, Settings, Test kit | Developer, testers (local, test mode) | `--with-scenarios` | `lib/kit/*`, `tests/integration/kit.test.ts` | `docs/MANUAL-TEST-KIT.md` |
| 2 | Tester sheet and answers (45 things to check, including Open Items outcomes and pool to loan file) | ✅ Built | `docs/MANUAL-TEST-KIT.md`, `-ANSWERS.md` | testers | n/a | kit test checks they agree | Items 43 to 45 |
| 3 | Demo items (aged inbox items, pool loans) | ✅ Built | `npm run kit:demo` | Developer | n/a | `lib/kit/demo.ts` | `docs/DEMO_SCRIPT.md` |
| 4 | Demo script (30 minutes, both approval flows) | ✅ Built | `docs/DEMO_SCRIPT.md` | n/a | n/a | D-048 | n/a |
| 5 | `db:reset-seed`: fake data at every stage with pending Open Items; pools via first load | ✅ Built | console | Developer | n/a | `scripts/db-reset-seed.ts`, README | n/a |
| 6 | Sample myloans (mock) with the real branch list and products; simulator (now also not released / released again) | ✅ Built | Settings, System and test mode | `simulator:use` | n/a | `lib/myloans/v1/mock-store.ts`, `lib/services/source-sync.ts` | Kit items 30 to 45 |
| 7 | Separate test database for vitest and e2e (`gdfi_dms_test`); destructive guards | ✅ Built | n/a | n/a | n/a | `lib/env/test-db.ts`, `lib/env/destructive.ts` | n/a |
| 8 | e2e in groups at 1440, 820 and 390 px, production build, 1 worker | ✅ Built | `npm run e2e:groups` | Developer | n/a | `scripts/e2e-groups.ts` | n/a |
| 9 | Documentation screenshots on purpose only | ✅ Built | `npm run docs:screenshots` | Developer | n/a | D-042 | n/a |
| 10 | Volume test database (separate, 15,000 loans) | ✅ Built | `npm run volume` | Developer | n/a | module 23 row 11 | n/a |
| 11 | Accessibility and phone-width basics on the main screens of each role (language, heading, names, labels, alt text, no sideways scroll) | ✅ Built | e2e | Developer | n/a | e2e `a11y-basics.spec.ts` (15 / 15, 19 Nov 2026; 15 / 15 again 25 Nov 2026) | n/a |
| 12 | axe (WCAG 2.1 A and AA) on the main screens of each role at 1440, 820 and 390, and the open phone drawer; readability at 320, 360, 390, 844 × 390, 820, 1024 and 1440 (no sideways scroll, 44 px tap targets, 16 px fields and 14 px text on phones, nothing cut on My loans cards) (D-058) | ✅ Built | e2e | Developer | n/a | e2e `axe.spec.ts` and `ui-refresh.spec.ts` (25 Nov 2026, all pass; axe found and the fix closed two name mismatches: Home counts, Funds type filter on phones) | n/a |

## D. Known limits and open questions

- The kit runs only locally on `gdfi_dms` with test mode; staging UAT uses its own fake data (to prepare with the testers).
