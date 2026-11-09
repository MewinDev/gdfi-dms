import { describe, expect, it } from "vitest";
import { buildPn, cleanPn, DEFAULT_PN_FORMAT, describePn, examplePn, isPnAttempt, parsePn, pnFormatProblem, pnHeadline, type PnFormat } from "./format";

const now = new Date("2026-11-09T10:00:00+08:00");
const parse = (s: string, f: PnFormat = DEFAULT_PN_FORMAT) => parsePn(s, f, now);
const bad = (s: string, f?: PnFormat) => {
  const r = parse(s, f);
  if (r.ok) throw new Error(`${s} should be refused`);
  return r;
};

describe("parsePn: the real PN format GD + branch (3) + year (4) + 9 + running (5)", () => {
  it("a valid PN and its parts", () => {
    expect(parse("GD1012026900001")).toEqual({ ok: true, pn: "GD1012026900001", parts: { prefix: "GD", branchCode: "101", year: "2026", system: "9", running: "00001" } });
    expect(parse("GD1652025912345")).toMatchObject({ ok: true, parts: { branchCode: "165", year: "2025", running: "12345" } });
  });

  it("cleans pasted variants first: spaces, dashes, dots, lower case", () => {
    for (const v of ["gd 101-2026-9-00001", "  GD101 2026 9 00001 ", "gd.101.2026.9.00001", "GD-101-2026-9-00001", "gd1012026900001"]) {
      expect(parse(v)).toMatchObject({ ok: true, pn: "GD1012026900001" });
    }
    expect(cleanPn(" gd 101-2026.9 00001 ")).toBe("GD1012026900001");
  });

  it("says which part is wrong", () => {
    expect(bad("XY1012026900001")).toMatchObject({ part: "prefix", message: "The PN must start with GD, not XY." });
    expect(bad("1012026900001")).toMatchObject({ part: "prefix", message: "The PN must start with GD." });
    expect(bad("GD10A2026900001")).toMatchObject({ part: "chars" });
    expect(bad("GD102026900001")).toMatchObject({ part: "branch", message: "The branch code must be 3 digits (this one has 2)." });
    expect(bad("GD10112026900001")).toMatchObject({ part: "branch", message: "The branch code must be 3 digits (this one has 4)." });
    expect(bad("GD101202690001")).toMatchObject({ part: "running", message: "The running number must be 5 digits (this one has 4)." });
    expect(bad("GD10120269000001")).toMatchObject({ part: "running", message: "The running number must be 5 digits (this one has 6)." });
    expect(bad("GD0012026900001")).toMatchObject({ part: "branch" });
    expect(bad("GD1012026800001")).toMatchObject({ part: "system", message: "The number after the year must be 9 (the MyLoans system), not 8." });
    expect(bad("GD1012026900000")).toMatchObject({ part: "running" });
    expect(bad("GD1011999900001")).toMatchObject({ part: "year" });
    expect(bad("GD12")).toMatchObject({ part: "length" });
    expect(bad("   ")).toMatchObject({ part: "empty" });
  });

  it("refuses a year in the future (Philippine year)", () => {
    expect(bad("GD1012027900001")).toMatchObject({ part: "year", message: "The year is in the future (2027)." });
    // 31 Dec 2026 23:30 PHT is already 2027 in no zone that matters: still 2026 in Manila.
    expect(parsePn("GD1012026900001", DEFAULT_PN_FORMAT, new Date("2026-12-31T15:30:00Z")).ok).toBe(true);
    expect(parsePn("GD1012027900001", DEFAULT_PN_FORMAT, new Date("2026-12-31T16:30:00Z")).ok).toBe(true); // 1 Jan 2027 00:30 PHT
  });

  it("the setting changes the rules (prefix, lengths, system digit) and can switch the check off", () => {
    const other: PnFormat = { enabled: true, prefix: "GF", branchDigits: 4, yearDigits: 2, system: "7", runningDigits: 6 };
    expect(parse("GF1001267000123", other)).toMatchObject({ ok: true, parts: { branchCode: "1001", year: "26", system: "7", running: "000123" } });
    expect(parse("GD1012026900001", other).ok).toBe(false);
    const off = { ...DEFAULT_PN_FORMAT, enabled: false };
    expect(parse("anything-123", off)).toEqual({ ok: true, pn: "ANYTHING123", parts: null });
    expect(isPnAttempt("GD123", off)).toBe(false);
  });

  it("the headline, the example and the pattern", () => {
    expect(pnHeadline()).toBe("This does not look like a PN. Example: GD1012026900001");
    expect(examplePn()).toBe("GD1012026900001");
    expect(describePn().pattern).toBe("GD ### #### 9 #####");
    expect(describePn().length).toBe(15);
    expect(describePn().parts.map((p) => p.example)).toEqual(["GD", "101", "2026", "9", "00001"]);
    expect(buildPn("101", 2026, 13)).toBe("GD1012026900013");
  });

  it("isPnAttempt: a PN being typed, not a CIN, CIF, label code or a name", () => {
    expect(isPnAttempt("GD101")).toBe(true);
    expect(isPnAttempt("gd 101-2026")).toBe(true);
    expect(isPnAttempt("1012026900001")).toBe(true);
    expect(isPnAttempt("CIN-771003")).toBe(false);
    expect(isPnAttempt("Maria Santos")).toBe(false);
    expect(isPnAttempt("GDFI")).toBe(false);
  });

  it("checks the setting itself", () => {
    expect(pnFormatProblem(DEFAULT_PN_FORMAT)).toBeNull();
    expect(pnFormatProblem({ ...DEFAULT_PN_FORMAT, prefix: "g1" })).toMatch(/Prefix/);
    expect(pnFormatProblem({ ...DEFAULT_PN_FORMAT, yearDigits: 3 })).toMatch(/Year/);
    expect(pnFormatProblem({ ...DEFAULT_PN_FORMAT, system: "x" })).toMatch(/System/);
  });
});
