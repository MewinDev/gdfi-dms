# 05 Working-days calendar

Last updated: 18 November 2026 (PHT)

## A. Purpose and roles

One calendar decides every count of working days: due dates, TAT, waiting colours, liquidation deadlines (D-018, D-041). Admin keeps the working weekdays, holidays and office closures (for all branches or some); a change moves the saved due dates it affects. Everyone sees the results.

## B. Checklist

| # | Item | Status | Where | Who | Customizable? | Evidence | UAT check |
|---|---|---|---|---|---|---|---|
| 1 | Working weekdays (default Monday to Saturday) | ✅ Built | Settings, Holidays and working days | `settings:holidays` (Admin) | Yes | `lib/calendar/core.ts`, D-041 | UAT ADM-2 |
| 2 | Holidays for all branches | ✅ Built | same | `settings:holidays` | Yes | `lib/services/calendar.ts` | Add a holiday; Check lists moved due dates |
| 3 | Office closures for some branches (with extensions of saved due dates) | ✅ Built | same | `settings:holidays` | Yes | D-041, e2e `calendar-settings.spec.ts` | Close Angono for a day |
| 4 | "Check" shows which saved due dates a change moves, before saving | ✅ Built | same | `settings:holidays` | No | D-041, e2e `due-dates.spec.ts` | Press Check |
| 5 | Saved due dates (not recomputed each day); a removed holiday undoes its own moves | ✅ Built | n/a | n/a | No | D-042, D-043 | Remove the holiday added above |
| 6 | Backdated holiday (at most 7 days back, with a reason) | ✅ Built | same | `settings:holidays` | Limit fixed in code | `calendar.backdateMaxDays` | Add one 8 days back: refused |
| 7 | Correct one item's due date with a reason | ✅ Built | Inbox, Correct due date | `duedates:correct` (Admin) | No | D-042, migration 019 | Correct a due date |
| 8 | Holiday CSV import and export | ✅ Built | Settings, Import / Export | `settings:import` | Yes | D-042 | Import next year's list |
| 9 | Pausing holds take paused days off the TAT | ✅ Built | Inbox ("Paused") | n/a | Per hold reason | hold reasons `pausesTat` | Kit demo "Paused" item |
| 10 | The official holiday list entered for go-live | ⏸ Blocked (Admin: data entry) | Settings, Holidays | Admin | n/a | `docs/STATUS.md` (Blocked) | Go-live checklist step 6 |

## D. Known limits and open questions

- Special non-working days announced at short notice: entered as holidays the same day (the 7-day backdate covers a late entry).
