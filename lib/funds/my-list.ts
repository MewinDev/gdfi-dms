/**
 * D-065: the processor's My funds, one list like Loans and Jobs (D-059, D-064): one row per job that needs funds and
 * per advance line, status chips with counts (none chosen: every open one, shown as chosen), one search, compact
 * filters that apply at once (Type, Transaction, Late only, Sort); everything in the address. Pure (no database).
 */

export const FUNDS_STATUS_KEYS = ["needs", "requested", "approved", "released", "liquidate", "overdue", "liquidated", "closed"] as const;
export type FundsRowStatus = (typeof FUNDS_STATUS_KEYS)[number];
export const FUNDS_STATUS_LABELS: Record<FundsRowStatus, string> = {
  needs: "Needs funds", requested: "Requested", approved: "Approved", released: "Released", liquidate: "To liquidate",
  overdue: "Liquidation overdue", liquidated: "Liquidated", closed: "Returned/cancelled",
};
/** The status chip's colour. */
export const FUNDS_STATUS_TONE: Record<FundsRowStatus, "act" | "wait" | "navy" | "ok" | "bad" | "mute"> = {
  needs: "act", requested: "wait", approved: "navy", released: "ok", liquidate: "act", overdue: "bad", liquidated: "ok", closed: "mute",
};
/** No chip chosen: every open one (all but Liquidated and Returned/cancelled). */
export const DEFAULT_FUNDS_STATUS: FundsRowStatus[] = ["needs", "requested", "approved", "released", "liquidate", "overdue"];

export type FundsSort = "due" | "borrower";
export interface FundsListParams { status: FundsRowStatus[]; q: string; type: string | null; txn: string | null; late: boolean; sort: FundsSort; dir: "asc" | "desc" }

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseFundsParams(sp: Record<string, string | string[] | undefined>): FundsListParams {
  const status = one(sp.status).split(",").filter((s): s is FundsRowStatus => (FUNDS_STATUS_KEYS as readonly string[]).includes(s));
  return {
    status: [...new Set(status)], q: one(sp.q).trim().slice(0, 80), type: one(sp.type).toUpperCase() || null, txn: one(sp.txn) || null,
    late: one(sp.late) === "1", sort: one(sp.sort) === "borrower" ? "borrower" : "due", dir: one(sp.dir) === "desc" ? "desc" : "asc",
  };
}

export function fundsListUrl(p: FundsListParams, patch: Partial<FundsListParams> = {}): string {
  const n = { ...p, ...patch };
  const s = new URLSearchParams();
  if (n.status.length) s.set("status", n.status.join(","));
  if (n.q) s.set("q", n.q);
  if (n.type) s.set("type", n.type);
  if (n.txn) s.set("txn", n.txn);
  if (n.late) s.set("late", "1");
  if (n.sort !== "due") s.set("sort", n.sort);
  if (n.dir !== "asc") s.set("dir", n.dir);
  const q = s.toString();
  return q ? `/my-funds?${q}` : "/my-funds";
}

/** The chips shown as chosen: the address's, or every open one when none. */
export const shownFundsStatus = (status: readonly FundsRowStatus[]): FundsRowStatus[] => (status.length ? [...status] : [...DEFAULT_FUNDS_STATUS]);

/**
 * A click on a status in Filters (the user's review: "All open" is one choice, the statuses are not all ticked by
 * default): from All open, a status shows that one only; more can be added; unticking the last one is All open again.
 */
export function toggleFundsStatus(status: readonly FundsRowStatus[], k: FundsRowStatus): FundsRowStatus[] {
  const next = status.includes(k) ? status.filter((x) => x !== k) : [...status, k];
  return FUNDS_STATUS_KEYS.filter((s) => next.includes(s));
}

/**
 * The status of an advance line (D-065): denied or cancelled lines and requests are "Returned/cancelled"; released
 * money is "Released" until its liquidation clock starts, then "To liquidate", or "Liquidation overdue" past its due
 * date; liquidated or closed advances are "Liquidated".
 */
export function lineStatus(x: { advanceStatus: string; lineDenied: boolean; liquidationDue: boolean; overdue: boolean }): FundsRowStatus {
  if (x.lineDenied || x.advanceStatus === "DENIED" || x.advanceStatus === "CANCELLED") return "closed";
  if (x.advanceStatus === "REQUESTED") return "requested";
  if (x.advanceStatus === "APPROVED") return "approved";
  if (x.advanceStatus === "LIQUIDATED" || x.advanceStatus === "CLOSED") return "liquidated";
  if (x.overdue) return "overdue";
  if (x.liquidationDue || x.advanceStatus !== "RELEASED") return "liquidate";
  return "released";
}

