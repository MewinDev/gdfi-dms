import type { LoanRow } from "@/lib/services/queries";
import type { LoanCardData } from "@/components/ui/loan-card";
import { BORROWER_CHIP } from "./borrower-chip";
import { dayText, deadlineChip, LA_STAGES, peso, stageWords, WAITING_STAGES, type Tone } from "./plain";

/** A loan's row on My loans: the one Home chip, plus the deadline and the "something is different" flags apart. */
export interface LoanListCard extends LoanCardData {
  urgency: number;
  group: "need" | "wait" | "other";
  problem: boolean;
  /** The deadline ("Due today", "Late by 2 days", "3 days left"), shown in its own column. */
  due: { text: string; tone: Tone; hot: boolean } | null;
  /** What is different about this loan (MyLoans changed, borrower details waiting, problems), most important first. */
  flags: { text: string; tone: Tone }[];
  /** The account at a glance: "New · Auto Refinancing" and "Released Nov 10, 2026". */
  loanText: string;
  releasedText: string;
}

export function cardFor(r: LoanRow, holidays: ReadonlySet<string>): LoanListCard {
  const problem = r.openExceptions > 0;
  const dl = deadlineChip(r.tat, holidays);
  const needsYou = problem || LA_STAGES.includes(r.stage);
  const flags: { text: string; tone: Tone }[] = [
    ...(r.sourceChanged ? [{ text: "MyLoans changed", tone: "bad" as Tone }] : []),
    ...(r.borrowerChanged ? [{ text: BORROWER_CHIP, tone: "wait" as Tone }] : []),
    ...(problem ? [{ text: `${r.openExceptions} problem${r.openExceptions === 1 ? "" : "s"}`, tone: "bad" as Tone }] : []),
  ];
  return {
    due: dl ? { text: dl.text, tone: dl.tone, hot: dl.urgency >= 2 } : null,
    flags,
    loanText: [r.loanType, r.productName?.trim()].filter(Boolean).join(" · "),
    releasedText: `Released ${dayText(r.releasedAt)}`,
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
