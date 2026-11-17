import { businessDate, tatBadge, type TatBadge } from "@/lib/time";
import { PAUSE_RULE_TEXT, addWorkingDays, workingDaysBetween, type Days } from "@/lib/calendar/core";
import type { Stage } from "./stage";

export type TatMap = Map<string, { businessDays: number; note: string; label: string }>;

const target = (tats: TatMap, key: string, fallback: number) => tats.get(key)?.businessDays ?? fallback;

export interface LoanTatInput {
  stage: Stage | string;
  stageSince: Date;
  releasedAt: Date;
  /** Transaction type codes currently with a DP (for "In process"). */
  inProcessCodes?: string[];
}

export interface LoanTat {
  deadline: string; // YYYY-MM-DD
  badge: TatBadge;
  basis: string;
}

/**
 * TAT for the current stage. Phase 3 is measured from the release date (Day 2); later stages
 * are measured from when the loan entered the stage.
 */
export function loanTat(input: LoanTatInput, tats: TatMap, days: Days, now: Date = new Date()): LoanTat | null {
  const today = businessDate(now);
  const since = businessDate(input.stageSince);
  const release = businessDate(input.releasedAt);
  let deadline: string;
  let basis: string;
  switch (input.stage) {
    case "Opened":
    case "For checklist":
    case "No DP assignment required": {
      const d = target(tats, "P3_ASSIGN", 2);
      deadline = addWorkingDays(release, d, days);
      basis = `Day ${d} from release`;
      break;
    }
    case "Assigned to DP":
      deadline = addWorkingDays(since, target(tats, "P4_ACCEPT", 0), days);
      basis = "DP acceptance";
      break;
    case "In process": {
      const map: Record<string, string> = { NOTARY: "P4_NOTARY", PPSR: "P4_PPSR", MORTGAGE: "P4_MORTGAGE" };
      const d = Math.max(0, ...(input.inProcessCodes ?? []).map((c) => target(tats, map[c] ?? "P4_NOTARY", 3)));
      deadline = addWorkingDays(since, d || target(tats, "P4_LIQUIDATE", 5), days);
      basis = "DP processing";
      break;
    }
    case "Awaiting LA acceptance":
      deadline = addWorkingDays(since, target(tats, "P5_ACCEPT", 2), days);
      basis = "Branch acceptance";
      break;
    case "For Vault Transmittal":
    case "In transit to Vault":
      deadline = addWorkingDays(since, target(tats, "P6_VAULTED", 3), days);
      basis = "Transmittal to vaulted";
      break;
    default:
      return null;
  }
  return { deadline, badge: tatBadge(deadline, today), basis };
}

/** Day-2 deadline for assignment (Beyond-TAT reason required after it). */
export function assignDeadline(releasedAt: Date, tats: TatMap, days: Days): string {
  return addWorkingDays(businessDate(releasedAt), target(tats, "P3_ASSIGN", 2), days);
}

// ---------------------------------------------------------------------------
// Per-step clock and problems. The clock NEVER pauses: it runs from the step's start to its finish
// (or to now), through waiting, hold and problems. A problem is a separate red state with its own
// timer; it does not move the deadline or the day count.
// ---------------------------------------------------------------------------

export interface StepClockInput {
  /** Target in business days (null: this step has no target, the chip shows Waiting). */
  targetDays: number | null;
  start: Date;
  /** Finished (null while running). */
  end?: Date | null;
}

export interface StepClock {
  /** Business days used so far (or until the finish). Day N shows max(1, used). */
  used: number;
  target: number | null;
  deadline: string | null;
  /** Business days past the deadline (0 when not late). */
  late: number;
  done: boolean;
}

export function stepClock(input: StepClockInput, days: Days, now: Date = new Date()): StepClock {
  const start = businessDate(input.start);
  const until = businessDate(input.end ?? now);
  const used = Math.max(0, workingDaysBetween(start, until, days));
  if (input.targetDays === null) return { used, target: null, deadline: null, late: 0, done: !!input.end };
  const deadline = addWorkingDays(start, input.targetDays, days);
  const late = until > deadline ? workingDaysBetween(deadline, until, days) : 0;
  return { used, target: input.targetDays, deadline, late, done: !!input.end };
}

