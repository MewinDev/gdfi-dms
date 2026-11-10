/**
 * One status wording for a transaction, used wherever the list of transactions appears (Loan File
 * "All transactions", Check documents "Transactions" and the tablet and phone strip): exactly ONE
 * status word as a soft pill, and the day count as plain grey text (never a second pill). The Loan
 * File list also shows one short line; Check documents does not (the "Do this now" card says it).
 * The word is what blocks the row first, in the same order as the "Do this now" steps
 * (lib/workflow/next-steps.ts): On hold, Problem, Returned, Missing paper; then the status itself:
 * Not started, Needs papers, Ready to send, Sent to DP, In progress, Coming back, Done.
 * Who it was sent to and the LTO office are in the transaction detail only.
 * Pure, so the server and the browser use the same words.
 */
import type { TatChipData } from "@/lib/workflow/tat";
import { blockerOf } from "@/lib/workflow/next-steps";
import { holdRowLine } from "./holds";
import type { Tone } from "./plain";

export interface TxnStatusInput {
  code: string;
  requiresDp: boolean;
  /** Custom types done by the LA have no processor and are finished with "Mark as done". */
  status: string;
  requiredDone: number;
  requiredTotal: number;
  tickedAny: boolean;
  edstReference?: string | null;
  /** Returned by the processor after accepting (Return to LA: papers needed): the reason. */
  returnedForPapers?: string | null;
  /** Sent back by the DP and now with the LA who sent it: Decline (before accepting) or Return to LA (after). */
  sentBack?: "declined" | "returned" | null;
  /** The TAT chip of the current step (lib/jobs/view.ts txnTat), null when there is no clock. */
  tat: TatChipData | null;
  /** Open items on it (the same ones as the Open items card). */
  problem: { reason: string; days: number } | null;
  hold: { reason: string; days: number } | null;
  missingPapers: number;
}

export type PillKind = "status" | "missing" | "hold" | "problem" | "returned";
export interface TxnStatus {
  /** The one status pill (word and icon; colour is never the only signal). */
  pill: { text: string; tone: Tone; kind: PillKind };
  /** One short line under the name (Loan File list only). */
  line: string;
  /** "Day 1 of 2", "Due today", "+1 day late": plain text, never a pill; null for finished work. */
  clock: { text: string; late: boolean } | null;
}

const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Sent back by the DP (Decline or Return to LA) and now with the LA. */
const isReturned = (t: TxnStatusInput) => t.status === "RETURNED";

/** The status itself (before what blocks it): the word, its tone and the short line. */
function base(t: TxnStatusInput): { text: string; tone: Tone; line: string } {
  const missing = Math.max(0, t.requiredTotal - t.requiredDone);
  switch (t.status) {
    case "FOR_CHECKLIST":
    case "READY":
    case "RETURNED":
      if (t.status === "RETURNED" && t.sentBack === "declined") {
        return { text: "Returned", tone: "act", line: "Declined by the DP · fix and send again" };
      }
      if (t.status === "RETURNED") {
        return { text: "Returned", tone: "act", line: t.returnedForPapers && missing > 0 ? `Returned: ${t.returnedForPapers}` : "Fix and send again" };
      }
      if (missing > 0) return t.tickedAny ? { text: "Needs papers", tone: "act", line: "Checking papers" } : { text: "Not started", tone: "mute", line: "Not started" };
      if (t.requiresDp) return { text: "Ready to send", tone: "ok", line: "Choose a processor" };
      return { text: "In progress", tone: "act", line: t.code === "EDST" ? "Enter it in EDST" : "Mark it as done" };
    case "ASSIGNED":
      return { text: "Sent to DP", tone: "wait", line: "Waiting for the DP to accept" };
    case "IN_PROCESS":
      return { text: "In progress", tone: "wait", line: "The DP is working on it" };
    case "FORWARDED":
      return { text: "Coming back", tone: "act", line: "Check the package when it arrives" };
    case "COMPLETED":
      return { text: "Done", tone: "ok", line: t.code === "EDST" && t.edstReference ? `EDST reference ${t.edstReference}` : t.requiresDp ? "The package came back complete" : "Finished" };
    default:
      return { text: "Cancelled", tone: "mute", line: "Cancelled" };
  }
}

export function txnStatus(t: TxnStatusInput): TxnStatus {
  const b = base(t);
  const clock = t.status === "COMPLETED" || t.status === "CANCELLED" ? null : clockText(t.tat);
  switch (blockerOf({ hold: !!t.hold, problem: !!t.problem, returned: isReturned(t), missing: t.missingPapers > 0 })) {
    case "hold": return { pill: { text: "On hold", tone: "hold", kind: "hold" }, line: holdRowLine(t.hold!.reason, t.hold!.days), clock };
    case "problem": return { pill: { text: "Problem", tone: "bad", kind: "problem" }, line: `Problem: ${t.problem!.reason} · ${dd(Math.max(1, t.problem!.days))}`, clock };
    case "returned": return { pill: { text: "Returned", tone: "act", kind: "returned" }, line: b.line, clock };
    case "missing": return { pill: { text: "Missing paper", tone: "act", kind: "missing" }, line: b.line, clock };
    default: return { pill: { text: b.text, tone: b.tone, kind: "status" }, line: b.line, clock };
  }
}

/**
 * The clock as plain text: "Day 1 of 2", "Due today", "+1 day late" (late is shown in red text).
 * The pill already says Problem or On hold, so the clock never repeats it (the clock never pauses).
 */
export function clockText(tat: TatChipData | null): TxnStatus["clock"] {
  if (!tat || tat.state === "done") return null;
  if (tat.lateText) return { text: tat.lateText, late: true };
  if (tat.state === "overdue") return { text: tat.text, late: true };
  if (tat.state === "due") return { text: "Due today", late: false };
  const day = /Day \d+ of \d+/.exec(tat.text)?.[0];
  if (day) return { text: day, late: false };
  const waiting = /Waiting · (\d+ days?)/.exec(tat.text)?.[1];
  return waiting ? { text: `Waiting ${waiting}`, late: false } : null;
}
