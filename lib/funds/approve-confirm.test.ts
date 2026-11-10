import { describe, expect, it } from "vitest";
import { approveConfirmText, approvedTotal, toCents } from "./approve-confirm";
import { matchesSearch, searchTerms } from "./list-view";
import { formerlyText, numberPrefix } from "./types";

describe("Approve this request? (the window's words)", () => {
  it("the amount in bold and one grey line: number · processor · kind · borrower", () => {
    expect(approveConfirmText({ number: "CA-2026-0002", requester: "DP 1", kinds: ["LTO fee"], borrowers: ["Elsa Morales"], cents: 350_000 })).toEqual({
      title: "Approve this request?", amount: "₱3,500.00", line: "CA-2026-0002 · DP 1 · LTO fee · Elsa Morales",
    });
    // Several lines: each kind and borrower once; a general expense has no borrower.
    expect(approveConfirmText({ number: "FT-2026-0001", requester: "DP 2", kinds: ["LTO fee", "Transport", "LTO fee"], borrowers: [], cents: 125_050 }).line)
      .toBe("FT-2026-0001 · DP 2 · LTO fee, Transport");
  });

  it("shows the changed total when the amounts were changed in the form", () => {
    const lines = [{ id: "a" }, { id: "b" }];
    expect(approvedTotal(lines, { a: "3,500.00", b: "1500" })).toBe(500_000);
    const changed = approvedTotal(lines, { a: "2,000", b: "1500.5" });
    expect(changed).toBe(350_050);
    expect(approveConfirmText({ number: "CA-2026-0002", requester: "DP 1", kinds: ["LTO fee"], borrowers: ["Elsa Morales"], cents: changed }).amount).toBe("₱3,500.50");
    // A blank or bad amount counts as 0 (the server refuses it with its own message).
    expect(approvedTotal(lines, { a: "", b: "abc" })).toBe(0);
    expect(toCents("₱1,234.5")).toBe(123_450);
    expect(toCents("1.234")).toBeNull();
  });
});

describe("Request numbers by type", () => {
  it("the prefix is the type's code: CA for Cash advance, FT for Fund transfer", () => {
    expect(numberPrefix("CA")).toBe("CA");
    expect(numberPrefix("ft")).toBe("FT");
    expect(numberPrefix("G-C")).toBe("GC");
    expect(formerlyText(["CA-2026-0008"])).toBe("Formerly CA-2026-0008");
    expect(formerlyText([])).toBe("");
  });

  it("the Funds search finds a request by its number now and by a number it had before", () => {
    const row = { search: searchTerms("FT-2026-0001", ["CA-2026-0008"], [{ pn: "GD1652026901003", borrower: "Elsa Morales" }]) };
    expect(matchesSearch(row, "FT-2026-0001")).toBe(true);
    expect(matchesSearch(row, "CA-2026-0008")).toBe(true);
    expect(matchesSearch(row, "ca20260008")).toBe(true);
    expect(matchesSearch(row, "Elsa")).toBe(true);
    expect(matchesSearch(row, "CA-2026-0009")).toBe(false);
  });
});
