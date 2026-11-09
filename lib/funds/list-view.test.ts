import { describe, expect, it } from "vitest";
import { DASH, agingTone, daysText, matchesSearch, orDash, summarize, summaryText, type ListItem } from "./list-view";
import { kindText } from "./kinds";

const items: ListItem[] = [
  { key: "CA-2026-0001", typeCode: "CA", cents: 350_000, search: ["CA-2026-0001", "GD1012026902031", "Elsa Morales"] },
  { key: "CA-2026-0002", typeCode: "FT", cents: 25_000, search: ["CA-2026-0002"] },
  { key: "topup-1", typeCode: "CA", cents: 50_000, search: ["CA-2026-0003", "GD1012026902033", "Gloria Chua"] },
];

describe("Funds page summary line", () => {
  it("counts the rows of the tab and sums the amounts shown", () => {
    const s = summarize(items);
    expect(s).toMatchObject({ count: 3, cents: 425_000 });
    expect(summaryText(s)).toBe("3 requests · ₱4,250.00 total");
  });
  it("follows the type filter", () => {
    expect(summaryText(summarize(items, { ftype: "FT" }))).toBe("1 request · ₱250.00 total");
    expect(summaryText(summarize(items, { ftype: "CA" }))).toBe("2 requests · ₱4,000.00 total");
  });
  it("follows the search (request number, PN or borrower), with the type filter too", () => {
    expect(summarize(items, { query: "elsa" }).keys).toEqual(new Set(["CA-2026-0001"]));
    expect(summaryText(summarize(items, { query: "902033" }))).toBe("1 request · ₱500.00 total");
    expect(summarize(items, { query: "ca 2026 0002" }).count).toBe(1); // spaces and dashes do not matter
    expect(summarize(items, { query: "ca-2026", ftype: "CA" }).count).toBe(2);
    expect(summaryText(summarize(items, { query: "nobody" }))).toBe("0 requests · ₱0.00 total");
  });
  it("an empty search matches every row", () => {
    expect(matchesSearch(items[1], "   ")).toBe(true);
  });
});

describe("Funds page cells", () => {
  it("Other shows its description; an empty one says so", () => {
    expect(kindText("OTHER", "Other", "Courier")).toBe("Other: Courier");
    expect(kindText("OTHER", "Other", "  ")).toBe("Other (not described)");
    expect(kindText("LTO_FEE", "LTO fee", "")).toBe("LTO fee");
  });
  it("an empty field is a grey dash, never a blank", () => {
    expect(orDash("")).toBe(DASH);
    expect(orDash("   ")).toBe(DASH);
    expect(orDash(null)).toBe(DASH);
    expect(orDash(" Antipolo ")).toBe("Antipolo");
  });
  it("days waiting and outstanding, in words", () => {
    expect(daysText(0, "waiting")).toBe("Waiting since today");
    expect(daysText(1, "waiting")).toBe("1 business day waiting");
    expect(daysText(12, "outstanding")).toBe("12 business days outstanding");
  });
  it("the aging dot: red when overdue, amber after 10 business days, grey otherwise", () => {
    expect(agingTone({ overdue: true, days: 2 })).toBe("bad");
    expect(agingTone({ overdue: false, days: 11 })).toBe("act");
    expect(agingTone({ overdue: false, days: 10 })).toBe("mute");
  });
});
