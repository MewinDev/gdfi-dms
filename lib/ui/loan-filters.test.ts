import { describe, expect, it } from "vitest";
import { branchKey, groupByAreaBranch, groupedOrder, groupTotals, listHref } from "./loan-filters";
import { pageOf } from "./paging";

const row = (n: number, area: string, branch: string) => ({ id: `L${n}`, area, branch });

describe("grouped list with paging", () => {
  // 60 in Rizal (Antipolo 40, Angono 20), 10 with no area: 70 rows, 2 pages of 50.
  const rows = [
    ...Array.from({ length: 20 }, (_, i) => row(i, "Rizal", "Antipolo")),
    ...Array.from({ length: 10 }, (_, i) => row(100 + i, "", "Pasig")),
    ...Array.from({ length: 20 }, (_, i) => row(200 + i, "Rizal", "Angono")),
    ...Array.from({ length: 20 }, (_, i) => row(300 + i, "Rizal", "Antipolo")),
  ];

  it("the whole result is grouped first; inside a group the list's own order is kept", () => {
    const ordered = groupedOrder(rows);
    expect(ordered).toHaveLength(70);
    expect(ordered.slice(0, 20).every((r) => r.branch === "Angono")).toBe(true);
    expect(ordered.slice(20, 60).map((r) => r.id)).toEqual([...rows.slice(0, 20), ...rows.slice(50)].map((r) => r.id));
    expect(ordered.slice(60).every((r) => r.area === "")).toBe(true); // "Area needed" last
  });

  it("page 2 keeps the whole counts and marks a group begun on page 1 as continued", () => {
    const ordered = groupedOrder(rows);
    const p2 = pageOf(ordered, 2, 50);
    const t = groupTotals(ordered, p2.info.from - 1);
    expect(t.areas).toEqual({ Rizal: 60, "Area needed": 10 });
    expect(t.branches[branchKey("Rizal", "Antipolo")]).toBe(40);
    expect(t.continued.has("Rizal")).toBe(true);
    expect(t.continued.has(branchKey("Rizal", "Antipolo"))).toBe(true);
    expect(t.continued.has("Area needed")).toBe(false);
    // The page itself: the last 10 of Antipolo, then the 10 with no area.
    const groups = groupByAreaBranch(p2.rows);
    expect(groups.map((g) => [g.area, g.count])).toEqual([["Rizal", 10], ["Area needed", 10]]);
  });

  it("another tab, filter or grouping is an address without page (back to page 1)", () => {
    expect(listHref({ tab: "all", stage: "Opened", page: undefined })).toBe("/loans?tab=all&stage=Opened");
  });
});