/** Problem time: the sum of each problem's open time in business days (holidays skipped), still counting while open. */
export function problemDays(problems: { raisedAt: Date; resolvedAt: Date | null }[], days: Days, now: Date = new Date()): number {
  return problems.reduce((sum, p) => sum + Math.max(0, workingDaysBetween(businessDate(p.raisedAt), businessDate(p.resolvedAt ?? now), days)), 0);
}

/** Hold time: the sum of each hold's time in business days (holidays and weekends skipped), still counting while open. */
export function holdDays(holds: { raisedAt: Date; resumedAt: Date | null }[], days: Days, now: Date = new Date()): number {
  return holds.reduce((sum, h) => sum + Math.max(0, workingDaysBetween(businessDate(h.raisedAt), businessDate(h.resumedAt ?? now), days)), 0);
}

/** processing = green (2+ working days left), soon / due = amber, overdue = red, paused = grey (D-041). */
export type ChipState = "waiting" | "processing" | "soon" | "due" | "hold" | "paused" | "problem" | "overdue" | "done";
export interface TatChipData {
  state: ChipState;
  text: string;
  /** "+1 day late" shown next to a Problem or On hold chip when also overdue. */
  lateText?: string;
  /** Plain words shown on hover and to screen readers (the pause rule on a Paused chip). */
  note?: string;
}

export interface HoldChipInput { open: boolean; days: number; reason: string; /** The hold's reason is ticked "Pauses TAT" (D-041). */ pauses?: boolean }

const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * The one mapping from a clock (+ open problem, + open hold) to the chip. Words and an icon, never
 * colour alone. A problem wins over a hold; both keep the day count (the clock never pauses), and an
 * overdue step shows "+N days late" beside either.
 */
export function tatChip(clock: StepClock, today: string, problem?: { open: boolean; days: number; reason: string } | null, hold?: HoldChipInput | null, soon?: { days: Days; amberWithin: number }): TatChipData {
  const total = Math.max(1, clock.target ?? 0);
  const day = Math.max(1, clock.used);
  const lateText = clock.late > 0 ? `+${dd(clock.late)} late` : undefined;
  if (clock.done) return { state: "done", text: clock.late > 0 ? `Done · ${dd(clock.late)} late` : "Done on time" };
  if (problem?.open) {
    return { state: "problem", text: `Problem ${dd(Math.max(1, problem.days))} · ${problem.reason}${clock.target !== null ? ` · Day ${Math.min(day, total)} of ${total}` : ""}`, lateText };
  }
  if (hold?.open && hold.pauses && clock.target !== null) {
    // The clock is stopped (D-041): no countdown while it waits on someone else.
    return { state: "paused", text: `Paused · ${hold.reason}`, note: `On hold ${dd(Math.max(1, hold.days))}; the turnaround time is paused. ${PAUSE_RULE_TEXT}`, lateText };
  }
  if (hold?.open) {
    return {
      state: "hold", text: `On hold ${dd(Math.max(1, hold.days))} · ${hold.reason}${clock.target !== null ? ` · Day ${Math.min(day, total)} of ${total}` : ""}`,
      lateText,
    };
  }
  if (clock.target === null) return { state: "waiting", text: `Waiting · ${dd(day)}` };
  if (clock.late > 0) return { state: "overdue", text: lateText! };
  if (clock.deadline === today) return { state: "due", text: `Due today · Day ${total} of ${total}` };
  if (soon && clock.deadline) {
    const left = workingDaysBetween(today, clock.deadline, soon.days);
    if (left > 0 && left <= soon.amberWithin) return { state: "soon", text: `${dd(left)} left · Day ${Math.min(day, total)} of ${total}` };
  }
  return { state: "processing", text: `Processing · Day ${Math.min(day, total)} of ${total}` };
}

/** TAT key for a transaction's current step (null: no target). */
export function txnStepKey(status: string, code: string): string | null {
  switch (status) {
    case "FOR_CHECKLIST": case "READY": case "RETURNED": return code === "EDST" ? "P3_EDST" : "P3_ASSIGN";
    case "ASSIGNED": return "P4_ACCEPT";
    case "IN_PROCESS": return ({ NOTARY: "P4_NOTARY", PPSR: "P4_PPSR", MORTGAGE: "P4_MORTGAGE" } as Record<string, string>)[code] ?? null;
    case "FORWARDED": return "P5_ACCEPT";
    default: return null;
  }
}

/** Target days for a TAT key (null when there is none). */
export const targetOf = (tats: TatMap, key: string | null) => (key ? tats.get(key)?.businessDays ?? null : null);
