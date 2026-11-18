import type { z } from "zod";
import { MemoryBreakerStore, type BreakerStore } from "@/lib/myloans/resilience";
import { countCall } from "@/lib/myloans/client";
import { UNAVAILABLE_MESSAGE } from "@/lib/myloans/types";
import {
  api1ManySchema, api1NotSelectableSchema, api1OkSchema, branchesSchema, driftMessage, feedPageSchema, productsSchema,
  type FeedPageV1, type FeedRowV1,
} from "./schema";

/**
 * Piece 6 (IMPLEMENTATION_PLAN.md 7.4): the myloans contract client. HTTP only; the same code in mock and live mode
 * (only the address, the key and, in tests, the fetch differ). Every answer is checked against the contract schemas;
 * failures come back as plain words. Retries with backoff on "did not answer", Retry-After on 429, the circuit
 * breaker and the hourly call count. The address and the key never appear in a message, a log or the database.
 */

export type V1Fail =
  | { ok: false; kind: "unavailable"; message: string; status?: number; limited?: true }
  | { ok: false; kind: "busy"; message: string; retryAfterMs: number }
  | { ok: false; kind: "unauthorized"; message: string }
  | { ok: false; kind: "drift"; message: string; status: number };
export type V1<T> = { ok: true; data: T } | V1Fail;

export type Api1V1 =
  | { status: 200; row: FeedRowV1 }
  | { status: 404 }
  | { status: 422; transactionStatusId: number; feedState: FeedRowV1["feedState"]; replacedByPnNo: string | null }
  | { status: 409; rows: FeedRowV1[] };

export const BUSY_TEXT = "myloans is busy. Try again in a few minutes.";
export const KEY_TEXT = "myloans refused the DMS key. Ask IT to check the myloans key setting.";

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  retries?: number;
  baseDelayMs?: number;
  maxRetryAfterMs?: number;
  breakAfter?: number;
  openMs?: number;
  breaker?: BreakerStore;
  /** Count each call in the shared hourly count (with this limit; undefined: counted, no limit). false: not counted. */
  ceiling?: number | false;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type Raw = { status: number; body: unknown; retryAfterMs?: number } | { status: 0 };

