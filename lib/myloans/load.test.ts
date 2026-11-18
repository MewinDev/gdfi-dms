import { beforeEach, describe, expect, it } from "vitest";
import { beginStats, callsThisHour, lookupPn, MemoryCallStore, readStats, resetClient, setCallStore } from "./client";
import type { MyLoansAdapter, MyLoansLookup } from "./types";

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
