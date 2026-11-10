/**
 * The ordered next steps of ONE transaction: the one source the Check documents screen uses for the
 * "Do this now" card, the status word in the Transactions list and strip, the markers on the
 * checklist rows, and what the Open items card leaves out (what the card already says).
 *
 * Layout only: every rule stays where it is (the hold lock, the Send rules, the papers-back block,
 * the missing-paper request). This only reads the stored state and puts it in order.
 *
 * Order (the first step that is not done is "now"; later ones are "next"; finished ones are "done"):
 *   1. hold     On hold: Resume (the holder only); nothing below can change until then.
 *   2. problem  An open problem on the transaction: fix it (its own actions).
 *   3. confirm  The DP handed the papers back with a return: confirm what arrived.
 *   4. fix      Returned or declined by the DP: fix what they found (the reason, once).
 *               With papers named, done when those papers are ticked again. Without papers named
 *               it is "resend": fix and send again in one step (there is nothing to tick for it).
 *   5. missing  An open missing-paper request (not the DP's own return: that is step 4).
 *   6. tick     Tick the required papers ("4 of 5 required").
 *   7. send     Send to DP (or, for work without a processor, "finish": EDST or Mark as done).
 *
 * The confirm step comes before the fix step: the returned paper has to be back in the LA's hands
 * before it can be fixed and ticked, and Send stays locked until the papers are confirmed.
 * Only the steps that apply are returned. Pure: the server and the browser use the same answer.
 */

export type StepKind = "hold" | "problem" | "confirm" | "fix" | "resend" | "missing" | "tick" | "send" | "finish";
export type StepState = "now" | "next" | "done";

export interface NextStepsInput {
  /** LoanTransaction status (FOR_CHECKLIST, READY, RETURNED, ASSIGNED, IN_PROCESS, FORWARDED, COMPLETED, CANCELLED). */
  status: string;
  requiresDp: boolean;
  /** An open hold on the transaction. */
  hold: boolean;
  /** Open problems on the transaction. */
  problems: number;
  /**
   * Sent back by the DP (status RETURNED after a Decline or a Return to LA). `papers`: the checklist
   * rows the DP named in the return (null or empty: none named) and how many are still not ticked.
   */
  sentBack: { kind: "declined" | "returned"; papers: { lineIds: string[]; remaining: number } | null } | null;
  /** Papers the DP handed over with the return: how many still wait to be confirmed, and whether they were confirmed. */
  papersBack: { waiting: number; confirmed: boolean } | null;
  /** An open missing-paper request that is not the DP's own return. */
  missing: boolean;
  required: { done: number; total: number };
}

export interface NextStep {
  kind: StepKind;
  state: StepState;
  /** 1, 2, 3 ... in the card. */
  n: number;
}

/** In the LA's hands: papers to tick, a send or a resend. */
export const PRE_SEND_STATUSES = ["FOR_CHECKLIST", "READY", "RETURNED"] as const;
const preSend = (s: string) => (PRE_SEND_STATUSES as readonly string[]).includes(s);

export function getNextSteps(t: NextStepsInput): NextStep[] {
  const out: { kind: StepKind; done: boolean }[] = [];
  if (t.hold) out.push({ kind: "hold", done: false });
  if (t.problems > 0) out.push({ kind: "problem", done: false });
  const pre = preSend(t.status);
  const named = t.sentBack?.papers && t.sentBack.papers.lineIds.length > 0 ? t.sentBack.papers : null;
  if (pre) {
    if (t.papersBack) out.push({ kind: "confirm", done: t.papersBack.confirmed && t.papersBack.waiting === 0 });
    if (t.sentBack) out.push(named ? { kind: "fix", done: named.remaining === 0 } : { kind: "resend", done: false });
  }
  if (t.missing && !["COMPLETED", "CANCELLED"].includes(t.status)) out.push({ kind: "missing", done: false });
  if (pre) {
    if (t.required.total > 0) out.push({ kind: "tick", done: t.required.done >= t.required.total });
    // "Fix and send again" (nothing named) already holds the send.
    if (!out.some((s) => s.kind === "resend")) out.push({ kind: t.requiresDp ? "send" : "finish", done: false });
  }
  let nowSeen = false;
  return out.map((s, i) => {
    let state: StepState;
    if (s.done) state = "done";
    else if (!nowSeen) { state = "now"; nowSeen = true; }
    else state = "next";
    return { kind: s.kind, state, n: i + 1 };
  });
}

// ---------------------------------------------------------------------------
// From the stored records (the loan file as loaded): the same reading for the page and the tests.
// ---------------------------------------------------------------------------

interface AssignmentFacts { status: string; endorsedAt: Date; returnedAt: Date | null; decidedAt?: Date | null; papersHandedAt: Date | null; papersReceivedAt: Date | null; papersReceivedBy?: string | null }
export interface TxnFacts {
  id: string;
  status: string;
  type: { requiresDp: boolean };
  holds: { resumedAt: Date | null }[];
  problems: { resolvedAt: Date | null }[];
  checks: { id: string; checked: boolean }[];
  /** Newest first (as the loan file loads them). */
  dpAssignments: AssignmentFacts[];
}
export interface LoanFacts {
  exceptions: { id: string; transactionId: string | null; type: string; status: string; details: unknown; raisedAt: Date }[];
  documents: { transactionId: string | null; stage: string }[];
}

