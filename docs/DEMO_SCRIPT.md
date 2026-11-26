# Demo script: 30 minutes on the test kit

Last updated: 26 November 2026 (PHT)

A walkthrough for three users (one Loan Associate, one Document Processor, one Finance person) on the clean Manual Test Kit with the demo items (`npm run kit:demo`). It shows the everyday flow, the Inbox and the TAT report (piece 9, D-046). Everything is sample data: nothing here is a real loan.

## Before the session (5 minutes, not counted)

1. In PowerShell, in the project folder: `npm run kit:reset` and type `RESET` (a backup is taken first). It says "Loaded: CLEAN kit".
2. Then `npm run kit:demo`: it adds a few **aged** items so the Inbox shows every colour. LA Angono gets an overdue item (red, GD1652026903013), one due today (amber, GD1652026903016) and one on hold (Paused, GD1652026903017). The Angono LA pool gets two released loans not yet opened: GD1652026903014 waiting 1 working day (amber) and GD1652026903015 waiting 3 (red).
3. Start the app (`npm run dev`) and open `http://localhost:3000/login` in **three browser windows** (or one normal and two private windows), one per user, so nobody signs out between steps.
4. Sign in under **Test sign-in**:

| Window | Account | Who it plays | Branch access |
|---|---|---|---|
| 1 | **LA Angono** | Loan Associate | Angono (165) |
| 2 | **DP 1** | Document Processor | Antipolo and Angono |
| 3 | **Finance** | Finance: approves (bands off) and releases the cash | All branches |

Extra accounts the presenter uses (switch inside window 2 or 3 when the step says so):

| Account | Used for |
|---|---|
| **DP 2** | Accepts from the Branch DP pool, and returns a job (step 4) |
| **Admin** | Turns approval bands on for the second approval flow (step 5) |
| **Approver (small amounts)** | Approves under ₱5,000 when approval bands are on (step 5) |
| **LA Supervisor/Head** | Away and Move work items; the TAT report (steps 8 and 9) |
| **LA Luzon 1** | Receives a moved item (step 8) |

Two sample PNs, both at Angono and both plain Mortgage loans:

- **GD1652026903019** (Salvador Castillo): the named-processor path.
- **GD1652026903012** (Karla Mendoza): the Branch DP pool path.

## The walkthrough

### 1. Find loan, then the Inbox (LA Angono, minutes 0 to 4)

1. **Loans**, type `GD1652026903019`, **Find**, then **Open loan file**.
2. Point out: the transactions appear at once. Open **Inbox** (left menu): under **My items** they are already **accepted** (Find loan counts as Accept), each with a green **Due** chip and "Turnaround time (from accept)".
3. Do the same for `GD1652026903012`.

### 2. Send: one to a named DP, one to the Branch DP pool (LA Angono, minutes 4 to 9)

1. On GD1652026903019, open the **Mortgage** transaction, tick every required paper, answer **Needs funds** with **LTO fee**, pick **DP 1** and **Send to DP 1**, then **Send**.
2. On GD1652026903012, open **Mortgage**, tick the papers, answer **No funds needed**, and pick **Branch DP pool** (under the list of processors): "Any processor of Angono can accept it. The first to accept gets it." **Send to the branch pool**, then **Send**.
3. Point out the pool line on the loan file: "In the Angono DP pool since …", with **Take it back** (the LA can still take it back until someone accepts).
4. Back on the **Inbox**: both items have left My items (they are with the processors now).

### 3. DP accepts, holds, resumes, forwards (DP 1, minutes 9 to 16)

