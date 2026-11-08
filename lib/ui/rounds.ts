/**
 * Rounds of a transaction with a processor. A round is one Send to a Document Processor. When the DP
 * declines it (before accepting) or returns it to the LA (after accepting), it goes back to the
 * specific Loan Associate who sent it, with the findings; the LA fixes it and sends it again: a new
 * round. A pull back or a change of processor before accepting is not a new round. Earlier rounds
 * stay in the Journey. The TAT clock never restarts. Pure: server and browser use the same words.
 */
import { durationText } from "./holds";
import { fmtDateTime } from "@/lib/time";

/** Decline: one reason from this short list, plus remarks (5 to 500). Same list on the server. */
export const DECLINE_REASONS = ["No capacity", "Wrong job for me", "Papers not complete", "Other"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export interface AssignmentLike {
  id: string;
  status: string;
  endorsedAt: Date;
  createdAt?: Date;
  assignedById: string;
  assignedBy?: { name: string; active?: boolean } | null;
  dpUser: { name: string };
  decidedAt: Date | null;
  returnedAt: Date | null;
  closedAt: Date | null;
  declineReasons: string | null;
  returnReasons: string | null;
  returnReason?: { name: string } | null;
  /** Return to LA: papers handed over by the DP, and confirmed back by the LA. */
  papersHandedAt?: Date | null;
  papersReceivedAt?: Date | null;
  papersReceivedBy?: string | null;
}

/** Ended by the DP and sent back to the LA: Decline (before accepting) or Return to LA (after). */
export const sentBackKind = (a: Pick<AssignmentLike, "status" | "returnedAt">): "declined" | "returned" | null =>
  a.status === "DECLINED" ? "declined" : a.status === "WITHDRAWN" && a.returnedAt ? "returned" : null;

const byTime = <T extends Pick<AssignmentLike, "endorsedAt">>(xs: T[]) => [...xs].sort((a, b) => a.endorsedAt.getTime() - b.endorsedAt.getTime());

/** The round each assignment belongs to (1, 2, ...): one more after every decline or return. */
export function roundNumbers<T extends AssignmentLike>(assignments: T[]): Map<string, number> {
  const out = new Map<string, number>();
  let round = 1;
  for (const a of byTime(assignments)) {
    out.set(a.id, round);
    if (sentBackKind(a)) round += 1;
  }
  return out;
}

/** The round the transaction is in now (the next send's round when it was sent back). */
export function currentRound(assignments: AssignmentLike[]): number {
  return 1 + assignments.filter((a) => sentBackKind(a)).length;
}

/** "Round 2" for the LA and Admin once it was sent again (the round of the latest send; null in round 1). */
export const roundChip = (assignments: AssignmentLike[]) => {
  const last = byTime(assignments.filter((a) => a.status !== "PULLED_BACK")).at(-1);
  const n = last ? roundNumbers(assignments).get(last.id) ?? 1 : 1;
  return n >= 2 ? `Round ${n}` : null;
};

export interface SentBack {
  kind: "declined" | "returned";
  /** "Declined by the DP" / "Returned by the DP: fix and send again". */
  label: string;
  dpName: string;
  at: Date;
  /** The DP's findings: reason and remarks (and the papers named, for a return). */
  findings: string;
  /** The LA who sent it: the only LA it lands on. */
  senderId: string;
  senderName: string | null;
  /** False when the sender's account is inactive: it then shows for every active LA of the branch. */
  senderActive: boolean;
  round: number;
}

/**
 * Who the "sent back" item is for: the LA who sent it; when that LA is inactive, every active LA of
 * the loan's branch (with "Sender {name} is inactive").
 */
export function sentBackIsFor(sb: Pick<SentBack, "senderId" | "senderActive">, user: { id: string; isBranchLa: boolean }): boolean {
  return sb.senderId === user.id || (!sb.senderActive && user.isBranchLa);
}
export const inactiveSenderNote = (sb: Pick<SentBack, "senderActive" | "senderName">) => (sb.senderActive ? null : `Sender ${sb.senderName ?? "unknown"} is inactive`);

/** The latest round ended by the DP (when the transaction is back with the LA), else null. */
export function sentBack(status: string, assignments: AssignmentLike[]): SentBack | null {
  if (status !== "RETURNED") return null;
  const ordered = byTime(assignments.filter((a) => a.status !== "PULLED_BACK"));
  const last = ordered.at(-1);
  const kind = last ? sentBackKind(last) : null;
  if (!last || !kind) return null;
  return {
    kind,
    label: kind === "declined" ? "Declined by the DP" : "Returned by the DP: fix and send again",
    dpName: last.dpUser.name,
    at: (kind === "declined" ? last.decidedAt : last.returnedAt) ?? last.closedAt ?? last.endorsedAt,
    findings: (kind === "declined" ? last.declineReasons : last.returnReasons) ?? "",
    senderId: last.assignedById,
    senderName: last.assignedBy?.name ?? null,
    senderActive: last.assignedBy?.active ?? true,
    round: roundNumbers(assignments).get(last.id) ?? 1,
  };
}

export interface RoundEntry {
  round: number;
  /** "Sent" (round 1) or "Sent again" (later rounds). */
  sentText: string;
  sentAt: Date;
  sentBy: string | null;
  dpName: string;
  /** How the round ended so far: Declined by DP, Returned by DP, Accepted, Done, Pulled back, Waiting to accept. */
  outcome: string;
  outcomeAt: Date | null;
  findings: string | null;
  /** From the send to the outcome (or to now while it is open). */
  duration: string;
  /** "Papers handed over by {DP} · date and time", "Papers received by {LA} · date and time". */
  papers: string[];
}

const OUTCOME: Record<string, string> = {
  PENDING_ACCEPTANCE: "Waiting to accept", ACCEPTED: "Accepted, being processed", CLOSED: "Done", PULLED_BACK: "Pulled back by the LA", WITHDRAWN: "Ended",
};

/** The Journey, per round, in order: Sent, then Declined / Returned by DP (findings, DP, when, how long), Sent again, ... */
export function roundEntries(assignments: AssignmentLike[], now: Date = new Date()): RoundEntry[] {
  const rounds = roundNumbers(assignments);
  return byTime(assignments).map((a) => {
    const kind = sentBackKind(a);
    const r = rounds.get(a.id) ?? 1;
    const end = kind === "declined" ? a.decidedAt : kind === "returned" ? a.returnedAt : a.status === "ACCEPTED" ? a.decidedAt : a.closedAt;
    return {
      round: r,
      sentText: r === 1 ? "Sent" : "Sent again",
      sentAt: a.endorsedAt,
      sentBy: a.assignedBy?.name ?? null,
      dpName: a.dpUser.name,
      outcome: kind === "declined" ? "Declined by DP" : kind === "returned" ? "Returned by DP" : OUTCOME[a.status] ?? a.status,
      outcomeAt: end ?? null,
      findings: kind === "declined" ? a.declineReasons : kind === "returned" ? a.returnReasons : null,
      duration: durationText((end ?? now).getTime() - a.endorsedAt.getTime()),
      papers: [
        ...(a.papersHandedAt ? [`Papers handed over by ${a.dpUser.name} · ${fmtDateTime(a.papersHandedAt)}`] : []),
        ...(a.papersReceivedAt ? [`Papers received by ${a.papersReceivedBy ?? "the Loan Associate"} · ${fmtDateTime(a.papersReceivedAt)}`] : []),
      ],
    };
  });
}
