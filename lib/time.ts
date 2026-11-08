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
export function businessDate(d: Date, tz: string = APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return parts; // en-CA formats as YYYY-MM-DD
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isWeekend(ymd: string): boolean {
  const day = parseYmd(ymd).getUTCDay();
  return day === 0 || day === 6;
}

export function isBusinessDay(ymd: string, holidays: ReadonlySet<string>): boolean {
  return !isWeekend(ymd) && !holidays.has(ymd);
}

/** Adds n business days (skipping weekends and holidays). n = 0 returns the same date. */
export function addBusinessDays(ymd: string, n: number, holidays: ReadonlySet<string> = new Set()): string {
  let d = parseYmd(ymd);
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + 86_400_000);
    if (isBusinessDay(formatYmd(d), holidays)) left--;
  }
  return formatYmd(d);
}

/** Business days from a to b (positive when b is after a). Counts days after a up to and including b. */
export function businessDaysBetween(a: string, b: string, holidays: ReadonlySet<string> = new Set()): number {
  if (a === b) return 0;
  const sign = a < b ? 1 : -1;
  let [from, to] = sign > 0 ? [a, b] : [b, a];
  let count = 0;
  let d = parseYmd(from);
  const end = parseYmd(to);
  while (d < end) {
    d = new Date(d.getTime() + 86_400_000);
    if (isBusinessDay(formatYmd(d), holidays)) count++;
  }
  from = to = "";
  return sign * count;
}

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

/** Calendar-day offset helper used by the mock data (relative release dates). */
export function businessDaysAgo(n: number, from: Date = new Date(), holidays: ReadonlySet<string> = new Set()): string {
  let d = parseYmd(businessDate(from));
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() - 86_400_000);
    if (isBusinessDay(formatYmd(d), holidays)) left--;
  }
  return formatYmd(d);
}

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

export function fmtPeso(n: number | string | { toString(): string }): string {
  const v = typeof n === "number" ? n : Number(n.toString());
  return "PHP " + v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
