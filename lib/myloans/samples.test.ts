import { describe, expect, it } from "vitest";
import { DATA_CHECK_PNS, SAMPLE_PNS, dataCheckSamples, sampleLoans } from "./samples";

describe("sample loans", () => {
  it("are hidden when TEST_MODE is off", () => {
    expect(sampleLoans(false)).toEqual([]);
    expect(dataCheckSamples(false, true)).toEqual([]);
  });

  it("are exactly the three hand-picked PNs in test mode, with their MyLoans records", () => {
    const s = sampleLoans(true);
    expect(s.map((x) => x.pn)).toEqual(["GD1012026901001", "GD1652026901003", "GD1652026901004"]);
    for (const x of s) {
      expect(x.record?.pn).toBe(x.pn);
      expect(x.tests.length).toBeGreaterThan(10);
    }
    expect(s[0].record?.borrowerName).toBe("Maria Santos");
    expect(s[1].record?.borrowerName).toBe("Ana Villanueva");
  });

  it("data-check PNs need both test mode and the Admin setting", () => {
    expect(dataCheckSamples(true, false)).toEqual([]);
    const d = dataCheckSamples(true, true).map((x) => x.pn);
    expect(d).toContain("GD1012026999999");
    expect(d).toContain("GD3902026901007");
    expect(d).toContain("GD1652026901011");
  });

  it("the two groups do not overlap", () => {
    const a = new Set(SAMPLE_PNS.map((x) => x.pn));
    expect(DATA_CHECK_PNS.some((x) => a.has(x.pn))).toBe(false);
  });
});
