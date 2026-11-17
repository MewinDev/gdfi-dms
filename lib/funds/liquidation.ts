import { addWorkingDays, workingDaysBetween, type Days } from "@/lib/calendar/core";
import { dayText } from "@/lib/ui/plain";

/**
 * The liquidation due date (D-017, D-044). Pure: the service gathers the facts, this decides.
 *
 * Due = N working days (per funds type, default 2) after the LAST of its lines' anchors, on the requesting
 * processor's branch calendar:
 *   - a transaction line: its LTO pickup (or, for a type with no LTO, its completion);
 *   - a transaction cancelled before that: the cancellation day;
 *   - a note-only line: the release day.
 * Until every line has its anchor there is no date (never overdue) — unless the FALLBACK applies: a line's LTO is
 * not done after its job's own TAT due date; then due = N working days after the latest anchor or TAT due date.
 * A saved LTO / cancellation / release date stays even if an LTO is later redone or cancelled; a fallback date
 * stays once set even if the LTO is then done (it still moves while the TAT due date moves and the LTO is pending).
 */

export type LiquidationBasis = "LTO" | "CANCELLED" | "RELEASE" | "FALLBACK";

export interface LiqLine {
  kind: "TXN" | "NOTE";
  /** The day the line is done (LTO pickup, or completion for a type with no LTO), counted from the carry-over. */
  doneDay: string | null;
  /** The day its transaction was cancelled before it was done. */
  cancelledDay: string | null;
  /** The saved TAT due date of the line's current job (for the fallback); null when there is no accepted job. */
  jobDueDay: string | null;
}

export interface LiqInput {
  n: number;
  releasedDay: string;
  lines: LiqLine[];
  today: string;
  days: Days;
  saved: { due: string | null; basis: LiquidationBasis | null };
}

export type LiqDue =
  | { state: "due"; due: string; anchor: string; basis: LiquidationBasis }
  | { state: "waiting"; left: number; total: number };

const max = (xs: string[]) => xs.reduce((a, b) => (b > a ? b : a));

export function liquidationDueOf(i: LiqInput): LiqDue {
  // A saved final date stays (D-044 item 1).
  if (i.saved.due && i.saved.basis && i.saved.basis !== "FALLBACK") return { state: "due", due: i.saved.due, anchor: i.saved.due, basis: i.saved.basis };
  const anchors = i.lines.map((l) => (l.kind === "NOTE" ? { day: i.releasedDay, why: "RELEASE" as const } : l.doneDay ? { day: l.doneDay, why: "LTO" as const } : l.cancelledDay ? { day: l.cancelledDay, why: "CANCELLED" as const } : null));
  const pending = i.lines.filter((_, k) => !anchors[k]);
  const done = anchors.filter((a): a is NonNullable<typeof a> => !!a);
  if (!pending.length) {
    // A fallback date that was set stays even now that the LTO is done (D-044 item 5).
    if (i.saved.due && i.saved.basis === "FALLBACK") return { state: "due", due: i.saved.due, anchor: i.saved.due, basis: "FALLBACK" };
    if (!done.length) return { state: "waiting", left: 0, total: 0 };
    const anchor = max(done.map((a) => a.day));
    const why = done.every((a) => a.why === "RELEASE") ? "RELEASE" : done.find((a) => a.day === anchor && a.why !== "RELEASE")?.why ?? "LTO";
    return { state: "due", due: addWorkingDays(anchor, i.n, i.days), anchor, basis: why };
  }
  // Fallback: a pending line's LTO is not done after its job's TAT due date (and every pending line has one).
  const fallback = pending.every((l) => !!l.jobDueDay) && pending.some((l) => i.today > l.jobDueDay!);
  if (fallback) {
    const anchor = max([...done.map((a) => a.day), ...pending.map((l) => l.jobDueDay!)]);
    return { state: "due", due: addWorkingDays(anchor, i.n, i.days), anchor, basis: "FALLBACK" };
  }
  return { state: "waiting", left: pending.length, total: i.lines.filter((l) => l.kind === "TXN").length };
}

/** Working days late: after the due date, up to and including the liquidation day (0 when on time). */
export const daysLate = (due: string, liquidatedDay: string, days: Days) => Math.max(0, workingDaysBetween(due, liquidatedDay, days));

const dd = (n: number) => `${n} working day${n === 1 ? "" : "s"}`;

/** The one line shown for an advance's liquidation (Funds, My funds), in plain words (D-044). */
export function liquidationLine(a: { status: string; dueText: string | null; basis: string | null; note: string; daysLate: number | null; n: number; mustLiquidate: boolean }): string {
  if (!a.mustLiquidate) return "No receipts needed for this type";
  if (a.daysLate !== null && ["LIQUIDATED", "CLOSED"].includes(a.status)) return a.daysLate > 0 ? `Liquidated ${dd(a.daysLate)} late` : "Liquidated on time";
  if (a.dueText) return a.basis === "FALLBACK" ? `LTO not done. Liquidation due by fallback: ${a.dueText}` : `Due ${a.dueText}`;
  return `Due ${dd(a.n)} after the LTO pickup${a.note ? ` (${a.note})` : ""}`;
}

/** The plain line of an advance row as stored (Funds, My funds). */
export function liquidationLineFor(a: {
  status: string; liquidationDueAt: Date | null; liquidationBasis: string | null; liquidationNote: string; daysLate: number | null;
  fundsType: { liquidationDueDays: number; mustLiquidate: boolean } | null;
}): string {
  return liquidationLine({
    status: a.status, dueText: a.liquidationDueAt ? dayText(a.liquidationDueAt) : null, basis: a.liquidationBasis, note: a.liquidationNote, daysLate: a.daysLate,
    n: a.fundsType?.liquidationDueDays ?? 2, mustLiquidate: a.fundsType?.mustLiquidate ?? true,
  });
}
