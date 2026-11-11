import type { MyLoansAdapter, MyLoansLookup } from "./types";
import { cleanPn } from "@/lib/pn/format";

/**
 * One way to ask MyLoans for a loan, per server process: simultaneous asks for the same PN share one
 * call (coalescing), answers are kept about a minute (short cache), every call is counted against the
 * hour, and its time and trouble (429, no answer) are recorded for the sync statistics.
 */
const CACHE_MS = 60_000;
const inflight = new Map<string, Promise<MyLoansLookup>>();
const cache = new Map<string, { at: number; value: MyLoansLookup }>();
let hour = { key: "", count: 0 };

export interface CallStats { calls: number; saved: number; rateLimited: number; failed: number; ms: number[] }
let stats: CallStats = { calls: 0, saved: 0, rateLimited: 0, failed: 0, ms: [] };

const hourKey = (now: number) => new Date(now).toISOString().slice(0, 13);
/** Calls made to MyLoans in the current clock hour (this server). */
export function callsThisHour(now: number = Date.now()) { return hour.key === hourKey(now) ? hour.count : 0; }
/** A sync run reads and resets its own statistics. */
export function beginStats() { stats = { calls: 0, saved: 0, rateLimited: 0, failed: 0, ms: [] }; }
export function readStats(): CallStats { return { ...stats, ms: [...stats.ms] }; }
/** Tests only. */
export function resetClient() { inflight.clear(); cache.clear(); hour = { key: "", count: 0 }; beginStats(); }

/** An answer for this PN is in the short cache (reusing it costs no call). */
export function hasCached(pn: string, now: number = Date.now(), variant?: string) {
  const hit = cache.get(variant ? `${cleanPn(pn)}|${variant}` : cleanPn(pn));
  return !!hit && now - hit.at < CACHE_MS;
}

/** A call made outside lookupPn (the changed-since feed): counted the same way. */
export function noteCall(ms: number, r: { ok: boolean; retryAfterMs?: number }, now: number = Date.now()) {
  const k = hourKey(now);
  hour = hour.key === k ? { key: k, count: hour.count + 1 } : { key: k, count: 1 };
  stats.calls++;
  stats.ms.push(ms);
  if (!r.ok) { stats.failed++; if (r.retryAfterMs !== undefined) stats.rateLimited++; }
}

/**
 * variant: kept apart in the short cache (the sample MyLoans passes the simulated change for this PN, so
 * a simulated change is seen at once instead of after the cache time).
 */
export async function lookupPn(adapter: MyLoansAdapter, pn: string, o: { fresh?: boolean; now?: () => number; variant?: string } = {}): Promise<MyLoansLookup> {
  const now = o.now ?? Date.now;
  const key = o.variant ? `${cleanPn(pn)}|${o.variant}` : cleanPn(pn);
  const hit = cache.get(key);
  if (!o.fresh && hit && now() - hit.at < CACHE_MS) { stats.saved++; return hit.value; }
  const running = inflight.get(key);
  if (running) { stats.saved++; return running; }
  const started = now();
  const k = hourKey(started);
  hour = hour.key === k ? { key: k, count: hour.count + 1 } : { key: k, count: 1 };
  stats.calls++;
  const p = adapter.getByPn(cleanPn(pn)).then((r) => {
    stats.ms.push(now() - started);
    if (!r.ok && r.reason === "UNAVAILABLE") { stats.failed++; if (r.retryAfterMs !== undefined) stats.rateLimited++; }
    if (r.ok) cache.set(key, { at: now(), value: r });
    if (cache.size > 2_000) cache.delete(cache.keys().next().value!);
    return r;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
