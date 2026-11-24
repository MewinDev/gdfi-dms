# Business questions for the user demo

Last updated: 24 November 2026 (PHT)

Every working default still waiting for the business, from `docs/DECISIONS.md` (the **[TO CONFIRM]** items of D-056 and the older open ones), grouped by who answers. Each has what the DMS does today and one question. Every default can be changed in Settings or with one small change; nothing has to be rebuilt.

## LA Supervisor/Head

| # | Topic | Today's default | Question | Source |
|---|---|---|---|---|
| L1 | Papers of the four optional transactions | v2 §4.6's lists, all required: Cancellation of Mortgage (notarized Release of Chattel Mortgage, original OR/CR, valid IDs); Transfer of Ownership (Deed of Sale, original OR/CR, seller and buyer valid IDs, PNP-HPG clearance, stencil, CTPL insurance); Renewal of OR (original OR/CR, CTPL insurance, emission test result); PPSR Termination (PPSR termination statement, PPSR registration reference, proof of full payment) | Are these the right papers, and which are optional? Does PPSR Termination go through the LTO (today it runs the LTO stages like For Entry PPSR)? | D-056 item 3 |
| L2 | Papers of the four built-in transactions | Today's lists (for example Notary: Promissory Note, Disclosure Statement, Chattel Mortgage, 2 borrower IDs, Deed of Sale or Sales Invoice; Mortgage: OR, CR, notarized Chattel Mortgage, insurance policy). v2's samples differ: For EDST adds the DST form (BIR 2000); For Entry PPSR adds the PPSR registration form and EDST proof; Mortgage adds the PPSR proof, EDST proof and stencil | Keep today's lists, or add v2's papers? | D-056 item 7 |
| L3 | Papers by loan type | Papers depend only on the transaction (not on New / Renewal or Financing / Refinancing) | Do any papers differ by loan type or classification? | D-056 item 7 |
| L4 | When the optional transactions can be added | Any time before the papers go to the Vault, on any loan | Should some be unavailable for Untransferred or Not Mortgage loans, as v2 §4.5 says? | D-056 item 3, PHASE_A_GAPS S6 |
| L5 | LA turnaround | 1 working day for "Checklist complete" and "Assign to DP" | Is 1 working day right for checking papers and sending to a processor? | D-056 item 9 |
| L6 | Hold reasons | The seeded list, marked "Proposed" in Settings | Are these the right hold reasons, and which ones pause the TAT? | seed (hold reasons) |

## Finance

| # | Topic | Today's default | Question | Source |
|---|---|---|---|---|
| F1 | LTO waits for receipt confirmation | The processor confirms a fund transfer (reference #, amount, last 4); a mismatch is flagged to Finance; the LTO does **not** wait | Should the processor be stopped from going to the LTO until the receipt is confirmed (v2 §5.7)? | D-056 item 1 |
| F2 | Fund request model | One request per processor covering several jobs, lines per expense kind with preset amounts and maximums | Keep it, or move to v2's formula (fee table per transaction, km × rate, meals per day) and one request per account? | D-056 item 4 |
| F3 | Fund transfer liquidation | Receipts, like a cash advance | Should a fund transfer be liquidated with receipts, or only "amount used" confirmed? | D-056 item 6b |
| F4 | Finance turnaround | 1 working day to release | Is 1 working day right for a cash advance and a fund transfer? | D-056 item 9 |
| F5 | Approval bands | Off: anyone with the Approve tick who handles the type approves any amount | Should approval depend on the amount (bands by role)? | D-024 |
| F6 | Funds types | Cash advance and Fund transfer, marked "Proposed"; liquidation due 2 working days after the last LTO pickup | Are the two types and the 2 working days right? | seed (funds types), D-044 |

## Operations

| # | Topic | Today's default | Question | Source |
|---|---|---|---|---|
| O1 | Processor turnaround | 5 working days for Notary, PPSR registration and Mortgage | Is 5 working days right for each, or do they differ? | D-056 item 9 |
| O2 | Fund formula rates (only if F2 says yes) | Not used | Who gives the fee table, the rate per km, the km per LTO office and the meal rule? | D-056 item 4 |
| O3 | Official holiday list | Sample holidays | Who enters this year's and next year's official list, and when? | STATUS (Blocked) |

## IT

| # | Topic | Today's default | Question | Source |
|---|---|---|---|---|
| I1 | Hosting | Not decided | Where does the DMS run (on-premise, cloud, Supabase), and does the server keep a persistent disk for uploaded files? | PHASE_A_GAPS Q10 |
| I2 | Microsoft sign-in | Not set up | Can IT register the Entra app (redirect URL, which group may sign in)? | PHASE_A_GAPS G1 |
| I3 | Backups | Folder or S3-compatible bucket, 30 days | Which target and off-site copy (3-2-1), and who checks the monthly restore? | D-055 |
| I4 | Email | Microsoft Graph, off until go-live | The sender mailbox and the app's Mail.Send consent? | ENVIRONMENT |
| I5 | Scheduler and CI | Not set up | Who sets up the scheduler and the GitHub Actions secret and branch protection? | STATUS (Blocked) |

## myloans team

| # | Topic | Today's default | Question | Source |
|---|---|---|---|---|
| M1 | Authentication | Bearer API key | Is the API key final, or must the DMS use OAuth client credentials (v2 §11.7)? | PHASE_A_GAPS Q10 |
| M2 | Staging access | Not available | When can the DMS reach myloans staging for the contract tests and a sync dry run (C5)? | STATUS (Blocked) |
| M3 | Hash test vectors | One test skipped | Can you send the 3 test-vector outputs? | STATUS (Blocked) |
| M4 | Change feed | Assumed | Do cancel and deactivate always update `updated_at`? What are the timings and limits (R2-6, A4, A5, C2)? | STATUS (Blocked) |
| M5 | Loan closed / paid | Not built (phase C) | Which source says a loan is fully paid (R2-4)? | STATUS (Blocked) |