/** The Liquidation due chip: "Due in 2 days", "Due today", "Overdue by 1 day", "Waiting for LTO pickup", "Liquidated on time". */
export interface LiqChip { text: string; tone: "bad" | "act" | "ok" | "mute"; kind: "overdue" | "today" | "due" | "waiting" | "done" | "none" }
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function liquidationChip(x: { status: FundsRowStatus; mustLiquidate: boolean; daysLeft: number | null; waitingFor: "LTO" | null; daysLate: number | null }): LiqChip | null {
  if (x.status === "needs" || x.status === "requested" || x.status === "approved" || x.status === "closed") return null;
  if (!x.mustLiquidate) return { text: "No receipts needed", tone: "mute", kind: "none" };
  if (x.status === "liquidated") return x.daysLate ? { text: `Liquidated ${days(x.daysLate)} late`, tone: "bad", kind: "done" } : { text: "Liquidated on time", tone: "ok", kind: "done" };
  if (x.daysLeft === null) return { text: x.waitingFor === "LTO" ? "Waiting for LTO pickup" : "Due date not set yet", tone: "mute", kind: "waiting" };
  if (x.daysLeft < 0) return { text: `Overdue by ${days(-x.daysLeft)}`, tone: "bad", kind: "overdue" };
  if (x.daysLeft === 0) return { text: "Due today", tone: "act", kind: "today" };
  return { text: `Due in ${days(x.daysLeft)}`, tone: x.daysLeft <= 1 ? "act" : "ok", kind: "due" };
}

export interface FundsRowLike {
  status: FundsRowStatus; borrower: string; pn: string; typeCode: string | null; txnCode: string | null;
  /** The date that sorts the list: the liquidation due date, else the job's due date. */
  dueDate: string | null; late: boolean;
}
export interface FundsFacets { status: Record<FundsRowStatus, number>; type: Record<string, number>; txn: Record<string, number>; late: number }

const squash = (s: string) => s.toLowerCase().replace(/[\s.\-]/g, "");
export const matchesFundsSearch = (r: Pick<FundsRowLike, "borrower" | "pn">, q: string) => {
  const t = q.trim().toLowerCase();
  return !t || r.borrower.toLowerCase().includes(t) || squash(r.pn).includes(squash(t));
};

/** The rows shown and every choice's count (each number is what clicking it shows). */
export function filterFunds<R extends FundsRowLike>(all: readonly R[], p: FundsListParams): { rows: R[]; counts: FundsFacets } {
  const shown = shownFundsStatus(p.status);
  const base = (r: R, skip?: "type" | "txn" | "late") =>
    matchesFundsSearch(r, p.q) && (skip === "type" || !p.type || r.typeCode === p.type) && (skip === "txn" || !p.txn || r.txnCode === p.txn) && (skip === "late" || !p.late || r.late);
  const rows = all.filter((r) => shown.includes(r.status) && base(r));
  const status = Object.fromEntries(FUNDS_STATUS_KEYS.map((k) => [k, 0])) as Record<FundsRowStatus, number>;
  const type: Record<string, number> = {};
  const txn: Record<string, number> = {};
  let late = 0;
  for (const r of all) {
    if (base(r)) status[r.status]++;
    if (!shown.includes(r.status)) continue;
    if (r.typeCode && base(r, "type")) type[r.typeCode] = (type[r.typeCode] ?? 0) + 1;
    if (r.txnCode && base(r, "txn")) txn[r.txnCode] = (txn[r.txnCode] ?? 0) + 1;
    if (r.late && base(r, "late")) late++;
  }
  return { rows: sortFunds(rows, p), counts: { status, type, txn, late } };
}

/** Overdue liquidation first, then the soonest due (no date last); or by borrower, either way. */
export function sortFunds<R extends FundsRowLike>(rows: readonly R[], p: Pick<FundsListParams, "sort" | "dir">): R[] {
  const sign = p.dir === "desc" ? -1 : 1;
  const byDue = (a: R, b: R) => {
    const la = a.late ? 0 : 1, lb = b.late ? 0 : 1;
    if (la !== lb && p.dir === "asc") return la - lb;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) * sign;
    if (a.dueDate || b.dueDate) return a.dueDate ? -1 : 1;
    return a.borrower.localeCompare(b.borrower);
  };
  return [...rows].sort((a, b) => (p.sort === "borrower" ? a.borrower.localeCompare(b.borrower) * sign || byDue(a, b) : byDue(a, b)));
}
