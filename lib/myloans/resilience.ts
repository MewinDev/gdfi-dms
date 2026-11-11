import type { ListBranchesOptions, MyLoansAdapter, MyLoansBranches, MyLoansChanged, MyLoansLookup, MyLoansSearch } from "./types";
import { NOT_FOUND_MESSAGE, UNAVAILABLE_MESSAGE } from "./types";
import { recordStatusKind } from "./status";

/** Statuses 15 to 19 are disbursement-check records, not loans: never a loan file, never shown as a status. */
const isLoan = (r: { statusId?: string | null; status?: string | null }) => recordStatusKind(r) !== "not_a_loan";

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
  /** Where the breaker lives: memory (one process; the default, unit tests) or the database (shared, the app). */
  breaker?: BreakerStore;
}

type Fail = { ok: false; retryAfterMs?: number; reason: string };

/** The circuit breaker's state, wherever it is kept. */
export interface BreakerStore {
  /** Open until (epoch ms; 0 when closed) and the failures counted so far. */
  read(): Promise<{ failures: number; openUntil: number }>;
  /** One more failure; opens the breaker at `breakAfter` (for `openMs`) and starts counting again. One atomic step. */
  failure(now: number, breakAfter: number, openMs: number): Promise<void>;
  /** An answer came: the failures start again from 0. */
  success(): Promise<void>;
}

export class MemoryBreakerStore implements BreakerStore {
  private s = { failures: 0, openUntil: 0 };
  async read() { return { ...this.s }; }
  async failure(now: number, breakAfter: number, openMs: number) {
    const f = this.s.failures + 1;
    this.s = f >= breakAfter ? { failures: 0, openUntil: now + openMs } : { failures: f, openUntil: this.s.openUntil };
  }
  async success() { this.s.failures = 0; }
}

/** Shared by every instance (table MyLoansBreaker, one row). If it cannot be read, the breaker counts as open (fail safe). */
export class DbBreakerStore implements BreakerStore {
  private async db() { return (await import("@/lib/db")).prisma; }
  async read() {
    try {
      const rows = await (await this.db()).$queryRaw<{ failures: number; openUntil: Date | null }[]>`SELECT "failures", "openUntil" FROM "MyLoansBreaker" WHERE "id" = 'myloans'`;
      return { failures: rows[0]?.failures ?? 0, openUntil: rows[0]?.openUntil?.getTime() ?? 0 };
    } catch {
      return { failures: 0, openUntil: Number.MAX_SAFE_INTEGER };
    }
  }
  async failure(now: number, breakAfter: number, openMs: number) {
    const until = new Date(now + openMs);
    await (await this.db()).$executeRaw`
      INSERT INTO "MyLoansBreaker" ("id", "failures", "openUntil", "updatedAt") VALUES ('myloans', ${breakAfter <= 1 ? 0 : 1}, ${breakAfter <= 1 ? until : null}, NOW())
      ON CONFLICT ("id") DO UPDATE SET
        "failures" = CASE WHEN "MyLoansBreaker"."failures" + 1 >= ${breakAfter} THEN 0 ELSE "MyLoansBreaker"."failures" + 1 END,
        "openUntil" = CASE WHEN "MyLoansBreaker"."failures" + 1 >= ${breakAfter} THEN ${until} ELSE "MyLoansBreaker"."openUntil" END,
        "updatedAt" = NOW()`.catch(() => null);
  }
  async success() {
    await (await this.db()).$executeRaw`UPDATE "MyLoansBreaker" SET "failures" = 0, "updatedAt" = NOW() WHERE "id" = 'myloans' AND "failures" > 0`.catch(() => null);
  }
}

export class ResilientAdapter implements MyLoansAdapter {
  readonly name: "mock" | "live";
  readonly capabilities;
  private readonly o: Required<ResilienceOptions>;

  constructor(private readonly inner: MyLoansAdapter, opts: ResilienceOptions = {}) {
    this.name = inner.name;
    this.capabilities = inner.capabilities;
    this.o = {
      retries: 2, baseDelayMs: 300, breakAfter: 5, openMs: 60_000, maxRetryAfterMs: 10_000,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), breaker: new MemoryBreakerStore(), ...opts,
    };
  }

  /** For the sync card and tests. */
  async breakerState() {
    const s = await this.o.breaker.read();
    return { failures: s.failures, open: this.o.now() < s.openUntil, openUntil: s.openUntil };
  }

  private async run<T extends { ok: boolean }>(call: () => Promise<T>, unavailable: (msg: string) => T, isFailure: (r: T) => boolean): Promise<T> {
    if ((await this.breakerState()).open) return unavailable("MyLoans did not answer several times. We will try again in a minute.");
    for (let attempt = 0; ; attempt++) {
      let r: T;
      try { r = await call(); } catch { r = unavailable(UNAVAILABLE_MESSAGE); }
      if (!isFailure(r)) { await this.o.breaker.success(); return r; }
      const retryAfter = (r as unknown as Fail).retryAfterMs;
      if (attempt >= this.o.retries || (retryAfter !== undefined && retryAfter > this.o.maxRetryAfterMs)) {
        await this.o.breaker.failure(this.o.now(), this.o.breakAfter, this.o.openMs);
        return r;
      }
      await this.o.sleep(retryAfter ?? this.o.baseDelayMs * 2 ** attempt);
    }
  }

  async getByPn(pn: string): Promise<MyLoansLookup> {
    const r = await this.run(() => this.inner.getByPn(pn), (message): MyLoansLookup => ({ ok: false, reason: "UNAVAILABLE", message }), (x) => !x.ok && x.reason === "UNAVAILABLE");
    return r.ok && !isLoan(r.record) ? { ok: false, reason: "NOT_FOUND", message: NOT_FOUND_MESSAGE } : r;
  }
  async search(query: string, limit: number): Promise<MyLoansSearch> {
    if (!this.capabilities.search) return this.inner.search(query, limit);
    const r = await this.run(() => this.inner.search(query, limit), (message): MyLoansSearch => ({ ok: false, reason: "UNAVAILABLE", message }), (x) => !x.ok && x.reason === "UNAVAILABLE");
    return r.ok ? { ok: true, hits: r.hits.filter((h) => isLoan({ status: h.status })) } : r;
  }
  async getChangedSince(since: Date, limit: number): Promise<MyLoansChanged> {
    if (!this.capabilities.changedSince) return this.inner.getChangedSince(since, limit);
    const r = await this.run(() => this.inner.getChangedSince(since, limit), (message): MyLoansChanged => ({ ok: false, reason: "UNAVAILABLE", message }), (x) => !x.ok && x.reason === "UNAVAILABLE");
    return r.ok ? { ...r, records: r.records.filter(isLoan) } : r;
  }
  listBranches(o: ListBranchesOptions): Promise<MyLoansBranches> {
    const inner = this.inner.listBranches?.bind(this.inner);
    if (!inner || !this.capabilities.branches) return Promise.resolve({ ok: false, reason: "UNSUPPORTED", message: "MyLoans has no branch list yet. Use Import from MyLoans (a file)." });
    return this.run(() => inner(o), (message) => ({ ok: false, reason: "UNAVAILABLE", message }), (r) => !r.ok && r.reason === "UNAVAILABLE");
  }
}
