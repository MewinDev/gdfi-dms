import { execFileSync } from "node:child_process";
import { databaseName } from "@/lib/env/load-files";

/**
 * The local Docker database, for the developer commands (npm run db:create-test and the Manual Test
 * Kit). Every call runs `docker` directly (no shell), so the same code works from PowerShell, Command
 * Prompt and Git Bash. Files go in and out with `docker cp`, never through a console pipe.
 */
const SERVICE = "gdfi-dms-db";

let cached: string | null = null;
/** The running database container (docker compose service gdfi-dms-db). */
export function containerId(): string {
  if (cached) return cached;
  let id = "";
  try {
    id = execFileSync("docker", ["compose", "ps", "-q", SERVICE], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split(/\s+/)[0] ?? "";
  } catch {
    throw new Error("Docker is not running, or the database container is not started. Start Docker Desktop, then run npm run db:up.");
  }
  if (!id) throw new Error("The database container is not running. Run npm run db:up.");
  cached = id;
  return id;
}

/** The database user from the connection string (never the password). */
export function dbUser(url = process.env.DIRECT_URL || process.env.DATABASE_URL || ""): string {
  try {
    return decodeURIComponent(new URL(url).username) || process.env.POSTGRES_USER || "postgres";
  } catch {
    return process.env.POSTGRES_USER || "postgres";
  }
}

export function docker(args: string[], opts: { input?: string } = {}): string {
  try {
    return execFileSync("docker", args, { encoding: "utf8", input: opts.input, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    // Docker and Postgres messages never contain the password (it is not passed on the command line).
    throw new Error((err.stderr || err.message).toString().trim().split("\n").slice(-3).join(" "));
  }
}

/** Runs SQL in a database through psql in the container (stdin, so quotes and new lines are safe). Returns the rows as text. */
export function psql(database: string, sql: string): string {
  return docker(["exec", "-i", containerId(), "psql", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A", "-U", dbUser(), "-d", database], { input: sql });
}

/** Single-quoted SQL literal. */
export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** Double-quoted SQL identifier. */
export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function databaseExists(name: string): boolean {
  return psql("postgres", `SELECT 1 FROM pg_database WHERE datname = ${lit(name)};`).trim() === "1";
}

/** Closes every other connection to a database (the dev server reconnects by itself on its next query). */
export function terminateConnections(name: string) {
  psql("postgres", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${lit(name)} AND pid <> pg_backend_pid();`);
}

export const nameOf = (url: string | undefined) => databaseName(url);

const BINS = { prisma: "node_modules/prisma/build/index.js", tsx: "node_modules/tsx/dist/cli.mjs" } as const;
/** Runs the project's own Prisma or tsx through Node (no shell, works the same on every console). */
export function runBin(bin: keyof typeof BINS, args: string[], env: NodeJS.ProcessEnv, quiet = false) {
  execFileSync(process.execPath, [BINS[bin], ...args], { env, stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit" });
}
