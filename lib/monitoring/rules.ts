/**
 * Monitoring rules in one place (pure: the server, the browser and the unit tests use the same code).
 *  - Availability of a processor: capacity, open jobs, On leave, and the status chip thresholds.
 *  - The dates filter: presets, Custom From and To (PHT, both days included, no future dates), the
 *    heading "9 Nov to 9 Nov 2026", and the By day / By week buckets.
 *  - A fast business-day counter over a date range (the TAT calendar: weekends and holidays skipped).
 */
import { addBusinessDays, isBusinessDay } from "@/lib/time";

/** The Philippine calendar day of an instant (fixed UTC+8, no daylight saving): fast, no formatter. */
export const phtDate = (d: Date) => new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/** THE thresholds (one constant). Available from 40%; Busy from 1% to 39%; Full at 0%. */
export const AVAILABILITY = {
  /** The default capacity (open jobs) when Settings has none. */
  defaultCapacity: 10,
  /** Available at this percentage or more. */
  availableFrom: 40,
  /** Capacity limits in Settings. */
  minCapacity: 1,
  maxCapacity: 200,
} as const;

export type AvailabilityStatus = "AVAILABLE" | "BUSY" | "FULL" | "ON_LEAVE";
export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = { AVAILABLE: "Available", BUSY: "Busy", FULL: "Full", ON_LEAVE: "On leave" };
/** Soft status colours (the ToneChip tones). */
export const AVAILABILITY_TONE: Record<AvailabilityStatus, "ok" | "act" | "bad" | "mute"> = { AVAILABLE: "ok", BUSY: "act", FULL: "bad", ON_LEAVE: "mute" };

export interface Availability {
  /** 0 to 100, rounded (0 when on leave). */
  pct: number;
  open: number;
  capacity: number;
  status: AvailabilityStatus;
  /** "60% · 4 of 10 in use". */
  text: string;
}

/**
 * Availability % = max(0, capacity minus open jobs) / capacity, rounded. On leave counts as 0%.
 * When at least one place is free the percentage is never shown as 0 (rounding), so Full means full.
 */
export function availability(capacity: number, open: number, onLeave = false): Availability {
  const cap = Math.max(1, Math.round(capacity));
  const free = Math.max(0, cap - open);
  const raw = (free / cap) * 100;
  const pct = onLeave ? 0 : free === 0 ? 0 : Math.max(1, Math.round(raw));
  const status: AvailabilityStatus = onLeave ? "ON_LEAVE" : free === 0 ? "FULL" : pct >= AVAILABILITY.availableFrom ? "AVAILABLE" : "BUSY";
  return { pct, open, capacity: cap, status, text: `${pct}% · ${open} of ${cap} in use` };
}

/** On leave today: the switch is on and the "until" day (if any) is today or later. A past "until" ends the leave. */
export function onLeaveToday(u: { dpOnLeave: boolean; dpLeaveUntil: string | null }, today: string): boolean {
  return u.dpOnLeave && (!u.dpLeaveUntil || u.dpLeaveUntil >= today);
}

/** "On leave until Nov 14, 2026" or "On leave". */
export function leaveText(until: string | null, fmt: (ymd: string) => string): string {
  return until ? `On leave until ${fmt(until)}` : "On leave";
}

// ---------------------------------------------------------------------------
// Dates filter
// ---------------------------------------------------------------------------

export const PRESETS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["month", "This month"],
  ["lastmonth", "Last month"],
  ["custom", "Custom"],
] as const;
export type Preset = (typeof PRESETS)[number][0];
export const DEFAULT_PRESET: Preset = "30d";
/** Longer ranges show weeks instead of days in the By day view. */
export const MAX_DAY_ROWS = 92;

