# The Loan Associate

What the Loan Associate does, from Find loan to Send and the changes allowed before the DP accepts.

Last updated: 10 November 2026 (PHT)

See the [colour key](README.md#colour-key).

```mermaid
flowchart TD
  A1["Find loan: type a PN, suggestions from 3 characters, live lookup in MyLoans"]:::la
  A1 --> A2{"Data check passes?"}
  A2 -->|No| A2b["Message names the field, nothing is saved"]:::sys
  A2 -->|Yes| A3["Preview. Financing: LA picks Undertaking and ORCR status"]:::la
  A3 --> A4["Open Loan File: rules create the transactions and the paper lists"]:::sys
  A4 --> A5["To do tab: Next step card and All transactions list"]:::la
  A5 --> B1["Check documents: Do this now card with the one next step, then the open transaction's papers; all transactions in order on the right"]:::la
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
  O["Open items card: what is open on the other transactions, and MyLoans changes"]:::sys
  B3 -.-> O
  B4 -.-> O
  classDef la fill:#dbe8fb,stroke:#3b5a8a,color:#14213a
  classDef dp fill:#fdecc8,stroke:#c98512,color:#14213a
  classDef sys fill:#e6e8ec,stroke:#56627a,color:#14213a
  classDef hold fill:#c9d4e6,stroke:#0c2340,color:#14213a
```

- Find loan does a live lookup in MyLoans by PN; suggestions start at 3 characters; only loans in the user's branch access appear. The PN is checked first (Settings, System, PN format: GD + branch code + year + 9 + running number, for example GD1012026900001; spaces, dashes and dots are removed): a wrong PN shows "This does not look like a PN. Example: GD1012026900001" and the wrong part, and is never sent to MyLoans. The Loan File shows the PN as stored and "Opened at {branch} ({code})" under it ("..., now at ..." when MyLoans moved the loan).
- Check documents shows the "Do this now" card and the open transaction on the left, and all transactions, in fixed order, on the right (see [What the loan file shows first](#what-the-loan-file-shows-first)).
- Nothing is pre-selected for funds: the LA must answer. The LTO office and the late reason appear only when they apply.
- Before the DP accepts, the LA can update papers, change funds, processor or LTO office, add a note, or pull back. After accepting, only the DP can return it.
- A Decline (before accepting) or a Return to LA (after) goes back to the specific LA who sent it, never to another LA of the branch: it is on that LA's Home ("Sent back to you"); on Check documents the "Do this now" card says it once: the findings, the DP's name and the round. Sending again starts a new round; nothing is pre-selected.
- While a transaction is on hold it is locked for everyone (see [Locked](01-glossary.md)); only the hold owner can resume it.
- The Open items card on Check documents lists what is open on the other transactions of the loan file and MyLoans changes. What the "Do this now" card already says for the open transaction is not repeated there; when nothing is left, the card is not shown. A "Sent back to you" or "Waiting for papers" row reads top to bottom (the badge, the transaction, what was found or asked, then who and the date and time in PHT, so the turnaround time can be read exactly) and the whole row opens it (Open, or Show paper for a missing paper). The right column scrolls with the page. On the dashboard and the Updates page it is unchanged.

## What the loan file shows first

On Check documents, the "Do this now" card at the top of the left column says the one thing to do now on the open transaction. Each fact is said once. The steps come from one place (`getNextSteps` in `lib/workflow/next-steps.ts`), which also gives the status word in the Transactions list, the marker on a returned paper and what the Open items card leaves out, so they always agree. Only the steps that apply are shown; the first one not done is open, the others are one grey line ("After step 2") or a green tick when done.

1. **On hold**: the hold reason, who put it on hold, and Resume for the hold owner only (others see who must resume it). The transaction stays locked until then.
2. **Problem to fix**: the problem, who raised it, and its usual action.
3. **Confirm the papers you received**: after a Return to LA with papers handed over. "All 7 received" confirms them in one click; "Check each paper" opens the list of every paper, each set to Received, so one that did not arrive can be marked Not received (a problem is raised for it, as before).
4. **Fix and send again**: returned or declined by the DP. The findings are shown here once, with the paper named in bold and "Go to this paper". The paper's row in the checklist has one small marker ("Returned: missing paper"). It comes after step 3 because the paper must be back in hand before it can be fixed, and Send stays locked until the papers are confirmed.
5. **Waiting for a paper**: an open missing-paper request (not the DP's own return): which paper, who asked, "Show paper".
6. **Tick the required papers**: "4 of 5 required".
7. **Send to DP**: points to the Send panel, which keeps its own ready check. Work without a processor ends with EDST or Mark as done instead.

The card is soft amber for a returned transaction, soft red for a problem, soft grey-blue for a hold, and white with a plain border for normal work. The Transactions list shows one status word per transaction (On hold, Problem, Returned, Missing paper, Not started, Needs papers, Ready to send, Sent to DP, In progress, Coming back, Done) and the day count in grey. On tablet and phone the transactions become a strip under the card; only the strip scrolls sideways.

![Returned: confirm the papers is the step to do now](../screenshots/loan-file-next-step/returned-now-confirm-1440.png)

![After All received: fix and send again, the findings shown once](../screenshots/loan-file-next-step/returned-fix-step-1440.png)

[Back to the workflow index](README.md)
