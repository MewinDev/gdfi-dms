# Manual Test Kit: answers

Last updated: 11 November 2026 (PHT)

What each PN of the [Manual Test Kit](MANUAL-TEST-KIT.md) is and what it is good for. Look here only if you get stuck: the point is to find it out by searching and opening the PN.

All of them are in the sample MyLoans only, released on the day the kit was built (unless it says otherwise), with a car (plate, engine and chassis numbers) and an address. Every loan is opened with **Find loan**, as a real Loan Associate would.

**MyLoans changes.** Nothing changes by itself. For the cases that need MyLoans to change (a Refresh change, a branch move, a unit change), open the loan first, then sign in as **Admin**, open the loan file and use **Simulate a MyLoans change** (amount, name, product, cancel, replace or branch). The change shows after **Refresh** or the next sync, and a material change waits for review.

**Approvals.** Cash advances under ₱5,000.00 go to **Approver Small**; ₱5,000.00 and up to **Approver Large** (Settings, Approval bands). Finance releases.

### Antipolo (101)

| PN | What it is and what it is good for |
|---|---|
| GD1012026903001 | Refinancing, New, ₱650,000: above the ₱500,000 limit, so no Mortgage. |
| GD1012026903002 | Auto Financing, ₱350,000: you pick Undertaking or Non-Undertaking, and Transferred or Untransferred, when opening. |
| GD1012026903003 | Blank product, Renewal, ₱800,000: the rules treat it as Refinancing; Renewal up to ₱1,000,000 needs a Mortgage. |
| GD1012026903004 | New at exactly ₱500,000: Mortgage needed (the limit is included). |
| GD1012026903005 | New at ₱500,001: one peso over, no Mortgage. |
| GD1012026903006 | Released 2 business days ago: Assign to DP is due today (TAT). |
| GD1012026903007 | Released 4 business days ago: Assign to DP is late; Send asks for the late reason (TAT). |
| GD1012026903008 | Same borrower, first unit (CIN shared with GD1012026903009). Open this one first. |
| GD1012026903009 | Same borrower, additional unit: after opening GD1012026903008, Find loan shows it as related (same CIN). |
| GD1012026903010 | MyLoans change after Refresh: open it, then as Admin use Simulate a MyLoans change (amount or name) on its loan file; the change shows only after Refresh or the next sync. |
| GD7772026903011 | Unknown branch code 777 in the PN; MyLoans puts the loan at Antipolo, so it opens at Antipolo (the branch comes from MyLoans, not from the PN). |
| GD1012026903041 | Missing papers: mark a required Notary paper Missing, try to Send (it names the paper: "Add remarks for: ..."), write a reason and remarks, then Send. As DP 1, the paper is in "Review the papers" as an amber Missing row (no tick box) and cannot be named in a return. |
| GD1012026903042 | Missing papers, optional paper: on Notary tick "Include in this file" for Valid ID of co-maker, mark it Missing with remarks; an optional paper left unticked needs nothing. |
| GD1012026903043 | Missing papers through the vault gate: Refinancing above ₱500,000 (EDST and Notary). Send Notary with a paper Missing (with remarks), finish it; the loan file shows "Complete with exceptions" until the paper is Received. |
| GD1012026903044 | Ticked Present but not there: tick every Notary paper and send it to DP 1; as DP 1, at Accept mark one paper not received: the Return to LA still works for a paper the LA ticked Present. |

### Angono (165)

| PN | What it is and what it is good for |
|---|---|
| GD1652026903012 | Renewal at exactly ₱1,000,000: Mortgage needed. |
| GD1652026903013 | Renewal at ₱1,000,001: no Mortgage. |
| GD1652026903014 | Truck Financing, ₱450,000: pick Non-Undertaking when opening. |
| GD1652026903015 | Auto Financing, ₱300,000: pick Untransferred to get Notary and EDST. |
| GD1652026903016 | Product "Auto Finance" (not the word Financing): treated as Refinancing. |
| GD1652026903017 | Branch moved by MyLoans later: open it, then as Admin Simulate a MyLoans change, Branch; it waits for review until applied. |
| GD1652026903018 | Unit change (replacement): open it, then as Admin Simulate a MyLoans change, Replace; MyLoans gives a new PN and the old one waits for review. |
| GD1652026903019 | Plain Mortgage loan: good for a full Send to DP, Pasuyo between DP 1 and DP 2, and a cash advance for the LTO fee. |

