# 03 Branch scope and data access

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

Every person sees and acts only on the branches in their access (D-019, D-030): loan files, jobs, funds, Open Items, reports and files. Access is per person (single branches, an area, a division, or All branches). Admin sets it; Superadmin can give All branches.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Branch access per person: branches, areas, divisions, exceptions, All branches | ✅ Built | Users, Edit, Branch access | `access:manage`; All branches: `access:all_branches` | Yes | D-023, e2e `pn-branches.spec.ts` (Users, Branch access) | UAT ADM-1 |
| 2 | Scope checked before every answer (pages, actions, search, suggestions, exports) | ✅ Built | all | n/a | No | `lib/auth/scope.ts`, `scope.test.ts`, integration cross-branch tests (D-039) | UAT LA-5 |
| 3 | Out-of-branch loan file by URL: Not found | ✅ Built | `/loans/<pn>` | n/a | No | e2e `happy-path.spec.ts` (404) | Type another branch's PN in the address bar |
| 4 | Find loan outside your branches: branch only, never the borrower | ✅ Built | Find loan | n/a | No | `docs/workflow/03-loan-associate.md` | UAT LA-5 |
| 5 | Jobs scoped by the loan's branch; funds by the request's branch; Finance branch-scoped (Changed by D-035) | ✅ Built | Jobs, Funds | n/a | No | D-035, D-039 | Finance CA user of 101/165 sees only those |
| 6 | Open Items by the loan's branch; Unassigned queue for branches with no approver | ✅ Built | Open Items | approvers | No | D-011, `tests/integration/open-items.test.ts` | UAT ADM-6 |
| 7 | One file route for receipts, stage evidence, LTO proof; scope and permission checked; every open logged | ✅ Built | `/api/files/<kind>/<id>` | by file kind | No | `app/api/files/[kind]/[id]/route.ts`, e2e `file-access-log.spec.ts` | UAT FIN-5 |
| 8 | Branch matched by myloans BranchID (renames and code changes do not break access) | ✅ Built | n/a | n/a | No | D-054, `resolveLoanBranch` | Rename a branch in the mock: access unchanged |
| 9 | A loan moved to another branch in myloans changes branch only after approval | ✅ Built | Open Items | approvers | No | D-053, `open-items.test.ts` | Kit item 31 |

## D. Known limits and open questions

- Phase B roles (Custodian, QA) will need their own scope rule (by vault or all branches): to decide with phase B.
