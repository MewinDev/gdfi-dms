# The Loan Associate

What the Loan Associate does, from Find loan to Send and the changes allowed before the DP accepts.

Last updated: 8 November 2026 (PHT)

See the [colour key](README.md#colour-key).

```mermaid
flowchart TD
  A1["Find loan: type a PN, suggestions from 3 characters, live lookup in MyLoans"]:::la
  A1 --> A2{"Data check passes?"}
  A2 -->|No| A2b["Message names the field, nothing is saved"]:::sys
  A2 -->|Yes| A3["Preview. Financing: LA picks Undertaking and ORCR status"]:::la
  A3 --> A4["Open Loan File: rules create the transactions and the paper lists"]:::sys
  A4 --> A5["To do tab: Next step card and All transactions list"]:::la
  A5 --> B1["Check documents: open transaction on the left, all transactions in order on the right"]:::la
  B1 --> B2["Tick the papers: required, pick-at-least-one groups, optional, add another paper"]:::la
  B2 -->|"A paper has not arrived"| B3["Ask for missing paper: name the papers, optional hold"]:::la
  B3 --> B2
  B2 -->|"Waiting on the borrower"| B4["Put on hold: reason and remarks required, resume with remarks"]:::hold
  B4 --> B2
  B2 --> B5["Print labels, not required to send"]:::la
  B2 --> B6{"Transaction type"}
  B6 -->|"Needs a processor"| C1["Send panel with a ready check"]:::la
  B6 -->|EDST| B7["Record the EDST reference: done, no processor"]:::la
  C1 --> C2["Papers ticked"]:::la
  C1 --> C3["Funds answered: Needs funds with kinds, or No funds needed"]:::la
  C1 --> C4["Processor chosen: Recommended, other branch, optional Pasuyo second processor"]:::la
  C1 --> C5["LTO office chosen, only when the type needs LTO"]:::la
  C1 --> C6["Reason for lateness, only when past the date"]:::la
  C2 --> C7["Send turns on when all are ready, the reason shows beside it until then"]:::la
  C3 --> C7
  C4 --> C7
  C5 --> C7
  C6 --> C7
  C7 --> C8["Sent: the next transaction that needs action opens"]:::sys
  C8 --> D1{"Has the DP accepted?"}
  D1 -->|"Not yet"| D2["LA updates papers, changes funds, processor or LTO office, adds a note, or pulls back"]:::la
  D2 --> C1
  D1 -->|Yes| D3["Locked for the LA. The DP can return it: papers needed"]:::dp
  D1 -->|"DP declines"| D4["Back to the LA who sent it, with the findings. The DP no longer sees it"]:::dp
  D3 --> D4
  D4 --> D5["The sender fixes it on Check documents and sends again: Round 2, processor chosen again"]:::la
  D5 --> C1
  O["Open items card: missing papers, holds, problems, MyLoans changes"]:::sys
  B3 -.-> O
  B4 -.-> O
  classDef la fill:#dbe8fb,stroke:#3b5a8a,color:#14213a
  classDef dp fill:#fdecc8,stroke:#c98512,color:#14213a
  classDef sys fill:#e6e8ec,stroke:#56627a,color:#14213a
  classDef hold fill:#c9d4e6,stroke:#0c2340,color:#14213a
```

- Find loan does a live lookup in MyLoans by PN; suggestions start at 3 characters; only loans in the user's branches appear.
- Check documents shows the open transaction on the left and all transactions, in fixed order, on the right.
- Nothing is pre-selected for funds: the LA must answer. The LTO office and the late reason appear only when they apply.
- Before the DP accepts, the LA can update papers, change funds, processor or LTO office, add a note, or pull back. After accepting, only the DP can return it.
- A Decline (before accepting) or a Return to LA (after) goes back to the specific LA who sent it, never to another LA of the branch: it is on that LA's Home ("Sent back to you") and Open items, with the findings, the DP's name and the date and time at the top of the transaction. Sending again starts a new round; nothing is pre-selected.
- While a transaction is on hold it is locked for everyone (see [Locked](01-glossary.md)); only the hold owner can resume it.
- The Open items card on Check documents is the single alert place for missing papers, holds, problems and MyLoans changes.

[Back to the workflow index](README.md)
