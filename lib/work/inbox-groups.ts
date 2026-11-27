import type { InboxRow } from "@/lib/services/work-items";

/**
 * D-063: the Inbox shows one row per LOAN. The items of the same loan (its transactions, a processor's job, a
 * package) are one row; an item with no loan (a funds request) is a row of its own. Each row has one status chip,
 * the most urgent of its items: "Late by 2 days", "Due today", "3 days left" or "Paused". Pure (no database), so the
 * Inbox's client code and the tests use the same rules.
 */

export type DueKind = "late" | "today" | "left" | "paused";
export interface DueStatus { kind: DueKind; text: string; tone: "bad" | "act" | "ok" | "hold" }

const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** The status chip of one item: paused first; then late, due today or days left; null without a due date. */
export function dueStatus(r: Pick<InboxRow, "paused" | "daysLeft" | "tone">): DueStatus | null {
  if (r.paused) return { kind: "paused", text: "Paused", tone: "hold" };
  if (r.daysLeft === null || r.daysLeft === undefined) return null;
  if (r.daysLeft < 0) return { kind: "late", text: `Late by ${plural(-r.daysLeft)}`, tone: "bad" };
  if (r.daysLeft === 0) return { kind: "today", text: "Due today", tone: "act" };
  return { kind: "left", text: `${plural(r.daysLeft)} left`, tone: r.tone === "amber" ? "act" : "ok" };
}

/** Lower is more urgent: the most days late first; paused and no due date last (as the Inbox order, D-046). */
function urgency(r: InboxRow): number {
  if (r.paused) return 1_000_000;
  if (r.daysLeft === null || r.daysLeft === undefined) return 500_000;
  return r.daysLeft;
}

/**
 * How long an item waited before it was taken (from arrival to accept, or today), under a "Waited" label in the details
 * panel only: "Less than a day" (the user's review: plain words, not "< 1 day"), "1 working day", "2 working days".
 */
export const waitedShort = (n: number) => (n === 0 ? "Less than a day" : `${n} working day${n === 1 ? "" : "s"}`);

export interface InboxGroup {
  /** The PN (or the item id when it has no loan). */
  key: string;
  pn: string | null;
  loanId: string | null;
  /** The borrower, or the item's label when it has no loan (a funds request). */
  name: string;
  branchName: string;
  product: string | null;
  amount: string | null;
  /** The release date ("Nov 26, 2026"). */
  releasedOn: string | null;
  items: InboxRow[];
  /** The most urgent item's status and due date. */
  status: DueStatus | null;
  dueText: string | null;
  /** A released loan not yet in the DMS (the pool's preview). */
  candidate: boolean;
  /** In a branch pool: "In the branch pool since Nov 24 · 2 working days" (the longest waiting item) and its colour. */
  poolText: string | null;
  poolTone: InboxRow["poolTone"];
}

/** Groups the items by loan, keeping the list's order (a loan sits where its first item was). */
export function groupByLoan(rows: readonly InboxRow[]): InboxGroup[] {
  const by = new Map<string, InboxRow[]>();
  for (const r of rows) {
    const key = r.pn ?? r.id;
    by.set(key, [...(by.get(key) ?? []), r]);
  }
  return [...by.entries()].map(([key, items]) => {
    const top = [...items].sort((a, b) => urgency(a) - urgency(b))[0];
    const oldest = [...items].sort((a, b) => b.waiting - a.waiting)[0];
    const pnOf = items[0].pn;
    return {
      key, pn: pnOf, loanId: items.find((i) => i.loanId)?.loanId ?? null,
      name: items.find((i) => i.borrower)?.borrower ?? (pnOf ? pnOf : items[0].label),
      branchName: items[0].branchName,
      product: items.find((i) => i.product)?.product ?? null,
      amount: items.find((i) => i.amount)?.amount ?? items.find((i) => i.candidate?.amount)?.candidate?.amount ?? null,
      releasedOn: items.find((i) => i.releasedOn)?.releasedOn ?? null,
      items, status: dueStatus(top), dueText: top.paused ? null : top.dueText,
      candidate: items.some((i) => i.kind === "LOAN_CANDIDATE"),
      poolText: oldest.poolText, poolTone: oldest.poolTone,
    };
  });
}

/**
 * D-063: every Inbox count is in loans, the same unit as the rows: the sidebar badge, the tabs, "N waiting too long"
 * and Home's "Work to move on". Items of the same loan count once; an item with no loan (a funds request) is one.
 */
export const loanCount = (items: readonly { id: string; pn: string | null }[]) => new Set(items.map((i) => i.pn ?? i.id)).size;

/** The quick filters of My items (D-063): all, late, due today, paused. */
export type QuickFilter = "all" | "late" | "today" | "paused";
export const matchesFilter = (g: InboxGroup, f: QuickFilter) => f === "all" || g.status?.kind === f;

/** One item's chip on the row: "Notary · Check and send"; a funds request or a package says what it is. */
export const itemChipText = (r: InboxRow) => (r.txn ? `${r.txn.name} · ${r.kindText}` : r.kindText);
