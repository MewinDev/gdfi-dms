# 15 Liquidation

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

After the LTO work the processor accounts for the money: receipts for each expense and the cash returned; Finance confirms and closes the advance. Roles: DP (liquidates), Finance (settles and closes, grants exceptions), Admin (due-day setting).

## B and C. Checklist: v2 §3.5, §5.8 and Chart 6 (end)

| # | Item (v2 source) | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | CA liquidation: OR # and amount per expense, receipts uploaded | ✅ Built | My funds, Liquidate | `funds:liquidate` | No | `funds.ts`, e2e `liquidation.spec.ts` | UAT DP-8 |
| 2 | Compare actual with released; excess returned | ✅ Built | My funds, Funds | DP, Finance | No | `funds.ts` (return of cash) | UAT FIN-6 |
| 3 | Shortage to reimburse computed | ❌ Missing (only the excess to return) | n/a | n/a | n/a | FLOWCHART Chart 6 | n/a |
| 4 | Due within 2 working days after LTO processing (Changed by D-017 / D-044: N working days after the last LTO pickup, per funds type, default 2, saved on the record) | ✅ Built | Funds, My funds | System | Liquidation due days (0 to 30) | `lib/funds/liquidation.ts`, `lib/services/liquidation.ts`, D-044 | Release, then the pickup: due date shows |
| 5 | No new CA while one is unliquidated (Changed: blocked only while overdue; Finance can grant an exception) | ✅ Built as decided | My funds | System; `funds:exception` | No | `funds.ts`, D-039 | UAT DP-9 |
| 6 | Late liquidation recorded (for demerits later) | ✅ Built | TAT report, Liquidations | n/a | No | D-044 | TAT report Liquidations section |
| 7 | FT: confirm the amount used | ⚠️ Partial: an FT is liquidated with receipts like a CA (per type "must liquidate"; off settles at release) | Settings, Funds types | `fundtypes:manage` | Must liquidate | `FundsType.mustLiquidate` | n/a |
| 8 | Finance verifies the liquidation, then closes | ✅ Built | Funds | `funds:*_settle` | No | `closeAdvance` in `funds.ts` | UAT FIN-6 |
| 9 | Receipts open through the file route, each open logged | ✅ Built | Funds, My funds | by scope | No | module 17 | UAT FIN-5 |
| 10 | Liquidation report (print) | ✅ Built | Funds | `funds:*_print` | No | e2e `funds-design.spec.ts` | UAT FIN-8 |
| 11 | Forward to the LA only after liquidation (§5.8) | ⚠️ Partial: not gated (module 13 row 17) | Job | n/a | n/a | `jobs.ts` | n/a |
| 12 | Unliquidated CAs report (§10.3) | ⚠️ Partial: Funds page counts and lists overdue, CSV | Funds | Finance | No | module 19, report 12 | n/a |

## D. Known limits and open questions

- Row 3 (shortage) and row 11 (forward waits for liquidation): small, to decide (`docs/PHASE_A_GAPS.md`).
