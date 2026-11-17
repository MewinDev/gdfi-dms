import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allInScope, branchRowScope, hasAllBranches, inScope, loanRelationScope, loanScope, scopeIds, worksInScope } from "./scope";

const all = { scopeBranchIds: null };
const two = { scopeBranchIds: ["b1", "b2"] };
const none = { scopeBranchIds: [] as string[] };

describe("branch scope helpers (lib/auth/scope.ts)", () => {
  it("All branches: no filter", () => {
    expect(loanScope(all)).toEqual({});
    expect(branchRowScope(all)).toEqual({});
    expect(loanRelationScope(all)).toEqual({});
    expect(inScope(all, "anything")).toBe(true);
    expect(hasAllBranches(all)).toBe(true);
    expect(scopeIds(all)).toBeNull();
  });

  it("some branches: only those", () => {
    expect(loanScope(two)).toEqual({ branchId: { in: ["b1", "b2"] } });
    expect(branchRowScope(two)).toEqual({ id: { in: ["b1", "b2"] } });
    expect(loanRelationScope(two)).toEqual({ loan: { branchId: { in: ["b1", "b2"] } } });
    expect(inScope(two, "b1")).toBe(true);
    expect(inScope(two, "b3")).toBe(false);
    expect(inScope(two, null)).toBe(false);
    expect(allInScope(two, ["b1", "b2"])).toBe(true);
    expect(allInScope(two, ["b1", "b3"])).toBe(false);
  });

  it("no branch: a filter that matches nothing (never an empty filter that matches everything)", () => {
    expect(loanScope(none).branchId!.in).toHaveLength(1);
    expect(loanScope(none).branchId!.in[0]).toMatch(/^__/);
    expect(inScope(none, "b1")).toBe(false);
  });

  it("worksInScope (D-039): a worker in one of the branches, or All branches on either side", () => {
    const w = (ids: string[], allBranches = false) => ({ allBranches, branches: ids.map((branchId) => ({ branchId })) });
    expect(worksInScope(two, w(["b2", "b9"]))).toBe(true);
    expect(worksInScope(two, w(["b9"]))).toBe(false);
    expect(worksInScope(two, w([], true))).toBe(true);
    expect(worksInScope(all, w(["b9"]))).toBe(true);
    expect(worksInScope(none, w(["b1"]))).toBe(false);
  });
});

/**
 * One helper (D-008, D-019): outside lib/auth, no code reads `scopeBranchIds` itself or asks the database
 * "who has this permission" through `role.permissions` (lib/auth/holders.ts does, with the overrides and
 * the fund-type ticks). Tests and lib/seed (sample data) are not app code.
 */
describe("one helper for scope and holders", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) { if (![path.join("lib", "auth"), path.join("lib", "seed")].includes(p)) walk(p); }
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(p);
    }
  };
  for (const d of ["app", "components", "lib"]) walk(d);
  const hits = (re: RegExp) => files.flatMap((f) => readFileSync(f, "utf8").split("\n").map((l, i) => [f, i + 1, l] as const).filter(([, , l]) => re.test(l)).map(([f, n, l]) => `${f}:${n} ${l.trim()}`));

  it("nothing outside lib/auth reads scopeBranchIds (use loanScope, branchRowScope, inScope, hasAllBranches, scopeIds)", () => {
    expect(hits(/\.scopeBranchIds\b/)).toEqual([]);
  });

  it("nothing outside lib/auth filters people on role.permissions (use holdsWhere / holdsAnyWhere)", () => {
    expect(hits(/permissions:\s*\{\s*(has|hasSome|hasEvery)\b/)).toEqual([]);
  });
});
