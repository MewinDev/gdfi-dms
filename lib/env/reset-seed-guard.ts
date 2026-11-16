import { destructiveRefusal } from "./destructive";
import { databaseName } from "./load-files";

/** The only database npm run db:reset-seed may replace: the local development database. */
export const RESET_SEED_DATABASE = "gdfi_dms";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Guard for npm run db:reset-seed (scripts/db-reset-seed.ts). It replaces everything in the local
 * development database, so it runs only when ALL of these hold:
 *   - APP_ENV is exactly "local" (never staging, production, or unset);
 *   - DATABASE_URL and DIRECT_URL both name gdfi_dms (never the test database gdfi_dms_test, never another);
 *   - the database is on this computer (localhost);
 *   - ALLOW_DESTRUCTIVE=1 is set for this one command (lib/env/destructive.ts).
 * Returns the refusal in plain words, or null when allowed. Never shows a URL or a password.
 */
export function resetSeedRefusal(env: Record<string, string | undefined> = process.env): string | null {
  const what = "npm run db:reset-seed";
  const appEnv = (env.APP_ENV ?? "").trim().toLowerCase();
  if (appEnv !== "local") return `${what} runs only when APP_ENV is local (it is "${appEnv || "not set"}").`;
  const urls = [env.DATABASE_URL, env.DIRECT_URL].filter((u): u is string => !!u?.trim());
  if (!urls.length) return `${what}: DATABASE_URL is not set.`;
  for (const u of urls) {
    const name = databaseName(u);
    if (name !== RESET_SEED_DATABASE) return `${what} replaces only the local development database ${RESET_SEED_DATABASE}; this points to "${name ?? "unknown"}".`;
    const host = hostOf(u);
    if (!host || !LOCAL_HOSTS.has(host)) return `${what} runs only against a database on this computer (localhost).`;
  }
  if (env.ALLOW_DESTRUCTIVE !== "1") return `${what} replaces everything in ${RESET_SEED_DATABASE}. Set ALLOW_DESTRUCTIVE=1 for this one command if you mean it.`;
  return destructiveRefusal(what, env);
}