export class MyLoansClientV1 {
  private readonly o: Required<Omit<ClientOptions, "ceiling" | "fetchImpl">> & Pick<ClientOptions, "ceiling" | "fetchImpl">;
  constructor(opts: ClientOptions) {
    this.o = {
      timeoutMs: 8000, retries: 2, baseDelayMs: 500, maxRetryAfterMs: 30_000, breakAfter: 5, openMs: 60_000,
      breaker: new MemoryBreakerStore(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: Date.now, ...opts,
    };
  }

  /** One GET, no retry. status 0: no answer (network, timeout). */
  private async once(path: string): Promise<Raw> {
    const f = this.o.fetchImpl ?? fetch;
    try {
      const res = await f(`${this.o.baseUrl.replace(/\/+$/, "")}${path}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${this.o.apiKey}` },
        signal: AbortSignal.timeout(this.o.timeoutMs), cache: "no-store",
      });
      const text = await res.text();
      let body: unknown = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = Symbol.for("not-json"); }
      const ra = res.headers.get("retry-after");
      return { status: res.status, body, retryAfterMs: ra && /^\d+$/.test(ra) ? Number(ra) * 1000 : undefined };
    } catch {
      return { status: 0 };
    }
  }

  /** GET with the breaker, the hourly count, retries and Retry-After. Returns the raw answer or a plain failure. */
  private async get(path: string): Promise<{ ok: true; status: number; body: unknown } | V1Fail> {
    const b = await this.o.breaker.read();
    if (b.openUntil > this.o.now()) return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE, limited: true };
    for (let attempt = 0; ; attempt++) {
      if (this.o.ceiling !== false && !(await countCall(this.o.ceiling === undefined ? {} : { ceiling: this.o.ceiling }))) {
        return { ok: false, kind: "busy", message: BUSY_TEXT, retryAfterMs: 60_000 };
      }
      const r = await this.once(path);
      if (r.status === 401 || r.status === 403) return { ok: false, kind: "unauthorized", message: KEY_TEXT };
      if (r.status === 429) {
        const wait = r.retryAfterMs ?? 2000;
        if (attempt < this.o.retries && wait <= this.o.maxRetryAfterMs) { await this.o.sleep(wait); continue; }
        return { ok: false, kind: "busy", message: BUSY_TEXT, retryAfterMs: wait };
      }
      if (r.status === 0 || r.status >= 500) {
        if (attempt < this.o.retries) { await this.o.sleep(this.o.baseDelayMs * 2 ** attempt); continue; }
        await this.o.breaker.failure(this.o.now(), this.o.breakAfter, this.o.openMs);
        return { ok: false, kind: "unavailable", message: UNAVAILABLE_MESSAGE, ...(r.status ? { status: r.status } : {}) };
      }
      await this.o.breaker.success();
      return { ok: true, status: r.status, body: "body" in r ? r.body : null };
    }
  }

  private parse<T>(schema: z.ZodType<T>, status: number, body: unknown): V1<T> {
    const p = schema.safeParse(body);
    return p.success ? { ok: true, data: p.data } : { ok: false, kind: "drift", message: driftMessage(p.error), status };
  }

  /** API 1: one PN #, any status. 200 one selectable row; 404 none; 422 not selectable; 409 several rows. */
  async api1(pn: string): Promise<V1<Api1V1>> {
    const r = await this.get(`/loans/${encodeURIComponent(pn)}`);
    if (!r.ok) return r;
    switch (r.status) {
      case 200: { const p = this.parse(api1OkSchema, 200, r.body); return p.ok ? { ok: true, data: { status: 200, row: p.data } } : p; }
      case 404: return { ok: true, data: { status: 404 } };
      case 422: { const p = this.parse(api1NotSelectableSchema, 422, r.body); return p.ok ? { ok: true, data: { status: 422, ...p.data } } : p; }
      case 409: { const p = this.parse(api1ManySchema, 409, r.body); return p.ok ? { ok: true, data: { status: 409, rows: p.data.rows } } : p; }
      default: return { ok: false, kind: "drift", message: `myloans sent something we did not expect: status ${r.status}.`, status: r.status };
    }
  }

  private async page(q: string): Promise<V1<FeedPageV1>> {
    const r = await this.get(`/loans/changes?${q}`);
    if (!r.ok) return r;
    if (r.status !== 200) return { ok: false, kind: "drift", message: `myloans sent something we did not expect: status ${r.status}.`, status: r.status };
    return this.parse(feedPageSchema, 200, r.body);
  }

  /** API 2, change mode: loans changed after `since` (fixed for the whole run), cut by loan after `afterId`. */
  changesPage(q: { since: string; afterId: number; limit: number }) {
    return this.page(`since=${encodeURIComponent(q.since)}&afterId=${q.afterId}&limit=${q.limit}`);
  }

  /** Pool mode (first load): released loans on or after the cutoff. */
  poolPage(q: { releasedSince: string; afterId: number; limit: number }) {
    return this.page(`releasedSince=${encodeURIComponent(q.releasedSince)}&afterId=${q.afterId}&limit=${q.limit}`);
  }

  async branches() {
    const r = await this.get("/branches");
    if (!r.ok) return r;
    return r.status === 200 ? this.parse(branchesSchema, 200, r.body) : ({ ok: false, kind: "drift", message: `myloans sent something we did not expect: status ${r.status}.`, status: r.status } as const);
  }

  async products() {
    const r = await this.get("/products");
    if (!r.ok) return r;
    return r.status === 200 ? this.parse(productsSchema, 200, r.body) : ({ ok: false, kind: "drift", message: `myloans sent something we did not expect: status ${r.status}.`, status: r.status } as const);
  }
}
