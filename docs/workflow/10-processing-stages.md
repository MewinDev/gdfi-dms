# Processing stages

The default stages a DP job runs for each transaction type, with their evidence and targets.

Last updated: 8 November 2026 (PHT)

**Proposed, to be confirmed with Collateral and Mortgage.** All of it can be changed by Admin in Settings, Processing stages (`stages:manage`). Changes apply to jobs not yet started; a job that already started keeps its stages.

## Stages

| Stage | Who gets it | Evidence fields (type, required) | Target |
|---|---|---|---|
| Notarization | Notary | Notary name (text, required); Document (text, required); Page number (text, required); Book number (text, required); Series (text, required) | None yet |
| PPSR registration | Entry of PPSR | Filed on (date, required); Registered on (date, required); Registration number (text, required); Certificate (file, required) | None yet |
| LTO drop off | Every type with a processor, while "Needs LTO processing" is on | Dropped on (date, required); LTO office (text, required, filled in from the Send step); Official receipt number (text, required) | None yet |
| LTO pickup | Same as LTO drop off | Picked up on (date, required); Annotated OR/CR received (tick, required) | None yet |
| Check and verify | Every type with a processor, always last | Every paper of the transaction ticked "Received back and complete"; verified-by (recorded by the system); note (optional) | None yet |

Mortgage has no stage of its own: its work is LTO drop off and LTO pickup. EDST has no DP stages.

## Rules

- Stages run in order. Start and Finish times are the system's.
- A stage cannot finish while a required field is empty (checked on screen and on the server).
- Attempts, holds and problems belong to the stage that is current.
- A stage target, when set, shows its own small chip. It is for information and adds no alerts.
- The transaction's own turnaround time (Notary 3, Entry of PPSR 5, Mortgage 10 business days) does not change and never pauses.

[Back to the workflow index](README.md)
