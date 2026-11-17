import { describe, expect, it } from "vitest";
import { pageInfo, pageOf, pageParam, PAGE_SIZE, rangeText, skipTake, withPage } from "./paging";

describe("paging", () => {
  it("120 rows at 50 a page: 3 pages, the last one 20 rows", () => {
    const rows = Array.from({ length: 120 }, (_, i) => i + 1);
    expect(pageOf(rows, 1, PAGE_SIZE.loans).info).toMatchObject({ page: 1, pages: 3, from: 1, to: 50, total: 120 });
    const p2 = pageOf(rows, 2, 50);
    expect(p2.rows[0]).toBe(51);
    expect(p2.rows).toHaveLength(50);
    const p3 = pageOf(rows, 3, 50);
    expect(p3.rows).toEqual(rows.slice(100));
    expect(rangeText(p3.info)).toBe("101–120 of 120");
  });

  it("the order is kept: a page is a slice of the list as it was", () => {
    const rows = ["c", "a", "b", "e", "d"];
    expect([...pageOf(rows, 1, 2).rows, ...pageOf(rows, 2, 2).rows, ...pageOf(rows, 3, 2).rows]).toEqual(rows);
  });

  it("a page past the end shows the last page; nonsense is page 1; an empty list is one empty page", () => {
    expect(pageInfo(120, 9, 50)).toMatchObject({ page: 3, from: 101, to: 120 });
    for (const v of [undefined, "", "0", "-2", "abc", "1.5", "2e3"]) expect(pageParam(v)).toBe(1);
    expect(pageParam("2")).toBe(2);
    expect(pageParam(["3", "4"])).toBe(3);
    expect(pageInfo(0, 4, 50)).toEqual({ page: 1, pages: 1, from: 0, to: 0, total: 0, size: 50 });
  });

  it("skip and take for a database page; thousands with commas", () => {
    expect(skipTake(pageInfo(312, 2, 100))).toEqual({ skip: 100, take: 100 });
    expect(rangeText(pageInfo(1_312, 2, 50))).toBe("51–100 of 1,312");
  });

  it("another page keeps every param; page 1 has no page", () => {
    expect(withPage("/loans?tab=all&stage=Opened", 2)).toBe("/loans?tab=all&stage=Opened&page=2");
    expect(withPage("/loans?tab=all&page=3", 1)).toBe("/loans?tab=all");
    expect(withPage("/admin/users", 2)).toBe("/admin/users?page=2");
  });
});
