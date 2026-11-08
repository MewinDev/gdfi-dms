import { databaseName } from "./load-files";

/**
 * Two local databases (docs/ENVIRONMENT.md):
 *   gdfi_dms       the person's own data and manual testing (the Manual Test Kit).
 *   gdfi_dms_test  the automated tests (unit with a database, integration, Playwright e2e).
 * The automated tests always use the test database: TEST_DATABASE_URL when set, otherwise DATABASE_URL
 * with the database name swapped for gdfi_dms_test. They refuse any database without "test" in its
 * name, and ALLOW_DESTRUCTIVE does not change that.
 */
export const TEST_DATABASE_NAME = "gdfi_dms_test";

/** The same server, user and options as `url`, with another database name. */
export function withDatabaseName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

/** The test database URL: TEST_DATABASE_URL, or DATABASE_URL pointed at gdfi_dms_test. Null when neither is set. */
export function testDatabaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  const base = env.DIRECT_URL || env.DATABASE_URL;
  return base ? withDatabaseName(base, TEST_DATABASE_NAME) : null;
}

/** Points DATABASE_URL and DIRECT_URL at the test database (in `env`). Returns its name. */
export function pointAtTestDatabase(env: Record<string, string | undefined> = process.env): string | null {
  const url = testDatabaseUrl(env);
  if (!url) return null;
  env.DATABASE_URL = url;
  env.DIRECT_URL = url;
  return databaseName(url);
}

/**
 * The automated tests' own check: every database they would touch is on this PC and has "test" in its
 * name. No override: the person's gdfi_dms is never touched by a test run.
 */
export function testDatabaseRefusal(what: string, env: Record<string, string | undefined> = process.env): string | null {
  const urls = [env.DATABASE_URL, env.DIRECT_URL].filter((x): x is string => !!x);
  if (!urls.length) return `${what}: DATABASE_URL is not set.`;
  if (urls.some((u) => !/@(localhost|127\.0\.0\.1)[:/]/.test(u))) return `${what} only run against a database on this PC (localhost).`;
  const names = [...new Set(urls.map((u) => databaseName(u) ?? ""))];
  const bad = names.filter((n) => !n.toLowerCase().includes("test"));
  if (bad.length) return `${what} only run on a test database. "${bad.join('", "')}" is not one (expected ${TEST_DATABASE_NAME}).`;
  return null;
}

export function assertTestDatabase(what: string, env: Record<string, string | undefined> = process.env): void {
  const why = testDatabaseRefusal(what, env);
  if (why) throw new Error(why);
}
