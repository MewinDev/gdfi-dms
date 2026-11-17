/**
 * The ONE working-days calendar (D-018, D-041). Pure: no database. Every day count in the app (TAT, liquidation,
 * carry-over, reports, reminders, the sync window, the job lists) goes through these functions;
 * lib/calendar/no-other-counting.test.ts forbids any other.
 *
 * Dates are Manila dates as "YYYY-MM-DD". Counting rule (D-041): the working days AFTER the start date, up to
 * and including the end date; the same day is 0. A due date is due until the end of that day (23:59 Manila).
 * Whose calendar: LA work, the loan's branch; a DP job and liquidation, the processor's branch; Finance, the
 * requesting processor's branch (the caller picks the branch and asks daysFor).
 */

/** One holiday or office closure (active rows only). */
export interface CalendarEntry {
  id?: string;
  date: string;
  /** Every branch, or only branchIds. */
  allBranches: boolean;
  branchIds: readonly string[];
  kind?: "HOLIDAY" | "CLOSURE";
}

export interface WorkCalendar {
  /** Index 0 = Sunday ... 6 = Saturday; true = a working day. */
  workingWeekdays: readonly boolean[];
  entries: readonly CalendarEntry[];
  /** Due-date colour: amber when this many working days are left or fewer (setting tat.amberWithinDays; default 1). */
  amberWithinDays?: number;
}

/** The calendar of one branch (or of no branch: only the all-branch entries apply). */
export interface Days {
  isWorkingDay(ymd: string): boolean;
}

/** Default (D-041): Monday to Saturday working, Sunday off. */
export const DEFAULT_WORKING_WEEKDAYS: readonly boolean[] = [false, true, true, true, true, true, true];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Plain words for a pause, shown wherever pauses appear (D-041). */
export const PAUSE_RULE_TEXT = "The day you put it on hold counts; the day you resume doesn't.";

const DAY_MS = 86_400_000;
/** Ten years of days: a guard so a calendar with no working day can never loop forever. */
const MAX_STEPS = 3660;

const toUtc = (ymd: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Not a date: ${ymd}`);
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
};
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
export const nextDay = (ymd: string, by = 1) => fromUtc(toUtc(ymd) + by * DAY_MS);
export const weekdayOf = (ymd: string) => new Date(toUtc(ymd)).getUTCDay();

/** The calendar as seen by one branch (null: no branch, only all-branch entries). */
export function daysFor(cal: WorkCalendar, branchId: string | null | undefined): Days {
  const off = new Set<string>();
  for (const e of cal.entries) if (e.allBranches || (!!branchId && e.branchIds.includes(branchId))) off.add(e.date);
  const week = cal.workingWeekdays;
  return { isWorkingDay: (ymd) => !!week[weekdayOf(ymd)] && !off.has(ymd) };
}

/** n working days after ymd (n = 0: the same date; negative: before it). */
export function addWorkingDays(ymd: string, n: number, days: Days): string {
  let d = ymd, left = Math.abs(n), steps = 0;
  const dir = n < 0 ? -1 : 1;
  while (left > 0) {
    d = nextDay(d, dir);
    if (days.isWorkingDay(d)) left--;
    if (++steps > MAX_STEPS) throw new Error("No working day in the calendar.");
  }
  return d;
}

/** Working days after a up to and including b (negative when b is before a; 0 for the same day). */
export function workingDaysBetween(a: string, b: string, days: Days): number {
  if (a === b) return 0;
  const sign = a < b ? 1 : -1;
  const [from, to] = sign > 0 ? [a, b] : [b, a];
  let count = 0, d = from, steps = 0;
  while (d < to) {
    d = nextDay(d);
    if (days.isWorkingDay(d)) count++;
    if (++steps > 40 * MAX_STEPS) break;
  }
  return sign * count;
}

/** Days paused by holds whose reason "Pauses TAT" (D-041): after the hold day, up to and including the resume day (or today). */
export function pausedDays(holds: readonly { from: string; to: string | null; pauses: boolean }[], today: string, days: Days): number {
  return holds.reduce((n, h) => n + (h.pauses ? Math.max(0, workingDaysBetween(h.from, h.to ?? today, days)) : 0), 0);
}

/**
 * A holiday or closure added (or a working day taken away) after a due date was saved: the working days lost
 * INSIDE the item's counting window (after its start date, up to and including its due date). Zero when the
 * window does not contain a changed date. Overdue items are extended too (D-041 refinement).
 */
export function lostWorkingDays(start: string, due: string, before: Days, after: Days): number {
  let lost = 0;
  for (let d = nextDay(start), steps = 0; d <= due && steps < 40 * MAX_STEPS; d = nextDay(d), steps++) {
    if (before.isWorkingDay(d) && !after.isWorkingDay(d)) lost++;
  }
  return lost;
}

export type DueTone = "green" | "amber" | "red" | "paused";

/** Colour of a due date (D-041): red when late, amber within `amberWithin` working days (or due today), else green. */
export function dueTone(due: string, today: string, days: Days, amberWithin: number, paused = false): DueTone {
  if (paused) return "paused";
  if (today > due) return "red";
  return workingDaysBetween(today, due, days) <= amberWithin ? "amber" : "green";
}

/** The working days left until a due date (0 = due today; negative = late by that many). */
export const daysLeft = (due: string, today: string, days: Days) => workingDaysBetween(today, due, days);
