# 18 Notifications and Home warnings

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

People are told about work in the app (Updates, the bell) and, when switched on, by email (Microsoft Graph). Home shows each person's counts, the next things to do and warnings for supervisors and Admin. Roles: everyone receives; Admin manages emails.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | In-app updates for 21 events (sent, accepted, declined, returned, holds, problems, missing papers, pasuyo, funds requested / decided / released, cash returned, liquidation due, approval waiting, package moved, myloans changes, borrower changes, LTO advisory, TAT digest) | ✅ Built | Updates, bell | everyone | No | `lib/email/templates.ts` (`EMAIL_EVENTS`), `notify` | Send a job: the DP gets an update |
| 2 | Email for the same events (Graph, outbox, retries) | ✅ Built, off until go-live | Settings, Email notifications | `email:manage` | Master switch, per event, templates | `lib/email/*`, e2e `email.spec.ts` | Send a test email |
| 3 | Reminders: due soon, approval waiting, daily overdue digest (business days) | ✅ Built | email | System | Per event | `lib/email/reminders.ts`, `docs/SCHEDULER.md` | n/a |
| 4 | Each person can turn emails off for themselves | ✅ Built | Updates | everyone | Yes | `email_preference_changed` audit action | n/a |
| 5 | Amounts never in a notification or email | ✅ Built | n/a | n/a | No | `lib/services/open-items.ts` comment, templates | n/a |
| 6 | Home per role (counts, Do these next, caught up) | ✅ Built | Home | everyone | No | e2e `home-compact.spec.ts` | UAT per role, row 1 |
| 7 | Supervisor Home: waiting too long, people away, Open Items | ✅ Built | Home | LA Supervisor/Head | No | e2e `home-compact.spec.ts` | UAT SUP-1 |
| 8 | Admin Home warnings: branches without an approver, a closed branch with work, a new product, users with no branches, LTO advisories | ✅ Built | Home | Admin | No | D-053, D-054, `lib/services/lto-advisories.ts` | UAT ADM-6, ADM-8 |
| 9 | Sync alert after N failed runs | ✅ Built | Updates | Admin, Superadmin | N | module 09 | n/a |
| 10 | v2 notification matrix (each event, who, channel, timing) approved by the business (§13.6) | ⏸ Blocked (business analyst with Admin) | n/a | n/a | n/a | v2 §13.6 | n/a |
| 11 | Graph credentials in production | ⏸ Blocked (IT owner) | n/a | n/a | `GRAPH_*` | `docs/ENVIRONMENT.md` | n/a |

## D. Known limits and open questions

- Email reminder timing is fixed (every 15 minutes, digest on the first call of a business day): fine unless the business wants other times.
