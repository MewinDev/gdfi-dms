import type { ListBranchesOptions, MyLoansAdapter, MyLoansBranches, MyLoansChanged, MyLoansLookup, MyLoansSearch } from "./types";
import { NOT_FOUND_MESSAGE, UNAVAILABLE_MESSAGE } from "./types";
import { myLoansBaseUrl } from "@/lib/env";
import { LIVE_CAPABILITIES, LIVE_PATHS, mapBranches, mapChanged, mapLoan, mapSearch } from "./live-mapping";

/**
 * Live MyLoans adapter, written against the contract. Paths and field names live in live-mapping.ts
 * (all to confirm with the MyLoans team). Server only: the address and key come from MYLOANS_BASE_URL
 * and MYLOANS_API_KEY and never appear in an error, a log or the database.
 */
type Fetch = typeof fetch;

export class HttpMyLoansAdapter implements MyLoansAdapter {
  readonly name = "live" as const;
  readonly capabilities = LIVE_CAPABILITIES;

  constructor(
    private readonly baseUrl = myLoansBaseUrl(),
    private readonly apiKey = process.env.MYLOANS_API_KEY?.trim() ?? "",
    private readonly timeoutMs = Number(process.env.MYLOANS_TIMEOUT_MS ?? 8000),
    private readonly fetchImpl: Fetch = (...a) => fetch(...a),
  ) {}

  private async get(path: string): Promise<{ status: number; body: unknown; retryAfterMs?: number } | null> {
    if (!this.baseUrl) return null;
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
        cache: "no-store",
      });
      const ra = res.headers.get("retry-after");
      const retryAfterMs = ra && Number.isFinite(Number(ra)) ? Number(ra) * 1000 : undefined;
      const body = res.ok ? await res.json().catch(() => null) : null;
      return { status: res.status, body, retryAfterMs };
    } catch {
      return null; // timeout or network: no details (they could include the address)
    }
  }

  async getByPn(pn: string): Promise<MyLoansLookup> {
    const r = await this.get(LIVE_PATHS.byPn(pn));
    if (!r) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
    if (r.status === 404) return { ok: false, reason: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    if (r.status === 429) return { ok: false, reason: "UNAVAILABLE", message: "MyLoans asked us to slow down. Try again in a moment.", retryAfterMs: r.retryAfterMs };
    if (r.status < 200 || r.status >= 300) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
    const record = mapLoan(r.body);
    if (!record) return { ok: false, reason: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    return { ok: true, record, raw: r.body, adapter: "live", retrievedAt: new Date() };
  }

  async search(query: string, limit: number): Promise<MyLoansSearch> {
    if (!this.capabilities.search) return { ok: false, reason: "UNSUPPORTED", message: "MyLoans takes the exact PN only." };
    const r = await this.get(LIVE_PATHS.search(query, limit));
    if (!r || r.status < 200 || r.status >= 300) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE, retryAfterMs: r?.retryAfterMs };
    return { ok: true, hits: mapSearch(r.body).slice(0, limit) };
  }

  async getChangedSince(since: Date, limit: number): Promise<MyLoansChanged> {
    if (!this.capabilities.changedSince) return { ok: false, reason: "UNSUPPORTED", message: "MyLoans has no changed-since feed." };
    const r = await this.get(LIVE_PATHS.changedSince(since, limit));
    if (!r || r.status < 200 || r.status >= 300) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE, retryAfterMs: r?.retryAfterMs };
    return { ok: true, records: mapChanged(r.body).slice(0, limit), until: new Date() };
  }


  /** Placeholder until the MyLoans team gives a branch endpoint (LIVE_CAPABILITIES.branches is false). */
  async listBranches(o: ListBranchesOptions): Promise<MyLoansBranches> {
    if (!this.capabilities.branches) return { ok: false, reason: "UNSUPPORTED", message: "MyLoans has no branch list yet. Use Import from MyLoans (a file)." };
    const r = await this.get(LIVE_PATHS.branches(o.page, o.pageSize, this.capabilities.branchesUpdatedSince ? o.updatedSince : null));
    if (!r || r.status < 200 || r.status >= 300) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE, retryAfterMs: r?.retryAfterMs };
    const m = mapBranches(r.body);
    return { ok: true, branches: m.rows, nextPage: m.nextPage };
  }
}
