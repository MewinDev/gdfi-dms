import { describe, expect, it } from "vitest";
import { dateMap, rebaseSql, shiftBusinessDays, YMD_COLUMNS } from "./rebase";

const H = new Set(["2026-11-30"]); // Bonifacio Day (a Monday)

describe("Re-basing the sample dates on restore", () => {
  it("moves by business days, both ways, skipping weekends and holidays", () => {
    expect(shiftBusinessDays("2026-11-06", 1, H)).toBe("2026-11-09"); // Fri -> Mon
    expect(shiftBusinessDays("2026-11-09", -1, H)).toBe("2026-11-06"); // Mon -> Fri
    expect(shiftBusinessDays("2026-11-27", 1, H)).toBe("2026-12-01"); // Fri -> Tue (Mon is a holiday)
    expect(shiftBusinessDays("2026-12-01", -1, H)).toBe("2026-11-27");
    expect(shiftBusinessDays("2026-11-04", 0, H)).toBe("2026-11-04");
  });

  it("a loan released 2 business days before the save is again 2 business days before today", () => {
    const saved = "2026-11-04"; // Wednesday
    const today = "2026-11-11"; // the next Wednesday: 5 business days later
    const m = dateMap(saved, today, H);
    expect(m.get("2026-11-02")).toBe("2026-11-09"); // Mon -> Mon
    expect(m.get(saved)).toBe(today);
    // Across the holiday: saved Fri 27 Nov, restored Tue 1 Dec = 1 business day.
    const m2 = dateMap("2026-11-27", "2026-12-01", H);
    expect(m2.get("2026-11-26")).toBe("2026-11-27");
    expect(m2.get("2026-11-27")).toBe("2026-12-01");
  });

  it("a weekend date keeps its distance from the business day before it", () => {
    const m = dateMap("2026-11-04", "2026-11-05", H);
    expect(m.get("2026-11-07")).toBe("2026-11-10"); // Sat after Fri 6 -> the day after Mon 9
  });

  it("saved today: nothing to move", () => {
    expect(dateMap("2026-11-04", "2026-11-04", H).size).toBe(0);
    expect(rebaseSql(new Map(), YMD_COLUMNS)).toBe("");
  });

  it("one transaction: every timestamp (Manila date = UTC + 8 hours), the text dates and the sample MyLoans dates; never the holidays", () => {
    const sql = rebaseSql(dateMap("2026-11-04", "2026-11-05", H), [{ table: "Loan", column: "releasedAt", kind: "timestamp" }, ...YMD_COLUMNS]);
    expect(sql.startsWith("BEGIN;")).toBe(true);
    expect(sql.trim().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain(`UPDATE "Loan" x SET "releasedAt" = x."releasedAt" + (m.nd - m.d) * interval '1 day'`);
    expect(sql).toContain(`(x."releasedAt" + interval '8 hours')::date`);
    for (const c of ["TransactionAttempt", "Receipt", "CashReturn", "Hold"]) expect(sql).toContain(`UPDATE "${c}"`);
    expect(sql).toContain("'myloans.mockExtra'");
    expect(sql).not.toContain("HolidayCalendar");
  });
});