### A. Mabini (168)

| PN | What it is and what it is good for |
|---|---|
| GD1682026903020 | Plain Mortgage loan at A. Mabini: send it to DP 3 and forward to Receiving LA A. Mabini. |
| GD1682026903021 | Plain Mortgage loan at A. Mabini: good for a hold, a missing paper or a problem. |
| GD1682026903022 | Auto Financing at A. Mabini. |
| GD1682026903023 | Renewal at A. Mabini, ₱900,000: Mortgage needed. |
| GD1682026903024 | Refinancing above the limit at A. Mabini (₱700,000): no Mortgage. |
| GD1682026903025 | Released 2 business days ago at A. Mabini: Assign to DP due today. |

### Alaminos (390)

| PN | What it is and what it is good for |
|---|---|
| GD3902026903026 | Plain Mortgage loan at Alaminos: send it to DP 4. |
| GD3902026903027 | Plain Mortgage loan at Alaminos: good for Return to LA with findings. |
| GD3902026903028 | Auto Financing at Alaminos. |
| GD3902026903029 | Renewal at Alaminos, ₱1,000,000: Mortgage needed. |
| GD3902026903030 | Released 4 business days ago at Alaminos: late (TAT). |
| GD3902026903031 | Alaminos is outside Luzon 1: LA Luzon 1 is refused (Outside your branch access). LA Alaminos or Roving LA can open it; Area Supervisor Luzon 1 then sees it (that role views loans but does not open them). |

### Amang Rodriguez (174)

| PN | What it is and what it is good for |
|---|---|
| GD1742026903032 | Amang Rodriguez: LA Luzon 1 is excluded from this branch, so it is refused for them; Roving LA can open it. |
| GD1742026903033 | Amang Rodriguez, second loan: once Roving LA opens it, Area Supervisor Luzon 1 sees it and LA Luzon 1 does not. |

### Cainta (102)

| PN | What it is and what it is good for |
|---|---|
| GD1022026903034 | Cainta (Luzon 1): LA Luzon 1 and Roving LA can open it; LA Antipolo cannot (Outside your branch access). |

### Binangonan (123)

| PN | What it is and what it is good for |
|---|---|
| GD1232026903035 | Binangonan (Luzon 1). |

### Marikina (104)

| PN | What it is and what it is good for |
|---|---|
| GD1042026903036 | Marikina (Luzon 1), Renewal ₱950,000: Mortgage needed. |

### Marcos Highway (163)

| PN | What it is and what it is good for |
|---|---|
| GD1632026903037 | Marcos Highway (Luzon 1), Auto Financing. |

### Mandaluyong (147)

| PN | What it is and what it is good for |
|---|---|
| GD1472026903038 | Mandaluyong (Luzon 1). |

### Libis (155)

| PN | What it is and what it is good for |
|---|---|
| GD1552026903039 | Libis (Luzon 1), released 2 business days ago. |

### Alicia-Inactive (718)

| PN | What it is and what it is good for |
|---|---|
| GD7182026903040 | At Alicia-Inactive (718), a branch MyLoans closed: opening it is refused ("Alicia-Inactive (718) is inactive in Settings, so no new loan files can be opened for it."). |

## Things to check (10 November 2026)

1. **Approve asks first.** Approve opens "Approve this request?" with the amount in bold and one grey line (number · processor · kind · borrower). Focus is on Cancel; Cancel and Esc change nothing. Approve (gold) says "Approving..." and approves once, even on a double tap: one history line and one notice. After a lowered amount, the window shows the changed total. On a phone it is a bottom sheet.
2. **Request numbers.** The cash advance is CA-2026-0001 (or the next CA number) and the fund transfer FT-2026-0001 (its own series). After Change type the request has the next number of the new type and "Formerly CA-..." under it and in its history; searching the old number finds it.
3. **Print liquidation report.** Without the tick there is no Print button, and the report link says "Ask an Admin to turn on 'Print liquidation report' for your role." Finance and Admin print as before.
4. **Moving a hold.** Finance has no Transfer hold any more. The Branch Supervisor (Antipolo and Angono) and the Area Supervisor (Luzon 1 plus Alaminos) have Transfer hold on loans of their branches and can give the hold only to someone who also has access to that branch. Neither can resume it.
5. **Who can move holds.** With Admin's tick on, no line shows (Admin has All branches). With it off, "N active branches have nobody who can move a hold." shows with **Show branches**; the supervisors' branches are not in the list.
6. **Journey filters.** All · Needs attention and the transaction pills. There is no "Mine".

