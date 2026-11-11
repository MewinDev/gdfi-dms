import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

/**
 * Migration folders: "<14-digit timestamp>_<name>", unique, and applied in name order. Prisma applies
 * migrations in name order; a new migration (made with prisma migrate diff, never migrate dev) is named to follow
 * 20261119090000_hold_transfer_and_papers_back (see CLAUDE.md). When a local database is reachable,
 * the folders in name order must equal the order recorded in _prisma_migrations (so the newest
 * folder is also the last one applied). Without a database that part is skipped.
 */
const DIR = path.resolve("prisma/migrations");
const folders = readdirSync(DIR).filter((f) => statSync(path.join(DIR, f)).isDirectory());
const sorted = [...folders].sort();

async function appliedOrder(): Promise<string[] | null> {
  if (!process.env.DATABASE_URL) return null;
  const db = new PrismaClient();
  try {
    const rows = await db.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY started_at, finished_at`;
    return rows.map((r) => r.migration_name);
  } catch {
    return null; // no database here, or not migrated: skip that part
  } finally {
    await db.$disconnect().catch(() => {});
  }
}
const applied = await appliedOrder();

describe("prisma/migrations", () => {
  it("every folder is a 14-digit timestamp and a lower-case name", () => {
    expect(folders.length).toBeGreaterThan(0);
    for (const f of folders) expect(f, f).toMatch(/^\d{14}_[a-z0-9_]+$/);
  });

  it("names and timestamps are unique", () => {
    expect(new Set(folders).size).toBe(folders.length);
    const stamps = folders.map((f) => f.slice(0, 14));
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it.skipIf(!applied)("the local database applied them in folder (name) order, the newest last", () => {
    expect(applied).toEqual(sorted.slice(0, applied!.length));
    expect(applied!.at(-1)).toBe(sorted.at(-1));
  });
});
