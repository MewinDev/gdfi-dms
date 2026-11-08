# Rules and roles

The automatic rules, the turnaround targets, the roles and examples of permissions.

Last updated: 8 November 2026 (PHT)

### Automatic rules (run once, when the LA clicks Open Loan File)

| Rule | Input | Result |
|---|---|---|
| 1 Classification | Product Name contains the whole word "Refinancing", else "Financing", else (or blank) | Refinancing, Financing, or Refinancing by default |
| 2 Undertaking | Financing only, picked by the LA | Undertaking or Non-Undertaking |
| 3 ORCR | Financing + Untransferred | Notary + EDST |
| 4 Mortgage | New and amount at or below PHP 500,000; Renewal and amount at or below PHP 1,000,000 | Mortgage: Notary, EDST, Entry of PPSR, Mortgage. Otherwise Notary and EDST |

### Turnaround targets (business days, all editable in Settings)

| Clock | Default |
|---|---|
| LA check and send | Day 2 from release |
| EDST | 1 |
| DP accepts | Same day |
| Notary | 3 |
| Entry of PPSR | 5 |
| Mortgage | 10 |
| Receiving LA acceptance | 2 |
| Transmittal to the vault | 3 |

The clock never pauses. Holds and problems only change the colour and add their own timers. All times are shown in Philippine time (PHT).

### Processing stages (defaults, editable in Settings)

| Transaction | Stages a DP job runs, in order |
|---|---|
| Notary | Notarization, then the LTO stages if the type needs LTO, then Check and verify |
| Entry of PPSR | PPSR registration, then the LTO stages if the type needs LTO, then Check and verify |
| Mortgage | No stage of its own: LTO drop off, LTO pickup, then Check and verify |
| Any type with a processor | LTO drop off and LTO pickup when "Needs LTO processing" is on; Check and verify always last |
| EDST | No DP stages |

Details and evidence fields: [Processing stages](10-processing-stages.md).

### Roles (Admin is locked from LA, DP and Finance work steps)

| Role | Main work |
|---|---|
| LA | Search and open loans, check papers, flag funds, send, receive forwarded packages, EDST |
| DP | Accept or decline, stages, attempts, cash advance requests, liquidation, return to LA, Pasuyo, check and verify, forward to a branch |
| Finance and approvers | Approve and release cash advances, confirm returns, close advances, follow up overdue liquidation |
| Admin | Settings, roles and access, Audit Log, TAT reports, review of MyLoans changes, closing cancelled loans |

Permissions are switches in Settings, Roles and access, enforced on the server. Examples: `funds:flag`, `funds:request`, `funds:approve`, `funds:release`, `jobs:work`, `jobs:pasuyo`, `jobs:return_to_la`, `holds:raise`, `holds:resolve`, `problems:raise`, `problems:resolve`, `journey:view_amounts`, `source:review`, `source:manage`, `email:manage` and `stages:manage` (Settings, Processing stages; Admin only by default).

[Back to the workflow index](README.md)
