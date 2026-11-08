import { databaseName } from "@/lib/env/load-files";

/**
 * Manual Test Kit safety checks. Pure functions over an env object, so they are unit-tested and run
 * the same in the npm scripts, the Settings panel, its route and its server actions (on every call,
 * from the server's own environment, never from anything the browser sends).
 *
 * The kit runs only when ALL of these hold:
 *   - APP_ENV is exactly "local" (never staging or production, never unset-and-guessed),
 *   - TEST_MODE is "true",
 *   - every database it would touch is on this PC and in the allow-list (gdfi_dms only; the automated
 *     tests' gdfi_dms_test is never on it).
 * The npm scripts also blank the Microsoft Graph values for their own run, so nothing they do can send
 * an email; the email switch is set to Not active after every start, reset and restore.
 */
export const KIT_DATABASES: readonly string[] = ["gdfi_dms"];

/**
 * Where the kit works: the allow-list and the folder. Only the kit's own integration test changes them
 * (to run the kit on gdfi_dms_test with a scratch folder), and only inside Vitest.
 */
export const kitConfig: { databases: readonly string[]; dir: string } = { databases: KIT_DATABASES, dir: "storage/kit" };
export function setKitConfigForTests(next: Partial<typeof kitConfig>) {
  if (!process.env.VITEST) throw new Error("Only the kit's own tests may change where the kit works.");
  Object.assign(kitConfig, next);
}
export const KIT_CONFIRM_WORD = "RESET";
export const GRAPH_KEYS = ["GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_TENANT_ID", "GRAPH_SENDER_EMAIL"] as const;

type Env = Record<string, string | undefined>;

export function kitRefusal(env: Env = process.env): string | null {
  const appEnv = (env.APP_ENV ?? "").trim().toLowerCase();
  if (appEnv !== "local") return `The Manual Test Kit runs only on a developer PC (APP_ENV=local)${appEnv ? `, not ${appEnv}` : ""}.`;
  if (env.TEST_MODE !== "true") return "The Manual Test Kit needs test mode (TEST_MODE=true).";
  if ((env.MYLOANS_MODE ?? "mock").trim().toLowerCase() === "live") return "The Manual Test Kit needs the sample MyLoans (MYLOANS_MODE=mock): its loans come from there.";
  const urls = [env.DATABASE_URL, env.DIRECT_URL].filter((x): x is string => !!x);
  if (!urls.length) return "The Manual Test Kit: DATABASE_URL is not set.";
  if (urls.some((u) => !/@(localhost|127\.0\.0\.1)[:/]/.test(u))) return "The Manual Test Kit works only on the database on this PC (localhost).";
  const names = [...new Set(urls.map((u) => databaseName(u) ?? ""))];
  const bad = names.filter((n) => !kitConfig.databases.includes(n));
  if (bad.length) return `The Manual Test Kit works only on ${kitConfig.databases.join(", ")}, not "${bad.join('", "')}".`;
  return null;
}

export const kitAvailable = (env: Env = process.env) => kitRefusal(env) === null;

/** The database the kit works on (after kitRefusal passed). */
export function kitDatabase(env: Env = process.env): string {
  return databaseName(env.DIRECT_URL || env.DATABASE_URL) ?? kitConfig.databases[0];
}

/** For the npm scripts: no Microsoft Graph values in this run, so no email can leave. Returns the names it blanked. */
export function blankGraph(env: Env = process.env): string[] {
  const blanked = GRAPH_KEYS.filter((k) => !!env[k]);
  for (const k of GRAPH_KEYS) env[k] = "";
  return blanked;
}

/** Reset and Restore replace everything: the person types RESET (capitals) to go ahead. */
export function confirmRefusal(typed: string | null | undefined): string | null {
  return (typed ?? "").trim() === KIT_CONFIRM_WORD ? null : `Type ${KIT_CONFIRM_WORD} to confirm.`;
}

export const OUT_OF_DATE = "The baseline is out of date. Run `npm run kit:rebuild`.";

/** True when the migrations saved with a dump differ from the ones in prisma/migrations now. */
export function migrationsDiffer(saved: readonly string[], current: readonly string[]): boolean {
  return saved.length !== current.length || saved.some((m, i) => m !== current[i]);
}

/** A backup name: letters, digits, dash and underscore, 1 to 60 characters; "baseline" and "pre-reset-" are the kit's own. */
export function backupNameRefusal(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  if (!n) return "Give the backup a name.";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(n)) return "Use letters, digits, - and _ only (up to 60), starting with a letter or digit.";
  if (n.toLowerCase() === "baseline" || n.toLowerCase().startsWith("pre-reset-")) return `"${n}" is used by the kit itself. Pick another name.`;
  return null;
}
