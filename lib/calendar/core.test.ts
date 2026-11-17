import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKING_WEEKDAYS, PAUSE_RULE_TEXT, addWorkingDays, daysFor, daysLeft, dueTone, lostWorkingDays, pausedDays, weekdayOf, workingDaysBetween,
  type CalendarEntry, type WorkCalendar,
} from "./core";

/**
 * D-041: the nine worked examples the user checked (17 November 2026), the refinement for holidays and closures
 * added late, month and year ends, and a branch with a local holiday against one without. Sample dates only.
 */
const ANGONO = "b-angono", PASIG = "b-pasig";
const cal = (entries: CalendarEntry[] = [], workingWeekdays = DEFAULT_WORKING_WEEKDAYS): WorkCalendar => ({ workingWeekdays, entries });
const all = (date: string): CalendarEntry => ({ date, allBranches: true, branchIds: [] });
const only = (date: string, ...branchIds: string[]): CalendarEntry => ({ date, allBranches: false, branchIds, kind: "CLOSURE" });
const plain = daysFor(cal(), null);

describe("the calendar's basics", () => {
  it("default Monday to Saturday; Sunday off", () => {
    expect(weekdayOf("2026-11-22")).toBe(0); // Sunday
    expect(plain.isWorkingDay("2026-11-21")).toBe(true); // Saturday is a working day
    expect(plain.isWorkingDay("2026-11-22")).toBe(false);
  });

  it("the tickboxes decide (Saturday off, a Sunday on)", () => {
    const monFri = daysFor(cal([], [false, true, true, true, true, true, false]), null);
    expect(monFri.isWorkingDay("2026-11-21")).toBe(false);
    const withSunday = daysFor(cal([], [true, true, true, true, true, true, true]), null);
    expect(withSunday.isWorkingDay("2026-11-22")).toBe(true);
  });

  it("addWorkingDays(0) is the same date; a negative count goes back", () => {
    expect(addWorkingDays("2026-11-22", 0, plain)).toBe("2026-11-22");
    expect(addWorkingDays("2026-11-23", -1, plain)).toBe("2026-11-21");
  });

  it("a holiday on a non-working day changes nothing", () => {
    const sundayHoliday = daysFor(cal([all("2026-11-22")]), null);
    expect(workingDaysBetween("2026-11-21", "2026-11-23", sundayHoliday)).toBe(1);
    expect(addWorkingDays("2026-11-21", 1, sundayHoliday)).toBe("2026-11-23");
  });

  it("refuses to loop forever when no day is a working day", () => {
    expect(() => addWorkingDays("2026-11-23", 1, daysFor(cal([], [false, false, false, false, false, false, false]), null))).toThrow(/No working day/);
  });

  it("the plain words for a pause", () => {
    expect(PAUSE_RULE_TEXT).toBe("The day you put it on hold counts; the day you resume doesn't.");
  });
});

