/**
 * Business calendar helpers. Dates are handled as YYYY-MM-DD strings in the business time zone
 * (Philippine time, Asia/Manila) so "today", "Day 2" and holidays never drift with the server's or
 * the browser's own time zone. Instants are stored in UTC; every date and time shown uses PHT.
 */

/** The one app time zone: Philippine time. Fixed on purpose (the server's own zone never matters). */
export const APP_TIMEZONE = "Asia/Manila";
/** Short label shown after times. */
export const APP_TZ_LABEL = "PHT";
/** UTC offset of Philippine time (no daylight saving time). */
export const APP_TZ_OFFSET = "+08:00";

/** The instant a Manila calendar day starts (00:00 PHT). */
export function startOfBusinessDay(ymd: string): Date {
  return new Date(`${ymd}T00:00:00${APP_TZ_OFFSET}`);
}
/** The last second of a Manila calendar day (23:59:59 PHT). */
export function endOfBusinessDay(ymd: string): Date {
  return new Date(`${ymd}T23:59:59${APP_TZ_OFFSET}`);
}
/** Noon of a Manila calendar day: a safe instant to format a YYYY-MM-DD date. */
export function noonOfBusinessDay(ymd: string): Date {
  return new Date(`${ymd}T12:00:00${APP_TZ_OFFSET}`);
}

/** YYYY-MM-DD for an instant, in the business time zone. */
const ymdFormatters = new Map<string, Intl.DateTimeFormat>();
export function businessDate(d: Date, tz: string = APP_TIMEZONE): string {
  // One formatter per time zone (building one is slow; reports call this thousands of times).
  let f = ymdFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    ymdFormatters.set(tz, f);
  }
  return f.format(d); // en-CA formats as YYYY-MM-DD
}

// Day counting (working days, holidays, closures) lives ONLY in lib/calendar (D-018, D-041).

export type TatBadge = "ON_TIME" | "DUE_TODAY" | "OVERDUE";

/** TAT badge for a deadline date compared with today (both YYYY-MM-DD). */
export function tatBadge(deadline: string, today: string): TatBadge {
  if (today > deadline) return "OVERDUE";
  if (today === deadline) return "DUE_TODAY";
  return "ON_TIME";
}

export const TAT_LABEL: Record<TatBadge, string> = {
  ON_TIME: "On time",
  DUE_TODAY: "Due today",
  OVERDUE: "Overdue",
};

// The one shared formatter: "Nov 7, 2026, 9:12 AM PHT" (long) and "Nov 7, 9:12 AM" (short), always in PHT.
const longFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const shortFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIMEZONE, year: "numeric", month: "short", day: "numeric" });
const toDate = (d: Date | string) => (typeof d === "string" ? (d.length === 10 ? noonOfBusinessDay(d) : new Date(d)) : d);

/** "Nov 7, 2026, 9:12 AM PHT". */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "-";
  return `${longFmt.format(toDate(d)).replace(/ /g, " ")} ${APP_TZ_LABEL}`;
}

/** "Nov 7, 9:12 AM" (PHT, for compact rows). */
export function fmtShort(d: Date | string | null | undefined): string {
  if (!d) return "-";
  return shortFmt.format(toDate(d)).replace(/ /g, " ");
}

/** "Nov 7, 2026" (PHT calendar day). Accepts a Date or YYYY-MM-DD. */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "-";
  return dateFmt.format(toDate(d));
}

/** "3 h", "2 d" style elapsed text. */
export function elapsed(since: Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - since.getTime());
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
