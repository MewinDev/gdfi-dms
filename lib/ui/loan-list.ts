/**
 * D-059: the one Loans page for every role. Pure rules (no database): the address (URL) of a list, the filters,
 * the counts on each filter option, the order and the page. lib/services/loan-list.ts loads the rows.
 *
 * Address: /loans?q=…&status=needs,hold&branch=<id>&with=me&late=1&sort=amount&dir=desc&per=50&page=2. Every part is
 * optional; the defaults are left out, so a plain /loans is the default list (all open loans, Archived hidden, late
 * first then soonest due, 25 a page).
 */
import type { TatBadge } from "@/lib/time";

export const STATUS_KEYS = ["needs", "new", "hold", "problems", "archived"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];
export const STATUS_LABELS: Record<StatusKey, string> = {
  needs: "Needs action", new: "Not yet in DMS", hold: "On hold", problems: "Problems", archived: "Archived",
};
export const SORT_KEYS = ["due", "borrower", "branch", "released", "amount"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const PER_PAGE = [25, 50] as const;
export type WithKey = "me" | "pool";

export interface LoanListParams {
  q: string;
  /** Empty: every open loan file (and, while searching, the archived ones and the pool items too). */
  status: StatusKey[];
  branch: string | null;
  /** null: anyone. */
  with: WithKey | null;
  late: boolean;
  sort: SortKey;
  dir: "asc" | "desc";
  per: 25 | 50;
  page: number;
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseListParams(sp: SP): LoanListParams {
  const status = [...new Set(one(sp.status).split(",").map((s) => s.trim()).filter((s): s is StatusKey => (STATUS_KEYS as readonly string[]).includes(s)))];
  const sort = (SORT_KEYS as readonly string[]).includes(one(sp.sort)) ? (one(sp.sort) as SortKey) : "due";
  const w = one(sp.with);
  const page = /^\d{1,6}$/.test(one(sp.page)) ? Math.max(1, Number(one(sp.page))) : 1;
  return {
    // The old Find a loan addresses (?fill=PN) search too.
    q: (one(sp.q) || one(sp.fill)).trim().slice(0, 60),
    status: STATUS_KEYS.filter((k) => status.includes(k)),
    branch: one(sp.branch) || null,
    with: w === "me" || w === "pool" ? w : null,
    late: one(sp.late) === "1",
    sort,
    dir: one(sp.dir) === "desc" ? "desc" : one(sp.dir) === "asc" ? "asc" : sort === "amount" || sort === "released" ? "desc" : "asc",
    per: one(sp.per) === "50" ? 50 : 25,
    page,
  };
}

/** Amount and release date: the largest and the newest first. */
const defaultDir = (s: SortKey) => (s === "amount" || s === "released" ? "desc" : "asc");

/** The address of a list: the given params over the current ones; defaults left out; `page` only when above 1. */
export function listUrl(p: LoanListParams, change: Partial<LoanListParams> = {}): string {
  const n = { ...p, page: 1, ...change };
  const s = new URLSearchParams();
  if (n.q) s.set("q", n.q);
  if (n.status.length) s.set("status", STATUS_KEYS.filter((k) => n.status.includes(k)).join(","));
  if (n.branch) s.set("branch", n.branch);
  if (n.with) s.set("with", n.with);
  if (n.late) s.set("late", "1");
  if (n.sort !== "due") s.set("sort", n.sort);
  if (n.dir !== defaultDir(n.sort)) s.set("dir", n.dir);
  if (n.per !== 25) s.set("per", String(n.per));
  if (n.page > 1) s.set("page", String(n.page));
  const q = s.toString();
  return `/loans${q ? `?${q}` : ""}`;
}

/** A row reduced to what the filters, the counts and the order need. */
export interface LeanRow {
  key: string;
  source: "dms" | "pool";
  pn: string;
  borrowerName: string;
  branchId: string;
  branchName: string;
  amount: number | null;
  /** YYYY-MM-DD. */
  released: string;
  /** The TAT deadline (YYYY-MM-DD) and its badge; null when nothing is due (archived, closed, with nobody). */
  deadline: string | null;
  badge: TatBadge | null;
  needs: boolean;
  isNew: boolean;
  hold: boolean;
  problems: boolean;
  archived: boolean;
  /** Who has it now (a user id), or the branch pool. */
  withId: string | null;
  withPool: boolean;
}

export type Facet = "status" | "branch" | "with" | "late";

function statusOk(r: LeanRow, status: StatusKey[], searching: boolean): boolean {
  if (r.archived) return status.includes("archived") || (status.length === 0 && searching);
  // D-060: released loans not yet in the DMS are not in the default list; a search or the Not yet in DMS filter shows them.
  if (r.isNew) return status.includes("new") || (status.length === 0 && searching);
  if (!status.length) return true;
  return status.some((k) => (k === "needs" ? r.needs : k === "new" ? r.isNew : k === "hold" ? r.hold : k === "problems" ? r.problems : false));
}
const withOk = (r: LeanRow, w: WithKey | null, me: string) => (w === null ? true : w === "pool" ? r.withPool : r.withId === me);

/** True when the row passes every filter (but `skip`, for the counts of that filter's options). */
export function passes(r: LeanRow, p: LoanListParams, me: string, skip?: Facet): boolean {
  return (skip === "status" || statusOk(r, p.status, !!p.q))
    && (skip === "branch" || !p.branch || r.branchId === p.branch)
    && (skip === "with" || withOk(r, p.with, me))
    && (skip === "late" || !p.late || r.badge === "OVERDUE");
}

export interface FacetCounts {
  status: Record<StatusKey, number>;
  branch: Record<string, number>;
  with: { any: number; me: number; pool: number };
  late: number;
}

/** How many rows each filter option would show, with the other filters as they are. */
export function facetCounts(rows: LeanRow[], p: LoanListParams, me: string): FacetCounts {
  const c: FacetCounts = { status: { needs: 0, new: 0, hold: 0, problems: 0, archived: 0 }, branch: {}, with: { any: 0, me: 0, pool: 0 }, late: 0 };
  for (const r of rows) {
    if (passes(r, p, me, "status")) {
      if (r.archived) c.status.archived++;
      else {
        if (r.needs) c.status.needs++;
        if (r.isNew) c.status.new++;
        if (r.hold) c.status.hold++;
        if (r.problems) c.status.problems++;
      }
    }
    if (passes(r, p, me, "branch")) c.branch[r.branchId] = (c.branch[r.branchId] ?? 0) + 1;
    if (passes(r, p, me, "with")) {
      c.with.any++;
      if (r.withId === me) c.with.me++;
      if (r.withPool) c.with.pool++;
    }
    if (passes(r, p, me, "late") && r.badge === "OVERDUE") c.late++;
  }
  return c;
}

const byText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
/** Late first, then the soonest due; nothing due last; then the oldest release. */
const byDue = (a: LeanRow, b: LeanRow) =>
  (a.deadline === null ? 1 : 0) - (b.deadline === null ? 1 : 0) || (a.deadline ?? "").localeCompare(b.deadline ?? "") || a.released.localeCompare(b.released) || a.pn.localeCompare(b.pn);

/** The order: by due date (default), borrower, branch, release date or amount; ascending or descending. Unknown amounts stay last. */
export function sortRows(rows: LeanRow[], sort: SortKey, dir: "asc" | "desc"): LeanRow[] {
  const k = dir === "desc" ? -1 : 1;
  const cmp: (a: LeanRow, b: LeanRow) => number =
    sort === "borrower" ? (a, b) => k * byText(a.borrowerName, b.borrowerName) || byDue(a, b)
    : sort === "branch" ? (a, b) => k * byText(a.branchName, b.branchName) || byDue(a, b)
    : sort === "released" ? (a, b) => k * a.released.localeCompare(b.released) || byDue(a, b)
    : sort === "amount" ? (a, b) => (a.amount === null ? 1 : 0) - (b.amount === null ? 1 : 0) || k * ((a.amount ?? 0) - (b.amount ?? 0)) || byDue(a, b)
    : (a, b) => {
        // Due, descending: the latest deadline first, but nothing-due rows still last.
        const n = (a.deadline === null ? 1 : 0) - (b.deadline === null ? 1 : 0);
        return n || k * byDue(a, b);
      };
  return [...rows].sort(cmp);
}
