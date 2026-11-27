import type { TatChipData } from "@/lib/workflow/tat";
import type { JobRow, JobTab } from "@/lib/services/job-queries";

/**
 * D-064: the DP Jobs list, the same design as the Loans page (D-059): status chips with counts instead of tabs, one
 * search, compact filters that apply at once (Transaction, Funds, Late only) and a sort; everything in the address.
 * Pure (no database), so the page, its filter bar and the tests use the same rules.
 */

export const JOB_STATUS_KEYS = ["review", "process", "forwarded", "done", "problems", "hold"] as const;
export type JobStatusKey = (typeof JOB_STATUS_KEYS)[number];
export const JOB_STATUS_LABELS: Record<JobStatusKey, string> = {
  review: "To review", process: "In process", forwarded: "Forwarded", done: "Done", problems: "Problems", hold: "On hold",
};
/** No chip chosen: the open work (To review and In process). Forwarded and Done only when chosen. */
export const DEFAULT_TABS: JobTab[] = ["review", "process"];

export const FUNDS_KEYS = ["needs", "requested", "released", "liquidate", "liquidated"] as const;
export type FundsKey = (typeof FUNDS_KEYS)[number];
export const FUNDS_KEY_LABELS: Record<FundsKey, string> = {
  needs: "Needs funds", requested: "Requested", released: "Released", liquidate: "To liquidate", liquidated: "Liquidated",
};

export type JobSort = "due" | "borrower" | "branch";
export interface JobListParams {
  status: JobStatusKey[];
  q: string;
  type: string | null;
  funds: FundsKey | null;
  late: boolean;
  sort: JobSort;
  dir: "asc" | "desc";
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Reads the address (unknown values are ignored). */
export function parseJobParams(sp: Record<string, string | string[] | undefined>): JobListParams {
  const status = one(sp.status).split(",").filter((s): s is JobStatusKey => (JOB_STATUS_KEYS as readonly string[]).includes(s));
  const funds = one(sp.funds);
  const sort = one(sp.sort);
  return {
    status: [...new Set(status)],
    q: one(sp.q).trim().slice(0, 80),
    type: one(sp.type) || null,
    funds: (FUNDS_KEYS as readonly string[]).includes(funds) ? (funds as FundsKey) : null,
    late: one(sp.late) === "1",
    sort: sort === "borrower" || sort === "branch" ? sort : "due",
    dir: one(sp.dir) === "desc" ? "desc" : "asc",
  };
}

type TabKey = Exclude<JobStatusKey, "problems" | "hold">;
const TAB_KEYS: TabKey[] = ["review", "process", "forwarded", "done"];

/** The chips shown as chosen: the address's tab chips, or the default ones (To review, In process) when none. */
export function shownStatus(status: readonly JobStatusKey[]): JobStatusKey[] {
  const tabs = status.filter((s): s is TabKey => (TAB_KEYS as string[]).includes(s));
  return [...(tabs.length ? tabs : (DEFAULT_TABS as TabKey[])), ...status.filter((s) => s === "problems" || s === "hold")];
}

/**
 * A click on a status chip: from what is shown (the default included). Choosing exactly the default again, or
 * clearing every tab chip, goes back to no tab chip in the address (the default list).
 */
export function toggleStatus(status: readonly JobStatusKey[], k: JobStatusKey): JobStatusKey[] {
  const shown = shownStatus(status);
  const next = shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k];
  const tabs = next.filter((s) => (TAB_KEYS as string[]).includes(s));
  const flags = next.filter((s) => s === "problems" || s === "hold");
  const isDefault = !tabs.length || (tabs.length === DEFAULT_TABS.length && DEFAULT_TABS.every((t) => tabs.includes(t as TabKey)));
  return isDefault ? flags : [...tabs, ...flags];
}

/** The address of a list (only what differs from the default). */
export function jobListUrl(p: JobListParams, patch: Partial<JobListParams> = {}): string {
  const n = { ...p, ...patch };
  const s = new URLSearchParams();
  if (n.status.length) s.set("status", n.status.join(","));
  if (n.q) s.set("q", n.q);
  if (n.type) s.set("type", n.type);
  if (n.funds) s.set("funds", n.funds);
  if (n.late) s.set("late", "1");
  if (n.sort !== "due") s.set("sort", n.sort);
  if (n.dir !== "asc") s.set("dir", n.dir);
  const q = s.toString();
  return q ? `/jobs?${q}` : "/jobs";
}

/** The chip in the Time left column: "Late by 1 day", "Due today", "1 day left", "Day 1 of 5", "Paused", "Done on time". */
export interface TimeLeft { text: string; tone: "bad" | "act" | "ok" | "hold" | "mute"; kind: "late" | "today" | "left" | "day" | "paused" | "done" | "waiting" }

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function timeLeft(x: { tab: JobTab; tat: TatChipData | null; daysLeft: number | null; amberWithin: number }): TimeLeft | null {
  const { tab, tat } = x;
  if (tab === "returned") return null;
  if (tab === "done") return tat ? { text: tat.text, tone: /late/.test(tat.text) ? "bad" : "ok", kind: "done" } : null;
  if (tat?.state === "paused") return { text: "Paused", tone: "hold", kind: "paused" };
  if (x.daysLeft === null) return tat?.state === "waiting" ? { text: "Waiting", tone: "mute", kind: "waiting" } : null;
  if (x.daysLeft < 0) return { text: `Late by ${days(-x.daysLeft)}`, tone: "bad", kind: "late" };
  if (x.daysLeft === 0) return { text: "Due today", tone: "act", kind: "today" };
  if (x.daysLeft <= x.amberWithin) return { text: `${days(x.daysLeft)} left`, tone: "act", kind: "left" };
  // Plenty of time: where the job is in its target ("Day 1 of 5"), from the TAT chip's own words.
  const m = tat?.text.match(/Day (\d+) of (\d+)/);
  return m ? { text: `Day ${m[1]} of ${m[2]}`, tone: "ok", kind: "day" } : { text: `${days(x.daysLeft)} left`, tone: "ok", kind: "left" };
}

