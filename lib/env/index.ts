import { UserError } from "@/lib/services/errors";
import { APP_ENVS, checkEnv, myLoansBaseUrlFrom, refusalMessage, type AppEnv } from "./check";

export { APP_ENVS, checkEnv, refusalMessage, type AppEnv } from "./check";

/**
 * Server-side environment helpers. NODE_ENV=production is also used by `next start` on a developer
 * PC, so it cannot tell this PC from the real server: APP_ENV does (local, staging, production).
 */
export function appEnv(): AppEnv {
  const v = process.env.APP_ENV?.trim().toLowerCase();
  if (!v) return "local";
  // An unknown value is treated as production: the safe side (test helpers off). Startup refuses it anyway.
  return (APP_ENVS as readonly string[]).includes(v) ? (v as AppEnv) : "production";
}
export const isProduction = () => appEnv() === "production";

/** Test helpers (simulator, Reset test data, sample loans, mock MyLoans) refuse in production, even for Admin. */
export function refuseInProduction(what: string): void {
  if (isProduction()) throw new UserError(`${what} is not available in production.`);
}

let warnedOldName = false;
/** The MyLoans address. The old name MYLOANS_API_BASE_URL still works, with a one-line warning (once). */
export function myLoansBaseUrl(): string {
  const r = myLoansBaseUrlFrom(process.env);
  if (r.oldName && !warnedOldName) {
    warnedOldName = true;
    console.warn("[env] MYLOANS_API_BASE_URL is the old name: rename it to MYLOANS_BASE_URL in your env files.");
  }
  return r.value;
}
/** Tests only. */
export function resetEnvWarnings() {
  warnedOldName = false;
}

/**
 * Startup check (instrumentation.ts and the console scripts). Production and staging throw on any
 * error; local only warns. Messages name the variable, never its value.
 */
export function assertEnvAtStartup(log: Pick<Console, "warn"> = console): void {
  const r = checkEnv(process.env);
  myLoansBaseUrl(); // the old-name warning, once
  for (const w of r.warnings) log.warn(`[env] ${w}`);
  if (r.appEnv !== "local" && r.errors.length) throw new Error(refusalMessage(r));
  for (const e of r.appEnv === "local" ? r.errors : []) log.warn(`[env] ${e}`);
}
