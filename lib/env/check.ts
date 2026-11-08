import { z } from "zod";

/**
 * Environment check (pure: takes the variables, returns plain messages). Every message names the
 * variable and never its value. Used at startup (instrumentation.ts), by the console scripts and by
 * the tests. APP_ENV decides how strict it is:
 *   local       nothing blocks; missing optional values are warnings
 *   staging     like production, but MYLOANS_MODE may be mock and TEST_MODE may be true
 *   production  refuses to start on any error below
 */
export const APP_ENVS = ["local", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];
export type Env = Record<string, string | undefined>;
export interface EnvReport { appEnv: AppEnv; errors: string[]; warnings: string[] }

/** Empty or blank counts as not set. */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : typeof v === "string" ? v.trim() : v);
const lower = (v: unknown) => { const b = blank(v); return typeof b === "string" ? b.toLowerCase() : b; };
const oneOf = <T extends readonly [string, ...string[]]>(values: T, caseless = false) => z.preprocess(caseless ? lower : blank, z.enum(values).optional());

/** Variables with a fixed set of values: anything else is refused in every environment. */
const SCHEMA = z.object({
  APP_ENV: oneOf(APP_ENVS, true),
  TEST_MODE: oneOf(["true", "false"]),
  MYLOANS_MODE: oneOf(["mock", "live"], true),
  EMAIL_AUTO_DRAIN: oneOf(["true", "false"]),
  AUTH_MODE: oneOf(["test", "entra"]),
  STORAGE_DRIVER: oneOf(["local", "supabase"], true),
  SEED_TEST_USERS: oneOf(["true", "false"]),
  MYLOANS_TIMEOUT_MS: z.preprocess(blank, z.coerce.number().int().min(500).max(120_000).optional()),
});
const HINT: Record<keyof z.infer<typeof SCHEMA>, string> = {
  APP_ENV: "must be local, staging or production.",
  TEST_MODE: "must be true or false.",
  MYLOANS_MODE: "must be mock or live.",
  EMAIL_AUTO_DRAIN: "must be true or false.",
  AUTH_MODE: "must be test or entra.",
  STORAGE_DRIVER: "must be local or supabase.",
  SEED_TEST_USERS: "must be true or false.",
  MYLOANS_TIMEOUT_MS: "must be a whole number of milliseconds between 500 and 120000.",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"]);
/** null: not a valid address. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase(); // "localhost." is localhost too
  } catch {
    return null;
  }
}
export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost") || /^127\./.test(host);
}

export const GRAPH_NAMES = ["GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET", "GRAPH_TENANT_ID", "GRAPH_SENDER_EMAIL"] as const;

/** The MyLoans address: the new name wins; the old name MYLOANS_API_BASE_URL is read as a fallback. */
export function myLoansBaseUrlFrom(env: Env): { value: string; oldName: boolean } {
  const now = env.MYLOANS_BASE_URL?.trim();
  if (now) return { value: now, oldName: false };
  const old = env.MYLOANS_API_BASE_URL?.trim();
  return old ? { value: old, oldName: true } : { value: "", oldName: false };
}

export function checkEnv(env: Env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = SCHEMA.safeParse(env);
  const bad = new Set<string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0]) as keyof typeof HINT;
      if (bad.has(name)) continue;
      bad.add(name);
      errors.push(`${name} ${HINT[name]}`);
    }
  }
  const v = (parsed.success ? parsed.data : {}) as Partial<z.infer<typeof SCHEMA>>;
  const appEnv: AppEnv = bad.has("APP_ENV") ? "production" : v.APP_ENV ?? "local"; // an unknown APP_ENV is checked as strictly as production
  const strict = appEnv !== "local";
  const where = appEnv === "production" ? "in production" : "in staging";
  const set = (name: string) => !!env[name]?.trim();
  const testMode = env.TEST_MODE?.trim() === "true";
  const mode = (env.MYLOANS_MODE?.trim().toLowerCase() || "mock") as "mock" | "live";
  // Strict environments: an error. Local: a warning only.
  const need = (msg: string) => (strict ? errors : warnings).push(msg);

  if (appEnv === "production" && testMode) errors.push("TEST_MODE must be false in production.");
  if (appEnv === "staging" && testMode && !set("EMAIL_TEST_RECIPIENT")) warnings.push("EMAIL_TEST_RECIPIENT is not set: in test mode emails are not sent to anyone.");
  if (appEnv === "production" && !bad.has("MYLOANS_MODE") && mode !== "live") errors.push("MYLOANS_MODE must be live in production.");

  for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
    const url = env[name]?.trim();
    if (!url) { need(`${name} is not set.`); continue; }
    const host = hostOf(url);
    if (host === null) need(`${name} is not a valid database address.`);
    else if (strict && isLocalHost(host)) errors.push(`${name} points to this computer (localhost); use the hosted database ${where}.`);
  }

  const base = env.APP_BASE_URL?.trim();
  if (!base) need("APP_BASE_URL is not set (links in emails use it).");
  else {
    const host = hostOf(base);
    if (host === null) need("APP_BASE_URL is not a valid web address.");
    else if (strict && !base.toLowerCase().startsWith("https://")) errors.push(`APP_BASE_URL must start with https:// ${where}.`);
    else if (strict && isLocalHost(host)) errors.push(`APP_BASE_URL points to this computer (localhost); use the real address ${where}.`);
  }

  const cron = env.CRON_SECRET?.trim() ?? "";
  if (!cron) need("CRON_SECRET is not set: the scheduled email and MyLoans runs are refused.");
  else if (strict && cron.length < 24) errors.push(`CRON_SECRET must be at least 24 characters ${where}.`);
  else if (cron.length < 16) warnings.push("CRON_SECRET is shorter than 16 characters: the scheduled runs are refused.");

  const session = env.SESSION_SECRET?.trim() ?? "";
  if (!session) need("SESSION_SECRET is not set: nobody can sign in.");
  else if (session.length < 32) need("SESSION_SECRET must be at least 32 characters.");

  if (appEnv === "production" || mode === "live") {
    const msg = (name: string) => `${name} is not set${appEnv === "production" ? " (needed in production)" : " (needed when MYLOANS_MODE is live)"}.`;
    if (!myLoansBaseUrlFrom(env).value) (strict ? errors : warnings).push(msg("MYLOANS_BASE_URL"));
    if (!set("MYLOANS_API_KEY")) (strict ? errors : warnings).push(msg("MYLOANS_API_KEY"));
  }

  const missingGraph = GRAPH_NAMES.filter((n) => !set(n));
  if (missingGraph.length) warnings.push(`${missingGraph.join(", ")} ${missingGraph.length === 1 ? "is" : "are"} not set: emails stay Not set up.`);
  if (strict && env.EMAIL_AUTO_DRAIN?.trim() === "false") warnings.push("EMAIL_AUTO_DRAIN is false: emails wait for the scheduled sender (POST /api/cron/email-reminders).");
  if (appEnv === "production" && (env.AUTH_MODE?.trim() || "test") === "test") warnings.push("AUTH_MODE is test: the test sign-in buttons are on. Switch to entra once Microsoft sign-in is set up.");

  return { appEnv, errors, warnings };
}

/** The message shown when the server refuses to start. Names only. */
export function refusalMessage(r: EnvReport): string {
  const label = r.appEnv === "production" ? "Production" : r.appEnv === "staging" ? "Staging" : "Local";
  return [`GDFI DMS will not start (${label}). Fix these settings:`, ...r.errors.map((e) => `  - ${e}`)].join("\n");
}