### Funds handled by different people

7. **Finance Cash** sees only cash advances: no fund transfer in any tab, count, total, search result or CSV, no Type filter, and "Cash advances" under the Funds title. A fund transfer's report link says it is not found.
8. **Finance Transfer** sees only fund transfers, with "Fund transfers" under the title.
9. **Approver Cash** sees cash advances only and has Approve on them (its role shares both Cash advance bands); **Approver Transfer** the same for fund transfers. Neither sees the other type. Settings, Approval bands lists the shared bands per type (two roles on each amount).
10. With **Release fund transfers** on no role, Settings, Funds types shows "Nobody can release fund transfers." in soft amber under Fund transfer (and Release: Nobody); Settings, Roles and the top of Funds (Admin) show the same line. Fund transfers wait at To release and the Admin is told. Tick it again and the line goes.

### Missing papers

11. **Missing papers.** Pressing **Missing** opens a small box under the row (red "Missing, remarks needed"); Send says "Add remarks for: ..." naming the paper. After Save remarks the row is amber "Missing, with remarks" and Send works. An optional paper without **Include in this file** stays quiet and needs nothing. As the processor, **Review the papers** shows the paper in its place as an amber row with a **Missing** chip, the reason and remarks, who and when, and no tick box (no separate card on top); A paper ticked first and then marked Missing shows the same way, with its Document ID on the row (never ticked). The loan file counts read "4 of 5 received · 1 missing with remarks", and the bar shows received papers only. Accept works with it, and the paper is not offered in Return to LA (the server refuses it too). **Received** asks for the date it arrived; the reason and remarks stay, and the Loan File row goes with the last one. The Journey has one event per marking and per Received. Monitoring, **Has missing papers**, lists the paper and its days. No email and no alert.
12. **The reason and remarks box.** The focus goes to the reason chips (one tap picks one; it turns navy with a tick). The remarks are one line that grows; the hint says how many characters are left ("4 more characters.") and Save stays off until there are 5. Enter saves (Shift+Enter is a new line). Saved, it folds to one line: the reason chip, the remarks, who and when, and **Edit**; Esc on Edit cancels and keeps the old text. On a phone the chips wrap, Save sits under the remarks, nothing scrolls sideways.

### Labels (removed 11 November 2026)

13. **No labels.** No Print labels button or page, no "Labels not printed yet" warning, no "Labels printed" chip and no "Labels are on all papers" tick: Send depends only on the papers (required papers, missing papers with remarks) and the other usual checks, and Accept is one press. The Documents tab shows each paper's Document ID (column ID). Settings, Roles has no Print labels tick. A QR code for Archiving and Warehousing (where a file is stored: vault, box, part, numbers) comes in a later phase; it is not built.

### Find a loan (11 November 2026)

14. **Find a loan, compact.** The title with one small grey line beside it, one search row (the placeholder "PN, CIN or CIF"; input and Find loan the same height; on a phone the button is full width under the input) and, in test mode, the sample loans as one slim row (PN, name, branch; what each tests is in its tooltip; on a phone folded under **Show 3**). Only the samples of your branches are listed. The loan shows in one card: the name, the PN and the chips on one row, the four facts, the two questions side by side (stacked on a phone) and **Open loan file**, greyed with "Pick both answers to continue" beside it. The focus is on the first question and the arrow keys move inside it. No "Please pick one to continue." until you press Open loan file; then it shows under the question still empty. Under the buttons: "Next: we set up the loan file, you check the papers, then send them to a processor." Nothing scrolls sideways.
15. **Outside your branches.** Typing calls nothing: no one has opened these PNs, so the dropdown only shows the quiet hint "Not opened in the DMS yet. Press Find loan to look it up in MyLoans." Pressing Find loan on the Alaminos PN shows the one-line message "This loan is outside your branches." with the PN and **Try again**. The PN that is not in MyLoans shows "We could not find this loan in MyLoans."
16. **The result follows the box.** The card or message goes away as soon as the PN in the box changes or a sample is picked; it never shows a different PN than the one in the box.

