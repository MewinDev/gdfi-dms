import { describe, expect, it } from "vitest";
import { BUILTIN_BRANCHES } from "./builtin";
import { branchRowHash, diffBranches, type DmsBranch, type DmsState } from "./diff";
import type { MyLoansBranchRow } from "./file";

const row = (o: Partial<MyLoansBranchRow>): MyLoansBranchRow => ({ divisionId: 1, divisionName: "Branch Division", areaId: 1, areaName: "LUZON 1 (NGMA + RIZAL)", branchId: 5, code: "101", name: "Antipolo", address: "", active: null, updatedAt: null, ...o });
const br = (o: Partial<DmsBranch>): DmsBranch => ({ id: "b1", myloansBranchId: 5, code: "101", name: "Antipolo", address: "", active: true, hidden: false, source: "MYLOANS", divisionId: "d1", areaId: "a1", ...o });
const state = (branches: DmsBranch[]): DmsState => ({ divisions: [{ id: "d1", myloansId: 1, name: "Branch Division" }], areas: [{ id: "a1", myloansId: 1, name: "LUZON 1 (NGMA + RIZAL)" }], branches });

describe("diffBranches", () => {
  it("unchanged when everything matches", () => {
    const d = diffBranches([row({})], state([br({})]), { full: true });
    expect(d.counts).toMatchObject({ new: 0, changed: 0, unchanged: 1, missing: 0 });
  });
  it("matches by MyLoans id first: a new code is Code changed, a new name Renamed (not new plus missing)", () => {
    const d = diffBranches([row({ code: "102", name: "Antipolo City" })], state([br({})]), { full: true });
    expect(d.counts).toMatchObject({ new: 0, changed: 1, missing: 0 });
    const i = d.items[0];
    expect(i.matchedBy).toBe("id");
    expect(i.kind).toBe("CODE_CHANGED");
    expect(i.kinds).toEqual(["CODE_CHANGED", "RENAMED"]);
    expect(i.fields.map((f) => `${f.field}:${f.was}->${f.now}`)).toEqual(["code:101->102", "name:Antipolo->Antipolo City"]);
  });
  it("the code only when one side has no id (a hand-made branch is adopted)", () => {
    const d = diffBranches([row({})], state([br({ myloansBranchId: null, source: "DMS" })]), { full: false });
    expect(d.items[0]).toMatchObject({ status: "changed", matchedBy: "code", branchId: "b1" });
    // Both sides have an id and they differ: not the same branch, even with the same code.
    const other = diffBranches([row({ branchId: 77 })], state([br({})]), { full: true });
    expect(other.items[0].status).toBe("new");
    expect(other.missing.map((m) => m.id)).toEqual(["b1"]);
  });
  it("the name only for a branch with no MyLoans id (a 'Code needed' branch)", () => {
    const d = diffBranches([row({ name: "Quezon City", code: "201", branchId: 9 })], state([br({ id: "qc", myloansBranchId: null, code: null, name: "Quezon City", source: "DMS", areaId: null, divisionId: null })]), { full: false });
    expect(d.items[0]).toMatchObject({ matchedBy: "name", branchId: "qc" });
    expect(d.items[0].fields.map((f) => f.field)).toEqual(["code", "division", "area"]);
  });
  it("status: Closed and Reopened; a missing status changes nothing on an existing branch", () => {
    expect(diffBranches([row({ active: false })], state([br({})]), { full: true }).items[0].kind).toBe("CLOSED");
    expect(diffBranches([row({ active: true })], state([br({ active: false })]), { full: true }).items[0].kind).toBe("REOPENED");
    expect(diffBranches([row({ active: null })], state([br({ active: false })]), { full: true }).items[0].status).toBe("unchanged");
  });
  it("area or division changed is Moved; a new area is listed", () => {
    const d = diffBranches([row({ areaId: 4, areaName: "LUZON 3 NORTH" })], state([br({})]), { full: true });
    expect(d.items[0].kind).toBe("MOVED");
    expect(d.newGroups.map((g) => g.name)).toEqual(["LUZON 3 NORTH"]);
  });
  it("a renamed area (same id) is listed once, branches are not moved", () => {
    const d = diffBranches([row({ areaName: "LUZON 1" })], state([br({})]), { full: true });
    expect(d.items[0].status).toBe("unchanged");
    expect(d.renamedGroups).toEqual([expect.objectContaining({ level: "area", was: "LUZON 1 (NGMA + RIZAL)", name: "LUZON 1" })]);
  });
  it("Not in the list only for full lists, only MyLoans branches, never hidden or inactive ones", () => {
    const dms = state([br({}), br({ id: "x", myloansBranchId: 6, code: "102", name: "B" }), br({ id: "h", myloansBranchId: 7, code: "103", name: "H", hidden: true }), br({ id: "m", myloansBranchId: null, code: "104", name: "Manual", source: "DMS" })]);
    expect(diffBranches([row({})], dms, { full: true }).missing.map((m) => m.id)).toEqual(["x"]);
    expect(diffBranches([row({})], dms, { full: false }).missing).toEqual([]);
  });
  it("area 12 under two divisions is one area; counts per (Division, Area)", () => {
    const rows = BUILTIN_BRANCHES;
    const d = diffBranches(rows, { divisions: [], areas: [], branches: [] }, { full: true });
    expect(d.counts.new).toBe(12);
    const areas = d.newGroups.filter((g) => g.key.startsWith("area"));
    expect(areas.filter((a) => a.name === "Luzon 3 - CFD")).toHaveLength(1);
    expect(d.perGroup.filter((g) => g.area === "Luzon 3 - CFD").map((g) => g.division).sort()).toEqual(["Branch Division", "Car Financing Division"]);
  });
  it("test-looking rows come first, imported inactive and suggested to hide", () => {
    const d = diffBranches([row({ branchId: 1, code: "390", name: "Alaminos" }), row({ branchId: 209, code: "999", name: "Test Branch" })], state([]), { full: true });
    expect(d.items[0]).toMatchObject({ suggestHide: true, importActive: false, note: "Looks like a test or unused branch" });
    expect(d.items[1]).toMatchObject({ suggestHide: false, importActive: true });
    expect(d.counts.suggestions).toBe(1);
  });
  it("the row hash changes with what MyLoans says", () => {
    expect(branchRowHash(row({}))).toBe(branchRowHash(row({})));
    expect(branchRowHash(row({ name: "X" }))).not.toBe(branchRowHash(row({})));
  });
});
