import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-018, D-041: ONE calendar. No code outside lib/calendar decides what a working day is: no weekday checks,
 * no holiday sets, none of the removed helpers. (Formatting a weekday NAME for display is allowed.)
 */
const ROOT = process.cwd();
const FORBIDDEN: [RegExp, string][] = [
  [/\b(isBusinessDay|addBusinessDays|businessDaysBetween|businessDaysAgo|isWeekend|getHolidaySet)\b/, "a removed day-counting helper"],
  [/\.getU?T?C?Day\(\)\s*(===|!==|==|!=|<|>|%|\))|\[\s*0\s*,\s*6\s*\]\.includes|day === 0 \|\| day === 6/, "a weekday check"],
  [/holidayCalendar\.findMany\(\{[^}]*select:\s*\{\s*date: true\s*\}/, "its own holiday set"],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n.startsWith(".") ? [] : files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("one calendar: no other day counting", () => {
  it("nothing outside lib/calendar counts working days its own way", () => {
    const hits: string[] = [];
    for (const d of ["app", "components", "lib", "scripts", "prisma"]) {
      for (const f of files(path.join(ROOT, d))) {
        const rel = path.relative(ROOT, f).split(path.sep).join("/");
        if (rel.startsWith("lib/calendar/")) continue;
        const s = readFileSync(f, "utf8");
        for (const [re, what] of FORBIDDEN) if (re.test(s)) hits.push(`${rel}: ${what}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
