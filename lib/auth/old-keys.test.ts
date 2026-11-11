import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizePermissions, PERMISSIONS } from "./permissions";

// Built from parts so this file does not hold the old key itself.
const OLD = ["source", "review_borrower"].join(":");

describe("the renamed tick myloans:review_borrower", () => {
  it("an old saved key becomes the new one", () => {
    expect(normalizePermissions([PERMISSIONS.LOANS_VIEW, OLD])).toContain("myloans:review_borrower");
    expect(normalizePermissions([PERMISSIONS.LOANS_VIEW, OLD])).not.toContain(OLD);
  });

  it("the old key appears nowhere: only the rename map and the migrations keep it", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        if (["node_modules", ".next", ".next-e2e-prod", "test-results", "migrations", "screenshots", ".git"].includes(f)) continue;
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx|md|sql|json|prisma|mjs|cjs)$/.test(f)) continue;
        readFileSync(p, "utf8").split(/\r?\n/).forEach((line, i) => { if (line.includes(OLD)) found.push(`${p}:${i + 1}`); });
      }
    };
    for (const d of ["lib", "app", "components", "docs", "tests", "scripts", "prisma"]) walk(d);
    expect(found).toEqual([join("lib", "auth", "permissions.ts") + `:${readFileSync(join("lib", "auth", "permissions.ts"), "utf8").split(/\r?\n/).findIndex((l) => l.includes(OLD)) + 1}`]);
  });
});
