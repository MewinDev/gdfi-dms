import { databaseName } from "./load-files";

/**
 * Guard for commands that reset, drop or overwrite data (prisma migrate reset, the integration tests,
 * the Playwright e2e reset). They run only when:
 *   - APP_ENV is not staging or production (never, whatever else is set), and
 *   - every database they would touch has "test" in its name, or ALLOW_DESTRUCTIVE=1 is set on purpose.
 * Returns the refusal in plain words, or null when allowed. Never shows a URL or a password.
 */
export function destructiveRefusal(what: string, env: Record<string, string | undefined> = process.env): string | null {
  const appEnv = (env.APP_ENV ?? "").trim().toLowerCase();
  if (appEnv === "staging" || appEnv === "production") return `${what} never runs when APP_ENV is ${appEnv}.`;
  const names = [...new Set([databaseName(env.DATABASE_URL), databaseName(env.DIRECT_URL)].filter((x): x is string => !!x))];
  if (!names.length) return `${what}: DATABASE_URL is not set.`;
  if (names.every((n) => n.toLowerCase().includes("test"))) return null;
  if (env.ALLOW_DESTRUCTIVE === "1") return null;
  return `${what} would change the database "${names.join('", "')}". Use a database with "test" in its name, or set ALLOW_DESTRUCTIVE=1 if you mean it.`;
}

export function assertDestructiveAllowed(what: string, env: Record<string, string | undefined> = process.env): void {
  const why = destructiveRefusal(what, env);
  if (why) throw new Error(why);
}