/** The DP's latest Return to LA, and the missing-paper request it made (the papers it named, its reason and note). */
export function lastReturnOf(t: TxnFacts, loan: LoanFacts) {
  const declinedOrReturned = t.status === "RETURNED";
  const lastReturn = declinedOrReturned ? t.dpAssignments.find((a) => a.status === "WITHDRAWN" && a.returnedAt) ?? null : null;
  // Only when the latest round ended with this return (a later decline is the latest instead).
  const latest = t.dpAssignments.find((a) => a.status !== "PULLED_BACK");
  const current = lastReturn && latest === lastReturn ? lastReturn : null;
  const request = current
    ? loan.exceptions.find((e) => e.transactionId === t.id && e.type === "LEGAL_DOCS_COMPLETION" && (e.details as { askedBy?: string } | null)?.askedBy === "DP" && e.raisedAt >= current.endorsedAt) ?? null
    : null;
  const d = (request?.details ?? null) as { checkIds?: unknown; reason?: string; note?: string } | null;
  const ids = Array.isArray(d?.checkIds) ? d!.checkIds.map(String) : [];
  return { lastReturn: current, request, reason: d?.reason ?? null, note: d?.note ?? "", namedIds: t.checks.filter((c) => ids.includes(c.id)).map((c) => c.id) };
}

/**
 * The step input of a transaction from its stored records. `sentBackKind` is lib/ui/rounds sentBack()'s
 * kind (null when it was not sent back); `required` is the checklist count (lib/workflow/checklist).
 */
export function nextStepsInputOf(t: TxnFacts, loan: LoanFacts, sentBackKind: "declined" | "returned" | null, required: { done: number; total: number }) {
  const r = lastReturnOf(t, loan);
  const waiting = t.status === "RETURNED" ? loan.documents.filter((d) => d.transactionId === t.id && d.stage === "IN_TRANSIT").length : 0;
  const openRequest = loan.exceptions.find((e) => e.transactionId === t.id && e.type === "LEGAL_DOCS_COMPLETION" && e.status === "OPEN") ?? null;
  const named = r.namedIds;
  const input: NextStepsInput = {
    status: t.status,
    requiresDp: t.type.requiresDp,
    hold: t.holds.some((h) => !h.resumedAt),
    problems: t.problems.filter((p) => !p.resolvedAt).length,
    sentBack: sentBackKind ? { kind: sentBackKind, papers: named.length ? { lineIds: named, remaining: t.checks.filter((c) => named.includes(c.id) && !c.checked).length } : null } : null,
    papersBack: waiting > 0 || r.lastReturn?.papersHandedAt ? { waiting, confirmed: !!r.lastReturn?.papersReceivedAt } : null,
    // The DP's own request is the "fix" step, not a second "missing" step.
    missing: !!openRequest && openRequest.id !== r.request?.id,
    required,
  };
  return { input, ...r, otherRequestId: input.missing ? openRequest!.id : null };
}

/** The step the person can do now (null: nothing to do on this transaction now). */
export const nowStep = (steps: NextStep[]) => steps.find((s) => s.state === "now") ?? null;

/**
 * What blocks the transaction, in the same order as the steps: the status word of a transaction row
 * ("On hold", "Problem", "Returned", "Missing paper") comes from here, so the row and the card never
 * disagree. Null: nothing blocks it; the row shows its plain status.
 */
export type Blocker = "hold" | "problem" | "returned" | "missing";
export const BLOCKER_ORDER: Blocker[] = ["hold", "problem", "returned", "missing"];
export function blockerOf(t: { hold: boolean; problem: boolean; returned: boolean; missing: boolean }): Blocker | null {
  return BLOCKER_ORDER.find((b) => t[b]) ?? null;
}

/** The blocker a step stands for (the steps that are not a blocker return null). */
export function blockerOfStep(kind: StepKind): Blocker | null {
  switch (kind) {
    case "hold": return "hold";
    case "problem": return "problem";
    case "confirm": case "fix": case "resend": return "returned";
    case "missing": return "missing";
    default: return null;
  }
}

/**
 * The Open items kinds the "Do this now" card already says for this transaction: the Open items card
 * leaves those rows out for it (rows on other transactions and loan-level rows stay).
 */
export function coveredOpenKinds(steps: NextStep[]): Set<"hold" | "problem" | "missing" | "returned"> {
  const out = new Set<"hold" | "problem" | "missing" | "returned">();
  for (const s of steps) {
    if (s.kind === "hold") out.add("hold");
    if (s.kind === "problem") out.add("problem");
    if (s.kind === "missing") out.add("missing");
    // The DP's return: its own missing-paper request and the "Sent back to you" row.
    if (s.kind === "fix" || s.kind === "resend" || s.kind === "confirm") { out.add("returned"); out.add("missing"); }
  }
  return out;
}