const DAY = 86_400_000;
const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const ymdAdd = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const ymdDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export interface DateRange {
  preset: Preset;
  from: string;
  to: string;
  /** "9 Nov to 9 Nov 2026". */
  label: string;
  /** Set when the custom dates were not usable (the default range is used instead). */
  error: string | null;
  /** Number of days in the range (both days included). */
  days: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (ymd: string) => `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
/** "9 Nov to 9 Nov 2026", "28 Dec 2025 to 3 Jan 2026". */
export function rangeLabel(from: string, to: string): string {
  const fy = from.slice(0, 4), ty = to.slice(0, 4);
  return fy === ty ? `${dm(from)} to ${dm(to)} ${ty}` : `${dm(from)} ${fy} to ${dm(to)} ${ty}`;
}

function presetRange(p: Exclude<Preset, "custom">, today: string): [string, string] {
  switch (p) {
    case "today": return [today, today];
    case "yesterday": return [ymdAdd(today, -1), ymdAdd(today, -1)];
    case "7d": return [ymdAdd(today, -6), today];
    case "30d": return [ymdAdd(today, -29), today];
    case "month": return [`${today.slice(0, 7)}-01`, today];
    case "lastmonth": {
      const first = `${today.slice(0, 7)}-01`;
      const lastDay = ymdAdd(first, -1);
      return [`${lastDay.slice(0, 7)}-01`, lastDay];
    }
  }
}

/**
 * The dates filter from the URL. Custom needs both days, not in the future, and To not before From;
 * otherwise the default (Last 30 days) is used and `error` says why. Dates are Philippine dates.
 */
export function parseRange(sp: { range?: string; from?: string; to?: string }, today: string): DateRange {
  const preset = (PRESETS.some(([k]) => k === sp.range) ? sp.range : sp.from || sp.to ? "custom" : DEFAULT_PRESET) as Preset;
  const make = (p: Preset, from: string, to: string, error: string | null = null): DateRange => ({ preset: p, from, to, label: rangeLabel(from, to), error, days: ymdDiff(from, to) + 1 });
  if (preset !== "custom") {
    const [from, to] = presetRange(preset, today);
    return make(preset, from, to);
  }
  const fallback = (error: string) => { const [f, t] = presetRange("30d", today); return make(DEFAULT_PRESET, f, t, error); };
  if (!isYmd(sp.from) || !isYmd(sp.to)) return fallback("Pick both the From and the To date.");
  if (sp.from > today || sp.to > today) return fallback("Dates cannot be in the future.");
  if (sp.to < sp.from) return fallback("\"To\" cannot be before \"From\".");
  return make("custom", sp.from, sp.to);
}

export interface Bucket {
  key: string; // first day of the bucket
  from: string;
  to: string;
  label: string;
}

/** Monday of the week of a date. */
export function weekStart(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 Sunday
  return ymdAdd(ymd, -((dow + 6) % 7));
}

/** One bucket per day, or per week (Monday to Sunday, cut to the range) when the range is over 92 days. */
export function buckets(from: string, to: string): { unit: "day" | "week"; rows: Bucket[] } {
  const days = ymdDiff(from, to) + 1;
  const rows: Bucket[] = [];
  if (days <= MAX_DAY_ROWS) {
    for (let d = from; d <= to; d = ymdAdd(d, 1)) rows.push({ key: d, from: d, to: d, label: dayLabel(d) });
    return { unit: "day", rows };
  }
  for (let w = weekStart(from); w <= to; w = ymdAdd(w, 7)) {
    const a = w < from ? from : w;
    const b = ymdAdd(w, 6) > to ? to : ymdAdd(w, 6);
    rows.push({ key: w, from: a, to: b, label: `Week of ${dm(a)}${a.slice(0, 4) !== to.slice(0, 4) ? ` ${a.slice(0, 4)}` : ""}` });
  }
  return { unit: "week", rows };
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const dayLabel = (ymd: string) => `${DOW[new Date(`${ymd}T00:00:00Z`).getUTCDay()]} ${dm(ymd)}`;

/** The bucket a date falls in. */
export const bucketOf = (ymd: string, unit: "day" | "week") => (unit === "day" ? ymd : weekStart(ymd));

// ---------------------------------------------------------------------------
// Business days, fast
// ---------------------------------------------------------------------------

/**
 * Business days between two instants (counted like the TAT clock: the days after the first PHT date
 * up to and including the second; the same day is 0). Precomputes a running count for a date range
 * so thousands of jobs cost one lookup each.
 */
export function businessDayCounter(holidays: ReadonlySet<string>, from: string, to: string) {
  const index = new Map<string, number>();
  let n = 0;
  for (let d = from; d <= to; d = ymdAdd(d, 1)) {
    if (isBusinessDay(d, holidays)) n++;
    index.set(d, n);
  }
  const at = (ymd: string): number => {
    const v = index.get(ymd);
    if (v !== undefined) return v;
    // Outside the precomputed range (rare): count the slow way from `from`.
    if (ymd < from) return (index.get(from) ?? 0) - countBetween(ymd, from, holidays);
    return n + countBetween(to, ymd, holidays);
  };
  return (a: Date, b: Date): number => {
    const x = phtDate(a), y = phtDate(b);
    return y <= x ? 0 : at(y) - at(x);
  };
}

function countBetween(a: string, b: string, holidays: ReadonlySet<string>): number {
  let c = 0;
  for (let d = ymdAdd(a, 1); d <= b; d = ymdAdd(d, 1)) if (isBusinessDay(d, holidays)) c++;
  return c;
}

/** Average to one decimal (null when there is nothing to average). */
export const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

/** "1.5 days" / "1 day" / "-". */
export const daysText = (n: number | null) => (n === null ? "-" : `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? "" : "s"}`);

/** Kept for symmetry with the TAT helpers: the due date of a target from a start date. */
export const dueDate = (startYmd: string, target: number, holidays: ReadonlySet<string>) => addBusinessDays(startYmd, target, holidays);
