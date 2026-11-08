import { describe, expect, it } from "vitest";
import { runDataCheck } from "./data-check";
import { mockRecords } from "./mock-data";

const now = new Date("2026-11-06T03:00:00Z"); // Friday, Manila
const today = "2026-11-06";
const la = { allowedBranchNames: ["Quezon City", "Cebu"], today };
const rec = (pn: string) => mockRecords(now).find((r) => r.pn === pn)!;

describe("Data Check on section 9 PNs", () => {
  it.each(["PN-0001001", "PN-0001002", "PN-0001003", "PN-0001004", "PN-0001005", "PN-0001006"])("%s passes", (pn) => {
    expect(runDataCheck(rec(pn), la).ok).toBe(true);
  });
  it.each([
    ["PN-0001007", "branch", /Outside your branch access/],
    ["PN-0001008", "status", /Not yet released/],
    ["PN-0001009", "loanType", /New" or "Renewal/],
    ["PN-0001010", "totalReleasedAmount", /above 0/],
    ["PN-0001011", "releaseDate", /missing/],
  ])("%s fails on %s", (pn, field, msg) => {
    const r = runDataCheck(rec(pn), la);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.field).toBe(field);
      expect(r.message).toMatch(msg);
    }
  });
  it("blank Product Name is valid", () => {
    const r = runDataCheck(rec("PN-0001006"), la);
    expect(r.ok && r.normalized.productName).toBe("");
  });
  it("future release date is refused", () => {
    const r = runDataCheck({ ...rec("PN-0001001"), releaseDate: "2026-11-07" }, la);
    expect(r.ok).toBe(false);
  });
  it("no branch restriction when allowedBranchNames is null", () => {
    expect(runDataCheck(rec("PN-0001007"), { allowedBranchNames: null, today }).ok).toBe(true);
  });
  it("string amounts with commas are read", () => {
    const r = runDataCheck({ ...rec("PN-0001001"), totalReleasedAmount: "450,000.00" }, la);
    expect(r.ok && r.normalized.totalReleasedAmount).toBe(450000);
  });
});
