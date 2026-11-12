# GDFI-DMS workflow

Index of the workflow documents: how a released loan moves from MyLoans to the vault gate.

Last updated: 12 November 2026 (PHT)

Plain-language map of how a released loan moves through GDFI-DMS: the Loan Associate (LA), the Document Processor (DP), Finance and approvers, and Admin. Written on 8 November 2026. It combines the original phases 1 to 5 with the decisions made since (funds, holds, returns, Pasuyo, LTO, MyLoans sync, email).

A live copy with the same diagrams is the artifact "DP Workflow Map". This folder is the record: when a workflow rule changes, change the diagram and the table here in the same change.

## Files

| File | What it covers |
|---|---|
| [Glossary](01-glossary.md) | The key words (PN, branch code, Area, Division, Branch review, Opened at), who uses them and their effect on the clock. |
| [Big picture](02-big-picture.md) | From the MyLoans lookup to the vault gate. |
| [The Loan Associate](03-loan-associate.md) | Find loan, Check documents, Send, and changes before the DP accepts. |
| [One DP job](04-dp-job.md) | Accept, stages, LTO, check and verify, forward, receive. |
| [Funds](05-funds.md) | Flag, request, approve, release, carry over, liquidate. |
| [When something goes wrong](06-exceptions.md) | Missing paper, hold, problem, return, Pasuyo, MyLoans changes. |
| [Rules and roles](07-rules-and-roles.md) | Automatic rules, turnaround targets, roles ("roles are just ticks"), branch access (Division, Area, Branch). |
| [Systems](08-systems.md) | MyLoans sync, the PN check, the branch list from MyLoans (and no direct database access), email, environment. |
| [Status and open questions](09-status-and-open-questions.md) | What is built, planned or later, and the open questions. |
| [Processing stages](10-processing-stages.md) | The default stages of each transaction type, their evidence and targets. |
| [Monitoring](11-monitoring.md) | DP and LTO office monitors, capacity and availability, LTO advisories: definitions and examples. |
| [Permissions](12-permissions.md) | Roles are just ticks: every tick, who has it by default, the role editor, lock-out protection and the audit of the permissions pass. |
| [Stages and next steps](13-stages-and-next-steps.md) | The one stage map: the 10 stepper steps, and every stage's name, step, next step and owner (the Phase 2 stages marked). |

To walk through these flows by hand, use the [Manual Test Kit](../MANUAL-TEST-KIT.md): sign-in accounts for each role and a list of fresh PNs to open yourself (the old scenario data, one sample loan per case, loads with `--with-scenarios`).

## Colour key

Colour shows who acts in the diagrams.

| Colour | Meaning |
|---|---|
| Blue | Loan Associate (LA) |
| Amber | Document Processor (DP) |
| Teal | Finance or approver |
| Purple | Admin |
| Grey | System |
| Red | Problem |
| Navy-grey | On hold |
| Gold, thick border | Planned, not built yet: none at the moment |
| Dashed border | Later phases, not part of these documents |

The diagrams are Mermaid flowcharts. GitHub and most Markdown viewers draw them.
