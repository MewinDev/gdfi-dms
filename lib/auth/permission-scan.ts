import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The server-side rule, kept true by a test (lib/auth/permission-scan.test.ts): every exported server
 * action (app/actions, app/login/actions.ts) and every route handler (app/api) calls a permission check,
 * or is on this short allow-list with the reason and the check it uses instead. Buttons only hide for
 * convenience; the server is the real check. docs/workflow/12-permissions.md prints this list.
 */
export const CHECK_CALLS = ["requirePermission(", "requireAnyPermission(", "requirePagePermission(", "requirePageAny(", "can("];

export interface AllowEntry {
  file: string;
  name: string;
  why: string;
  /** Text that must still be in the handler (its own check), so the allow-list cannot hide a missing one. */
  mustContain: string;
}

export const ALLOW_LIST: AllowEntry[] = [
  { file: "app/api/health/route.ts", name: "GET", why: "Health check for the host: ok, environment, database up or down. No data.", mustContain: "health(" },
  { file: "app/api/cron/myloans-sync/route.ts", name: "POST", why: "Scheduled MyLoans sync: its own secret (CRON_SECRET header), not a person.", mustContain: "cronAllowed(" },
  { file: "app/api/cron/email-reminders/route.ts", name: "POST", why: "Scheduled email reminders: its own secret (CRON_SECRET header), not a person.", mustContain: "cronAllowed(" },
  { file: "app/login/actions.ts", name: "testSignIn", why: "Test sign-in: before anyone is signed in (the test provider refuses outside test mode).", mustContain: "testProvider.resolveUser(" },
  { file: "app/login/actions.ts", name: "signOut", why: "Sign out: anyone may end their own session.", mustContain: "cookies()).delete(SESSION_COOKIE)" },
  { file: "app/actions/loan.ts", name: "markNotificationsReadAction", why: "Marks the signed-in person's own notifications as read.", mustContain: "getCurrentUser(" },
  { file: "app/actions/email.ts", name: "myEmailPreferenceAction", why: "The signed-in person's own email choice (non-urgent emails on or off).", mustContain: "getCurrentUser(" },
];

const toPosix = (p: string) => p.split(path.sep).join("/");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The files to scan: every server-action file and every route handler. */
export function serverEntryFiles(root = process.cwd()): string[] {
  const actions = readdirSync(path.join(root, "app/actions")).filter((n) => n.endsWith(".ts")).map((n) => `app/actions/${n}`);
  const routes = walk(path.join(root, "app/api")).filter((p) => /route\.ts$/.test(p)).map((p) => toPosix(path.relative(root, p)));
  return [...actions, "app/login/actions.ts", ...routes].sort();
}

/** Top-level functions of a file: name to body (up to the next top-level declaration). */
function topLevelFunctions(src: string): Map<string, string> {
  const re = /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm;
  const hits: { name: string; at: number }[] = [];
  for (let m = re.exec(src); m; m = re.exec(src)) hits.push({ name: m[1] ?? m[2], at: m.index });
  const out = new Map<string, string>();
  hits.forEach((h, i) => out.set(h.name, src.slice(h.at, hits[i + 1]?.at ?? src.length)));
  return out;
}

export interface ScanResult { file: string; name: string; ok: boolean; how: string }

/**
 * Each exported action or handler: ok when its body calls a check, or calls a helper of the same file
 * that does (for example kitUser() in app/actions/kit.ts), or is on the allow-list with its own check.
 */
export function scanServerEntries(root = process.cwd()): ScanResult[] {
  const results: ScanResult[] = [];
  for (const file of serverEntryFiles(root)) {
    const src = readFileSync(path.join(root, file), "utf8");
    const fns = topLevelFunctions(src);
    const exported = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm)].map((m) => m[1] ?? m[2]);
    const checks = (body: string) => CHECK_CALLS.some((c) => body.includes(c));
    const helpers = [...fns.entries()].filter(([, body]) => checks(body)).map(([n]) => n);
    for (const name of exported) {
      const body = fns.get(name) ?? "";
      const allow = ALLOW_LIST.find((a) => a.file === file && a.name === name);
      if (checks(body)) { results.push({ file, name, ok: true, how: "check" }); continue; }
      const helper = helpers.find((h) => h !== name && new RegExp(`\\b${h}\\(`).test(body));
      if (helper) { results.push({ file, name, ok: true, how: `via ${helper}()` }); continue; }
      if (allow) { results.push({ file, name, ok: body.includes(allow.mustContain), how: `allow-list (${allow.mustContain.replace("(", "")})` }); continue; }
      results.push({ file, name, ok: false, how: "no permission check" });
    }
  }
  return results;
}
