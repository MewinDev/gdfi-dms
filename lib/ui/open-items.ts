/**
 * Open items on a loan file's transactions: open problems, open holds and open missing-paper
 * requests. Pure: built from the records already stored (Problem, Hold, the Legal Docs Completion
 * request and the checklist as it is now); nothing is stored twice.
 * Most urgent first: problem, hold, missing paper; then oldest first.
 */
import { holdDays, problemDays } from "@/lib/workflow/tat";
import { holdReasonName } from "@/lib/ui/holds";

export type OpenKind = "problem" | "hold" | "missing";

export interface OpenTxnInput {
  id: string;
  code: string;
  name: string;
  problems: { id: string; raisedAt: Date; resolvedAt: Date | null; raisedByLabel: string; note: string; outsideControl: boolean; reason: { name: string } }[];
  holds: { id: string; raisedAt: Date; resumedAt: Date | null; raisedByLabel: string; note: string; reason: { name: string } }[];
  /**
   * The open missing-paper request, if any: when, who, asked from whom, and what it asked for:
   * `rows` (the requested checklist rows still not ticked; null for older requests that stored names
   * only) or `papers` (those names).
   */
  request: { id: string; raisedAt: Date; raisedByLabel: string; askedFrom: string | null; rows: { id: string; label: string }[] | null; papers: string[] } | null;
  /** Papers still not ticked now (name and the checklist rows that would satisfy it). */
  stillMissing: { name: string; lineIds: string[] }[];
}

export interface OpenItem {
  id: string;
  kind: OpenKind;
  txnId: string;
  txnCode: string;
  txnName: string;
  /** Short reason: the problem or hold reason, or the papers asked for ("OR/CR, Insurance"). */
  reason: string;
  since: Date;
  by: string;
  note: string;
  /** Business days so far (problems and holds; at least 1). */
  days: number;
  outsideControl: boolean;
  /** Missing paper: the requested papers still not ticked, and their checklist rows. */
  papers: string[];
  lineIds: string[];
  /** Missing paper: asked from whom (Borrower, Branch, Other), when given. */
  askedFrom: string | null;
}

const RANK: Record<OpenKind, number> = { problem: 0, hold: 1, missing: 2 };

export function openItemsOf(txns: OpenTxnInput[], holidays: ReadonlySet<string>, now: Date = new Date()): OpenItem[] {
  const out: OpenItem[] = [];
  for (const t of txns) {
    const base = { txnId: t.id, txnCode: t.code, txnName: t.name, outsideControl: false, papers: [] as string[], lineIds: [] as string[], askedFrom: null };
    for (const p of t.problems.filter((x) => !x.resolvedAt)) {
      out.push({ ...base, id: p.id, kind: "problem", reason: p.reason.name, since: p.raisedAt, by: p.raisedByLabel, note: p.note, days: Math.max(1, problemDays([p], holidays, now)), outsideControl: p.outsideControl });
    }
    for (const h of t.holds.filter((x) => !x.resumedAt)) {
      out.push({ ...base, id: h.id, kind: "hold", reason: holdReasonName(h), since: h.raisedAt, by: h.raisedByLabel, note: h.note, days: Math.max(1, holdDays([h], holidays, now)) });
    }
    if (t.request) {
      // The papers asked for that are still not ticked: the stored rows, or (older requests) by name.
      const r = t.request;
      const still = r.rows ?? t.stillMissing.filter((m) => r.papers.includes(m.name)).map((m) => ({ id: m.lineIds[0], label: m.name, ids: m.lineIds }));
      const papers = still.map((x) => x.label);
      out.push({
        ...base, id: r.id, kind: "missing", reason: (papers.length ? papers : r.papers).join(", "),
        since: r.raisedAt, by: r.raisedByLabel, note: "", days: 0, askedFrom: r.askedFrom,
        papers, lineIds: still.flatMap((x) => ("ids" in x ? (x as { ids: string[] }).ids : [x.id])),
      });
    }
  }
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.since.getTime() - b.since.getTime());
}

export const OPEN_WORD: Record<OpenKind, string> = { problem: "Problem", hold: "On hold", missing: "Missing paper" };

/** The small chip next to the selected transaction's title: "On hold · 1 day", "Problem · 2 days", "1 paper requested". */
export function titleChipOf(i: Pick<OpenItem, "kind" | "days" | "papers">): { text: string; tone: "bad" | "hold" } {
  const d = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (i.kind === "hold") return { text: `On hold · ${d(i.days)}`, tone: "hold" };
  if (i.kind === "problem") return { text: `Problem · ${d(i.days)}`, tone: "bad" };
  const n = Math.max(1, i.papers.length);
  return { text: `${n} paper${n === 1 ? "" : "s"} requested`, tone: "bad" };
}

/** Card groups, in this order; only groups with items are shown. */
export const OPEN_GROUPS: { kind: OpenKind; title: string }[] = [
  { kind: "missing", title: "Waiting for papers" },
  { kind: "hold", title: "On hold" },
  { kind: "problem", title: "Problems" },
];

/** The highlight target of an item: the requested paper's row, or the item's banner. */
export const focusTargetOf = (i: Pick<OpenItem, "kind" | "id" | "lineIds">) => (i.kind === "missing" && i.lineIds[0] ? `line-${i.lineIds[0]}` : `open-${i.id}`);
