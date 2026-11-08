import { describe, expect, it } from "vitest";
import {
  advanceBalance, ageBucket, bandFor, carryOverDecision, fundsDone, fundsStatus, isOverdue, lineBalance, liquidationDue, liquidationStatus, peso, toCents,
} from "./rules";

describe("Money in centavos", () => {
  it("formats pesos with two decimals", () => {
    expect(peso(1250000)).toBe("₱12,500.00");
    expect(peso(5)).toBe("₱0.05");
  });
  it("reads typed amounts without floating-point drift", () => {
    expect(toCents("12,500.00")).toBe(1250000);
    expect(toCents("0.1")).toBe(10);
    expect(toCents("1.005")).toBeNull();
    expect(toCents("abc")).toBeNull();
  });
});

describe("Funds status (from the LA flag and the advance lines)", () => {
  const line = (advanceStatus: string, releasedCents = 0, denied = false) => ({ advanceStatus, releasedCents, denied });
  it("No and unanswered mean not needed", () => {
    expect(fundsStatus("NO", [])).toBe("NOT_NEEDED");
    expect(fundsStatus("UNANSWERED", [])).toBe("NOT_NEEDED");
  });
  it("follows the advance: needed → requested → funded → settled", () => {
    expect(fundsStatus("YES", [])).toBe("NEEDED");
    expect(fundsStatus("YES", [line("REQUESTED")])).toBe("REQUESTED");
    expect(fundsStatus("YES", [line("APPROVED")])).toBe("REQUESTED");
    expect(fundsStatus("YES", [line("RELEASED", 5000)])).toBe("FUNDED");
    expect(fundsStatus("YES", [line("LIQUIDATED", 5000)])).toBe("SETTLED");
    expect(fundsStatus("YES", [line("CLOSED", 5000)])).toBe("SETTLED");
  });
  it("a denied line makes the transaction Denied (No funds)", () => {
    expect(fundsStatus("YES", [line("DENIED", 0, true)])).toBe("DENIED");
    expect(fundsStatus("YES", [line("APPROVED", 0, true)])).toBe("DENIED");
  });
  it("the stage gate passes only when settled or not needed", () => {
    expect(fundsDone("NOT_NEEDED")).toBe(true);
    expect(fundsDone("SETTLED")).toBe(true);
    for (const s of ["NEEDED", "REQUESTED", "FUNDED", "DENIED"] as const) expect(fundsDone(s)).toBe(false);
  });
});

describe("Liquidation maths", () => {
  it("balance = released − receipts − returned", () => {
    expect(advanceBalance({ releasedCents: 300000, receiptCents: 120000, returnedCents: 30000 })).toBe(150000);
    expect(lineBalance({ releasedCents: 100000, spentCents: 40000, returnedCents: 0 })).toBe(60000);
  });
  it("status: released → partly → liquidated", () => {
    expect(liquidationStatus({ releasedCents: 100000, receiptCents: 0, returnedCents: 0, status: "RELEASED" })).toBe("RELEASED");
    expect(liquidationStatus({ releasedCents: 100000, receiptCents: 40000, returnedCents: 0, status: "RELEASED" })).toBe("PARTIALLY_LIQUIDATED");
    expect(liquidationStatus({ releasedCents: 100000, receiptCents: 60000, returnedCents: 40000, status: "PARTIALLY_LIQUIDATED" })).toBe("LIQUIDATED");
  });
  it("due date counts business days and skips holidays", () => {
    // Fri 2026-11-06 + 10 business days, with Mon 2026-11-09 a holiday → Mon 2026-11-23.
    const due = liquidationDue(new Date("2026-11-06T09:00:00+08:00"), 10, new Set(["2026-11-09"]));
    expect(due.toISOString().slice(0, 10)).toBe("2026-11-23");
  });
  it("overdue only for an open advance past its due date", () => {
    const now = new Date("2026-11-20T09:00:00+08:00");
    expect(isOverdue({ status: "RELEASED", liquidationDueAt: new Date("2026-11-19T00:00:00Z") }, now)).toBe(true);
    expect(isOverdue({ status: "LIQUIDATED", liquidationDueAt: new Date("2026-11-19T00:00:00Z") }, now)).toBe(false);
    expect(isOverdue({ status: "RELEASED", liquidationDueAt: new Date("2026-11-25T00:00:00Z") }, now)).toBe(false);
  });
});

describe("Carry-over and approval bands", () => {
  const holidays = new Set<string>();
  it("first carry-over and within the limit are automatic; beyond it needs approval", () => {
    const first = new Date("2026-11-02T09:00:00+08:00"); // Mon
    expect(carryOverDecision({ balanceCents: 5000, firstCarryOver: null, now: first, limitDays: 3, holidays }).status).toBe("AUTO");
    expect(carryOverDecision({ balanceCents: 5000, firstCarryOver: first, now: new Date("2026-11-05T09:00:00+08:00"), limitDays: 3, holidays }).status).toBe("AUTO");
    const late = carryOverDecision({ balanceCents: 5000, firstCarryOver: first, now: new Date("2026-11-06T09:00:00+08:00"), limitDays: 3, holidays });
    expect(late).toEqual({ status: "PENDING", businessDays: 4 });
  });
  it("the band with the highest 'from' at or below the amount decides", () => {
    const bands = [{ fromCents: 0, roleId: "FIN", active: true }, { fromCents: 5000000, roleId: "HEAD", active: true }, { fromCents: 1000000, roleId: "OLD", active: false }];
    expect(bandFor(100000, bands)?.roleId).toBe("FIN");
    expect(bandFor(4999999, bands)?.roleId).toBe("FIN");
    expect(bandFor(5000000, bands)?.roleId).toBe("HEAD");
  });
  it("age buckets", () => {
    expect([0, 10, 11, 30, 31, 60, 61].map(ageBucket)).toEqual(["0-10", "0-10", "11-30", "11-30", "31-60", "31-60", "60+"]);
  });
});
