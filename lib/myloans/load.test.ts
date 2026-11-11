import { beforeEach, describe, expect, it } from "vitest";
import { jitteredPause, nextCap, nextCheckAt, tierOf } from "./tiers";
import { beginStats, callsThisHour, lookupPn, MemoryCallStore, readStats, resetClient, setCallStore } from "./client";
import type { MyLoansAdapter, MyLoansLookup } from "./types";

describe("Tiers", () => {
  it("A work in progress, B not yet sent, C finished but not closed; closed and cancelled never", () => {
    expect(tierOf("In process")).toBe("A");
    expect(tierOf("Assigned to DP")).toBe("A");
    expect(tierOf("For checklist", { openReview: true })).toBe("A");
    expect(tierOf("For checklist", { cashOut: true })).toBe("A");
    expect(tierOf("For checklist")).toBe("B");
    expect(tierOf("No DP assignment required")).toBe("B");
    expect(tierOf("In Safekeeping")).toBe("C");
    expect(tierOf("For Vault Transmittal")).toBe("C");
    for (const s of ["Closed", "Archived", "Disposed", "Cancelled in MyLoans"]) expect(tierOf(s)).toBeNull();
    expect(tierOf("In process", { cancelled: true })).toBeNull();
  });
  it("each tier at its own interval", () => {
    const now = new Date("2026-11-09T02:00:00Z");
    expect(nextCheckAt(now, "A")!.toISOString()).toBe("2026-11-09T03:00:00.000Z");
    expect(nextCheckAt(now, "B")!.toISOString()).toBe("2026-11-09T06:00:00.000Z");
    expect(nextCheckAt(now, "C")!.toISOString()).toBe("2026-11-10T02:00:00.000Z");
    expect(nextCheckAt(now, null)).toBeNull();
    expect(nextCheckAt(now, "A", { A: 15, B: 1, C: 1 })!.toISOString()).toBe("2026-11-09T02:15:00.000Z");
  });
  it("jitter stays between the pause and one and a half times it", () => {
    for (let i = 0; i <= 10; i++) {
      const p = jitteredPause(400, i / 10);
      expect(p).toBeGreaterThanOrEqual(400);
      expect(p).toBeLessThanOrEqual(600);
    }
    expect(jitteredPause(0, 0.7)).toBe(0);
  });
  it("adaptive cap: halves on trouble, grows back a quarter of the maximum when healthy", () => {
    expect(nextCap(50, 50, true)).toBe(25);
    expect(nextCap(25, 50, true)).toBe(12);
    expect(nextCap(1, 50, true)).toBe(1);
    expect(nextCap(25, 50, false)).toBe(38);
    expect(nextCap(38, 50, false)).toBe(50);
  });
});

describe("Shared calls", () => {
  // The shared count lives in the database; this unit test keeps it in memory.
  beforeEach(() => { resetClient(); setCallStore(new MemoryCallStore()); });
  const slow = (calls: string[], ms = 30): MyLoansAdapter => ({
    name: "mock", capabilities: { search: false, changedSince: false },
    getByPn: async (pn): Promise<MyLoansLookup> => {
      calls.push(pn);
      await new Promise((r) => setTimeout(r, ms));
      return { ok: true, record: { pn, cin: null, cif: null, sourceLoanId: null, borrowerName: "X", branchName: "Antipolo", branchCode: "101", status: "RELEASED", loanType: "New", productName: "Auto", totalReleasedAmount: 1, releaseDate: "2026-11-02" }, raw: {}, adapter: "mock", retrievedAt: new Date() };
    },
    search: async () => ({ ok: false, reason: "UNSUPPORTED", message: "" }), getChangedSince: async () => ({ ok: false, reason: "UNSUPPORTED", message: "" }),
  });
  it("five simultaneous refreshes of one PN (typed in a pasted variant) make one call; the short cache saves the next", async () => {
    const calls: string[] = [];
    const a = slow(calls);
    beginStats();
    const all = await Promise.all(Array.from({ length: 5 }, () => lookupPn(a, "gd 165-2026-9-01003")));
    expect(calls).toEqual(["GD1652026901003"]);
    expect(all.every((r) => r.ok)).toBe(true);
    await lookupPn(a, "GD1652026901003");
    expect(calls.length).toBe(1);
    expect(readStats()).toMatchObject({ calls: 1, saved: 5 });
    await lookupPn(a, "GD1652026901003", { fresh: true }); // Refresh from MyLoans: a fresh call
    expect(calls.length).toBe(2);
    expect(await callsThisHour()).toBe(2);
  });
});
