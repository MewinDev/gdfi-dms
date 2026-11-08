import { addBusinessDays, businessDaysBetween, isBusinessDay } from "@/lib/time";
import { ident, lit } from "./docker";

/**
 * Keeps the sample dates right after a reset or restore. The baseline remembers the Manila date it was
 * saved on. When it is put back on a later day, every date moves forward by the same number of BUSINESS
 * days (weekends and holidays skipped), keeping the time of day. So a loan released "2 business days
 * before the kit started" is again released 2 business days ago, and its TAT shows the same way
 * (On time, Due today, Late). Holidays (the calendar itself) never move.
 */

const DAY = 86_400_000;
const ymdAdd = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** n business days after (n > 0) or before (n < 0) a date. */
export function shiftBusinessDays(ymd: string, n: number, holidays: ReadonlySet<string>): string {
  if (n >= 0) return addBusinessDays(ymd, n, holidays);
  let d = ymd;
  let left = -n;
  while (left > 0) {
    d = ymdAdd(d, -1);
    if (isBusinessDay(d, holidays)) left--;
  }
  return d;
}

/**
 * Old date to new date, for every date from `span` days before to `span` days after the saved date. A
 * business day moves by `shift` business days; a weekend or holiday keeps its distance from the
 * business day before it.
 */
export function dateMap(savedOn: string, today: string, holidays: ReadonlySet<string>, span = 400): Map<string, string> {
  const shift = businessDaysBetween(savedOn, today, holidays);
  const map = new Map<string, string>();
  if (shift === 0) return map;
  for (let i = -span; i <= span; i++) {
    const d = ymdAdd(savedOn, i);
    let p = d;
    let gap = 0;
    while (!isBusinessDay(p, holidays)) { p = ymdAdd(p, -1); gap++; }
    map.set(d, ymdAdd(shiftBusinessDays(p, shift, holidays), gap));
  }
  return map;
}

export interface DateColumn { table: string; column: string; kind: "timestamp" | "ymd" }

/** Columns that hold a YYYY-MM-DD date as text (the holiday calendar is not one of them on purpose). */
export const YMD_COLUMNS: DateColumn[] = [
  { table: "TransactionAttempt", column: "date", kind: "ymd" },
  { table: "Receipt", column: "date", kind: "ymd" },
  { table: "CashReturn", column: "date", kind: "ymd" },
  { table: "Hold", column: "expectedResumeOn", kind: "ymd" },
];

/**
 * One SQL script (one transaction): a temporary table of old and new dates, then every timestamp
 * column (stored in UTC; the Manila date is UTC + 8 hours) and every YYYY-MM-DD text column moved by
 * its own date's difference.
 */
export function rebaseSql(map: Map<string, string>, columns: DateColumn[]): string {
  if (!map.size) return "";
  const rows = [...map].filter(([a, b]) => a !== b).map(([a, b]) => `(${lit(a)}::date, ${lit(b)}::date)`);
  const lines = [
    "BEGIN;",
    "CREATE TEMP TABLE kit_dates (d date PRIMARY KEY, nd date NOT NULL) ON COMMIT DROP;",
    `INSERT INTO kit_dates VALUES ${rows.join(",\n")};`,
  ];
  for (const c of columns) {
    const t = ident(c.table);
    const col = ident(c.column);
    if (c.kind === "timestamp") {
      lines.push(`UPDATE ${t} x SET ${col} = x.${col} + (m.nd - m.d) * interval '1 day' FROM kit_dates m WHERE x.${col} IS NOT NULL AND m.d = (x.${col} + interval '8 hours')::date;`);
    } else {
      lines.push(`UPDATE ${t} x SET ${col} = to_char(m.nd, 'YYYY-MM-DD') FROM kit_dates m WHERE m.d::text = x.${col};`);
    }
  }
  // The sample MyLoans loans (Setting myloans.mockExtra) carry their own release dates: moved the same way.
  lines.push(`UPDATE "Setting" s SET value = (SELECT jsonb_agg(CASE WHEN m.nd IS NOT NULL THEN jsonb_set(e, '{releaseDate}', to_jsonb(to_char(m.nd, 'YYYY-MM-DD'))) ELSE e END ORDER BY t.ord) FROM jsonb_array_elements(s.value) WITH ORDINALITY AS t(e, ord) LEFT JOIN kit_dates m ON m.d::text = e->>'releaseDate') WHERE s.key = 'myloans.mockExtra' AND jsonb_typeof(s.value) = 'array' AND jsonb_array_length(s.value) > 0;`);
  lines.push("COMMIT;");
  return lines.join("\n");
}
