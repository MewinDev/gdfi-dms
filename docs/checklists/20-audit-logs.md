# 20 Audit logs

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

Who did what and when: every user action and every automatic decision (the audit log), every file opened (module 17), every PN searched (module 08), every move of work (the movement ledger). Append-only. Roles: Admin and Superadmin read the audit log; Superadmin the file access log.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Audit log of user actions and automatic decisions (actor, mode MANUAL / AUTO, before / after, summary, PN) | ✅ Built | Audit Log (`/admin/audit`) | `audit:view` (Admin, Superadmin) | No | `lib/audit.ts` (`writeAudit`) | UAT ADM-11 |
| 2 | Append-only (no edit, no delete) | ✅ Built | n/a | n/a | No | HANDOVER (append-only; `ON DELETE RESTRICT`) | n/a |
| 3 | Filter by person, action, PN, date | ✅ Built | Audit Log | `audit:view` | No | `app/(app)/admin/audit` | Filter by PN |
| 4 | Settings, roles, permissions and overrides changes logged with before / after | ✅ Built | Audit Log | n/a | No | module 04 row 3 | Change a setting, find it |
| 5 | Movement ledger of every accept, forward, move, return | ✅ Built | Loan Journey, TAT report | n/a | No | `WorkMovement` (D-046) | Read the Journey |
| 6 | Open Item decisions with approver, remarks, time | ✅ Built | Open Items, Audit Log | n/a | No | module 10 | UAT SUP-2 |
| 7 | Sync runs in the audit log and the run log | ✅ Built | Audit Log, Settings | n/a | No | module 09 | n/a |
| 8 | Audit log retention rule | 📦 Later phase (C: retention) | n/a | n/a | n/a | D-007 | n/a |
| 9 | Audit log export | ❌ Missing (the file access log exports; the audit log does not) | n/a | n/a | n/a | `app/api/audit/files` only | n/a |
| 10 | Volume: audit log at 30,000 rows | ✅ Built (fast; file log page 6 ms at 60,000 rows) | n/a | n/a | n/a | `npm run volume` (18 Nov 2026) | n/a |

## D. Known limits and open questions

- Row 9: needed only if auditors ask for a file; small.
