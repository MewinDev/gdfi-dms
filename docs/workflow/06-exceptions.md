# When something goes wrong

Missing papers, holds, problems, changes after sending, Pasuyo and MyLoans changes.

Last updated: 18 November 2026 (PHT)

See the [colour key](README.md#colour-key).

```mermaid
flowchart TD
  X{"What is going on?"}
  X -->|"A paper has not arrived"| M1["Missing paper: marked on its row with a reason and remarks; the file goes on"]:::la
  M1 --> M2["Received with the date it arrived; the flag clears with the last one. No alert, no email, the clock keeps counting"]:::la
  X -->|"Waiting on someone outside our hands"| H1["On hold: reason and remarks required, start time automatic"]:::hold
  H1 --> H1L["Locked: nobody can change it until it is resumed"]:::hold
  H1L --> H2["Resume: only the hold owner, remarks required, time automatic"]:::hold
  H1L -->|"Owner away"| HT["Transfer hold: LA Supervisor/Head or Admin gives it to another owner in their branches, never resumes"]:::admin
  HT --> H2
  X -->|"A fault: system down, wrong paper, closed office"| P1["Problem: red, own timer"]:::prob
  P1 --> P2["Resolved with a note. Admin may tag Outside our control"]:::prob
  X -->|"LA wants to change a job already sent"| C1{"Has the DP accepted?"}
  C1 -->|"Not yet"| C2["LA updates papers, changes funds or processor, adds a note, or pulls back"]:::la
  C1 -->|Yes| C3["DP returns it: Return to LA with findings"]:::dp
  X -->|"DP will not take it"| D1["DP declines before accepting: one reason and remarks"]:::dp
  C3 --> C3P["DP hands over the papers; cash released stays as Cash to settle"]:::dp
  C3P --> C5["Back to the LA who sent it (every branch LA if that LA is inactive). The DP no longer sees it"]:::sys
  D1 --> C5
  C5 --> C6["LA confirms the papers back. Not received raises a Problem"]:::la
  C6 --> C4["The sender fixes it and sends again: Round 2"]:::la
  X -->|"DP finds a paper missing when verifying"| V1["Problem: Missing paper, or Return to LA: papers needed"]:::prob
  V1 --> V2["Found, then verified again. Forward stays blocked until all papers are complete"]:::dp
  X -->|"DP needs another processor to continue"| PS["Pasuyo: choose Return the cash or Hand the balance over"]:::dp
  X -->|"MyLoans data changed"| Y1{"Kind of change"}
  Y1 -->|"A rename: area, division, company, branch or product name"| Y2["Updated automatically, logged in Reference data changes. Never an Open Item"]:::sys
  Y1 -->|"Borrower name, CIF, CIN"| Y7["Open Item for the branch's borrower approvers: Approve or Reject with remarks. Nothing blocked"]:::admin
  Y1 -->|"Amount, product, loan type, release date"| Y3["One Open Item group, the rule effect shown: an approver of the branch approves or rejects with remarks"]:::admin
  Y1 -->|"No longer released: cancelled, not released, inactive, redone"| Y4["Status Open Item: Send, Forward and new cash blocked. Approve closes the loan after cash is returned; Reject keeps it"]:::admin
  Y1 -->|"Redone in myloans: new PN, same CIN"| Y5["The old loan's status item says replaced by. A person links it from Related loans with a note after confirming no payment"]:::admin
  Y1 -->|"New PN, new application"| Y6["Shown in Related loans: no alert, no link"]:::sys
  Z["Loan File: Missing papers row. Monitoring: Has missing papers. Open items: holds, problems and myloans changes (the Open Items page)"]:::sys
  M1 -.-> Z
  H1 -.-> Z
  P1 -.-> Z
  V1 -.-> Z
  Y3 -.-> Z
  Y7 -.-> Z
  classDef la fill:#dbe8fb,stroke:#3b5a8a,color:#14213a
  classDef dp fill:#fdecc8,stroke:#c98512,color:#14213a
  classDef prob fill:#fbe0dc,stroke:#b3261e,color:#14213a
  classDef hold fill:#c9d4e6,stroke:#0c2340,color:#14213a
  classDef admin fill:#e9e0f7,stroke:#6a4fa3,color:#14213a
  classDef sys fill:#e6e8ec,stroke:#56627a,color:#14213a
```

[Back to the workflow index](README.md)
