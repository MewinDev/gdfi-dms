import { describe, expect, it } from "vitest";
import { accessSummary, coveredByGroup, effectiveBranchIds, normalizeGrants, type BranchPlace, type GrantLike } from "./access";

// Two divisions; area A12 appears under both (as area 12 "Luzon 3 - CFD" does in MyLoans).
const B: BranchPlace[] = [
  { id: "b1", divisionId: "D1", areaId: "A1" },
  { id: "b2", divisionId: "D1", areaId: "A1" },
  { id: "b3", divisionId: "D1", areaId: "A4" },
  { id: "b4", divisionId: "D1", areaId: "A12" },
  { id: "b5", divisionId: "D2", areaId: "A12" },
  { id: "b6", divisionId: "D2", areaId: "A10" },
];
const div = (d: string): GrantLike => ({ kind: "DIVISION", divisionId: d, areaId: null, branchId: null, exclude: false });
const area = (d: string | null, a: string): GrantLike => ({ kind: "AREA", divisionId: d, areaId: a, branchId: null, exclude: false });
const br = (b: string, exclude = false): GrantLike => ({ kind: "BRANCH", divisionId: null, areaId: null, branchId: b, exclude });
const ids = (g: GrantLike[]) => [...effectiveBranchIds(g, B)].sort();

describe("effectiveBranchIds", () => {
  it("is the union of a Division, an Area (the Division+Area pair) and single Branches", () => {
    expect(ids([div("D2")])).toEqual(["b5", "b6"]);
    expect(ids([area("D1", "A12")])).toEqual(["b4"]); // only the pair, not area 12 under D2
    expect(ids([area(null, "A12")])).toEqual(["b4", "b5"]); // no division: the area in every division
    expect(ids([area("D1", "A1"), br("b6")])).toEqual(["b1", "b2", "b6"]);
    expect(ids([div("D2"), area("D1", "A4"), br("b1")])).toEqual(["b1", "b3", "b5", "b6"]);
  });
  it("takes exceptions out of a ticked Area or Division", () => {
    expect(ids([area("D1", "A1"), br("b2", true)])).toEqual(["b1"]);
    expect(ids([div("D1"), br("b4", true), br("b1", true)])).toEqual(["b2", "b3"]);
  });
  it("is dynamic: a branch added to a ticked Area later is included", () => {
    const g = [area("D1", "A1")];
    expect([...effectiveBranchIds(g, [...B, { id: "new", divisionId: "D1", areaId: "A1" }])]).toContain("new");
  });
  it("follows a branch that moves to another area", () => {
    const moved = B.map((b) => (b.id === "b2" ? { ...b, areaId: "A4" } : b));
    expect([...effectiveBranchIds([area("D1", "A1")], moved)]).toEqual(["b1"]);
  });
  it("no grants, no branches", () => expect(ids([])).toEqual([]));
});

describe("normalizeGrants", () => {
  it("drops duplicates, a branch already covered by a group, and exceptions no group covers", () => {
    const out = normalizeGrants([area("D1", "A1"), area("D1", "A1"), br("b1"), br("b6"), br("b6"), br("b3", true)], B);
    expect(out).toEqual([area("D1", "A1"), br("b6")]);
  });
  it("keeps a real exception and drops grants on unknown branches", () => {
    expect(normalizeGrants([div("D1"), br("b4", true), br("ghost")], B)).toEqual([div("D1"), br("b4", true)]);
  });
  it("coveredByGroup", () => {
    expect(coveredByGroup([area("D1", "A1")], B[0])).toBe(true);
    expect(coveredByGroup([area("D1", "A1")], B[2])).toBe(false);
    expect(coveredByGroup([div("D2")], B[4])).toBe(true);
  });
});

describe("accessSummary", () => {
  it("says what was granted and how many branches it makes", () => {
    expect(accessSummary([], 0, true)).toBe("All branches");
    expect(accessSummary([], 0, false)).toBe("No branches");
    expect(accessSummary([area("D1", "A1"), area("D2", "A10"), br("b3"), br("b4"), br("b5")], 41, false)).toBe("2 areas + 3 branches, 41 branches in total");
    expect(accessSummary([area("D1", "A1"), br("b2", true)], 1, false)).toBe("1 area except 1 branch, 1 branch in total");
    expect(accessSummary([div("D1")], 4, false)).toBe("1 division, 4 branches in total");
  });
});
