import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkDatabase, checkFolders, LEGACY_FOLDERS, TRIGRAM_INDEXES, TRIGRAM_MIGRATION } from "./migration-check";

/**
 * npm run migrate:check (lib/db/migration-check.ts): the guard before every migrate deploy. The
 * accident it stops (10 and 11 November 2026): `migrate dev --create-only` left
 * 20261110165712_remove_labels, it sorted in the middle, deploy applied it and dropped the trigram
 * search indexes.
 */
const DIR = path.resolve("prisma/migrations");
const real = readdirSync(DIR).filter((f) => statSync(path.join(DIR, f)).isDirectory()).sort();
const series = ["20261119090000_hold_transfer_and_papers_back", "20261119090001_funds_types", "20261119090002_monitoring"];
const good = [...LEGACY_FOLDERS, ...series];

describe("checkFolders: the folder pattern and order", () => {
  it("the real prisma/migrations folder passes", () => {
    expect(checkFolders(real)).toEqual([]);
  });

  it("a good list passes", () => {
    expect(checkFolders(good)).toEqual([]);
  });

  it("the stray folder from the accident (Prisma's own date name, in the middle) fails", () => {
    const withStray = [...good, "20261110165712_remove_labels"].sort();
    const p = checkFolders(withStray);
    expect(p.join("\n")).toMatch(/"20261110165712_remove_labels" is a stray folder/);
  });

  it("a Prisma date name after the series (not the next number) fails", () => {
    expect(checkFolders([...good, "20261125143012_new_thing"]).join("\n")).toMatch(/should be 20261119090003_<name>/);
  });

  it("the next number passes; a skipped number fails", () => {
    expect(checkFolders([...good, "20261119090003_next"])).toEqual([]);
    expect(checkFolders([...good, "20261119090004_skipped"]).join("\n")).toMatch(/should be 20261119090003_<name>/);
  });

  it("names that do not match <14 digits>_<lower-case name> fail", () => {
    for (const bad of ["20261119090003-dash", "2026111909003_short", "20261119090003_Upper", "20261119090003_", "migration_lock", "20261119090003_sp ace"]) {
      expect(checkFolders([...good, bad]).join("\n"), bad).toMatch(/does not match/);
    }
  });

  it("two folders with the same number, or out of order, fail (strictly increasing)", () => {
    expect(checkFolders([...good, "20261119090002_twin"]).join("\n")).toMatch(/strictly increasing/);
    const swapped = [...good.slice(0, -2), good.at(-1)!, good.at(-2)!];
    expect(checkFolders(swapped).join("\n")).toMatch(/strictly increasing/);
  });

  it("a removed older folder fails", () => {
    expect(checkFolders(good.filter((f) => f !== "20261110090000_journey")).join("\n")).toMatch(/"20261110090000_journey" is missing/);
  });
});

describe("checkDatabase: the connected database", () => {
  const indexes = ["Loan_pkey", ...TRIGRAM_INDEXES];

  it("all applied in order, both search indexes: passes", () => {
    expect(checkDatabase(good, good, indexes)).toEqual([]);
    expect(checkDatabase(good, good.slice(0, -1), indexes)).toEqual([]); // the newest is still waiting: fine
  });

  it("a folder waiting that sorts before the last applied (the stray) fails", () => {
    const folders = [...good, "20261110165712_remove_labels"].sort();
    expect(checkDatabase(folders, good, indexes).join("\n")).toMatch(/"20261110165712_remove_labels" is not applied but sorts before/);
  });

  it("a missing trigram index fails once its migration is applied; not before", () => {
    expect(checkDatabase(good, good, ["Loan_pkey", "Loan_pn_trgm_idx"]).join("\n")).toMatch(/"Loan_borrowerName_trgm_idx" is missing/);
    const before = good.slice(0, good.indexOf(TRIGRAM_MIGRATION));
    expect(checkDatabase(good, before, ["Loan_pkey"])).toEqual([]);
  });

  it("an applied migration with no folder, or applied out of order, fails", () => {
    expect(checkDatabase(good.slice(0, -1), good, indexes).join("\n")).toMatch(/its folder is missing/);
    const shuffled = [...good.slice(0, -2), good.at(-1)!, good.at(-2)!];
    expect(checkDatabase(good, shuffled, indexes).join("\n")).toMatch(/out of folder order/);
  });
});
