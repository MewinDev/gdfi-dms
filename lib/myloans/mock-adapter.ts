import { refuseInProduction } from "@/lib/env";
import { cleanPn } from "@/lib/pn/format";
import { mockRecords } from "./mock-data";
import type { ListBranchesOptions, MyLoansAdapter, MyLoansBranches, MyLoansChanged, MyLoansHit, MyLoansLookup, MyLoansRecord, MyLoansSearch, SourceCapabilities } from "./types";
import type { MyLoansBranchRow } from "@/lib/branches/file";
import { BUILTIN_BRANCHES } from "@/lib/branches/builtin";
import { NOT_FOUND_MESSAGE, UNAVAILABLE_MESSAGE } from "./types";

/** A per-PN change made by the simulator (or a test), with when it changed (for the changed-since feed). */
export type MockOverride = Partial<MyLoansRecord> & { changedAt?: string };

export interface MockOptions {
  /** Returns true when Settings asks to simulate "MyLoans unavailable". */
  isUnavailable?: () => Promise<boolean> | boolean;
  /** Per-PN changes, to simulate MyLoans changing a loan after it was opened. */
  overrides?: () => Promise<Record<string, MockOverride>> | Record<string, MockOverride>;
  /** Extra source loans (for example a replacement PN made by the simulator). */
  extra?: () => Promise<MyLoansRecord[]> | MyLoansRecord[];
  /** A whole source instead of the seeded one (tests: 25,000 loans). Indexed once by PN. */
  records?: MyLoansRecord[];
  capabilities?: Partial<SourceCapabilities>;
  now?: () => Date;
  /** The branch list (default: the built-in subset of the real MyLoans list). */
  branches?: () => Promise<MyLoansBranchRow[]> | MyLoansBranchRow[];
  /** Branch changes made by the kit or a test (rename, code change, close), keyed by MyLoans branch id or "code:101", and extra branches. */
  branchChanges?: () => Promise<MockBranchChanges> | MockBranchChanges;
}

export interface MockBranchChanges { overrides: Record<string, Partial<MyLoansBranchRow> & { removed?: boolean }>; extra: MyLoansBranchRow[] }

/** The seeded mock source: lookups go through a PN index, like the real one. */
export class MockMyLoansAdapter implements MyLoansAdapter {
  readonly name = "mock" as const;
  readonly capabilities: SourceCapabilities;
  private index: Map<string, MyLoansRecord> | null = null;
  /** Tests only: how many records the last search looked at and returned. */
  lastSearch = { returned: 0 };

  constructor(private readonly opts: MockOptions = {}) {
    refuseInProduction("The sample MyLoans (mock)");
    this.capabilities = { search: true, changedSince: true, branches: true, branchesUpdatedSince: true, ...opts.capabilities };
    if (opts.records) this.index = new Map(opts.records.map((r) => [r.pn, r]));
  }

  private async source(): Promise<Map<string, MyLoansRecord>> {
    if (this.index && this.opts.records) return this.index;
    const base = new Map(mockRecords(this.opts.now?.() ?? new Date()).map((r) => [r.pn, r]));
    for (const r of (await this.opts.extra?.()) ?? []) base.set(r.pn, r);
    return base;
  }

  private async withOverride(r: MyLoansRecord): Promise<MyLoansRecord> {
    const over = (await this.opts.overrides?.())?.[r.pn];
    if (!over) return r;
    const { changedAt: _ignored, ...fields } = over;
    void _ignored;
    return { ...r, ...fields };
  }

  async getByPn(pn: string): Promise<MyLoansLookup> {
    if (await this.opts.isUnavailable?.()) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
    const found = (await this.source()).get(cleanPn(pn));
    if (!found) return { ok: false, reason: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
    const record = await this.withOverride(found);
    return { ok: true, record, raw: { source: "MockMyLoans", loan: record }, adapter: "mock", retrievedAt: new Date() };
  }

  async search(query: string, limit: number): Promise<MyLoansSearch> {
    if (!this.capabilities.search) return { ok: false, reason: "UNSUPPORTED", message: "MyLoans takes the exact PN only." };
    if (await this.opts.isUnavailable?.()) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
    const q = query.trim().toUpperCase();
    const qPn = cleanPn(query);
    const hits: MyLoansHit[] = [];
    // Stops at the limit, like a source query with LIMIT.
    for (const r of (await this.source()).values()) {
      if ((qPn && r.pn.includes(qPn)) || r.borrowerName.toUpperCase().includes(q)) {
        const x = await this.withOverride(r);
        hits.push({ pn: x.pn, borrowerName: x.borrowerName, status: x.status, releaseDate: x.releaseDate, branchName: x.branchName, branchCode: x.branchCode });
        if (hits.length >= limit) break;
      }
    }
    this.lastSearch = { returned: hits.length };
    return { ok: true, hits };
  }

  async getChangedSince(since: Date, limit: number): Promise<MyLoansChanged> {
    if (!this.capabilities.changedSince) return { ok: false, reason: "UNSUPPORTED", message: "MyLoans has no changed-since feed." };
    if (await this.opts.isUnavailable?.()) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
    const over = (await this.opts.overrides?.()) ?? {};
    const source = await this.source();
    const records: MyLoansRecord[] = [];
    for (const [pn, o] of Object.entries(over)) {
      if (records.length >= limit) break;
      const r = source.get(pn);
      if (r && o.changedAt && new Date(o.changedAt) > since) records.push(await this.withOverride(r));
    }
    return { ok: true, records, until: new Date() };
  }


  async listBranches(o: ListBranchesOptions): Promise<MyLoansBranches> {
    if (!this.capabilities.branches) return { ok: false, reason: "UNSUPPORTED", message: "MyLoans has no branch list yet." };
    if (await this.opts.isUnavailable?.()) return { ok: false, reason: "UNAVAILABLE", message: UNAVAILABLE_MESSAGE };
    const base = (await this.opts.branches?.()) ?? BUILTIN_BRANCHES;
    const ch = (await this.opts.branchChanges?.()) ?? { overrides: {}, extra: [] };
    let rows = [...base, ...ch.extra].map((r) => ({ ...r, ...(ch.overrides[String(r.branchId ?? "")] ?? ch.overrides[`code:${r.code}`] ?? {}) }));
    rows = rows.filter((r) => !(r as { removed?: boolean }).removed).map((r) => { const { removed: _r, ...rest } = r as MyLoansBranchRow & { removed?: boolean }; void _r; return rest; });
    if (o.updatedSince && this.capabilities.branchesUpdatedSince) rows = rows.filter((r) => r.updatedAt && new Date(r.updatedAt) > o.updatedSince!);
    const start = (o.page - 1) * o.pageSize;
    return { ok: true, branches: rows.slice(start, start + o.pageSize), nextPage: start + o.pageSize < rows.length ? o.page + 1 : null };
  }
}
