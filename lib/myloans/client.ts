import type { MyLoansAdapter, MyLoansLookup } from "./types";
import { cleanPn } from "@/lib/pn/format";

/**
 * One way to ask MyLoans for a loan: simultaneous asks for the same PN share one call (coalescing, per
 * process), answers are kept about a minute (short cache, per process), and every call is counted in
 * the hour. The hourly count is SHARED (table MyLoansCallHour): every server instance, the cron endpoint
 * and the console script add to the same "This hour", one atomic statement per call, so two calls at the
 * same moment cannot both slip past the limit. If the count cannot be written, no call is made (fail safe:
 * "MyLoans is busy"). Time and trouble (429, no answer) are recorded for the run's statistics.
 */
const CACHE_MS = 60_000;
const inflight = new Map<string, Promise<MyLoansLookup>>();
const cache = new Map<string, { at: number; value: MyLoansLookup }>();

/** The words when the hourly limit, the circuit breaker or the shared count stops a call. */
export const BUSY_MESSAGE = "MyLoans is busy, please try again in a few minutes.";

export interface CallStats { calls: number; saved: number; rateLimited: number; failed: number; ms: number[] }
let stats: CallStats = { calls: 0, saved: 0, rateLimited: 0, failed: 0, ms: [] };

/** The clock hour a call belongs to (UTC, "2026-11-12T06"). */
export const hourKey = (now: number) => new Date(now).toISOString().slice(0, 13);

/** Where the hourly count lives. The app uses the database; unit tests may use memory. */
export interface CallStore {
  /** Calls counted in this hour. */
  count(hour: string): Promise<number>;
  /** Count one call (always). */
  add(hour: string): Promise<void>;
  /** Count one call only while under the ceiling; false when the hour is full. One atomic step. */
  reserve(hour: string, ceiling: number): Promise<boolean>;
}

export class MemoryCallStore implements CallStore {
  private rows = new Map<string, number>();
  async count(hour: string) { return this.rows.get(hour) ?? 0; }
  async add(hour: string) { this.rows.set(hour, (this.rows.get(hour) ?? 0) + 1); }
  async reserve(hour: string, ceiling: number) {
    const n = this.rows.get(hour) ?? 0;
    if (n >= ceiling) return false;
    this.rows.set(hour, n + 1);
    return true;
  }
}

/** The shared count: one row per hour; INSERT ... ON CONFLICT DO UPDATE ... WHERE calls < ceiling RETURNING. */
export class DbCallStore implements CallStore {
  private async db() { return (await import("@/lib/db")).prisma; }
  async count(hour: string) {
    const rows = await (await this.db()).$queryRaw<{ calls: number }[]>`SELECT "calls" FROM "MyLoansCallHour" WHERE "hour" = ${hour}`;
    return rows[0]?.calls ?? 0;
  }
  async add(hour: string) {
    await (await this.db()).$executeRaw`
      INSERT INTO "MyLoansCallHour" ("hour", "calls", "updatedAt") VALUES (${hour}, 1, NOW())
      ON CONFLICT ("hour") DO UPDATE SET "calls" = "MyLoansCallHour"."calls" + 1, "updatedAt" = NOW()`;
  }
  async reserve(hour: string, ceiling: number) {
    if (ceiling <= 0) return false;
    const rows = await (await this.db()).$queryRaw<{ calls: number }[]>`
      INSERT INTO "MyLoansCallHour" ("hour", "calls", "updatedAt") VALUES (${hour}, 1, NOW())
      ON CONFLICT ("hour") DO UPDATE SET "calls" = "MyLoansCallHour"."calls" + 1, "updatedAt" = NOW()
      WHERE "MyLoansCallHour"."calls" < ${ceiling}
      RETURNING "calls"`;
    return rows.length === 1;
  }
  /** Hours older than two days are not needed (one small delete per sync run). */
  async prune(now: number) {
    await (await this.db()).$executeRaw`DELETE FROM "MyLoansCallHour" WHERE "hour" < ${hourKey(now - 2 * 86_400_000)}`;
  }
}

let store: CallStore = new DbCallStore();
/** Tests: another store (memory, or one that fails). Returns the previous one. */
export function setCallStore(s: CallStore) { const was = store; store = s; return was; }
export function callStore() { return store; }

/** Calls made to MyLoans in the current clock hour, by every instance (the shared count). 0 if it cannot be read. */
export async function callsThisHour(now: number = Date.now()) {
  try { return await store.count(hourKey(now)); } catch { return 0; }
}
/** A sync run reads and resets its own statistics. */
export function beginStats() { stats = { calls: 0, saved: 0, rateLimited: 0, failed: 0, ms: [] }; }
export function readStats(): CallStats { return { ...stats, ms: [...stats.ms] }; }
/** Tests only: the short cache, in-flight calls and statistics of this process (the shared count is in the database). */
export function resetClient() { inflight.clear(); cache.clear(); beginStats(); }

/** An answer for this PN is in the short cache (reusing it costs no call). */
export function hasCached(pn: string, now: number = Date.now(), variant?: string) {
  const hit = cache.get(variant ? `${cleanPn(pn)}|${variant}` : cleanPn(pn));
  return !!hit && now - hit.at < CACHE_MS;
}

/**
 * Count a call before making it. With a ceiling: only while the hour has room (atomic). Returns false when
 * the call must not be made: the hour is full, or the count could not be written (fail safe).
 */
export async function countCall(o: { ceiling?: number; now?: number } = {}): Promise<boolean> {
  const hour = hourKey(o.now ?? Date.now());
  try {
    if (o.ceiling === undefined) { await store.add(hour); return true; }
    return await store.reserve(hour, o.ceiling);
  } catch {
    return false;
  }
}

/** A call made outside lookupPn (the changed-since feed), already counted with countCall: its statistics. */
export function noteCall(ms: number, r: { ok: boolean; retryAfterMs?: number }) {
  stats.calls++;
  stats.ms.push(ms);
  if (!r.ok) { stats.failed++; if (r.retryAfterMs !== undefined) stats.rateLimited++; }
}

/**
 * variant: kept apart in the short cache (the sample MyLoans passes the simulated change for this PN, so
 * a simulated change is seen at once instead of after the cache time).
 * ceiling: the hourly limit applies (the background run, the stale refresh, a new PN in Find loan); without
 * it the call is still counted (a person's Refresh, refresh on open).
 */
export async function lookupPn(adapter: MyLoansAdapter, pn: string, o: { fresh?: boolean; now?: () => number; variant?: string; ceiling?: number } = {}): Promise<MyLoansLookup> {
  const now = o.now ?? Date.now;
  const key = o.variant ? `${cleanPn(pn)}|${o.variant}` : cleanPn(pn);
  const hit = cache.get(key);
  if (!o.fresh && hit && now() - hit.at < CACHE_MS) { stats.saved++; return hit.value; }
  const running = inflight.get(key);
  if (running) { stats.saved++; return running; }
  const started = now();
  const p = (async (): Promise<MyLoansLookup> => {
    if (!(await countCall({ ceiling: o.ceiling, now: started }))) return { ok: false, reason: "UNAVAILABLE", message: BUSY_MESSAGE, limited: true };
    stats.calls++;
    const r = await adapter.getByPn(cleanPn(pn));
    stats.ms.push(now() - started);
    if (!r.ok && r.reason === "UNAVAILABLE") { stats.failed++; if (r.retryAfterMs !== undefined) stats.rateLimited++; }
    if (r.ok) cache.set(key, { at: now(), value: r });
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
    return r;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
