/**
 * Development only (D-052): an in-app timer that calls the sync endpoint every minute, so the myloans sync runs
 * under `next dev` without a scheduler. On only with MYLOANS_SYNC_DEV_TIMER=true and APP_ENV=local, and only when
 * CRON_SECRET is set. It calls the same endpoint any scheduler calls (docs/SCHEDULER.md); the endpoint decides
 * what is due (the catch-up, or a change run when the interval passed). Never on staging or production.
 */
export function devTimerWanted(env: Record<string, string | undefined> = process.env): boolean {
  return env.MYLOANS_SYNC_DEV_TIMER === "true" && (env.APP_ENV ?? "local") === "local" && (env.CRON_SECRET?.trim().length ?? 0) >= 16;
}

const KEY = Symbol.for("gdfi.myloansDevTimer");

export function startDevTimer(env: Record<string, string | undefined> = process.env): boolean {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (!devTimerWanted(env) || g[KEY]) return false;
  const url = `http://127.0.0.1:${env.PORT ?? "3000"}/api/cron/myloans-sync`;
  const tick = () => {
    fetch(url, { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET!.trim() } }).catch(() => null);
  };
  const t = setInterval(tick, 60_000);
  t.unref?.();
  g[KEY] = t;
  console.log("[myloans] development sync timer on: the sync endpoint is called every minute.");
  return true;
}
