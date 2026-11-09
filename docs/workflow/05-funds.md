# Funds

How cash advances and fund transfers are flagged, requested, approved, released, carried over and liquidated.

Last updated: 9 November 2026 (PHT)

See the [colour key](README.md#colour-key).

```mermaid
flowchart TD
  A["LA flags: needs funds, with the kinds, or no funds. No amount"]:::la
  A --> B["DP accepts the job"]:::dp
  B --> C["DP requests funds for several jobs and picks the type: Cash advance (default) or Fund transfer. Amount per line, LTO office and estimate shown"]:::dp
  C --> D{"DP has an overdue, unliquidated advance?"}
  D -->|Yes| D1["Blocked, unless Finance grants a one-time exception"]:::fin
  D1 --> C
  D -->|No| E["Approver checks the request against the approval band"]:::fin
  E -.->|"Before release"| T["Finance may change the type, with remarks (in the history)"]:::fin
  T -.-> E
  E -->|Denied| E1["Transaction shows No funds: DP or LA reschedules"]:::prob
  E -->|"Approved, full or lower with a note"| F["Cash advance: Release cash with the reference. Fund transfer: Send transfer with the reference number, date and account (last 4 digits)"]:::fin
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

- The LA only flags whether funds are needed. The DP asks for the amount, one advance for several jobs, and picks the funds type: Cash advance (default) or Fund transfer.
- Both types follow the same flow: approval bands, release, receipts, carry-over, top-up, liquidation, overdue notice, holds and permissions are the same. Only what Finance enters at release differs (Settings, Funds types), and a type's "Must be liquidated with receipts" switch (on for both by default).
- Finance can change the type before release, with remarks (5 to 500 characters); top-ups and carry-overs follow their record's type, and Finance can change a top-up's type at release.
- The type shows as a pill everywhere funds appear (My funds, the Finance lists, the job and loan transaction, Open items, notifications and emails, the TAT report and the CSV exports), with filters and counts by type on the Finance lists and the TAT report.
- The LTO office gives the approver an estimate of distance, time and transport.
- Carry-over is free for 3 business days by default, then Finance approves it. Liquidation is due 10 business days after release, restarting at each carry-over decision.
- Cash amounts are visible only to people with the permission `journey:view_amounts`.
- On a transaction that is on hold, Finance cannot request, approve, release, top up or approve a carry-over ("Locked: on hold by {name} since {date and time}."). Denying, receipts, returns, liquidation, close and exceptions stay allowed so money already out can be settled.
- When a job goes back to the LA after cash was released, the advance stays the DP's to settle ("Cash to settle"). A re-send asks for new cash like any new job.

[Back to the workflow index](README.md)
