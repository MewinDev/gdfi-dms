/**
 * One status wording for a transaction, used wherever the list of transactions appears (Loan File
 * "All transactions", Check documents "Transactions" and the tablet and phone strip): one chip, one
 * line of text, the papers count where it helps, the TAT chip (second small chip) and the markers
 * (Missing paper, On hold, Problem). Pure, so the server and the browser use the same words.
 */
import type { TatChipData } from "@/lib/workflow/tat";
import type { Tone } from "./plain";

export interface TxnStatusInput {
  code: string;
  requiresDp: boolean;
  /** Custom types done by the LA have no processor and are finished with "Mark as done". */
  status: string;
  requiredDone: number;
  requiredTotal: number;
  tickedAny: boolean;
  /** The processor it was sent to (and the second processor, Pasuyo), for sent work. */
  dpName?: string | null;
  secondName?: string | null;
  /** The Loan Associate who receives the package back. */
  receivingLaName?: string | null;
  edstReference?: string | null;
  /** The LTO office of sent work ("At LTO Mandaue"), when there is one. */
  ltoName?: string | null;
  /** Returned by the processor after accepting (Return to LA: papers needed): the reason. */
  returnedForPapers?: string | null;
  /** The TAT chip of the current step (lib/jobs/view.ts txnTat), null when there is no clock. */
  tat: TatChipData | null;
  /** Open items on it (the same ones as the Open items card). */
  problemDays: number | null;
  holdDays: number | null;
  missingPapers: number;
}

export type MarkerKind = "missing" | "hold" | "problem";
export interface TxnStatus {
  chip: { text: string; tone: Tone };
  line: string;
  /** "2 of 5 required papers" while papers are being checked. */
  papers: string | null;
  /** Second small chip (Due today, Day x of y), when it applies; never for finished work. */
  tat: TatChipData | null;
  markers: { kind: MarkerKind; text: string }[];
}

const PRE_SEND = ["FOR_CHECKLIST", "READY", "RETURNED"];
const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const pp = (n: number) => `${n} required paper${n === 1 ? "" : "s"}`;

export function txnStatus(t: TxnStatusInput): TxnStatus {
  const missing = Math.max(0, t.requiredTotal - t.requiredDone);
  const dp = t.dpName ? (t.secondName ? `${t.dpName} and ${t.secondName}` : t.dpName) : "the processor";
  const papers = PRE_SEND.includes(t.status) && t.requiredTotal > 0 ? `${t.requiredDone} of ${t.requiredTotal} required papers` : null;
  let chip: TxnStatus["chip"];
  let line: string;
  switch (t.status) {
    case "FOR_CHECKLIST":
    case "READY":
    case "RETURNED":
      if (t.status === "RETURNED" && t.returnedForPapers) {
        chip = { text: "Returned by DP: papers needed", tone: "act" };
        line = missing > 0 ? `${t.dpName ?? "The processor"} returned it: ${t.returnedForPapers} · tick the papers, then send again` : `${t.dpName ?? "The processor"} returned it · papers ticked, send it again`;
      } else if (t.status === "RETURNED") {
        chip = missing > 0 ? { text: `Needs ${pp(missing)}`, tone: "act" } : { text: "Ready to send", tone: "ok" };
        line = `Sent back by ${dp} · fix it and send it again`;
      } else if (missing > 0) {
        chip = { text: `Needs ${pp(missing)}`, tone: "act" };
        line = !t.tickedAny ? "Not started" : t.requiresDp ? "Checking papers · then send to a processor" : "Checking papers";
      } else if (t.requiresDp) {
        chip = { text: "Ready to send", tone: "ok" };
        line = "All required papers ticked · choose a processor";
      } else {
        chip = { text: "Ready", tone: "act" };
        line = t.code === "EDST" ? "You do this one · enter it in EDST and record the reference" : "You do this one · mark it as done";
      }
      break;
    case "ASSIGNED":
      chip = { text: "Sent", tone: "navy" };
      line = `Sent to ${dp} · waiting to accept`;
      break;
    case "IN_PROCESS":
      chip = { text: "Processing", tone: "wait" };
      line = `With ${dp} · working on it`;
      break;
    case "FORWARDED":
      chip = { text: "Coming back", tone: "act" };
      line = `${t.dpName ?? "The processor"} sent the package to ${t.receivingLaName ?? "the branch"} · check it when it arrives`;
      break;
    case "COMPLETED":
      chip = { text: "Done", tone: "ok" };
      line = t.code === "EDST" && t.edstReference ? `Done · EDST reference ${t.edstReference}` : t.requiresDp ? "Done · the package came back complete" : "Done";
      break;
    default:
      chip = { text: "Cancelled", tone: "mute" };
      line = "Cancelled";
  }
  if (t.ltoName && ["ASSIGNED", "IN_PROCESS"].includes(t.status)) line = `${line} · At ${t.ltoName}`;
  const markers: TxnStatus["markers"] = [];
  if (t.problemDays !== null) markers.push({ kind: "problem", text: `Problem ${dd(t.problemDays)}` });
  if (t.holdDays !== null) markers.push({ kind: "hold", text: `On hold ${dd(t.holdDays)}` });
  if (t.missingPapers > 0) markers.push({ kind: "missing", text: "Missing paper" });
  return { chip, line, papers, tat: t.status === "COMPLETED" ? null : clockOnly(t.tat), markers };
}

/**
 * In a list the markers already say Problem or On hold, so the TAT chip shows only the clock:
 * "Processing · Day 1 of 2", or "+1 day late" when it is overdue (the clock never pauses).
 */
function clockOnly(tat: TatChipData | null): TatChipData | null {
  if (!tat || (tat.state !== "problem" && tat.state !== "hold")) return tat;
  if (tat.lateText) return { state: "overdue", text: tat.lateText };
  const day = /Day \d+ of \d+/.exec(tat.text)?.[0];
  return day ? { state: "processing", text: `Processing · ${day}` } : null;
}
