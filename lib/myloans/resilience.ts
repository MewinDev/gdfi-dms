import type { ListBranchesOptions, MyLoansAdapter, MyLoansBranches, MyLoansChanged, MyLoansLookup, MyLoansSearch } from "./types";
import { UNAVAILABLE_MESSAGE } from "./types";

/**
 * Wraps an adapter: retry with backoff on "did not answer", honour Retry-After (429), and a simple
 * circuit breaker (after repeated failures, stop calling for a short while). "Not found" is an
 * answer, not a failure. Errors are plain words; nothing from the request (address, key) is kept.
 */
export interface ResilienceOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Consecutive failures that open the breaker. */
  breakAfter?: number;
  /** How long the breaker stays open. */
  openMs?: number;
  /** Longest wait we accept from Retry-After before giving up for now. */
  maxRetryAfterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type Fail = { ok: false; retryAfterMs?: number; reason: string };

export class ResilientAdapter implements MyLoansAdapter {
  readonly name: "mock" | "live";
  readonly capabilities;
  private failures = 0;
  private openUntil = 0;
  private readonly o: Required<ResilienceOptions>;

  constructor(private readonly inner: MyLoansAdapter, opts: ResilienceOptions = {}) {
    this.name = inner.name;
    this.capabilities = inner.capabilities;
    this.o = {
      retries: 2, baseDelayMs: 300, breakAfter: 5, openMs: 60_000, maxRetryAfterMs: 10_000,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), ...opts,
    };
  }

  /** For the sync card and tests. */
  breakerState() { return { failures: this.failures, open: this.o.now() < this.openUntil, openUntil: this.openUntil }; }

  private async run<T extends { ok: boolean }>(call: () => Promise<T>, unavailable: (msg: string) => T, isFailure: (r: T) => boolean): Promise<T> {
    if (this.o.now() < this.openUntil) return unavailable("MyLoans did not answer several times. We will try again in a minute.");
    for (let attempt = 0; ; attempt++) {
      let r: T;
      try { r = await call(); } catch { r = unavailable(UNAVAILABLE_MESSAGE); }
      if (!isFailure(r)) { this.failures = 0; return r; }
      const retryAfter = (r as unknown as Fail).retryAfterMs;
      if (attempt >= this.o.retries || (retryAfter !== undefined && retryAfter > this.o.maxRetryAfterMs)) {
        if (++this.failures >= this.o.breakAfter) { this.openUntil = this.o.now() + this.o.openMs; this.failures = 0; }
        return r;
      }
      await this.o.sleep(retryAfter ?? this.o.baseDelayMs * 2 ** attempt);
    }
  }

  getByPn(pn: string): Promise<MyLoansLookup> {
    return this.run(() => this.inner.getByPn(pn), (message) => ({ ok: false, reason: "UNAVAILABLE", message }), (r) => !r.ok && r.reason === "UNAVAILABLE");
  }
  search(query: string, limit: number): Promise<MyLoansSearch> {
    if (!this.capabilities.search) return this.inner.search(query, limit);
    return this.run(() => this.inner.search(query, limit), (message) => ({ ok: false, reason: "UNAVAILABLE", message }), (r) => !r.ok && r.reason === "UNAVAILABLE");
  }
  getChangedSince(since: Date, limit: number): Promise<MyLoansChanged> {
    if (!this.capabilities.changedSince) return this.inner.getChangedSince(since, limit);
    return this.run(() => this.inner.getChangedSince(since, limit), (message) => ({ ok: false, reason: "UNAVAILABLE", message }), (r) => !r.ok && r.reason === "UNAVAILABLE");
  }
  listBranches(o: ListBranchesOptions): Promise<MyLoansBranches> {
    const inner = this.inner.listBranches?.bind(this.inner);
    if (!inner || !this.capabilities.branches) return Promise.resolve({ ok: false, reason: "UNSUPPORTED", message: "MyLoans has no branch list yet. Use Import from MyLoans (a file)." });
    return this.run(() => inner(o), (message) => ({ ok: false, reason: "UNAVAILABLE", message }), (r) => !r.ok && r.reason === "UNAVAILABLE");
  }
}
