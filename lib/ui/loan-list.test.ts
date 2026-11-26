import { describe, expect, it } from "vitest";
import { facetCounts, listUrl, parseListParams, passes, sortRows, type LeanRow } from "./loan-list";

const ME = "u-me";
const row = (o: Partial<LeanRow> & { pn: string }): LeanRow => ({
  key: o.pn, source: "dms", borrowerName: o.pn, branchId: "b1", branchName: "Antipolo", amount: 100, released: "2026-11-01",
  deadline: null, badge: null, needs: false, isNew: false, hold: false, problems: false, archived: false, withId: null, withPool: false, ...o,
});
const ROWS: LeanRow[] = [
  row({ pn: "A", borrowerName: "Cruz", needs: true, deadline: "2026-11-20", badge: "OVERDUE", withId: ME, amount: 300 }),
  row({ pn: "B", borrowerName: "abad", hold: true, deadline: "2026-11-30", badge: "ON_TIME", withId: "u-other", branchId: "b2", branchName: "Angono", amount: 100 }),
  row({ pn: "C", borrowerName: "Bautista", source: "pool", isNew: true, deadline: "2026-11-25", badge: "DUE_TODAY", withPool: true, amount: null }),
  row({ pn: "D", borrowerName: "Diaz", problems: true, needs: true, withId: ME, amount: 200 }),
  row({ pn: "E", borrowerName: "Estrada", archived: true, withId: ME }),
];
const P = (q = "") => parseListParams(q ? Object.fromEntries(new URLSearchParams(q)) : {});
const shown = (q: string) => ROWS.filter((r) => passes(r, P(q), ME)).map((r) => r.pn);

describe("D-059: the Loans page address", () => {
  it("defaults: all open, due first, 25 a page; unknown values ignored", () => {
    expect(P()).toEqual({ q: "", status: [], branch: null, with: null, late: false, sort: "due", dir: "asc", per: 25, page: 1 });
    expect(P("status=hold,bogus,needs&with=x&per=30&page=-1&sort=zzz")).toMatchObject({ status: ["needs", "hold"], with: null, per: 25, page: 1, sort: "due" });
  });
  it("the old Find a loan address (?fill=) is a search", () => expect(P("fill=GD1012026901001").q).toBe("GD1012026901001"));
  it("listUrl leaves defaults out, keeps the filters and starts again at page 1", () => {
    const p = P("q=cruz&status=hold&branch=b2&with=me&late=1&sort=amount&per=50&page=3");
    expect(listUrl(P())).toBe("/loans");
    expect(listUrl(p)).toBe("/loans?q=cruz&status=hold&branch=b2&with=me&late=1&sort=amount&per=50");
    expect(listUrl(p, { page: 2 })).toBe("/loans?q=cruz&status=hold&branch=b2&with=me&late=1&sort=amount&per=50&page=2");
    expect(listUrl(p, { dir: "asc" })).toContain("dir=asc");
    expect(parseListParams(Object.fromEntries(new URLSearchParams(listUrl(p).split("?")[1])))).toEqual({ ...p, page: 1 });
  });
});

describe("D-059: filters", () => {
  it("default: every open loan file; the pool items (not yet in DMS) and archived ones hidden (D-060)", () => expect(shown("")).toEqual(["A", "B", "D"]));
  it("while searching with no status chosen, pool items and archived ones are found too", () => expect(shown("q=x")).toEqual(["A", "B", "C", "D", "E"]));
  it("status is a multi-select (any of them)", () => {
    expect(shown("status=needs")).toEqual(["A", "D"]);
    expect(shown("status=new")).toEqual(["C"]);
    expect(shown("status=hold,problems")).toEqual(["B", "D"]);
    expect(shown("status=archived")).toEqual(["E"]);
    expect(shown("status=needs,archived")).toEqual(["A", "D", "E"]);
  });
  it("branch, with (me / branch pool) and late only", () => {
    expect(shown("branch=b2")).toEqual(["B"]);
    expect(shown("with=me")).toEqual(["A", "D"]);
    expect(shown("with=pool")).toEqual([]); // the pool item shows only with the filter or a search
    expect(shown("with=pool&status=new")).toEqual(["C"]);
    expect(shown("late=1")).toEqual(["A"]);
    expect(shown("with=me&late=1&status=needs")).toEqual(["A"]);
  });
  it("each option's count uses the other filters as they are", () => {
    const c = facetCounts(ROWS, P("with=me"), ME);
    expect(c.status).toEqual({ needs: 2, new: 0, hold: 0, problems: 1, archived: 1 });
    expect(c.with).toEqual({ any: 3, me: 2, pool: 0 }); // the pool item is not in the default list
    expect(c.branch).toEqual({ b1: 2 });
    expect(c.late).toBe(1);
    expect(facetCounts(ROWS, P("status=archived"), ME).status.archived).toBe(1);
  });
});

describe("D-059: order", () => {
  const order = (q: string) => { const p = P(q); return sortRows(ROWS.filter((r) => passes(r, p, ME)), p.sort, p.dir).map((r) => r.pn); };
  it("default: late first, then the soonest due; nothing due last", () => expect(order("q=x")).toEqual(["A", "C", "B", "D", "E"]));
  it("due descending keeps nothing-due last", () => expect(order("q=x&dir=desc")).toEqual(["B", "C", "A", "E", "D"]));
  it("borrower (A to Z, any case), branch, amount (largest first by default; unknown last)", () => {
    expect(order("status=needs,new,hold&sort=borrower")).toEqual(["B", "C", "A", "D"]);
    expect(order("status=needs,new,hold&sort=borrower&dir=desc")).toEqual(["D", "A", "C", "B"]);
    expect(order("status=needs,new,hold&sort=branch")).toEqual(["B", "A", "C", "D"]);
    expect(order("status=needs,new,hold&sort=amount")).toEqual(["A", "D", "B", "C"]);
    expect(order("status=needs,new,hold&sort=amount&dir=asc")).toEqual(["B", "D", "A", "C"]);
  });
  it("released on: the newest first by default, then the oldest first; same day by due", () => {
    const rows = [{ ...ROWS[0], released: "2026-11-10" }, { ...ROWS[1], released: "2026-11-20" }, { ...ROWS[3], released: "2026-11-10" }];
    expect(P("sort=released").dir).toBe("desc");
    expect(listUrl(P("sort=released"))).toBe("/loans?sort=released");
    expect(sortRows(rows, "released", "desc").map((r) => r.pn)).toEqual(["B", "A", "D"]);
    expect(sortRows(rows, "released", "asc").map((r) => r.pn)).toEqual(["A", "D", "B"]);
  });
});
