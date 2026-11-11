# The Loan Associate

What the Loan Associate does, from Find loan to Send and the changes allowed before the DP accepts.

Last updated: 11 November 2026 (PHT)

See the [colour key](README.md#colour-key).

```mermaid
flowchart TD
  A1["Find loan: type a PN, CIN, CIF or name; suggestions from the DMS only, from 3 characters"]:::la
  A1 --> A0{"Already saved in the DMS?"}
  A0 -->|Yes| A0b["Already in the DMS card: Open loan file (no MyLoans call)"]:::la
  A0 -->|"No, a full PN"| A2{"One MyLoans lookup: data check passes?"}
  A2 -->|No| A2b["Message names the field, nothing is saved"]:::sys
  A2 -->|Yes| A3["Preview. Financing: LA picks Undertaking and ORCR status"]:::la
  A3 --> A4["Open Loan File: rules create the transactions and the paper lists"]:::sys
  A4 --> A5["To do tab: Next step card and All transactions list"]:::la
  A5 --> B1["Check documents: Do this now card with the one next step, then the open transaction's papers; all transactions in order on the right"]:::la
  B1 --> B2["Tick the papers: required, pick-at-least-one groups, optional, add another paper"]:::la
  B2 -->|"A paper has not arrived"| B3["Mark it Missing on its row: reason and remarks, then the file goes on"]:::la
  B3 --> B2
  B3 -.->|"It arrives later"| B3R["Received, with the date it arrived. The reason and remarks stay in the history"]:::la
  B2 -->|"Waiting on the borrower"| B4["Put on hold: reason and remarks required, resume with remarks"]:::hold
  B4 --> B2
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

- **Find loan is local first.** Typing never calls MyLoans: from 3 characters, 150 ms after typing stops, the dropdown searches only the loan files saved in the DMS of the user's branches (part of a PN, the exact CIN or CIF, part of the borrower's name; at most 8 rows: PN, borrower, stage and "In DMS"; no amounts, address or contact). A full PN saved in another branch shows "Outside your branches"; a full, valid PN not saved yet shows one quiet hint, "Not opened in the DMS yet. Press Find loan to look it up in MyLoans."; anything else shows nothing. Arrows move, Enter picks, Esc closes. The same box is on My loans, Find a loan (`/search`) and behind the top-bar Find loan. **Find loan (the button, or Enter)** checks the DMS first by the exact PN: a saved loan shows the **Already in the DMS** card (borrower, PN and product, stage, who has it, the next step, any hold, problem or "MyLoans changed" chip, **Open loan file** and **Cancel**; no questions, they were answered when it was opened; a cancelled or replaced loan says so and links to the replacement), with no MyLoans call. Only a full, valid PN not saved yet is looked up in MyLoans, once, and shows the preview below. In Find loan the PN may be typed with or without GD (the 13 digits alone, for example 1012026900001, get GD put in front), and part of a PN may have spaces, dashes or dots; imports and the PN format setting still need the GD. Part of a PN, a CIN, a CIF or a name searches the DMS only (at most 20 loan files in a compact list), or says "Not found in the DMS. To look it up in MyLoans, type the full PN." One loan file per PN: when two people press Open loan file on the same new PN at once, one file is made and the second lands on it with "This loan file was just opened by someone in your branch." The PN is checked first (Settings, System, PN format: GD + branch code + year + 9 + running number, for example GD1012026900001; spaces, dashes and dots are removed): a wrong PN shows "This does not look like a PN. Example: GD1012026900001" and the wrong part, and is never sent to MyLoans. The Find a loan page is one quick action: the search row, the sample loans of the user's branches (test mode), then one card with the loan, the two questions when the loan is Financing and **Open loan file**, which stays disabled until both are answered. The card shows the MyLoans account details by name only: borrower, PN and product; the MyLoans status by its name ("Loan Released"), Your branch, Details complete and Source: MyLoans; amount released, released on, loan type, product, branch, area, division and company. Codes and IDs are not shown there ([field map](../myloans/field-map.md)). A message (not in MyLoans, not released, outside your branches, details to fix) is one short line with the PN and Try again, and any result goes away as soon as the PN in the box changes. A PN outside the user's branches says "Outside your branches" (no details). Nothing is saved until Open loan file. The Loan File shows the PN as stored and "Opened at {branch}" under it, the branch name only ("..., now at ..." when MyLoans moved the loan). Its **More loan details** (collapsed, under Loan at a glance) has the full set from MyLoans with codes and IDs, grouped: Identity, Loan, Organization (company, division, area, branch), Status (ID, name, active) and Source (MyLoans, retrieved, last checked, last updated in MyLoans, opened at), and the rule that fired.
- Check documents shows the "Do this now" card and the open transaction on the left, and all transactions, in fixed order, on the right (see [What the loan file shows first](#what-the-loan-file-shows-first)).
- Nothing is pre-selected for funds: the LA must answer. The LTO office and the late reason appear only when they apply.
- Before the DP accepts, the LA can update papers, change funds, processor or LTO office, add a note, or pull back. After accepting, only the DP can return it.
- A Decline (before accepting) or a Return to LA (after) goes back to the specific LA who sent it, never to another LA of the branch: it is on that LA's Home ("Sent back to you"); on Check documents the "Do this now" card says it once: the findings, the DP's name and the round. Sending again starts a new round; nothing is pre-selected.
- While a transaction is on hold it is locked for everyone (see [Locked](01-glossary.md)); only the hold owner can resume it.
- The Open items card on Check documents lists what is open on the other transactions of the loan file and MyLoans changes. What the "Do this now" card already says for the open transaction is not repeated there; when nothing is left, the card is not shown. A "Sent back to you" or "Waiting for papers" row reads top to bottom (the badge, the transaction, what was found or asked, then who and the date and time in PHT, so the turnaround time can be read exactly) and the whole row opens it (Open, or Show paper for a missing paper). The right column scrolls with the page. On the dashboard and the Updates page it is unchanged.

## Missing papers with reasons

A missing paper no longer blocks the file (confirmed with the users, 10 November 2026). The rules:

1. **Per paper.** The reason and remarks belong to that paper, not to the file.
2. **Required papers** are Present (ticked) or **Missing**. Pressing **Missing** on the row opens a compact box right under it (no pop-up): the **Reason** as one-tap chips (Settings, Missing paper reasons; the focus goes to them) and one **Remarks** line that grows as you type, with **Save** beside it (under it on a phone). Remarks are 5 to 500 characters, always required, also for "Other"; the hint says how many characters are left, and the count shows only near 500. Enter saves, Shift+Enter is a new line, Esc cancels an edit. Saved, it folds to one line: the reason chip, the remarks, who and when, and **Edit**. The row is red "Missing, remarks needed" until they are saved, then amber "Missing, with remarks".
3. **Optional papers** have an **Include in this file** tick. Off: the row stays quiet and nothing expects the paper. On (or ticked Present): it behaves exactly like a required paper.
4. **Send** stays locked while any expected paper is Missing without saved remarks, and says which ("Add remarks for: Deed of Sale, Valid ID"). The server refuses the same.
5. The processor cannot return the file for a paper already Missing with remarks; it goes through as an exception (see [The DP job](04-dp-job.md)).
6. Through the **vault gate** the file is "Complete with exceptions" until every missing paper is Received.
7. **Received**: the LA (papers:receive_late, also Admin) marks it Received with the date it arrived (not in the future, not before it was marked). The reason and remarks stay. With the last one the flag clears.
8. **Remarks are never silently changed.** Every save and edit is kept in the paper's history (who, when, old and new text). Once the transaction was sent, a missing paper cannot be un-marked or its remarks removed: it ends only when Received. Before the first send, "Not missing" or ticking it Present takes the mark back (also kept in the history).
9. The turnaround time never pauses for a missing paper.
10. No alerts and no emails: the Loan File shows a short **Missing papers** row near the top (only when there is one), and Monitoring has the **Has missing papers** filter.

The old "Ask for missing paper" pop-up and its problem card are gone; the problem card now shows only problems raised by others (the processor's return, MyLoans changes, the LA's "Wrong details" or "Something else").

## What the loan file shows first

On Check documents, the "Do this now" card at the top of the left column says the one thing to do now on the open transaction. Each fact is said once. The steps come from one place (`getNextSteps` in `lib/workflow/next-steps.ts`), which also gives the status word in the Transactions list, the marker on a returned paper and what the Open items card leaves out, so they always agree. Only the steps that apply are shown; the first one not done is open, the others are one grey line ("After step 2") or a green tick when done.

1. **On hold**: the hold reason, who put it on hold, and Resume for the hold owner only (others see who must resume it). The transaction stays locked until then.
2. **Problem to fix**: the problem, who raised it, and its usual action.
3. **Confirm the papers you received**: after a Return to LA with papers handed over. "All 7 received" confirms them in one click; "Check each paper" opens the list of every paper, each set to Received, so one that did not arrive can be marked Not received (a problem is raised for it, as before).
4. **Fix and send again**: returned or declined by the DP. The findings are shown here once, with the paper named in bold and "Go to this paper". The paper's row in the checklist has one small marker ("Returned: missing paper"). It comes after step 3 because the paper must be back in hand before it can be fixed, and Send stays locked until the papers are confirmed.
5. **Waiting for a paper**: an older missing-paper request (not the DP's own return): which paper, who asked, "Show paper". New ones are not made: the LA marks the paper Missing on its row instead.
6. **Tick the required papers**: "4 of 5 required" (every paper of the file: a missing paper lets the file go on once its remarks are saved). A missing paper is never counted as received: while one is missing, the step, the loan file header, its progress bar, the transaction card and the Send check read "4 of 5 received · 1 missing with remarks", and the bar shows received papers only.
7. **Send to DP**: points to the Send panel, which keeps its own ready check. Work without a processor ends with EDST or Mark as done instead.

The card is soft amber for a returned transaction, soft red for a problem, soft grey-blue for a hold, and white with a plain border for normal work. The Transactions list shows one status word per transaction (On hold, Problem, Returned, Missing paper, Not started, Needs papers, Ready to send, Sent to DP, In progress, Coming back, Done) and the day count in grey. On tablet and phone the transactions become a strip under the card; only the strip scrolls sideways.

![Returned: confirm the papers is the step to do now](../screenshots/loan-file-next-step/returned-now-confirm-1440.png)

![After All received: fix and send again, the findings shown once](../screenshots/loan-file-next-step/returned-fix-step-1440.png)

## Documents tab

The Documents tab lists every paper of the loan file, one compact card per transaction, in the usual order. It only shows; ticking papers stays on Check documents. There is no label printing (labels were removed on 11 November 2026: they are not used in the LA and DP flow).

- At the top: "8 of 23 papers have a Document ID" and the filter **All · With you · Not yet** with its counts. The filter is kept in the address (`?papers=with-you`), so a refresh keeps it; "Not yet" with nothing left says "All papers are with you."
- Each card: the transaction and "7 of 7 with you".
- One line per paper: Paper, Type (Original or Copy), ID (the short Document ID, for example `CHM-01`; the full one is in the tooltip and the details), Where (**With you** with a green dot, **Not yet** in grey, or a short phrase such as "At DP 1" or "On the way"). "Not yet" lines are dimmed but keep their word.
- Press a line (or Enter) to open its details: who has it, where and since when, in Philippine time ("Test Loan Associate (LA, Angono) at the Angono branch, since Nov 10, 9:29 AM"), and the full Document ID. The same sentence is the line's tooltip.
- Two cards per row when the page is wide enough (1440), one column on a tablet, and on a phone collapsible cards (the ones with papers in hand open) with each paper on two lines.

![Documents tab: two cards per row, one line per paper](../screenshots/documents-tab/all-1440.png)

![Documents tab: a paper's details line, in Philippine time](../screenshots/documents-tab/row-details-open-1440.png)

## How to read the Journey

The Journey tab of the Loan File reads the same record three ways. Nothing is changed by reading it; the TAT clock never pauses.

- **Where it is now** (always on top): one line per place. Transactions in the same place and state share a line ("All 4 transactions: with LA 1 since Nov 9, 11:54 PM (7 h 30 min)"); one in another place or state gets its own line. Each line has one status pill (Now, On hold, Problem, Returned, Done) and the day count in grey ("Day 1 of 2", "Due today", or the late days in red). A role word and a name are said once ("With LA 1", never "With LA LA 1").
- **Story** (opens first): what happened, newest first. Each day is a date row ("Today · Tue, Nov 10, 2026", "Yesterday · Mon, Nov 9, 2026", then "Fri, Nov 7, 2026"); its events sit under it, each with its time (PHT) and one sentence ("DP 1 returned Notary: the ID copy is unreadable (Round 1)"), with the transaction pills. The same action by the same person in the same minute on several transactions is one line. Automatic steps are one grey line at the end of their day ("Loan opened and checked automatically · 5 steps"); they are listed in the Full log under **Show system steps**. Returns, declines, holds, problems and missing paper carry their word and a soft tint; the counts at the top are soft badges in the same colours ("1 return", "0 problems", "1 hold", "1 missing paper"; grey at 0), and pressing one shows only those lines. Filters: **All**, **Needs attention**, and **Whole loan** or one transaction (there is no "Mine"; an old link with it shows All). The Journey shows to everyone who can open the loan file.
- **By document**: one column per transaction (two per row on a tablet, a card per transaction on a phone, the ones that need attention open). Each goes Opened, Papers checked, With the processor (name), In process (only with stages), Back to the branch, Done: a filled dot when done (time, who, and a thin bar for the time it took), a gold half dot for now ("since Nov 9, 11:54 PM · 7 h 30 min"), an empty dot for later. Holds, returns, declines, problems, missing paper and funds show on the step they affected, with the Round for a return. Press a step to see its details. **Needs attention first** moves those columns to the front.
- **Full log**: the ten phases with every step, closed under "Full audit log". Search, **Who** (LA, DP, Finance, System), and the switches **Show system steps** and **Show not applicable** (both off at first). Each step says one phrase ("Done in 4 min · Nov 10, 8:42 AM", "Open since ..."); the target is named only when it is late or due today. Step numbers (1.1, 3.6) appear here only. "Papers: who has them" lists each paper's custody trail.

The choice of view and the filters are kept in the address, so a refresh keeps them.

![Journey, Story: date rows, the return and the hold flagged, the reason said once](../screenshots/journey-v2/story-1440.png)

![Journey, By document: one column per transaction, the return and the hold on the step they affected](../screenshots/journey-v2/by-document-1440.png)

[Back to the workflow index](README.md)
