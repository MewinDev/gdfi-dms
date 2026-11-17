import { addWorkingDays, workingDaysBetween, type Days } from "@/lib/calendar/core";

/**
 * Piece 9 rules (D-014, D-015, D-046), pure. A work item's round: waiting time (arrival to accept, never counted
 * against the person), TAT used (accept to forward, less paused days), due date and lateness; the pool colour.
 * Counting is the one calendar's (D-041): working days after the start up to and including the end.
 */

export type Outcome = "FORWARDED" | "RETURNED" | "DONE" | "MOVED_AWAY" | "BACK_TO_POOL" | "CANCELLED" | "PULLED_BACK";
export type PoolTone = "green" | "amber" | "red";

/** Working days waiting: arrival day to accept day (0 the same day). */
export const waitingDays = (arrivedDay: string, acceptedDay: string, days: Days) => Math.max(0, workingDaysBetween(arrivedDay, acceptedDay, days));

/** A round's due date: the target in working days from the accept day (a fresh full target each round, D-046). */
export const roundDue = (acceptedDay: string, targetDays: number, days: Days) => addWorkingDays(acceptedDay, targetDays, days);

/**
 * How a round ended. TAT used = working days from accept to the end, less paused days. Late = ended after its due
 * date; a round closed by a move ("Moved (away)") or sent back to the pool is never late (D-046 item 3).
 */
export function roundResult(r: { acceptedDay: string; endDay: string; dueDate: string | null; pausedDays: number; outcome: Outcome; days: Days }) {
  const used = Math.max(0, workingDaysBetween(r.acceptedDay, r.endDay, r.days) - r.pausedDays);
  const excused = r.outcome === "MOVED_AWAY" || r.outcome === "BACK_TO_POOL" || r.outcome === "CANCELLED" || r.outcome === "PULLED_BACK";
  const late = !excused && !!r.dueDate && r.endDay > r.dueDate;
  return { used, late, lateBy: late ? workingDaysBetween(r.dueDate!, r.endDay, r.days) : 0 };
}

/** The colour of an item waiting in the pool (settings: amber after 1 working day, red after 2). */
export function poolTone(waiting: number, amberAfter: number, redAfter: number): PoolTone {
  if (waiting >= redAfter) return "red";
  if (waiting >= amberAfter) return "amber";
  return "green";
}

/** Plain words for the pool line. */
export const waitingText = (n: number) => (n === 0 ? "Arrived today" : `Waiting ${n} working day${n === 1 ? "" : "s"}`);

/** Plain words for a closed round (TAT report, Movements). */
export function outcomeText(o: Outcome | string | null): string {
  return ({ FORWARDED: "Forwarded", RETURNED: "Returned", DONE: "Done", MOVED_AWAY: "Moved (away)", BACK_TO_POOL: "Back to the pool", CANCELLED: "Cancelled", PULLED_BACK: "Pulled back" } as Record<string, string>)[o ?? ""] ?? "Open";
}

/** Is a person away on this day (from / to inclusive, YYYY-MM-DD)? */
export const isAway = (u: { awayFrom: string | null; awayTo: string | null }, day: string) => !!u.awayFrom && !!u.awayTo && u.awayFrom <= day && day <= u.awayTo;
