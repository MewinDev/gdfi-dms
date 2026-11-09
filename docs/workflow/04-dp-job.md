# One DP job

One Document Processor job, from arrival to the job closing at the branch.

Last updated: 9 November 2026 (PHT)

See the [colour key](README.md#colour-key).

```mermaid
flowchart TD
  A["Job arrives: Sent to me, waiting to accept"]:::dp
  A --> B{"Papers and funds flag look right?"}
  B -->|No| B1["Decline: one reason and remarks. Back to the LA who sent it; gone from my lists"]:::dp
  B -->|Yes| C["Accept: confirm labels are on all papers, papers received into my custody"]:::dp
  C --> F{"Needs funds?"}
  F -->|Yes| F1["Request one cash advance, see My funds"]:::fin
  F1 --> F2["Approver approves, Finance releases: job is Funded"]:::fin
  F2 --> S0
  F -->|No| S0["Start the job stages for this transaction type"]:::dp
  S0 --> S1["Own stage: for example Notarization or PPSR registration, with evidence and time stamps"]:::dp
  S1 --> L{"Needs LTO processing?"}
  L -->|No| V
  L -->|Yes| L0{"At the LTO: funded?"}
  L0 -->|"No, and the block is on"| L0b["Blocked until Finance releases the cash"]:::fin
  L0b --> L0
  L0 -->|Yes| L1["LTO drop off: office, official receipt, time stamp"]:::dp
  L1 -.->|"Office problem"| LA["Report an LTO problem: an LTO advisory warns others, never blocks"]:::dp
  L1 --> L3["Log today's attempt: spent, receipts, result"]:::dp
  L3 --> L4{"Result"}
  L4 -->|"Not processed"| P["Problem opens in red, the clock keeps counting"]:::prob
  P --> P1["Rest of the cash: carry over or return"]:::fin
  P1 --> L3
  L4 -->|"Waiting on borrower or an appointment"| H["Put on hold with a reason and remarks, resume with remarks"]:::hold
  H --> L3
  L4 -->|Done| L5["LTO pickup: annotated papers back with the DP"]:::dp
  L5 --> V
  V["Check and verify: every paper is back and complete"]:::dp
  V -->|"Something is missing"| VP["Problem: Missing paper. Find it, then verify again"]:::prob
  VP --> V
  V -->|"All complete"| E["Complete the job: record the references"]:::dp
  E --> Q["Liquidate the cash advance with receipts, Finance closes it"]:::fin
  E --> FW["Forward to branch: the DP chooses the branch and the named LA. Never automatic"]:::dp
  FW --> W["Package In transit, the named LA is notified"]:::sys
  W --> X["LA receives and records Complete, Incomplete or Other"]:::la
  X -->|"Incomplete or blocking"| X2["DP is told, corrects and forwards again"]:::dp
  X2 --> FW
  X -->|Complete| X3["Job closes"]:::sys
  S1 -.->|"Papers missing or wrong"| R["Return to LA: findings required, every paper handed over. Back to the LA who sent it; gone from my lists"]:::dp
  R -.-> RS["Cash released for the job: Cash to settle in My funds until liquidated"]:::fin
  L3 -.->|"Another processor must continue"| PS["Pasuyo: pass to a second processor, decide the cash first"]:::dp
  classDef dp fill:#fdecc8,stroke:#c98512,color:#14213a
  classDef la fill:#dbe8fb,stroke:#3b5a8a,color:#14213a
  classDef fin fill:#d5f0ec,stroke:#2f7a70,color:#14213a
  classDef prob fill:#fbe0dc,stroke:#b3261e,color:#14213a
  classDef hold fill:#c9d4e6,stroke:#0c2340,color:#14213a
  classDef sys fill:#e6e8ec,stroke:#56627a,color:#14213a
```

- The job runs its type's stages in order (Settings, Processing stages). Each stage has Start and Finish; the times are the system's, nobody types them. Required evidence is checked on screen and on the server.
- LTO drop off and LTO pickup appear only when the transaction type has "Needs LTO processing" switched on. Starting LTO drop off is blocked until the job is funded when that setting is on.
- Attempts, holds and problems belong to the stage that is current when they are recorded.
- Check and verify is the last stage: the DP ticks every paper as received back and complete. A missing paper becomes a Problem (Missing paper) until found. Complete job and Forward stay blocked until it is done.
- Forwarding is manual and never automatic: the DP chooses the branch, then the named LA, and confirms the paper count. Liquidation runs beside forwarding and does not block it.
- The receiving LA records Complete, Incomplete or Other. Incomplete (or a blocking Other) sends the package back to the DP, who is told, corrects it and forwards again. The clock is never paused.
- Dotted lines (Return to LA, Pasuyo) can happen at any stage while the job is open. Pasuyo continues from the current stage.
- After a Decline or a Return to LA the job is no longer the DP's: it leaves every DP list, tile and count, the DP's notifications about it are removed, and an old link says "This job is no longer with you." If the LA sends it again it is a new round, possibly to another processor.
- While a job is on hold it is locked: nothing on it can change until the hold owner resumes it.
- At LTO drop off or LTO pickup the DP can press **Report an LTO problem** (System down, Office closed, Long queue, Other, with remarks). It warns the people choosing that office and the processors going there, and Operations is told; it never blocks anything. Active advisories for the job's office show in its "Process at" box. See [Monitoring](11-monitoring.md#lto-advisories).

[Back to the workflow index](README.md)