/** The funds filter a job falls under (null: no funds asked for this job, or denied). */
export function fundsKeyOf(r: Pick<JobRow, "funds"> & { liquidating?: boolean }): FundsKey | null {
  if (r.funds === "NEEDED") return "needs";
  if (r.funds === "REQUESTED") return "requested";
  if (r.funds === "FUNDED") return r.liquidating ? "liquidate" : "released";
  if (r.funds === "SETTLED") return "liquidated";
  return null;
}

type Row = Pick<JobRow, "tab" | "borrower" | "pn" | "cin" | "branch" | "typeCode" | "funds" | "problem" | "hold" | "daysLeft" | "tat" | "dueDate" | "endorsedAt"> & { liquidating?: boolean };

const isLate = (r: Row) => (r.daysLeft !== null && r.daysLeft < 0) || !!r.tat?.lateText;
const squash = (s: string) => s.toLowerCase().replace(/[\s.\-]/g, "");

/** The search: part of the borrower's name, part of the PN (spaces, dashes and dots ignored), or the CIN. */
export function matchesSearch(r: Row, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return r.borrower.toLowerCase().includes(t) || squash(r.pn).includes(squash(t)) || (!!r.cin && squash(r.cin).includes(squash(t)));
}

export interface JobFacets {
  status: Record<JobStatusKey, number>;
  type: Record<string, number>;
  funds: Record<FundsKey, number>;
  late: number;
}

/**
 * The rows shown and the counts of every choice. A status chip's count is what that chip alone would add; the
 * filters (search, transaction, funds, late) apply to every count, so each number is what clicking it shows.
 */
export function filterJobs<R extends Row>(all: readonly R[], p: JobListParams): { rows: R[]; counts: JobFacets } {
  const tabs = p.status.filter((s): s is Exclude<JobStatusKey, "problems" | "hold"> => s !== "problems" && s !== "hold");
  const shownTabs: JobTab[] = tabs.length ? tabs : DEFAULT_TABS;
  const flags = p.status.filter((s) => s === "problems" || s === "hold");
  const base = (r: R, skip?: "type" | "funds" | "late") =>
    matchesSearch(r, p.q) && (skip === "type" || !p.type || r.typeCode === p.type) && (skip === "funds" || !p.funds || fundsKeyOf(r) === p.funds) && (skip === "late" || !p.late || isLate(r));
  const flagOk = (r: R) => !flags.length || (flags.includes("problems") && !!r.problem) || (flags.includes("hold") && !!r.hold);
  const inTabs = (r: R) => shownTabs.includes(r.tab);
  const rows = all.filter((r) => inTabs(r) && flagOk(r) && base(r));

  const status = Object.fromEntries(JOB_STATUS_KEYS.map((k) => [k, 0])) as Record<JobStatusKey, number>;
  for (const r of all) {
    if (!base(r) || r.tab === "returned") continue;
    status[r.tab as Exclude<JobStatusKey, "problems" | "hold">]++;
    if (inTabs(r) && r.problem) status.problems++;
    if (inTabs(r) && r.hold) status.hold++;
  }
  const type: Record<string, number> = {};
  const funds = Object.fromEntries(FUNDS_KEYS.map((k) => [k, 0])) as Record<FundsKey, number>;
  let late = 0;
  for (const r of all) {
    if (!inTabs(r) || !flagOk(r)) continue;
    if (base(r, "type")) type[r.typeCode] = (type[r.typeCode] ?? 0) + 1;
    const fk = fundsKeyOf(r);
    if (fk && base(r, "funds")) funds[fk]++;
    if (base(r, "late") && isLate(r)) late++;
  }
  return { rows: sortJobs(rows, p), counts: { status, type, funds, late } };
}

/** Late first, then the soonest due (the default); or by borrower, branch or due date, either way. */
export function sortJobs<R extends Row>(rows: readonly R[], p: Pick<JobListParams, "sort" | "dir">): R[] {
  const sign = p.dir === "desc" ? -1 : 1;
  const byDue = (a: R, b: R) => {
    const la = isLate(a) ? 0 : 1, lb = isLate(b) ? 0 : 1;
    if (p.sort === "due" && p.dir === "asc" && la !== lb) return la - lb; // late first only in the default order
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) * sign;
    if (a.dueDate || b.dueDate) return a.dueDate ? -1 : 1; // no due date last, either way
    return b.endorsedAt.getTime() - a.endorsedAt.getTime();
  };
  const cmp = (a: R, b: R) =>
    p.sort === "borrower" ? a.borrower.localeCompare(b.borrower) * sign || byDue(a, b)
    : p.sort === "branch" ? a.branch.localeCompare(b.branch) * sign || byDue(a, b)
    : byDue(a, b);
  return [...rows].sort(cmp);
}
