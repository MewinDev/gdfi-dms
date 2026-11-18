# Phase A gaps

Last updated: 18 November 2026 (PHT)

Every ⚠️ Partial and ❌ Missing row of the module checklists (`docs/checklists/`) that matters for phase A (LA, DP and Funds on the live myloans feed), sorted into **needed for go-live**, **soon after go-live** and **later**. ⏸ Blocked rows (waiting for someone outside the team) are in `docs/STATUS.md`; 📦 phase B and C rows are not repeated here. Effort is developer-days for one experienced developer. **Nothing here is being fixed until the project owner decides (D-055).**

## 1. Needed for go-live

| # | Gap | Checklist row | Effort (days) | Depends on | Recommendation |
|---|---|---|---|---|---|
| G1 | Microsoft sign-in (Entra ID) | 01 #1, 21 #13 | 3 to 5 (already in "go-live preparation") | IT: app registration, redirect URL, which group signs in | Build now on a test tenant if IT can give one; it is the only way into staging and production. |
| G2 | DP receipt confirmation with a mismatch flag (v2 §5.7: reference #, amount, last 4; mismatch to Finance and Admin; LTO waits) | 14 #10, 13 #10, 16 #8 | 2 to 3 | Decision Q1 | Build, as a light step: the DP presses "Received" (or "Does not match" with a reason); the LTO stage waits for it only on funded transactions. |
| G3 | Admin cancels a transaction (v2 §5.3, §8: Admin / Superadmin only, with a reason, logged; reassign is Move work items) | 11 #12 | 1 to 2 | Decision Q2 | Build: Cancel transaction with a reason on the loan file, ticked for Admin; ends its work items, jobs and open funds lines. Without it a wrong transaction stays open for ever. |
| G4 | Optional transactions (Cancellation of Mortgage, Transfer of Ownership, Renewal of OR, PPSR Termination) | 12 #8 | 0.5 (seed the four types and their papers) | Operations confirm the papers (Q3) | Seed them as addable transaction types for go-live; the availability matrix waits (S6). |
| G5 | Checklist papers per transaction confirmed with Operations (v2 §4.6 sample lists) | 12 #13 | 0.5 (data entry) | Operations | Admin enters them in Settings before UAT. |
| G6 | File storage on a persistent disk, or a cloud storage driver | 17 #6 | 0 (persistent disk) or 2 (driver) | Hosting decision | Choose a host with a persistent disk; build the driver only if the host has none. |
| G7 | myloans authentication: v2 asks OAuth client credentials; built: Bearer API key | 07 #8 | 0 to 1 | myloans team (staging check) | Confirm in the staging check; add the token exchange only if myloans requires it. |
| G8 | Loans already in process at go-live (papers and jobs) | 23 #12 | 1 to 2 (procedure and a short entry guide) | Go-live date, LA Supervisors | First load brings released loans into the pools; for loans already at the LTO, a one-page guide for entering them on day 1. |
| G9 | Training material per role | 23 #13 | 2 to 3 (already in "go-live preparation") | UAT done | One-page quick guide per role from the UAT checklist and the demo script. |

New work beyond `docs/STATUS.md`'s go-live preparation: G2, G3, G4, G5, G6 (if needed), G7 (if needed): **4 to 9 days**.

## 2. Soon after go-live (first 1 to 2 months)

| # | Gap | Checklist row | Effort (days) | Depends on | Recommendation |
|---|---|---|---|---|---|
| S1 | Fund amount formula: fee table per transaction type + km × rate + meals per day + other; computed rates locked | 14 #1, #2; 04 #6 | 4 to 6 | Finance and Operations: the fee table, rate per km, km per LTO office, meal rule (Q4) | Go live with expense kinds and preset amounts (works today); add the formula when the rates are agreed. |
| S2 | One fund request per account (v2) vs per DP covering several loans (built) | 14 #1 | 2 to 3 if changed | Q4 | Keep per DP (one loan can have several processors, FLOWCHART P5.2) unless Finance needs per-account requests. |
| S3 | FT receiving account entered by the DP at request (built: by Finance at release) | 14 #4 | 1 | Finance (Q5) | Ask Finance which is easier; small either way. |
| S4 | "Funds credited" wording and date on the job | 14 #11 | 0.5 | none | Do with G2. |
| S5 | Liquidation: shortage to reimburse; forward waits for liquidation; FT "confirm amount used" | 15 #3, #7, #11; 13 #17 | 1 to 2 | Q6 | Compute the shortage; do not gate Forward on liquidation (it would stop the package for a Finance step); set FT to "confirm amount" if Finance agrees (a setting). |
| S6 | Optional transactions availability matrix (available / unavailable by result) | 12 #8 | 2 to 3 | G4 | After go-live, once the four types are in use. |
| S7 | Checklists by loan type or classification (v2 §9.2) | 12 #12 | 2 to 3 | Operations (Q7) | Only if the papers really differ by loan type; today they differ by transaction. |
| S8 | DP queue grouped per account; one account view with all its transactions | 13 #1, #2 | 2 to 3 | DP feedback in UAT | Wait for UAT: the per-transaction list may be enough. |
| S9 | One Exceptions report (holds, problems, returns, missing papers, Open Items) covering v2's Exceptions and Returned Documents reports | 16 #13, #14; 19 #2, #5 | 2 | none | Build soon after go-live. |
| S10 | Report exports: Open Items CSV, audit log CSV, TAT per month; consistent filters | 10 #15, 19 #0, #1, #13, 20 #9 | 2 to 3 | Q8 | Build the Open Items CSV first; the rest as asked. |
| S11 | Error tracking for the running app | 23 #14 | 1 | Hosting | Add with the hosting set-up. |
| S12 | LA TAT target (v2: 1 day check-and-assign; seeded 2 + 2) | 12 #22 | 0 (setting) | Admin (Q9) | Admin sets the real targets before go-live; no code. |
| S13 | Alert settings beyond on / off per event | 04 #5 | 1 to 2 | Notification matrix (blocked) | After the business agrees the matrix. |

## 3. Later

| # | Gap | Checklist row | Effort (days) | Recommendation |
|---|---|---|---|---|
| L1 | Loan-file stage order editable (v2 §9.1) | 04 #4 | 3 to 5 | Not needed: the stage map is decided (D-020). |
| L2 | Dashboard widgets and report filters per role (v2 §9.5) | 04 #9 | 3 to 5 | Only if roles ask; Home already follows the ticks. |
| L3 | Upload size setting | 17 #8 | 0.5 | Only if large photos cause trouble. |
| L4 | Mortgage thresholds as settings | 04 C3 | 1 | Only if Operations asks (v2 calls them rules). |

## 4. Reports at go-live (the 19 v2 reports)

| Report | Today | Proposal |
|---|---|---|
| 1 TAT per stage / employee / month | ⚠️ TAT report (by person, by reason, jobs), CSV | **Go-live as is**; per month soon after (S10) |
| 2 Pending and overdue documents | ⚠️ Inbox, Monitoring, Home | **Go-live as is**; Exceptions report soon after (S9) |
| 3 Transaction status per PN | ⚠️ Loans table and CSV | **Go-live as is** |
| 4 Document movement history | ⚠️ Journey, audit log | **Go-live as is** |
| 5 Returned documents | ⚠️ counts in the TAT report | Soon after (S9) |
| 6 Closed transactions | 📦 phase C | Later |
| 7 to 9 Demerits, QA deficiency, disputes | 📦 phase B | Later |
| 10 Fund request and LTO status per fund type | ⚠️ Funds page, Monitoring | **Go-live as is** |
| 11 Fund release per account | ⚠️ Funds list and CSV | **Go-live as is** (computed amount with S1) |
| 12 Expense breakdown and CA liquidation | ⚠️ lines per kind, liquidation report, overdue list | **Go-live as is**; computed side with S1 |
| 13 Open Items | ⚠️ page with Decided tab | **Go-live as is**; CSV soon after (S10) |
| 14 myloans sync log | ✅ run log | **Go-live** |
| 15 PN search log | ✅ with CSV | **Go-live** |
| 16 to 19 Archive and warehouse | 📦 phase C | Later |

So: 11 reports usable on go-live day in their current form (1 to 4, 10 to 15), 2 soon after (5, and the Exceptions view for 2), 6 + 4 later with phases B and C. No report blocks go-live.

## 5. Questions for the project owner

1. **Q1 (G2):** Build the DP receipt confirmation (match reference #, amount, last 4; mismatch flagged to Finance and Admin; LTO waits) for go-live?
2. **Q2 (G3):** Who may cancel a transaction: Admin only (v2), or also the LA Supervisor/Head? What happens to cash already released for it: ask for it back first (as for a cancelled loan)?
3. **Q3 (G4):** Seed the four optional transaction types for go-live? Who confirms their papers (Operations)?
4. **Q4 (S1, S2):** Do Finance and Operations want the v2 fund formula (fee table, km × rate, meals)? If yes, who gives the fee table, the rate per km, the km per LTO office and the meal rule? And should a request stay per processor (several loans) or be one per account (v2)?
5. **Q5 (S3):** Who enters the FT receiving account: the DP when requesting (v2) or Finance when releasing (today)?
6. **Q6 (S5):** Should Forward to the branch wait until the advance is liquidated (v2 §5.8)? Is an FT liquidated with receipts or only "amount used confirmed"?
7. **Q7 (S7):** Do the required papers differ by loan type (New / Renewal) or classification, or only by transaction?
8. **Q8 (reports):** Is the go-live report set in section 4 acceptable? Is CSV (opens in Excel) enough, or is PDF needed for any report?
9. **Q9 (S12):** The real TAT targets per step (v2 §2.2 samples vs the seeded values), to enter before UAT.
10. **Q10 (G6, G7):** The hosting decision (persistent disk or not) and whether myloans requires OAuth: both decide small pieces of work.

## 6. Total to a phase A go-live

| Step | Days |
|---|---|
| Real API verification (blocked: C5) | 2 to 3 |
| Production scheduler (blocked: hosting) | 1 |
| CI (blocked: GitHub setup) | 1 |
| Go-live preparation (Entra, staging, backups and monitoring set-up, first load, UAT, training, first weeks of support) | 10 to 15 |
| Go-live gaps above (G2 to G7) | 4 to 9 |
| **Phase A total** | **18 to 29 days** (about 4 to 6 weeks) |

Piece 12 is done (it was 4 to 6 days of the earlier 18 to 26).
