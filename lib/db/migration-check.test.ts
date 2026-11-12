import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE_MIGRATION, checkDatabase, checkFolders, TRIGRAM_INDEXES, TRIGRAM_MIGRATION } from "./migration-check";

/**
 * npm run migrate:check (lib/db/migration-check.ts): the guard before every migrate deploy. The
 * accident it stops (10 and 11 November 2026): `migrate dev --create-only` left
 * 20261110165712_remove_labels, it sorted in the middle, deploy applied it and dropped the trigram
 * search indexes. Since the squash (12 November 2026) the list starts with the baseline.
 */
const DIR = path.resolve("prisma/migrations");
const real = readdirSync(DIR).filter((f) => statSync(path.join(DIR, f)).isDirectory()).sort();
const good = [BASELINE_MIGRATION, "20261119090015_first_after", "20261119090016_second_after"];

describe("checkFolders: the folder pattern and order", () => {
  it("the real prisma/migrations folder passes and starts with the baseline", () => {
    expect(checkFolders(real)).toEqual([]);
    expect(real[0]).toBe(BASELINE_MIGRATION);
  });

  it("a good list passes; the baseline alone passes", () => {
    expect(checkFolders(good)).toEqual([]);
    expect(checkFolders([BASELINE_MIGRATION])).toEqual([]);
  });

  it("the stray folder from the accident (Prisma's own date name, before the baseline) fails", () => {
    const withStray = [...good, "20261110165712_remove_labels"].sort();
    expect(checkFolders(withStray).join("\n")).toMatch(/"20261110165712_remove_labels" is a stray folder/);
  });

  it("an old folder from before the squash, put back by mistake, fails", () => {
    expect(checkFolders(["20261106060100_init", ...good]).join("\n")).toMatch(/"20261106060100_init" is a stray folder/);
  });

  it("a Prisma date name after the baseline (not the next number) fails", () => {
    expect(checkFolders([...good, "20261125143012_new_thing"]).join("\n")).toMatch(/should be 20261119090017_<name>/);
  });

  it("the next number passes; a skipped number fails", () => {
    expect(checkFolders([...good, "20261119090017_next"])).toEqual([]);
    expect(checkFolders([...good, "20261119090018_skipped"]).join("\n")).toMatch(/should be 20261119090017_<name>/);
  });

  it("names that do not match <14 digits>_<lower-case name> fail", () => {
    for (const bad of ["20261119090017-dash", "2026111909017_short", "20261119090017_Upper", "20261119090017_", "migration_lock", "20261119090017_sp ace"]) {
      expect(checkFolders([...good, bad]).join("\n"), bad).toMatch(/does not match/);
    }
  });

  it("two folders with the same number, or out of order, fail (strictly increasing)", () => {
    expect(checkFolders([...good, "20261119090016_twin"]).join("\n")).toMatch(/strictly increasing/);
    const swapped = [...good.slice(0, -2), good.at(-1)!, good.at(-2)!];
    expect(checkFolders(swapped).join("\n")).toMatch(/strictly increasing/);
  });

  it("a missing or renamed baseline fails", () => {
    expect(checkFolders(good.slice(1)).join("\n")).toMatch(/"20261119090014_baseline" is missing/);
    expect(checkFolders(good.slice(1)).join("\n")).toMatch(/the first migration must be the baseline/);
    expect(checkFolders(["20261119090014_other", ...good.slice(1)]).join("\n")).toMatch(/"20261119090014_baseline" is missing/);
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

  it("the trigram indexes are made by the baseline; a missing one fails once it is applied, not before", () => {
    expect(TRIGRAM_MIGRATION).toBe(BASELINE_MIGRATION);
    expect(checkDatabase(good, good, ["Loan_pkey", "Loan_pn_trgm_idx"]).join("\n")).toMatch(/"Loan_borrowerName_trgm_idx" is missing/);
    expect(checkDatabase(good, good, ["Loan_pkey"]).join("\n")).toMatch(/"Loan_pn_trgm_idx" is missing/);
    expect(checkDatabase(good, [], ["Loan_pkey"])).toEqual([]);
  });

  it("an applied migration with no folder, or applied out of order, fails", () => {
    expect(checkDatabase(good.slice(0, -1), good, indexes).join("\n")).toMatch(/its folder is missing/);
    const shuffled = [...good.slice(0, -2), good.at(-1)!, good.at(-2)!];
    expect(checkDatabase(good, shuffled, indexes).join("\n")).toMatch(/out of folder order/);
  });

  it("a database that still lists the migrations from before the squash gets the fix in plain words", () => {
    const old = ["20261106060100_init", "20261116090000_myloans_load", "20261119090013_myloans_shared_limits"];
    const p = checkDatabase([BASELINE_MIGRATION], old, indexes).join("\n");
    expect(p).toMatch(/still lists 3 migration\(s\) from before the squash/);
    expect(p).toMatch(/mark 20261119090014_baseline as applied/);
    expect(p).not.toMatch(/its folder is missing/);
  });
});