### MyLoans account details (11 November 2026)

17. **Find a loan, account details.** Chips: **Loan Released** (the status by name, never a number), Your branch, Details complete and a grey **Source: MyLoans**; no "Loan found" chip. Two rows of four: Amount released, Released on, Loan type, Product, then Branch (Angono), Area (LUZON 1 (NGMA + RIZAL)), Division (Branch Division), Company (Global Dominion Financing Inc.). Names only: no CIN, CIF, vehicle, source loan ID, product code or any ID.
18. **More loan details.** Closed until you open it. Then, in two columns: Identity (PN, Source loan ID, CIN, CIF), Loan (borrower, amount, released on, loan type, product name, product code), Organization (Company "1 · Global Dominion Financing Inc.", Division "1 · Branch Division", Area "1 · LUZON 1 (NGMA + RIZAL)", Branch "165 · Angono"), Status (Status ID 12, Loan Released, Active Yes), Source (MyLoans, retrieved at, last checked, last updated in MyLoans, opened at), then the rule that fired.
19. **Feed quality (Admin).** With no loan files yet it says "No loan files yet"; once some are open, "All 15 items given (N loan files)", or the items MyLoans left empty with their counts (warnings; opening is never blocked). On Find a loan, Admin sees a "Data check (Admin)" line only when MyLoans left the product, area, division or company empty.

### Find a loan, local first (11 November 2026)

20. **Typing stays in the DMS.** From 3 characters, a moment after you stop typing, the dropdown lists only loan files saved in the DMS: the PN, the borrower's name, a small stage chip (for example "Check documents") and a grey "In DMS". No amount, address or contact, no spinner, and never "Looking in MyLoans". Part of the name finds it too. Random letters show nothing at all (no "No match" line). Arrows move, Enter on a row opens the "Already in the DMS" card, Esc closes the list.
21. **Already in the DMS.** The page does not jump to the loan file. One card: the borrower's name, the PN and product, the chips **Already in the DMS** and the stage (plus any hold, problem or **MyLoans changed**), then Owner (your name) or "With processor" and the processor's name, the branch and the next step. No Undertaking or OR/CR questions. **Open loan file** opens it; **Cancel** goes back to an empty Find a loan. A cancelled or replaced loan says so in red at the top and links to the new PN.
22. **A full PN not opened yet.** The dropdown shows one quiet line: "Not opened in the DMS yet. Press Find loan to look it up in MyLoans." Find loan then shows the usual MyLoans card with the details and the two questions (names only).
23. **Part of a PN or a name, with the button.** Part of a PN lists the matching loan files of your branches (up to 20): PN, name, stage chip and branch, each opening its loan file. The unknown name shows "Not found in the DMS." with "To look it up in MyLoans, type the full PN, for example GD1012026900001." MyLoans is never asked for part of a PN, a CIN, a CIF or a name.
24. **Outside your branches while typing.** The whole Antipolo PN shows "Outside your branches. You can only open loans of your branches." (no name). Part of the Antipolo borrower's name shows nothing: LA Angono never sees Antipolo loan files.
25. **Refresh when found (Admin).** "When a saved loan is found, refresh it from MyLoans if last checked more than this many hours ago", 4 by default; 0 means never. It runs once, in the background, after the "Already in the DMS" card shows (it never delays opening the loan), skips closed and cancelled loans and waits when the hourly limit is reached. A change it finds shows **MyLoans changed** on the card and goes to the usual MyLoans review.
26. **Two people, one PN.** Only one loan file is made. The first person lands on it as usual ("Loan file opened"); the second lands on the same loan file with "This loan file was just opened by someone in your branch."
27. **Without GD.** The opened one shows the **Already in the DMS** card with the PN written with GD. The other shows the hint while typing, then the usual MyLoans card with GD in front of the PN; no "must start with GD" message.
