# Funds

How cash advances are flagged, requested, approved, released, carried over and liquidated.

Last updated: 8 November 2026 (PHT)

See the [colour key](README.md#colour-key).

```mermaid
flowchart TD
  A["LA flags: needs funds, with the kinds, or no funds. No amount"]:::la
  A --> B["DP accepts the job"]:::dp
  B --> C["DP requests one cash advance for several jobs: amount per line, LTO office and estimate shown"]:::dp
  C --> D{"DP has an overdue, unliquidated advance?"}
  D -->|Yes| D1["Blocked, unless Finance grants a one-time exception"]:::fin
  D1 --> C
  D -->|No| E["Approver checks the request against the approval band"]:::fin
  E -->|Denied| E1["Transaction shows No funds: DP or LA reschedules"]:::prob
  E -->|"Approved, full or lower with a note"| F["Finance releases cash and records the reference"]:::fin
  F --> G["Job is Funded, DP and LA are notified"]:::sys
  G --> H["DP works an attempt and spends money"]:::dp
  H --> I["Receipts added: date, amount, number, file"]:::dp
  I --> J{"Cash left over?"}
  J -->|"Yes, within the carry-over limit"| K["Carry over, liquidation due date restarts"]:::dp
  J -->|"Yes, beyond the limit"| K2["Finance approves the carry-over"]:::fin
  K2 --> K
  J -->|"Return it"| M["DP records the return, Finance confirms"]:::fin
  K --> H
  H -->|"Needs more money"| N["Top-up request: approver sees only the extra"]:::dp
  N --> E
  I --> O{"Balance is zero?"}
  O -->|No| H
  O -->|Yes| P["Advance is Liquidated, Finance marks it Closed"]:::fin
  M --> O
  P --> Q["Funds Settled: counts toward the vault gate"]:::sys
  C -.->|"Transaction on hold"| L["Locked: request, approve, release, top-up and carry-over refused"]:::prob
  L -.-> I
  H -.->|"Job declined or returned to the LA"| S["Cash to settle: receipts and returns go on, Finance closes it"]:::fin
  S --> O
  classDef la fill:#dbe8fb,stroke:#3b5a8a,color:#14213a
  classDef dp fill:#fdecc8,stroke:#c98512,color:#14213a
  classDef fin fill:#d5f0ec,stroke:#2f7a70,color:#14213a
  classDef prob fill:#fbe0dc,stroke:#b3261e,color:#14213a
  classDef sys fill:#e6e8ec,stroke:#56627a,color:#14213a
```

- The LA only flags whether funds are needed. The DP asks for the amount, one advance for several jobs.
- The LTO office gives the approver an estimate of distance, time and transport.
- Carry-over is free for 3 business days by default, then Finance approves it. Liquidation is due 10 business days after release, restarting at each carry-over decision.
- Cash amounts are visible only to people with the permission `journey:view_amounts`.
- On a transaction that is on hold, Finance cannot request, approve, release, top up or approve a carry-over ("Locked: on hold by {name} since {date and time}."). Denying, receipts, returns, liquidation, close and exceptions stay allowed so money already out can be settled.
- When a job goes back to the LA after cash was released, the advance stays the DP's to settle ("Cash to settle"). A re-send asks for new cash like any new job.

[Back to the workflow index](README.md)
