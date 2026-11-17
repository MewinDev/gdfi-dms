import { DEFAULT_WORKING_WEEKDAYS, daysFor, type Days, type WorkCalendar } from "./core";

/**
 * Test helpers only (never imported by app code). A calendar from a list of all-branch holiday dates. Unit
 * tests whose subject is not the calendar may ask for MON_FRI by name to keep their dates readable; the
 * calendar itself (Mon to Sat by default) is tested in core.test.ts.
 */
export const MON_FRI: readonly boolean[] = [false, true, true, true, true, true, false];
export const testCal = (holidays: readonly string[] = [], weekdays: readonly boolean[] = DEFAULT_WORKING_WEEKDAYS): WorkCalendar => ({
  workingWeekdays: weekdays, entries: holidays.map((date) => ({ date, allBranches: true, branchIds: [] })),
});
export const testDays = (holidays: readonly string[] = [], weekdays: readonly boolean[] = DEFAULT_WORKING_WEEKDAYS): Days => daysFor(testCal(holidays, weekdays), null);