describe("the nine worked examples (D-041)", () => {
  it("1. Friday to Monday: 2 working days (Saturday counts, Sunday does not)", () => {
    expect(workingDaysBetween("2026-11-20", "2026-11-23", plain)).toBe(2);
  });

  it("2. Saturday to Monday: 1; the same day: 0", () => {
    expect(workingDaysBetween("2026-11-21", "2026-11-23", plain)).toBe(1);
    expect(workingDaysBetween("2026-11-23", "2026-11-23", plain)).toBe(0);
  });

  it("3. across a holiday (sample Wed 25 Nov, all branches): 1 day; a 2-day target from Tue 24 is due Fri 27", () => {
    const d = daysFor(cal([all("2026-11-25")]), ANGONO);
    expect(workingDaysBetween("2026-11-24", "2026-11-26", d)).toBe(1);
    expect(addWorkingDays("2026-11-24", 2, d)).toBe("2026-11-27");
  });

  it("4. a branch closure (Angono, Thu 26 Nov): Angono 1 day on time, Pasig 2 days and late by 1", () => {
    const c = cal([only("2026-11-26", ANGONO)]);
    const angono = daysFor(c, ANGONO), pasig = daysFor(c, PASIG);
    expect(workingDaysBetween("2026-11-25", "2026-11-27", angono)).toBe(1);
    expect(addWorkingDays("2026-11-25", 1, angono)).toBe("2026-11-27"); // due Fri 27: on time
    expect(workingDaysBetween("2026-11-25", "2026-11-27", pasig)).toBe(2);
    const pasigDue = addWorkingDays("2026-11-25", 1, pasig);
    expect(pasigDue).toBe("2026-11-26");
    expect(daysLeft(pasigDue, "2026-11-27", pasig)).toBe(-1); // late by 1
  });

  it("5. a hold that pauses TAT: 2 days paused, due moves from Sat 28 to Tue 1 Dec; forwarded Mon 30 used 4, on time", () => {
    const due = addWorkingDays("2026-11-23", 5, plain);
    expect(due).toBe("2026-11-28");
    const hold = { from: "2026-11-25", to: "2026-11-27", pauses: true };
    const paused = pausedDays([hold], "2026-11-30", plain);
    expect(paused).toBe(2);
    expect(addWorkingDays(due, paused, plain)).toBe("2026-12-01");
    expect(workingDaysBetween("2026-11-23", "2026-11-30", plain) - paused).toBe(4);
    // A reason that does not pause TAT: due stays Sat 28, so Mon 30 is late by 1.
    expect(pausedDays([{ ...hold, pauses: false }], "2026-11-30", plain)).toBe(0);
    expect(daysLeft(due, "2026-11-30", plain)).toBe(-1);
    // A hold started and resumed the same day pauses 0; an open hold pauses up to today.
    expect(pausedDays([{ from: "2026-11-25", to: "2026-11-25", pauses: true }], "2026-11-30", plain)).toBe(0);
    expect(pausedDays([{ from: "2026-11-25", to: null, pauses: true }], "2026-11-26", plain)).toBe(1);
  });

  it("6. liquidation N = 2 from the last LTO (Fri 27): due Mon 30 (the start point itself is piece 5)", () => {
    expect(addWorkingDays("2026-11-27", 2, plain)).toBe("2026-11-30");
  });

  it("7. a holiday added late (Wed 25): X (due 23) and Y (due 24) unchanged; Z (due 25) and W (due 27) gain a day", () => {
    const before = plain, after = daysFor(cal([all("2026-11-25")]), null);
    const lost = (start: string, due: string) => lostWorkingDays(start, due, before, after);
    const extend = (start: string, due: string) => addWorkingDays(due, lost(start, due), after);
    expect(lost("2026-11-20", "2026-11-23")).toBe(0); // X: already overdue, window ends before the 25th
    expect(lost("2026-11-23", "2026-11-24")).toBe(0); // Y
    expect(extend("2026-11-24", "2026-11-25")).toBe("2026-11-26"); // Z
    expect(extend("2026-11-24", "2026-11-27")).toBe("2026-11-28"); // W
  });

  it("8. month end: Mon 30 Nov + 2 = Wed 2 Dec", () => {
    expect(addWorkingDays("2026-11-30", 2, plain)).toBe("2026-12-02");
  });

  it("9. year end: with 1 Jan 2027 entered, Thu 31 Dec + 1 = Sat 2 Jan; with Saturday off, Mon 4 Jan", () => {
    expect(addWorkingDays("2026-12-31", 1, daysFor(cal([all("2027-01-01")]), null))).toBe("2027-01-02");
    expect(addWorkingDays("2026-12-31", 1, daysFor(cal([all("2027-01-01")], [false, true, true, true, true, true, false]), null))).toBe("2027-01-04");
    expect(workingDaysBetween("2026-12-31", "2027-01-04", daysFor(cal([all("2027-01-01")]), null))).toBe(2); // Sat 2, Mon 4
  });
});

describe("late-added holiday or closure: the refinement (D-041)", () => {
  it("an overdue item whose window holds the new closure is extended (Angono closed Thu 26, recorded Fri 27)", () => {
    const before = daysFor(cal(), ANGONO), after = daysFor(cal([only("2026-11-26", ANGONO)]), ANGONO);
    // Accepted Wed 25, target 1: due Thu 26; on Fri 27 it is overdue.
    expect(daysLeft("2026-11-26", "2026-11-27", before)).toBe(-1);
    const lost = lostWorkingDays("2026-11-25", "2026-11-26", before, after);
    expect(lost).toBe(1);
    const newDue = addWorkingDays("2026-11-26", lost, after);
    expect(newDue).toBe("2026-11-27");
    expect(daysLeft(newDue, "2026-11-27", after)).toBe(0); // forwarded Fri 27: on time
  });

  it("a Pasig item is unchanged by an Angono closure", () => {
    const c = cal([only("2026-11-26", ANGONO)]);
    expect(lostWorkingDays("2026-11-25", "2026-11-26", daysFor(cal(), PASIG), daysFor(c, PASIG))).toBe(0);
  });

  it("a branch with a local holiday against one without", () => {
    const c = cal([only("2026-12-07", ANGONO)]);
    expect(addWorkingDays("2026-12-05", 1, daysFor(c, ANGONO))).toBe("2026-12-08");
    expect(addWorkingDays("2026-12-05", 1, daysFor(c, PASIG))).toBe("2026-12-07");
    // No branch: only the all-branch entries apply.
    expect(daysFor(c, null).isWorkingDay("2026-12-07")).toBe(true);
  });
});

describe("colours (D-041)", () => {
  it("green 2+ days left, amber 1 day or due today, red late, grey paused", () => {
    expect(dueTone("2026-11-26", "2026-11-23", plain, 1)).toBe("green");
    expect(dueTone("2026-11-24", "2026-11-23", plain, 1)).toBe("amber");
    expect(dueTone("2026-11-23", "2026-11-23", plain, 1)).toBe("amber");
    expect(dueTone("2026-11-21", "2026-11-23", plain, 1)).toBe("red");
    expect(dueTone("2026-11-21", "2026-11-23", plain, 1, true)).toBe("paused");
    // The amber point is a setting: 0 = only on the due day.
    expect(dueTone("2026-11-24", "2026-11-23", plain, 0)).toBe("green");
    // Saturday counts: Fri 20 with due Mon 23 is 2 working days left.
    expect(dueTone("2026-11-23", "2026-11-20", plain, 1)).toBe("green");
  });
});