1. **Inbox, My items**: the GD1652026903019 Mortgage job is there, "Arrived today", not yet accepted. **Accept** opens the job; the job now has a due date.
2. **Put on hold** with the reason **Waiting for the client's papers** (it pauses the TAT) and a remark. Show the Inbox: the item shows **Paused** and moves to the end of the list.
3. **Resume** with a remark. The due date moved by the paused working days (the job's due-date history says why).
4. The job says "Needs funds: LTO fee". **Request a cash advance** (it opens My funds) for the LTO fee, for example ₱1,500.
5. Work the stages (Start, the evidence, Finish), **Check and verify**, **Complete job**, then **Forward** to Angono and **LA Angono**. If time is short, skip the stages and come back to them after step 9.

### 4. Branch DP pool and a return with a reason (DP 2, minutes 16 to 20)

1. Switch window 2 to **DP 2**. **Inbox, Branch pool**: the GD1652026903012 job, "Arrived today" in green. **Accept**: it becomes DP 2's normal job, already accepted.
2. (Optional) DP 1 tries to accept the same item at the same moment: they are told "Already accepted by DP 2 at … It is in their inbox now."
3. **Return to LA**: try to send it without a reason. It is refused. Pick **Wrong or unclear paper**, add a remark, and return it.
4. Switch to **LA Angono**: **Inbox, My items** shows it back, waiting for Accept. **Accept** gives a **fresh full target** (a new due date). Point out the note: the time it waited is shown as waiting, not counted against the LA.

### 5. Two approval flows, then release (Finance, Admin, Approver, minutes 20 to 23)

The users choose between these two flows (question 6 below; this settles D-024). Show both on the same request:

1. **Flow A, bands off (the kit's setting): Finance approves and releases.** As **Finance**, open **Funds, To approve**: DP 1's request has **Approve**. Do not press it yet; point it out.
2. **Flow B, bands on: an approver approves by amount, Finance releases.**
   1. Switch window 3 to **Admin**: **Settings, Cash-advance rules**, tick **Use approval bands by amount**, **Save switches**. The kit's bands are: under ₱5,000 to **Approver (small amounts)**, ₱5,000 and up to **Approver (large amounts)**.
   2. Switch to **Finance**: the request is still listed, but approval is now the approver's step.
   3. Switch to **Approver (small amounts)**: **Funds, To approve**, **Approve** (it asks to confirm, with the amount in bold).
3. Switch back to **Finance**: **Funds, To release**, **Release**.
4. Point out: there was no separate Accept. Approve and Release **count as accepting**, and the report measures them as **time to act (from arrival)**.
5. Put the switch back (Admin, untick **Use approval bands by amount**) so the next demo starts with Flow A.

### 6. The package comes back (LA Angono, minutes 23 to 24, if step 3 forwarded it)

1. The **Inbox** shows the package for GD1652026903019 ("Receive it to accept it"). Open it, **Receive**, **Complete**.

### 7. Inbox colours (LA Angono, minute 24)

1. **Inbox, My items** (the aged items from `npm run kit:demo`):
   - GD1652026903013 is **red** (overdue) and listed first;
   - GD1652026903016 is **amber** (due today);
   - the new items are **green**;
   - GD1652026903017 shows **Paused** (on hold for the client's papers) and is listed last.
2. **Branch pool**: two released loans not yet in the DMS. GD1652026903014 is **amber** ("In the branch pool since <date> · 1 working day"), GD1652026903015 **red** ("… · 3 working days"; D-060: kit:demo moves their release date back to the arrival, so a loan never waits from before it was released), and the tab says "1 waiting too long". **Accept** on one opens Find loan with the PN filled in; opening it takes it out of the pool.
3. The pool limits are a setting: **Settings, Inbox waiting colours** (amber after 1, red after 2 working days by default).

### 8. Away and Move work items (LA Angono, then LA Supervisor/Head, minutes 24 to 27)

1. **LA Angono**: **Inbox**, **I will be away**, today to today, note "Sick leave", **Save**.
2. Switch window 3 to **LA Supervisor/Head**. **Home**, the card "Work to move on": "1 item waiting in the pool too long" and "N items are with people who are away". Open the second line: **Inbox, With people away**.
3. On one of LA Angono's items: **Move**, **Give to LA Luzon 1**, reason "Away today", **Move**. The result line stays at the top: "Moved. Both people were told."
4. Point out: LA Angono's round ends as **"Moved (away)"**, never counted late. LA Luzon 1 gets a fresh target, and the item's overall due date is unchanged.
5. (Optional) Try to send a new job to someone who is away: they are shown disabled in the Send panel.

### 9. The TAT report, By person (LA Supervisor/Head, minutes 27 to 30)

1. Open `/reports/tat` (or **Open the TAT report** on Home when that card shows).
2. **By person**, two tables:
   - **Turnaround time (from accept):** rounds, average used, late, **returned** (DP 2: 1), **moved (away)** (LA Angono: 1).
   - **Time to act (from arrival):** Finance's approve and release.
3. Point out: waiting in a pool never counts against a person, and paused days are taken off. Items made from older records with a missing time are marked **Migrated** and left out.

## Six questions to ask the users

1. **Inbox:** when you start your day, does "My items, least time left first" show you what to do first? What would you look for that is not there?
2. **Branch pool:** would your branch use the pool, or always name a processor? What should happen when nobody accepts a pool item for a day?
3. **Colours and targets:** do amber after 1 working day and red after 2 match how long work may wait in the pool? Are the due-date colours right for your work?
4. **Away and Move:** who in your branch should mark people away and move their work? Is "Moved (away), not counted late" fair?
5. **TAT by person:** is "from accept" (and "time to act from arrival" for Finance and receiving) a fair way to measure your work? What would you want changed before this is used in performance reviews?
6. **Which approval flow should we use?** Flow A (Finance approves and releases any amount) or Flow B (an approver approves by amount band, then Finance releases)? If B, which amounts and who approves each band? This settles D-024.

[Manual Test Kit](MANUAL-TEST-KIT.md) · [Rules and roles: Inbox](workflow/07-rules-and-roles.md#inbox-branch-pool-and-moving-work-d-014-d-015-d-046)
