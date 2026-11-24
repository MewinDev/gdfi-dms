# 02 Roles and permissions

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

What each person may do. Roles are bundles of permission ticks (D-003); a person can also have their own extra or removed ticks (overrides, D-008). Superadmin sets up roles and the matrix; Admin manages users. The full list of ticks and their default roles is in module 04.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Ten decided roles plus Operations Monitor (Superadmin, Admin, LA, LA Supervisor/Head, DP / Collateral & Mortgage, Finance, Custodian, Digicur, QA, Archiver) | ✅ Built | Settings, Roles and access | Superadmin | Yes (new roles, copies, inactive) | `lib/auth/permissions.ts` (`ROLE_DEFAULTS`), D-002 | Settings, Roles lists them |
| 2 | Permission matrix: every role against 96 permissions, with tickboxes and plain-words summary | ✅ Built | Settings, Permissions | `roles:manage` (Superadmin) | Yes | `components/admin/permission-matrix.tsx`, e2e `role-editor.spec.ts` | UAT SA-1 |
| 3 | Per-user overrides (extra or removed ticks) | ✅ Built | Users, Edit | `roles:manage` | Yes | D-008, `lib/auth/effective.ts`, `effective.test.ts` | UAT SA-2 |
| 4 | Changes apply on the person's next click (no sign-out) | ✅ Built | all | n/a | No | `lib/auth/build-user.ts` | Untick, click: the button is gone |
| 5 | Lock-out protection (cannot remove the last way to manage permissions) | ✅ Built | Settings, Permissions | Superadmin | No | e2e `roles.spec.ts` | Try to untick Manage permissions on the only Superadmin |
| 6 | Required ticks added automatically (for example Open a loan file needs Find a loan) | ✅ Built | Settings, Permissions | n/a | No | `withRequirements` in `permissions.ts` | Tick Open a loan file: Find a loan ticks too |
| 7 | Admin and Superadmin locked out of day-to-day work by default (no approving, releasing, working jobs) | ✅ Built | n/a | n/a | Yes (tickable) | D-028, `DAY_TO_DAY_PERMISSIONS` | Admin has no Accept on a job |
| 8 | Open Item approvers by permission only, no fallback (Changed by D-029: v2 said "LA Supervisor/Head only") | ✅ Built | Open Items | `myloans:review`, `myloans:review_borrower` | Yes | D-010, D-029, `OPEN_ITEM_APPROVER_KEYS` | UAT SUP-2 |
| 9 | One Finance role; CA and FT per person ("Handles CA / FT") (Changed by D-009: v2 had two Finance roles) | ✅ Built | Users, Edit | Admin | Yes | D-009, D-034 | A CA-only Finance user cannot see FT |
| 10 | Role matrix download (CSV) | ✅ Built | Settings, Permissions | `roles:manage` | No | `app/api/settings/roles-matrix` | Download opens in Excel |
| 11 | Permission scan: every server action and route checks a permission | ✅ Built | n/a | n/a | No | `lib/auth/permission-scan.test.ts` | n/a (automated) |
| 12 | Role by screen: each role's menu and refused pages | ✅ Built | all | n/a | No | e2e `role-screens.spec.ts` (18 Nov 2026) | UAT per role, first row |

## D. Known limits and open questions

- Custodian, Digicur, QA and Archiver roles exist with view rights only; their work screens are phase B and C.
- Approval bands (D-024) use roles per band; switched off until Finance confirms.
