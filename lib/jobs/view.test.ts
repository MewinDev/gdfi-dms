import { describe, expect, it } from "vitest";
import { problemDays, stepClock, tatChip, txnStepKey } from "@/lib/workflow/tat";
import { txnTat } from "./view";

const at = (d: string) => new Date(`${d}T10:00:00+08:00`);
const none = new Set<string>();
const tats = new Map([["P4_MORTGAGE", { businessDays: 5, note: "", label: "" }], ["P4_ACCEPT", { businessDays: 0, note: "", label: "" }]]);

describe("The TAT clock never pauses", () => {
  it("is the same with and without a problem", () => {
    const now = at("2026-11-06");
    const base = { status: "IN_PROCESS", statusSince: at("2026-11-02"), fundsNeeded: "NO" as const, type: { code: "MORTGAGE" }, advanceLines: [] };
    const clean = txnTat({ ...base, problems: [] }, tats, none, now)!;
    const withProblem = txnTat({ ...base, problems: [{ raisedAt: at("2026-11-03"), resolvedAt: null, reason: { name: "LTO offline" } }] }, tats, none, now)!;
    expect(clean.text).toBe("Processing · Day 4 of 5");
    expect(withProblem.state).toBe("problem");
    expect(withProblem.text).toContain("Day 4 of 5"); // same day count: no pausing
    expect(stepClock({ targetDays: 5, start: at("2026-11-02") }, none, now)).toEqual(stepClock({ targetDays: 5, start: at("2026-11-02") }, none, now));
  });
});

describe("Problem time", () => {
  it("is the sum of each problem's business days, holidays skipped, open ones still counting", () => {
    const holidays = new Set(["2026-11-04"]);
    const ps = [
      { raisedAt: at("2026-11-02"), resolvedAt: at("2026-11-03") }, // 1
      { raisedAt: at("2026-11-03"), resolvedAt: at("2026-11-05") }, // 2 days, minus the Wed holiday = 1
      { raisedAt: at("2026-11-05"), resolvedAt: null }, // open: Thu → Mon = 2
    ];
    expect(problemDays(ps, holidays, at("2026-11-09"))).toBe(4);
  });
});

describe("TatChip mapping", () => {
  const today = "2026-11-06";
  const c = (start: string, target: number | null, end?: string) => stepClock({ targetDays: target, start: at(start), end: end ? at(end) : null }, none, at(end ?? today));
  it("Waiting (no target)", () => expect(tatChip(c("2026-11-04", null), today)).toEqual({ state: "waiting", text: "Waiting · 2 days" }));
  it("Processing", () => expect(tatChip(c("2026-11-05", 5), today).text).toBe("Processing · Day 1 of 5"));
  it("Due today", () => expect(tatChip(c("2026-10-30", 5), today)).toEqual({ state: "due", text: "Due today · Day 5 of 5" }));
  it("Overdue", () => expect(tatChip(c("2026-10-29", 5), today)).toEqual({ state: "overdue", text: "+1 day late" }));
  it("Problem (also late)", () => {
    const chip = tatChip(c("2026-10-29", 5), today, { open: true, days: 2, reason: "LTO offline" });
    expect(chip.state).toBe("problem");
    expect(chip.text).toBe("Problem 2 days · LTO offline · Day 5 of 5");
    expect(chip.lateText).toBe("+1 day late");
  });
  it("Done on time and done late", () => {
    expect(tatChip(c("2026-11-02", 5, "2026-11-05"), today).text).toBe("Done on time");
    expect(tatChip(c("2026-10-26", 5, "2026-11-06"), today).text).toBe("Done · 4 days late");
  });
  it("TAT keys for each job step exist", () => {
    expect(txnStepKey("ASSIGNED", "NOTARY")).toBe("P4_ACCEPT");
    expect(txnStepKey("IN_PROCESS", "NOTARY")).toBe("P4_NOTARY");
    expect(txnStepKey("IN_PROCESS", "PPSR")).toBe("P4_PPSR");
    expect(txnStepKey("IN_PROCESS", "MORTGAGE")).toBe("P4_MORTGAGE");
    expect(txnStepKey("FORWARDED", "MORTGAGE")).toBe("P5_ACCEPT");
    expect(txnStepKey("COMPLETED", "MORTGAGE")).toBeNull();
  });
});
