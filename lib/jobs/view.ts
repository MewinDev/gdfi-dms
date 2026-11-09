/**
 * Shared read-model for a transaction's job: funds status, TAT chip and open problem.
 * Used by the Loan File, Check documents, DP Home / Jobs, Finance and the Admin report, so every
 * screen shows the same words. The clock never pauses; problem time is shown beside it.
 */
import { fundsStatus, type FundsStatus } from "@/lib/funds/rules";
import { holdDays, problemDays, stepClock, tatChip, targetOf, txnStepKey, type TatChipData, type TatMap } from "@/lib/workflow/tat";
import { businessDate } from "@/lib/time";
import { holdReasonName } from "@/lib/ui/holds";

export interface TxnLike {
  status: string;
  statusSince: Date;
  fundsNeeded: "UNANSWERED" | "YES" | "NO";
  type: { code: string };
  advanceLines: { denied: boolean; releasedCents: number; advance: { status: string } }[];
  problems: { raisedAt: Date; resolvedAt: Date | null; reason: { name: string } }[];
  /** Holds (waiting, not a fault). Optional so older callers keep working; missing means none. */
  holds?: { raisedAt: Date; resumedAt: Date | null; reason: { name: string } }[];
}

export const txnFunds = (t: Pick<TxnLike, "fundsNeeded" | "advanceLines">): FundsStatus =>
  fundsStatus(t.fundsNeeded, t.advanceLines.map((l) => ({ denied: l.denied, releasedCents: l.releasedCents, advanceStatus: l.advance.status })));

/** The funds type of the transaction's live funds record (the latest one not denied or cancelled), or null. */
export function txnFundsType(t: { advanceLines: { denied: boolean; advance: { status: string; fundsTypeCode?: string; fundsTypeName?: string } }[] }): { code: string; name: string } | null {
  const live = t.advanceLines.filter((l) => !l.denied && !["DENIED", "CANCELLED"].includes(l.advance.status) && l.advance.fundsTypeCode);
  const l = live.at(-1);
  return l ? { code: l.advance.fundsTypeCode!, name: l.advance.fundsTypeName ?? l.advance.fundsTypeCode! } : null;
}

export const openProblem = <P extends { resolvedAt: Date | null }>(problems: P[]): P | null => problems.find((p) => !p.resolvedAt) ?? null;
export const openHold = <H extends { resumedAt: Date | null }>(holds: H[] | undefined): H | null => holds?.find((h) => !h.resumedAt) ?? null;

/** TAT chip for the transaction's current step (null when the step has no clock: done, cancelled, before the step). */
export function txnTat(t: TxnLike, tats: TatMap, holidays: ReadonlySet<string>, now: Date = new Date()): TatChipData | null {
  const key = txnStepKey(t.status, t.type.code);
  if (!key) return null;
  const clock = stepClock({ targetDays: targetOf(tats, key), start: t.statusSince }, holidays, now);
  // Problem time on this step: problems raised since the step began (sum of business days, still counting).
  const onStep = t.problems.filter((p) => p.raisedAt >= t.statusSince || !p.resolvedAt);
  const open = openProblem(t.problems);
  const hold = openHold(t.holds);
  return tatChip(
    clock, businessDate(now),
    open ? { open: true, days: problemDays(onStep.filter((p) => !p.resolvedAt), holidays, now), reason: open.reason.name } : null,
    hold ? { open: true, days: holdDays([hold], holidays, now), reason: holdReasonName(hold) } : null,
  );
}

/** Done chip for a finished job: from acceptance to completion against the processing target. */
export function doneTat(code: string, start: Date, end: Date, tats: TatMap, holidays: ReadonlySet<string>): TatChipData {
  const key = ({ NOTARY: "P4_NOTARY", PPSR: "P4_PPSR", MORTGAGE: "P4_MORTGAGE" } as Record<string, string>)[code] ?? null;
  return tatChip(stepClock({ targetDays: targetOf(tats, key), start, end }, holidays, end), businessDate(end));
}

/** Total problem days on a transaction (all problems, holidays skipped). */
export const txnProblemDays = (t: Pick<TxnLike, "problems">, holidays: ReadonlySet<string>, now: Date = new Date()) => problemDays(t.problems, holidays, now);

export const FUNDS_TONE: Record<FundsStatus, "mute" | "act" | "wait" | "ok" | "bad" | "navy"> = {
  NOT_NEEDED: "mute", NEEDED: "act", REQUESTED: "wait", FUNDED: "navy", SETTLED: "ok", DENIED: "bad",
};
