/**
 * One status wording for a transaction, used wherever the list of transactions appears (Loan File
 * "All transactions", Check documents "Transactions" and the tablet and phone strip): exactly ONE
 * status pill, ONE short line, and the day count as plain grey text (never a second pill).
 * The pill is the most important thing about the row: Problem, then On hold, then Missing paper,
 * then the status itself (Needs papers, Ready to send, Sent, Processing, Coming back, Done).
 * Who it was sent to and the LTO office are in the transaction detail only.
 * Pure, so the server and the browser use the same words.
 */
import type { TatChipData } from "@/lib/workflow/tat";
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

export type PillKind = "status" | "missing" | "hold" | "problem";
export interface TxnStatus {
  /** The one status pill (word and icon; colour is never the only signal). */
  pill: { text: string; tone: Tone; kind: PillKind };
  /** One short line under the name. */
  line: string;
  /** "Day 1 of 2", "Due today", "+1 day late": plain text, never a pill; null for finished work. */
  clock: { text: string; late: boolean } | null;
}

const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const pp = (n: number) => `${n} required paper${n === 1 ? "" : "s"}`;

/** The status itself (before open items): pill words and the short line. */
function base(t: TxnStatusInput): { text: string; tone: Tone; line: string } {
  const missing = Math.max(0, t.requiredTotal - t.requiredDone);
  switch (t.status) {
    case "FOR_CHECKLIST":
    case "READY":
    case "RETURNED":
      if (t.status === "RETURNED" && t.sentBack === "declined") {
        return { text: "Declined by the DP", tone: "act", line: "Fix and send again" };
      }
      if (t.status === "RETURNED" && (t.sentBack === "returned" || t.returnedForPapers)) {
        return { text: "Returned by the DP", tone: "act", line: t.returnedForPapers && missing > 0 ? `Returned: ${t.returnedForPapers}` : "Fix and send again" };
      }
      if (t.status === "RETURNED") return missing > 0 ? { text: `Needs ${pp(missing)}`, tone: "act", line: "Sent back · fix it and send it again" } : { text: "Ready to send", tone: "ok", line: "Sent back · send it again" };
      if (missing > 0) return { text: `Needs ${pp(missing)}`, tone: "act", line: t.tickedAny ? "Checking papers" : "Not started" };
      if (t.requiresDp) return { text: "Ready to send", tone: "ok", line: "Choose a processor" };
      return { text: "Ready", tone: "act", line: t.code === "EDST" ? "Enter it in EDST" : "Mark it as done" };
    case "ASSIGNED":
      return { text: "Sent", tone: "wait", line: "Waiting for the DP to accept" };
    case "IN_PROCESS":
      return { text: "Processing", tone: "wait", line: "The DP is working on it" };
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
  if (t.problem) return { pill: { text: "Problem", tone: "bad", kind: "problem" }, line: `Problem: ${t.problem.reason} · ${dd(Math.max(1, t.problem.days))}`, clock };
  if (t.hold) return { pill: { text: "On hold", tone: "hold", kind: "hold" }, line: holdRowLine(t.hold.reason, t.hold.days), clock };
  if (t.missingPapers > 0) return { pill: { text: "Missing paper", tone: "act", kind: "missing" }, line: b.line, clock };
  return { pill: { text: b.text, tone: b.tone, kind: "status" }, line: b.line, clock };
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
