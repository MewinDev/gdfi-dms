/**
 * npm run migrate:check (scripts/migrate-check.ts): the guard that runs before every `prisma migrate
 * deploy` in our scripts (db:deploy, db:migrate, db:reset, db:create-test and the kit rebuild).
 *
 * Why: twice (10 and 11 November 2026) `prisma migrate dev --create-only` left a stray folder with
 * Prisma's own date name (20261110165712_remove_labels). It sorted in the middle of the list, `migrate
 * deploy` applied it, and its SQL dropped the two loan-search trigram indexes. This project no longer
 * uses `migrate dev` at all (CLAUDE.md); these checks stop the same accident if a stray folder appears.
 *
 * On 12 November 2026 the 32 earlier migrations were squashed into one baseline, BASELINE_MIGRATION
 * (docs/db/squash-notes.md). The folder list is now the baseline, then each later migration numbered
 * the previous number plus one. No squash after go-live.
 *
 * The pure folder checks are here (unit-tested in migration-check.test.ts); the database checks take
 * what the script read from the connected database.
 */

/** "<14 digits>_<lower-case name>". */
export const FOLDER_PATTERN = /^\d{14}_[a-z0-9_]+$/;

/** The one migration that builds the whole database (every earlier migration, squashed). Always first. */
export const BASELINE_MIGRATION = "20261119090014_baseline";

/** The numbered series starts at the baseline; every later folder is the previous number plus one. */
export const SERIES_START = 20261119090014;

/** The loan-search indexes (made by TRIGRAM_MIGRATION) that a stray Prisma folder drops. */
export const TRIGRAM_INDEXES = ["Loan_pn_trgm_idx", "Loan_borrowerName_trgm_idx"] as const;
export const TRIGRAM_MIGRATION = BASELINE_MIGRATION;

const stamp = (f: string) => Number(f.slice(0, 14)); // 14 digits: well within a safe integer

/**
 * Checks the folder names in the order the folder lists them (name order). Returns the problems in
 * plain words; empty when all is well.
 *  - every folder matches FOLDER_PATTERN;
 *  - the numbers are strictly increasing (no two folders share one, none out of order);
 *  - the first folder is BASELINE_MIGRATION; nothing sorts before it (a folder dated before it is a
 *    stray with Prisma's own date name); after it, each number is the previous plus one.
 */
export function checkFolders(folders: readonly string[]): string[] {
  const problems: string[] = [];
  const bad = folders.filter((f) => !FOLDER_PATTERN.test(f));
  for (const f of bad) problems.push(`"${f}" does not match <14 digits>_<lower-case name>.`);
  const good = folders.filter((f) => FOLDER_PATTERN.test(f));
  for (let i = 1; i < good.length; i++) {
    if (stamp(good[i]) <= stamp(good[i - 1])) problems.push(`"${good[i]}" does not come after "${good[i - 1]}": the numbers must be strictly increasing.`);
  }
  let prev: number | null = null;
  for (const f of good) {
    const n = stamp(f);
    if (n < SERIES_START) {
      problems.push(`"${f}" is a stray folder (Prisma's own date name, before the baseline ${BASELINE_MIGRATION}). Delete it; make the migration with prisma migrate diff.`);
      continue;
    }
    if (prev === null && f !== BASELINE_MIGRATION) problems.push(`"${f}": the first migration must be the baseline ${BASELINE_MIGRATION}.`);
    if (prev !== null && n !== prev + 1) problems.push(`"${f}" should be ${prev + 1}_<name> (the next number after the latest).`);
    prev = n;
  }
  if (!folders.includes(BASELINE_MIGRATION)) problems.push(`"${BASELINE_MIGRATION}" is missing (the baseline must never be removed or renamed).`);
  return problems;
}

/**
 * Checks the connected database against the folders. `applied` is the finished, not rolled back rows
 * of _prisma_migrations in the order they ran; `indexes` the names of the Loan table's indexes.
 *  - every applied migration still has its folder (a database that still lists the migrations from
 *    before the squash gets the fix in plain words: docs/db/squash-notes.md);
 *  - they ran in folder order, and no folder waiting to be applied sorts before the last one applied
 *    (a stray in the middle would be applied out of order);
 *  - once TRIGRAM_MIGRATION is applied, both TRIGRAM_INDEXES exist.
 */
export function checkDatabase(folders: readonly string[], applied: readonly string[], indexes: readonly string[]): string[] {
  const problems: string[] = [];
  const onDisk = new Set(folders);
  const preSquash = applied.filter((a) => !onDisk.has(a) && FOLDER_PATTERN.test(a) && stamp(a) < SERIES_START);
  if (preSquash.length) {
    problems.push(`The database still lists ${preSquash.length} migration(s) from before the squash (such as "${preSquash[0]}"). Its schema is the same as the baseline's: clear those rows and mark ${BASELINE_MIGRATION} as applied (docs/db/squash-notes.md).`);
  }
  for (const a of applied) if (!onDisk.has(a) && !preSquash.includes(a)) problems.push(`The database applied "${a}", but its folder is missing.`);
  const sorted = [...applied].sort();
  if (applied.join() !== sorted.join()) problems.push("The database applied the migrations out of folder order.");
  const last = sorted.at(-1);
  const done = new Set(applied);
  if (last) {
    for (const f of folders) if (!done.has(f) && f < last) problems.push(`"${f}" is not applied but sorts before the last applied "${last}": a stray folder. Delete it before migrate deploy.`);
  }
  if (done.has(TRIGRAM_MIGRATION)) {
    for (const ix of TRIGRAM_INDEXES) if (!indexes.includes(ix)) problems.push(`The loan-search index "${ix}" is missing. Recreate it from ${TRIGRAM_MIGRATION}/migration.sql (block 3).`);
  }
  return problems;
}
