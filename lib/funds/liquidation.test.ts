import { describe, expect, it } from "vitest";
import { daysFor, DEFAULT_WORKING_WEEKDAYS } from "@/lib/calendar/core";
import { daysLate, liquidationDueOf, liquidationLine, type LiqInput, type LiqLine } from "./liquidation";

/**
 * D-044: the liquidation due date, the worked examples (as corrected by the user) and the six decisions, and the
 * days-late record across a Saturday, a Sunday, a holiday and a branch closure. Nov 2026: Mon 23 ... Mon 30.
 */
const ANGONO = "b-angono", PASIG = "b-pasig";
const plain = daysFor({ workingWeekdays: DEFAULT_WORKING_WEEKDAYS, entries: [] }, null);
const txn = (doneDay: string | null, extra: Partial<LiqLine> = {}): LiqLine => ({ kind: "TXN", doneDay, cancelledDay: null, jobDueDay: null, ...extra });
const run = (lines: LiqLine[], over: Partial<LiqInput> = {}) =>
  liquidationDueOf({ n: 2, releasedDay: "2026-11-23", lines, today: "2026-11-24", days: plain, saved: { due: null, basis: null }, ...over });

describe("the worked examples (D-044)", () => {
  it("1. one advance, one transaction: pickup Wed 25 -> due Fri 27; before the pickup, no date", () => {
    expect(run([txn(null)])).toEqual({ state: "waiting", left: 1, total: 1 });
    expect(run([txn("2026-11-25")])).toMatchObject({ state: "due", due: "2026-11-27", basis: "LTO" });
  });

  it("2. three transactions, pickups Tue 24, Thu 26, Mon 30: no date until the last; then Wed 2 Dec", () => {
    expect(run([txn("2026-11-24"), txn("2026-11-26"), txn(null)])).toEqual({ state: "waiting", left: 1, total: 3 });
    expect(run([txn("2026-11-24"), txn("2026-11-26"), txn("2026-11-30")])).toMatchObject({ due: "2026-12-02", anchor: "2026-11-30" });
  });

  it("3. an LTO redone or cancelled after the date was saved: the saved date stays", () => {
    const saved = { due: "2026-11-27", basis: "LTO" as const };
    expect(run([txn("2026-12-01")], { saved })).toMatchObject({ due: "2026-11-27", basis: "LTO" });
    expect(run([txn(null, { cancelledDay: "2026-12-01" })], { saved })).toMatchObject({ due: "2026-11-27" });
  });

  it("4. a transaction cancelled before its LTO: N after the later of the last pickup and the cancellation", () => {
    expect(run([txn("2026-11-24"), txn(null, { cancelledDay: "2026-11-26" })])).toMatchObject({ due: "2026-11-28", basis: "CANCELLED" }); // Sat counts
    // All lines cancelled: N after the last cancellation.
    expect(run([txn(null, { cancelledDay: "2026-11-24" }), txn(null, { cancelledDay: "2026-11-25" })])).toMatchObject({ due: "2026-11-27", basis: "CANCELLED" });
  });

  it("5. due Fri 27, liquidated Mon 30: 2 working days late (Sat 28 and Mon 30)", () => {
    expect(daysLate("2026-11-27", "2026-11-30", plain)).toBe(2);
    expect(daysLate("2026-11-27", "2026-11-27", plain)).toBe(0);
    expect(daysLate("2026-11-27", "2026-11-26", plain)).toBe(0);
  });

  it("6. CA vs FT: the same pickup Wed 25; CA N = 2 -> Fri 27, FT N = 3 -> Sat 28", () => {
    expect(run([txn("2026-11-25")], { n: 2 })).toMatchObject({ due: "2026-11-27" });
    expect(run([txn("2026-11-25")], { n: 3 })).toMatchObject({ due: "2026-11-28" });
  });
});

