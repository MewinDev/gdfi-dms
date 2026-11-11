/**
 * npm run migrate:check: fails (exit 1) when
 *  - a folder in prisma/migrations/ does not match the numbering pattern, or the list is not strictly
 *    increasing (a stray folder with Prisma's own date name, for example);
 *  - the connected database (DIRECT_URL, else DATABASE_URL) applied migrations out of order, has a
 *    folder waiting that sorts before the last applied one, or is missing a loan-search trigram index.
 * Runs before every `prisma migrate deploy` in our scripts (see package.json, scripts/db-create-test.ts
 * and lib/kit/core.ts) and once more after it. A database with no migrations yet (just emptied, or new)
 * gets the folder checks only. The rules are in lib/db/migration-check.ts.
 *
 * Options: --folders-only (skip the database).
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { loadEnvFiles } from "../lib/env/load-files";
import { checkDatabase, checkFolders, TRIGRAM_INDEXES } from "../lib/db/migration-check";

loadEnvFiles([".env.local", ".env"]);
const DIR = path.resolve("prisma/migrations");
const folders = readdirSync(DIR).filter((f) => statSync(path.join(DIR, f)).isDirectory()).sort();

async function fromDatabase(url: string): Promise<{ applied: string[]; indexes: string[] } | null> {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const table = await db.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('public._prisma_migrations')::text AS t`;
    if (!table[0]?.t) return null; // nothing applied yet
    const rows = await db.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at, finished_at`;
    const ix = await db.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Loan'`;
    return { applied: rows.map((r) => r.migration_name), indexes: ix.map((r) => r.indexname) };
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

async function main() {
  const problems = checkFolders(folders);
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  let where = "folders only";
  if (!process.argv.includes("--folders-only") && url) {
    const name = (() => { try { return new URL(url).pathname.slice(1); } catch { return "the database"; } })();
    const got = await fromDatabase(url);
    if (got) {
      problems.push(...checkDatabase(folders, got.applied, got.indexes));
      where = `${name}: ${got.applied.length} applied, ${TRIGRAM_INDEXES.filter((i) => got.indexes.includes(i)).length} of ${TRIGRAM_INDEXES.length} search indexes`;
    } else where = `${name}: no migrations applied yet (folder checks only)`;
  }
  if (problems.length) {
    console.error(`migrate:check failed (${folders.length} folders; ${where}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error("Never use prisma migrate dev here; make migrations with prisma migrate diff (CLAUDE.md).");
    process.exit(1);
  }
  console.log(`migrate:check ok: ${folders.length} folders, newest ${folders.at(-1)}; ${where}.`);
}

main().catch((e) => {
  console.error(`migrate:check could not run: ${(e as Error).message}`);
  process.exit(1);
});
