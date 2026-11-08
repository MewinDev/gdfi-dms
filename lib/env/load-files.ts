import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Loads env files into `env` with ONE precedence everywhere: a variable already set (the shell, CI,
 * the host) wins, then the first file that has it. Call with [".env.local", ".env"]. Written out
 * here (not left to process.loadEnvFile) so the rule is explicit and tested. Returns where each
 * value came from ("shell" or the file name). No secrets are logged.
 */
export function loadEnvFiles(
  files: string[],
  env: Record<string, string | undefined> = process.env,
  read: (file: string) => string | null = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null),
): Record<string, string> {
  const from: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) from[k] = "shell";
  for (const file of files) {
    const text = read(file);
    if (text === null) continue;
    for (const [k, v] of Object.entries(parseEnv(text))) {
      if (env[k] !== undefined) continue; // the shell, or an earlier file, already set it
      env[k] = v;
      from[k] = file;
    }
  }
  return from;
}

/** The database name in a Postgres URL ("gdfi_dms"), or null when it cannot be read. */
export function databaseName(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
}

/**
 * DATABASE_URL (the app) and DIRECT_URL (migrations) must name the same database. Setting only one in
 * the shell would leave the other pointing at the main database from .env.local: refuse that.
 */
export function databaseUrlMismatch(env: Record<string, string | undefined> = process.env): string | null {
  const a = databaseName(env.DATABASE_URL);
  const b = databaseName(env.DIRECT_URL);
  if (!a || !b || a === b) return null;
  return `DATABASE_URL and DIRECT_URL name different databases ("${a}" and "${b}"). Set both to the same database.`;
}
