import { describe, expect, it } from "vitest";
import { runDataCheck } from "./data-check";
import { mockRecords } from "./mock-data";

const now = new Date("2026-11-06T03:00:00Z"); // Friday, Manila
const today = "2026-11-06";
const la = { allowedBranches: [{ code: "101", name: "Antipolo" }, { code: "165", name: "Angono" }], today };
const rec = (pn: string) => mockRecords(now).find((r) => r.pn === pn)!;

describe("Data Check on section 9 PNs", () => {
  it.each(["GD1012026901001", "GD1012026901002", "GD1652026901003", "GD1652026901004", "GD1012026901005", "GD1012026901006"])("%s passes", (pn) => {
    expect(runDataCheck(rec(pn), la).ok).toBe(true);
  });
  it.each([
    ["GD3902026901007", "branch", /Outside your branch access/],
    ["GD1652026901008", "status", /Not yet released/],
    ["GD1652026901009", "loanType", /New" or "Renewal/],
    ["GD1652026901010", "totalReleasedAmount", /above 0/],
    ["GD1652026901011", "releaseDate", /missing/],
  ])("%s fails on %s", (pn, field, msg) => {
    const r = runDataCheck(rec(pn), la);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe(field);
      expect(r.message).toMatch(msg);
    }
  });
  it("blank Product Name is valid", () => {
    const r = runDataCheck(rec("GD1012026901006"), la);
    expect(r.ok && r.normalized.productName).toBe("");
  });
  it("future release date is refused", () => {
    const r = runDataCheck({ ...rec("GD1012026901001"), releaseDate: "2026-11-07" }, la);
    expect(r.ok).toBe(false);
  });
  it("no branch restriction when allowedBranches is null", () => {
    expect(runDataCheck(rec("GD3902026901007"), { allowedBranches: null, today }).ok).toBe(true);
  });
  it("a plain decimal string is read; one with commas is refused (D-050 item c, Q16)", () => {
    const r = runDataCheck({ ...rec("GD1012026901001"), totalReleasedAmount: "450000.00" }, la);
    expect(r.ok && r.normalized.totalReleasedAmount).toBe(450000);
    const bad = runDataCheck({ ...rec("GD1012026901001"), totalReleasedAmount: "450,000.00" }, la);
    expect(bad).toMatchObject({ ok: false, field: "totalReleasedAmount" });
  });
});

describe("exact amounts (D-050 item c)", () => {
  it("a plain decimal string is exact; a comma, an exponent or a sign is refused, never guessed", async () => {
    const { parseAmount } = await import("./data-check");
    expect(parseAmount("219590.00")).toBe(219590);
    expect(parseAmount("500000.00")).toBe(500000);
    expect(parseAmount("500000.01")).toBe(500000.01);
    expect(parseAmount(450000)).toBe(450000);
    for (const bad of ["1,000", "1e6", "-5", " ", "abc", "1.2.3", "₱1000"]) expect(parseAmount(bad), bad).toBeNull();
  });
});
