import type { LoanRow } from "@/lib/services/queries";
import type { LoanCardData } from "@/components/ui/loan-card";
import { BORROWER_CHIP } from "./borrower-chip";
import { deadlineChip, LA_STAGES, peso, stageWords, WAITING_STAGES } from "./plain";

export function cardFor(r: LoanRow, holidays: ReadonlySet<string>): LoanCardData & { urgency: number; group: "need" | "wait" | "other"; problem: boolean } {
  const problem = r.openExceptions > 0;
  const dl = deadlineChip(r.tat, holidays);
  const needsYou = problem || LA_STAGES.includes(r.stage);
  return {
    pn: r.pn,
    borrowerName: r.borrowerName,
    branch: r.branch,
    amountText: peso(r.amount),
    action: problem ? "Fix a problem first" : stageWords(r.stage),
    chip: r.sourceChanged ? { text: "MyLoans changed", tone: "bad" } : r.borrowerChanged ? { text: BORROWER_CHIP, tone: "wait" } : problem ? { text: `${r.openExceptions} problem${r.openExceptions === 1 ? "" : "s"}`, tone: "bad" } : dl ? { text: dl.text, tone: dl.tone } : null,
    urgency: (problem ? 10 : 0) + (dl?.urgency ?? 0),
    group: needsYou ? "need" : WAITING_STAGES.includes(r.stage) ? "wait" : "other",
    problem,
  };
}

/** Most urgent first: problems, then late / due today, then the oldest release. */
export function sortByUrgency<T extends { urgency: number }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => b.urgency - a.urgency);
}