describe("the other decisions (D-044)", () => {
  it("a note-only line: N after the release", () => {
    expect(run([{ kind: "NOTE", doneDay: null, cancelledDay: null, jobDueDay: null }])).toMatchObject({ due: "2026-11-25", basis: "RELEASE" });
  });

  it("fallback: a stuck job (TAT due Thu 26, today Fri 27): due Thu 26 + 2 = Sat 28; not before the TAT due date passes", () => {
    const stuck = [txn(null, { jobDueDay: "2026-11-26" })];
    expect(run(stuck, { today: "2026-11-26" })).toMatchObject({ state: "waiting" });
    expect(run(stuck, { today: "2026-11-27" })).toMatchObject({ state: "due", due: "2026-11-28", basis: "FALLBACK" });
  });

  it("fallback moves with the TAT due date (a pausing hold moved it to Tue 1 Dec)", () => {
    const held = [txn(null, { jobDueDay: "2026-12-01" })];
    expect(run(held, { today: "2026-11-27" })).toMatchObject({ state: "waiting" });
    expect(run(held, { today: "2026-12-02", saved: { due: "2026-11-28", basis: "FALLBACK" } })).toMatchObject({ due: "2026-12-03", basis: "FALLBACK" });
  });

  it("an LTO done after the fallback date: the fallback date stays", () => {
    expect(run([txn("2026-11-30")], { saved: { due: "2026-11-28", basis: "FALLBACK" } })).toMatchObject({ due: "2026-11-28", basis: "FALLBACK" });
  });

  it("no fallback while a pending line has no accepted job yet", () => {
    expect(run([txn(null, { jobDueDay: "2026-11-20" }), txn(null)], { today: "2026-11-27" })).toMatchObject({ state: "waiting", left: 2 });
  });
});

describe("days late across non-working days (D-044)", () => {
  const cal = (entries: { date: string; allBranches: boolean; branchIds: string[] }[]) => ({ workingWeekdays: DEFAULT_WORKING_WEEKDAYS, entries });
  it("across a Saturday (a working day): due Fri 27, liquidated Mon 30 = 2", () => {
    expect(daysLate("2026-11-27", "2026-11-30", plain)).toBe(2);
  });
  it("across a Sunday: due Sat 28, liquidated Mon 30 = 1", () => {
    expect(daysLate("2026-11-28", "2026-11-30", plain)).toBe(1);
  });
  it("across a holiday (sample Sat 28): due Fri 27, liquidated Mon 30 = 1", () => {
    expect(daysLate("2026-11-27", "2026-11-30", daysFor(cal([{ date: "2026-11-28", allBranches: true, branchIds: [] }]), null))).toBe(1);
  });
  it("across a branch closure (Angono, Sat 28): Angono 1, Pasig 2", () => {
    const c = cal([{ date: "2026-11-28", allBranches: false, branchIds: [ANGONO] }]);
    expect(daysLate("2026-11-27", "2026-11-30", daysFor(c, ANGONO))).toBe(1);
    expect(daysLate("2026-11-27", "2026-11-30", daysFor(c, PASIG))).toBe(2);
  });
});

describe("the one line in plain words (D-044)", () => {
  const base = { status: "RELEASED", dueText: null, basis: null, note: "", daysLate: null, n: 2, mustLiquidate: true };
  it("waiting, due, fallback, late, on time, no receipts", () => {
    expect(liquidationLine({ ...base, note: "1 of 3 left" })).toBe("Due 2 working days after the LTO pickup (1 of 3 left)");
    expect(liquidationLine({ ...base, dueText: "Nov 27, 2026", basis: "LTO" })).toBe("Due Nov 27, 2026");
    expect(liquidationLine({ ...base, dueText: "Nov 28, 2026", basis: "FALLBACK" })).toBe("LTO not done. Liquidation due by fallback: Nov 28, 2026");
    expect(liquidationLine({ ...base, status: "LIQUIDATED", daysLate: 2 })).toBe("Liquidated 2 working days late");
    expect(liquidationLine({ ...base, status: "CLOSED", daysLate: 0 })).toBe("Liquidated on time");
    expect(liquidationLine({ ...base, mustLiquidate: false })).toBe("No receipts needed for this type");
  });
});
