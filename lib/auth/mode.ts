/**
 * Which sign-in method is on, as pure rules (no database), so they can be tested and shared by the
 * providers, the login page, user creation and the start-up check (lib/env/check.ts).
 *
 * Test sign-in (pick a test user, no password) is for LOCAL development only (D-021):
 *   - AUTH_MODE=entra or AUTH_MODE=test is respected as set;
 *   - AUTH_MODE not set: "test" only when APP_ENV is local, otherwise "entra";
 *   - test sign-in works only when the mode is "test" AND APP_ENV is local. Staging and production
 *     refuse to start with AUTH_MODE=test (checkEnv), and even if they did start, nobody could use it.
 * APP_ENV not set counts as local (the same rule as checkEnv).
 */
export type AuthMode = "test" | "entra";
type Env = Record<string, string | undefined>;

export function appEnvOf(env: Env = process.env): string {
  return env.APP_ENV?.trim().toLowerCase() || "local";
}

export function authMode(env: Env = process.env): AuthMode {
  const m = env.AUTH_MODE?.trim().toLowerCase();
  if (m === "entra") return "entra";
  if (m === "test") return "test";
  return appEnvOf(env) === "local" ? "test" : "entra";
}

export function testSignInAllowed(env: Env = process.env): boolean {
  return authMode(env) === "test" && appEnvOf(env) === "local";
}

/**
 * Users added in the app (Users, Add) or by the users import are test users only where test sign-in is
 * allowed (local development). In staging and production they are always real users.
 */
export function newUsersAreTestUsers(env: Env = process.env): boolean {
  return testSignInAllowed(env);
}

/** Where to go after signing in: a path on this site only (never //host, /\host or the login page). */
export function safeNext(next: unknown): string {
  const v = typeof next === "string" ? next : "";
  const ok = v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") && !v.startsWith("/login");
  return ok ? v : "/dashboard";
}
