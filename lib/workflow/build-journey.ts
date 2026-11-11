/**
 * The one Journey of a loan, built from the stored records (pure: no database, no clock of its own).
 * Every fact is stored once (transactions, DP assignments, attempts, problems, holds, advances,
 * document movements, audit rows); this function only arranges them:
 *   - the 10 phases with their steps (names and order from the Journey template, lib/workflow/journey.ts),
 *     where the per-transaction steps (check papers, send, accept, process, forward, receive) get one
 *     row per transaction;
 *   - for each step: state, owner, start and end, duration, TAT target and actual, a list of state
 *     segments (waiting, processing, on hold, problem) and the attached holds, problems and attempts,
 *     with the plain-language events as its details;
 *   - per transaction: who holds the ball now (currentOwner) and the open segment ("Where it is now");
 *   - per paper: the custody trail and the time each holder held it.
 * The TAT clock never pauses: holds and problems only colour the segments.
 */
import { businessDate, businessDaysBetween, isBusinessDay } from "@/lib/time";
import { computeJourney, PHASES, type JourneyContext } from "./journey";
import { holdDays, problemDays, stepClock, targetOf, type TatChipData, type TatMap } from "./tat";
import { txnTat } from "@/lib/jobs/view";

// ---------------------------------------------------------------------------
// Input (plain records; the server fills it, see lib/services/journey.ts)
// ---------------------------------------------------------------------------

export interface PersonRef { id: string | null; name: string }

export interface HoldRec {
  id: string; reason: string; note: string; raisedAt: Date; raisedBy: string;
  resumedAt: Date | null; resumedBy: string | null; resumeNote: string; simulated: boolean;
  /** The job stage that was current when it was raised. */
  stageId?: string | null;
  /** Transfers of the hold to another owner, in order. */
  transfers?: { fromLabel: string; toLabel: string; byLabel: string; note: string; at: Date }[];
}
export interface ProblemRec {
  id: string; reason: string; note: string; raisedAt: Date; raisedBy: string;
  resolvedAt: Date | null; resolvedBy: string | null; resolutionNote: string; outsideControl: boolean; simulated: boolean;
  stageId?: string | null;
}
export interface AttemptRec { id: string; date: string; result: "DONE" | "NOT_PROCESSED"; reason: string | null; note: string; by: string; createdAt: Date; simulated: boolean; stageId?: string | null }
/** One processing stage of a DP job (Settings > Processing stages). Evidence as a summary, never file contents. */
export interface StageRec { id: string; name: string; status: "LATER" | "STARTED" | "DONE"; startedAt: Date | null; finishedAt: Date | null; by: string | null; summary: string; migrated: boolean }
export interface AssignmentRec {
  id: string; status: string; endorsedAt: Date; decidedAt: Date | null; returnedAt: Date | null; processedAt: Date | null;
  forwardedAt: Date | null; closedAt: Date | null; dp: PersonRef; second: PersonRef | null; receivingLa: PersonRef | null; assignedBy: PersonRef;
  stages?: StageRec[];
  /** Decline or Return to LA: the DP's findings as recorded (reason and remarks). */
  findings?: string | null;
  /** Return to LA: papers handed over by the DP, and confirmed back by the LA. */
  papersHandedAt?: Date | null;
  papersReceivedAt?: Date | null;
  papersReceivedBy?: string | null;
}
export interface AdvanceRec {
  id: string; number: string; status: string; requestedAt: Date; approvedAt: Date | null; releasedAt: Date | null;
  /** Peso amounts in centavos. Null when the viewer may not see cash amounts (never sent to them). */
  requestedCents: number | null; releasedCents: number | null;
  /** The lines in words: kind (Other with its description) and the amount source. */
  linesText?: string;
}
export interface TxnRec {
  id: string; code: string; name: string; requiresDp: boolean; ownerRole: string; status: string; statusSince: Date; createdAt: Date;
  completedAt: Date | null; cancelledAt: Date | null;
  /** When the required papers were all ticked (last "complete" save before the first send). */
  readyAt: Date | null;
  fundsNeeded: "UNANSWERED" | "YES" | "NO";
  /** The LTO office where the processor takes it (latest assignment), if any. */
  ltoOffice?: string | null;
  /** Funds status in words (Not needed, Needed, Requested, Funded, Settled, Denied). */
  fundsStatus: string;
  assignments: AssignmentRec[]; attempts: AttemptRec[]; problems: ProblemRec[]; holds: HoldRec[]; advances: AdvanceRec[];
}
export interface MovementRec {
  id: string; action: string; at: Date; from: string | null; to: string | null; location: string | null; by: string | null;
  acknowledgedAt: Date | null; remarks: string | null; simulated: boolean;
}
export interface DocRec {
  id: string; documentId: string | null; label: string; originality: string; txnId: string | null; stage: string;
  custodianLabel: string; location: string; since: Date; movements: MovementRec[];
}
export interface EventRec {
  id: string; at: Date; action: string; by: string; text: string; simulated: boolean; journeyStep: string | null;
  /** The transaction it is about (resolved by the server from the entity), if any. */
  txnId: string | null;
  /** Phase the loan was in at that time (for events that belong to no step). */
  phase: number;
}
export interface JourneyInput {
  loan: {
    pn: string; stage: string; stageSince: Date; classification: "FINANCING" | "REFINANCING"; mortgageResult: "MORTGAGE" | "NOT_MORTGAGE" | "NOT_EVALUATED";
    overridden: boolean; openedAt: Date; openedBy: PersonRef; branchName: string; openSourceChange: boolean;
    transmittalDispatched: boolean; transmittalReceived: boolean;
  };
  transactions: TxnRec[];
  documents: DocRec[];
  /** Advances for the whole loan (funds steps 3.4, 3.5, 4.5). */
  advances: AdvanceRec[];
  events: EventRec[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Waiting, Now (processing), On hold, Problem, Done, Later, Not applicable. */
export type StepState = "waiting" | "now" | "hold" | "problem" | "done" | "later" | "na";
export type SegState = "waiting" | "processing" | "hold" | "problem";

export const STEP_STATE_LABEL: Record<StepState, string> = {
  waiting: "Waiting", now: "Now", hold: "On hold", problem: "Problem", done: "Done", later: "Later", na: "Not applicable",
};
export const SEG_LABEL: Record<SegState, string> = { waiting: "Waiting", processing: "Processing", hold: "On hold", problem: "Problem" };

export interface Segment { state: SegState; start: Date; /** null: still open (counts to now) */ end: Date | null }

export interface JHold extends HoldRec { days: number }
export interface JProblem extends ProblemRec { days: number }
export interface JEvent { at: Date; text: string; by: string; simulated: boolean }

export interface JStep {
  key: string;
  stepId: string;
  title: string;
  txnId: string | null;
  txnCode: string | null;
  txnName: string | null;
  ownerRoles: string[];
  ownerName: string | null;
  ownerIds: string[];
  mode: string;
  state: StepState;
  start: Date | null;
  end: Date | null;
  /** Milliseconds from start to end (or to now while open). */
  durationMs: number | null;
  tat: { target: number | null; targetText: string; actualText: string | null; late: number; deadline: string | null };
  segments: Segment[];
  /** Milliseconds in each state; they add up to durationMs. */
  stateMs: Record<SegState, number>;
  holds: JHold[];
  problems: JProblem[];
  attempts: AttemptRec[];
  /** Processing step only: the job's stages, each with the holds, problems and attempts recorded in it. */
  stages?: JStageRow[];
  /** Plain-language events, newest first. */
  events: JEvent[];
  note?: string;
  simulated: boolean;
  /** Open item (current step, or an open hold or problem): highlighted, with a live "since" count. */
  open: boolean;
  openSince: Date | null;
}

export interface JStageRow extends StageRec { state: "done" | "now" | "later"; durationMs: number | null; holds: HoldRec[]; problems: ProblemRec[]; attempts: AttemptRec[] }

export interface JPhase { n: number; title: string; state: "done" | "current" | "upcoming"; steps: JStep[]; events: JEvent[] }

export interface Owner {
  role: string;
  name: string;
  since: Date;
  /** "On hold: Waiting on borrower", "Waiting for Finance approval". */
  reason?: string;
  /** "Waiting on DP Joy Navarro", "With LA Ana Cruz", "Waiting for Finance approval". */
  text: string;
}

export interface JTxn {
  id: string; code: string; name: string; status: string;
  state: StepState;
  owner: Owner | null;
  /** TAT chip of the current step (the same chip as everywhere else). */
  tat: TatChipData | null;
  segments: Segment[];
  start: Date;
  end: Date | null;
  /** Deadline (YYYY-MM-DD) of the open step, or of the processing step once done. */
  deadline: string | null;
  done: boolean;
  /** The open segment: what "Where it is now" shows (null when finished). */
  openSegment: Segment | null;
}

export interface CustodyStep {
  id: string; at: Date; action: string; label: string; from: string | null; to: string | null; place: string | null;
  by: string | null; acknowledgedBy: string | null; acknowledgedAt: Date | null; remarks: string | null; simulated: boolean;
}
export interface HolderPeriod { holder: string; place: string | null; from: Date; to: Date | null; ms: number }
export interface JDoc {
  id: string; documentId: string | null; label: string; originality: string; txnCode: string | null; txnName: string | null;
  holder: string; place: string; since: Date; trail: CustodyStep[]; periods: HolderPeriod[];
}

export interface Journey { phases: JPhase[]; txns: JTxn[]; docs: JDoc[]; now: Date }

// ---------------------------------------------------------------------------
// Per-transaction steps (one row per transaction)
// ---------------------------------------------------------------------------

type Kind = "CHECK" | "LA_DO" | "SEND" | "ACCEPT" | "PROCESS" | "FORWARD" | "RECEIVE";

const PROCESS_STEP: Record<string, { id: string; tatKey: string }> = {
  NOTARY: { id: "4.2", tatKey: "P4_NOTARY" }, PPSR: { id: "4.3", tatKey: "P4_PPSR" }, MORTGAGE: { id: "4.4", tatKey: "P4_MORTGAGE" },
};

function kindDef(kind: Kind, t: TxnRec): { stepId: string; title: string; roles: string[]; mode: string; tatKey: string | null } {
  switch (kind) {
    case "CHECK": return { stepId: "3.1", title: "Check the papers", roles: ["LA"], mode: "Manual", tatKey: "P3_CHECKLIST" };
    case "LA_DO": return t.code === "EDST"
      ? { stepId: "3.3", title: "Enter in EDST and record the reference", roles: ["LA"], mode: "Manual", tatKey: "P3_EDST" }
      : { stepId: "3.3", title: `Do the ${t.name} work`, roles: [t.ownerRole || "LA"], mode: "Manual", tatKey: null };
    case "SEND": return { stepId: "3.6", title: "Send to a processor", roles: ["LA"], mode: "Manual", tatKey: "P3_ASSIGN" };
    case "ACCEPT": return { stepId: "4.1", title: "Processor accepts", roles: ["DP"], mode: "Manual", tatKey: "P4_ACCEPT" };
    case "PROCESS": {
      const p = PROCESS_STEP[t.code];
      const title = t.code === "NOTARY" ? "Notary: send to notary, record details" : t.code === "PPSR" ? "Entry of PPSR: registration and certificate" : t.code === "MORTGAGE" ? "Mortgage: LTO drop and pickup of the annotated OR/CR" : `${t.name}: processing`;
      return { stepId: p?.id ?? "4.4", title, roles: ["DP"], mode: "Manual", tatKey: p?.tatKey ?? null };
    }
    case "FORWARD": return { stepId: "4.6", title: "Forward the package to the branch", roles: ["DP"], mode: "Manual", tatKey: "P4_FORWARD" };
    case "RECEIVE": return { stepId: "5.1", title: "Check the returned package", roles: ["LA"], mode: "Manual", tatKey: "P5_ACCEPT" };
  }
}

/** Template steps that become one row per transaction. */
const PER_TXN_IDS = new Set(["3.1", "3.3", "3.6", "4.1", "4.2", "4.3", "4.4", "4.6", "5.1"]);

interface Interval { kind: Kind; start: Date; end: Date | null; base: SegState; who: PersonRef[] }

/** The transaction's life as intervals, from the stored dates (assignments in send order). */
export function txnIntervals(t: TxnRec): Interval[] {
  const out: Interval[] = [];
  if (t.status === "CANCELLED") return out;
  const sends = [...t.assignments].sort((a, b) => a.endorsedAt.getTime() - b.endorsedAt.getTime());
  const firstSend = sends[0]?.endorsedAt ?? null;
  const ready = t.readyAt && (!firstSend || t.readyAt <= firstSend) ? t.readyAt : firstSend ?? (t.status === "FOR_CHECKLIST" ? null : t.completedAt ?? t.statusSince);
  out.push({ kind: "CHECK", start: t.createdAt, end: ready, base: "processing", who: [] });
  if (!ready) return out;
  if (!t.requiresDp) {
    out.push({ kind: "LA_DO", start: ready, end: t.completedAt, base: "processing", who: [] });
    return out;
  }
  let cursor: Date | null = ready;
  for (const a of sends) {
    const dpWho = [a.dp, ...(a.second ? [a.second] : [])];
    if (cursor) out.push({ kind: "SEND", start: cursor, end: a.endorsedAt, base: "processing", who: [a.assignedBy] });
    cursor = null;
    const accepted = a.decidedAt && a.status !== "DECLINED";
    out.push({ kind: "ACCEPT", start: a.endorsedAt, end: a.decidedAt ?? (a.status === "PENDING_ACCEPTANCE" ? null : a.closedAt ?? a.returnedAt), base: "waiting", who: dpWho });
    if (a.status === "DECLINED") { cursor = a.decidedAt ?? a.closedAt; continue; }
    if (a.status === "PULLED_BACK") { cursor = a.closedAt ?? a.endorsedAt; continue; }
    if (!accepted) continue;
    if (a.status === "WITHDRAWN") {
      out.push({ kind: "PROCESS", start: a.decidedAt!, end: a.returnedAt ?? a.closedAt, base: "processing", who: dpWho });
      cursor = a.returnedAt ?? a.closedAt;
      continue;
    }
    out.push({ kind: "PROCESS", start: a.decidedAt!, end: a.processedAt, base: "processing", who: dpWho });
    if (a.processedAt) out.push({ kind: "FORWARD", start: a.processedAt, end: a.forwardedAt, base: "processing", who: dpWho });
    if (a.forwardedAt) out.push({ kind: "RECEIVE", start: a.forwardedAt, end: a.closedAt ?? t.completedAt, base: "waiting", who: a.receivingLa ? [a.receivingLa] : [] });
  }
  // Sent back (declined or returned) and not sent again yet: the LA has it.
  if (cursor && ["READY", "RETURNED", "FOR_CHECKLIST"].includes(t.status)) out.push({ kind: "SEND", start: cursor, end: null, base: "processing", who: [] });
  if (!sends.length) out.push({ kind: "SEND", start: ready, end: null, base: "processing", who: [] });
  return out;
}

const KINDS_DP: Kind[] = ["CHECK", "SEND", "ACCEPT", "PROCESS", "FORWARD", "RECEIVE"];
const KINDS_LA: Kind[] = ["CHECK", "LA_DO"];

const PRIORITY: Record<SegState, number> = { problem: 4, hold: 3, processing: 2, waiting: 1 };

/**
 * Splits [start, end) into state segments: a problem wins over a hold, a hold over the base state.
 * Adjacent pieces with the same state are merged. An open interval (end null) keeps its last piece open.
 */
export function splitSegments(start: Date, end: Date | null, base: SegState, holds: { raisedAt: Date; resumedAt: Date | null }[], problems: { raisedAt: Date; resolvedAt: Date | null }[], now: Date): Segment[] {
  const stop = (end ?? now).getTime();
  const s0 = start.getTime();
  if (stop < s0) return [];
  const marks = new Set<number>([s0, stop]);
  const ranges: { kind: "hold" | "problem"; a: number; b: number }[] = [
    ...holds.map((h) => ({ kind: "hold" as const, a: h.raisedAt.getTime(), b: (h.resumedAt ?? new Date(8.64e15)).getTime() })),
    ...problems.map((p) => ({ kind: "problem" as const, a: p.raisedAt.getTime(), b: (p.resolvedAt ?? new Date(8.64e15)).getTime() })),
  ];
  for (const r of ranges) for (const x of [r.a, r.b]) if (x > s0 && x < stop) marks.add(x);
  const pts = [...marks].sort((a, b) => a - b);
  const stateAt = (x: number) => {
    let state: SegState = base;
    for (const r of ranges) if (r.a <= x && x < r.b && PRIORITY[r.kind] > PRIORITY[state]) state = r.kind;
    return state;
  };
  // Zero-length step (started and finished at once): one empty segment.
  if (pts.length === 1) return [{ state: stateAt(s0), start: new Date(s0), end: end === null ? null : new Date(s0) }];
  const out: Segment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const state = stateAt(a + (b - a) / 2);
    const last = out[out.length - 1];
    if (last && last.state === state) last.end = new Date(b);
    else out.push({ state, start: new Date(a), end: new Date(b) });
  }
  if (end === null) out[out.length - 1].end = null;
  return out;
}

/** Joins neighbouring segments in the same state (where one step ends and the next begins). */
export function mergeSegments(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.state === s.state && last.end && last.end.getTime() === s.start.getTime()) last.end = s.end;
    else out.push({ ...s });
  }
  return out;
}

const msOf = (s: Segment, now: Date) => Math.max(0, (s.end ?? now).getTime() - s.start.getTime());

export function stateTotals(segs: Segment[], now: Date): Record<SegState, number> {
  const t: Record<SegState, number> = { waiting: 0, processing: 0, hold: 0, problem: 0 };
  for (const s of segs) t[s.state] += msOf(s, now);
  return t;
}

/** Which interval an instant belongs to (the one it falls in; else the last one that started before it; else the first). */
function intervalAt<T extends { start: Date; end: Date | null }>(ivs: T[], at: Date): T | null {
  const inside = ivs.find((i) => i.start <= at && (i.end === null || at < i.end));
  if (inside) return inside;
  const before = ivs.filter((i) => i.start <= at).at(-1);
  return before ?? ivs[0] ?? null;
}

const EVENT_KIND: Record<string, Kind> = {
  checklist_saved: "CHECK", document_ids_generated: "CHECK", send_refused_missing_papers: "CHECK",
  edst_completed: "LA_DO",
  assigned_to_dp: "SEND", dp_notified: "SEND",
  dp_assignment_accepted: "ACCEPT", dp_assignment_declined: "ACCEPT", sent_job_updated: "ACCEPT", sent_job_pulled_back: "ACCEPT",
  attempt_logged: "PROCESS", dp_processing_recorded: "PROCESS", dp_assignment_returned: "PROCESS", funds_flag_changed: "PROCESS", job_passed_pasuyo: "PROCESS", job_returned_to_la: "PROCESS",
  package_forwarded: "FORWARD",
  package_accepted: "RECEIVE", package_incomplete: "RECEIVE",
};

// ---------------------------------------------------------------------------
// Who holds the ball
// ---------------------------------------------------------------------------

/**
 * A role word and a person's name, said once: "LA Ana Cruz", but "LA 1" (not "LA LA 1") when the
 * name already starts with the role word.
 */
export function withRole(role: string, name: string): string {
  const n = name.trim();
  return new RegExp(`^${role}\\b`, "i").test(n) ? n : `${role} ${n}`;
}

/** Stored text that already joined a role word to such a name ("With DP DP 1"): said once on screen. */
export const undoubleRole = (text: string) => text.replace(/\b(LA|DP)\s+\1\b/g, "$1");

export interface OwnerContext {
  loan: { stage: string; stageSince: Date; openedBy: PersonRef };
}

/**
 * The holder of the ball for a transaction, with since-when and an optional reason:
 * not sent: the LA; sent, not accepted: the processor (and second processor); accepted: the
 * processor, or Finance while funds wait for approval or release; on hold: the holder plus the
 * hold reason; forwarded: the named receiving LA; done: by the loan's stage (transmittal: the branch
 * LA; vault and later: their owner roles).
 */
export function currentOwner(t: TxnRec, ctx: OwnerContext): Owner | null {
  const base = baseOwner(t, ctx);
  if (!base) return null;
  const h = t.holds.find((x) => !x.resumedAt);
  if (h && !["COMPLETED", "CANCELLED"].includes(t.status)) {
    const reason = `On hold: ${h.reason.charAt(0).toLowerCase()}${h.reason.slice(1)}`;
    return { ...base, since: h.raisedAt, reason, text: `${base.text} · ${reason}` };
  }
  return base;
}

function baseOwner(t: TxnRec, ctx: OwnerContext): Owner | null {
  const a = [...t.assignments].sort((x, y) => y.endorsedAt.getTime() - x.endorsedAt.getTime()).find((x) => !["DECLINED", "WITHDRAWN", "PULLED_BACK"].includes(x.status));
  const last = [...t.assignments].sort((x, y) => y.endorsedAt.getTime() - x.endorsedAt.getTime())[0];
  const dpNames = (x: AssignmentRec) => (x.second ? `${x.dp.name} and ${x.second.name}` : x.dp.name);
  switch (t.status) {
    case "FOR_CHECKLIST":
    case "READY":
    case "RETURNED": {
      const la = (t.status === "RETURNED" && last?.assignedBy) || ctx.loan.openedBy;
      return { role: "LA", name: la.name, since: t.statusSince, text: `With ${withRole("LA", la.name)}` };
    }
    case "ASSIGNED":
      if (!a) return null;
      return { role: "DP", name: dpNames(a), since: a.endorsedAt, text: `Waiting on ${withRole("DP", dpNames(a))}` };
    case "IN_PROCESS": {
      if (!a) return null;
      if (t.fundsNeeded === "YES") {
        const live = t.advances.filter((x) => !["DENIED", "CANCELLED"].includes(x.status));
        const released = live.some((x) => x.releasedAt);
        const waiting = live.find((x) => x.status === "REQUESTED" || x.status === "APPROVED");
        if (!released && waiting) {
          const text = waiting.status === "REQUESTED" ? "Waiting for Finance approval" : "Waiting for Finance to release the funds";
          return { role: "FIN", name: "Finance", since: waiting.status === "REQUESTED" ? waiting.requestedAt : waiting.approvedAt ?? waiting.requestedAt, reason: text, text };
        }
      }
      return { role: "DP", name: dpNames(a), since: a.decidedAt ?? t.statusSince, text: `With ${withRole("DP", dpNames(a))}` };
    }
    case "FORWARDED": {
      const la = a?.receivingLa;
      return { role: "LA", name: la?.name ?? "the branch", since: a?.forwardedAt ?? t.statusSince, text: la ? `On the way to ${withRole("LA", la.name)}` : "On the way to the branch" };
    }
    case "COMPLETED": {
      const s = ctx.loan.stage;
      if (s === "For Vault Transmittal") return { role: "LA", name: ctx.loan.openedBy.name, since: ctx.loan.stageSince, text: `Branch ${withRole("LA", ctx.loan.openedBy.name)}: send to the vault` };
      if (s === "In transit to Vault") return { role: "VAULT", name: "Vault", since: ctx.loan.stageSince, text: "On the way to the vault" };
      if (s === "In Safekeeping") return { role: "VAULT", name: "Vault Custodian", since: ctx.loan.stageSince, text: "Safe in the vault (Vault Custodian)" };
      if (["Closed", "Archived", "Disposed"].includes(s)) return { role: "APPR", name: "Records", since: ctx.loan.stageSince, text: s };
      return { role: "DONE", name: "", since: t.completedAt ?? t.statusSince, text: "Done" };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Custody (document level)
// ---------------------------------------------------------------------------

export const MOVE_LABEL: Record<string, string> = {
  RECEIVED_AT_BRANCH: "Received at the branch",
  MARKED_NOT_PRESENT: "Marked not in hand",
  DISPATCHED_TO_DP: "Sent to the processor (in transit)",
  ACKNOWLEDGED_BY_DP: "Received by the processor",
  NOT_RECEIVED_BY_DP: "Not received by the processor (missing at Accept)",
  RETURNED_TO_DP: "Returned to DP: received back and complete",
  VERIFIED_BY_DP: "Verified by DP",
  BACK_TO_DP_INCOMPLETE: "Back to the processor: package incomplete",
  AT_LTO: "At the LTO",
  RETURNED_FROM_LTO: "Back from the LTO",
  PASSED_TO_SECOND_PROCESSOR: "Passed to a second processor (Pasuyo)",
  RETURNED_BY_DP: "Returned to the branch by the processor",
  RETURNED_UNACKNOWLEDGED: "Sent back by the processor (not accepted)",
  FORWARDED_TO_BRANCH: "Forwarded to the branch (in transit)",
  ACCEPTED_AT_BRANCH: "Received by the LA",
  TRANSMITTED_TO_VAULT: "Sent to the vault (in transit)",
  VAULTED: "Vaulted",
};

/** The trail of one paper and the time each holder held it. A movement acknowledged by the receiver changes the holder. */
export function custodyOf(d: DocRec, now: Date): { trail: CustodyStep[]; periods: HolderPeriod[] } {
  const moves = [...d.movements].sort((a, b) => a.at.getTime() - b.at.getTime());
  const trail: CustodyStep[] = moves.map((m) => ({
    id: m.id, at: m.at, action: m.action, label: MOVE_LABEL[m.action] ?? m.action.replace(/_/g, " ").toLowerCase(),
    from: m.from, to: m.to, place: m.location ?? m.to, by: m.by,
    acknowledgedBy: m.acknowledgedAt ? m.by : null, acknowledgedAt: m.acknowledgedAt, remarks: m.remarks, simulated: m.simulated,
  }));
  const periods: HolderPeriod[] = [];
  let cur: HolderPeriod | null = null;
  for (const m of moves) {
    if (m.action === "MARKED_NOT_PRESENT") {
      if (cur) { cur.to = m.at; periods.push(cur); cur = null; }
      continue;
    }
    // Not a hand-over (in transit, at the LTO): the same holder, maybe in a new place.
    if (!m.acknowledgedAt || !m.to) { if (cur && m.location) cur.place = m.location; continue; }
    if (cur) { cur.to = m.at; periods.push(cur); }
    cur = { holder: m.to, place: m.location, from: m.at, to: null, ms: 0 };
  }
  if (cur) periods.push(cur);
  for (const p of periods) p.ms = Math.max(0, (p.to ?? now).getTime() - p.from.getTime());
  return { trail: trail.reverse(), periods };
}

// ---------------------------------------------------------------------------
// The Journey
// ---------------------------------------------------------------------------

const ROLE_OF_KIND: Record<Kind, "LA" | "DP"> = { CHECK: "LA", LA_DO: "LA", SEND: "LA", ACCEPT: "DP", PROCESS: "DP", FORWARD: "DP", RECEIVE: "LA" };

const tatTextOf = (tats: TatMap, key: string | null, fallback?: string) => {
  if (!key) return fallback ?? "-";
  const t = tats.get(key);
  if (!t) return fallback ?? "-";
  if (t.note) return t.note;
  return t.businessDays === 0 ? "Same day" : `${t.businessDays} business day${t.businessDays === 1 ? "" : "s"}`;
};

const dd = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

function emptyStep(partial: Partial<JStep> & Pick<JStep, "key" | "stepId" | "title" | "ownerRoles" | "mode" | "state">): JStep {
  return {
    txnId: null, txnCode: null, txnName: null, ownerName: null, ownerIds: [], start: null, end: null, durationMs: null,
    tat: { target: null, targetText: "-", actualText: null, late: 0, deadline: null },
    segments: [], stateMs: { waiting: 0, processing: 0, hold: 0, problem: 0 },
    holds: [], problems: [], attempts: [], events: [], simulated: false, open: false, openSince: null,
    ...partial,
  };
}

export function buildJourney(input: JourneyInput, tats: TatMap, holidays: ReadonlySet<string>, now: Date = new Date()): Journey {
  const live = input.transactions.filter((t) => t.status !== "CANCELLED");

  // Loan-level steps: the template's own evaluation (done / current / pending / not applicable).
  const ctx: JourneyContext = {
    stage: input.loan.stage, classification: input.loan.classification, mortgageResult: input.loan.mortgageResult,
    overridden: input.loan.overridden, openedAt: input.loan.openedAt, openedBy: input.loan.openedBy.name, openSourceChange: input.loan.openSourceChange,
    transactions: input.transactions.map((t) => ({ code: t.code, requiresDp: t.requiresDp, status: t.status, processed: t.assignments.some((a) => a.status !== "DECLINED" && !!a.processedAt) })),
    cashAdvances: input.advances.map((a) => ({ status: a.status })),
    documents: input.documents.map((d) => ({ hasId: !!d.documentId, stage: d.stage })),
    transmittalDispatched: input.loan.transmittalDispatched, transmittalReceived: input.loan.transmittalReceived,
    audit: new Map(input.events.filter((e) => e.journeyStep).sort((a, b) => a.at.getTime() - b.at.getTime()).map((e) => [e.journeyStep!, { at: e.at, actor: e.by, simulated: e.simulated }])),
  };
  const template = computeJourney(ctx, tats);

  // Per-transaction steps.
  const txnSteps: JStep[] = [];
  const txns: JTxn[] = [];
  const eventsUsed = new Set<string>();
  for (const t of input.transactions) {
    const ivs = txnIntervals(t);
    const kinds = t.requiresDp ? KINDS_DP : KINDS_LA;
    const allSegs: Segment[] = [];
    // Holds, problems and attempts belong to the step they were raised in.
    const holdsBy = new Map<Interval, HoldRec[]>();
    const problemsBy = new Map<Interval, ProblemRec[]>();
    for (const h of t.holds) { const iv = intervalAt(ivs, h.raisedAt); if (iv) holdsBy.set(iv, [...(holdsBy.get(iv) ?? []), h]); }
    for (const p of t.problems) { const iv = intervalAt(ivs, p.raisedAt); if (iv) problemsBy.set(iv, [...(problemsBy.get(iv) ?? []), p]); }
    const evs = input.events.filter((e) => e.txnId === t.id);
    const evBy = new Map<Kind, EventRec[]>();
    for (const e of evs) {
      const k = (e.action === "transaction_completed" && t.requiresDp ? "RECEIVE" : e.action === "transaction_completed" ? "LA_DO" : EVENT_KIND[e.action]) ?? intervalAt(ivs, e.at)?.kind;
      if (!k) continue;
      evBy.set(k, [...(evBy.get(k) ?? []), e]);
      eventsUsed.add(e.id);
    }

    for (const kind of kinds) {
      const mine = ivs.filter((i) => i.kind === kind);
      const def = kindDef(kind, t);
      const key = `${def.stepId}:${t.code}`;
      const target = targetOf(tats, def.tatKey);
      if (t.status === "CANCELLED") {
        txnSteps.push(emptyStep({ key, stepId: def.stepId, title: def.title, ownerRoles: def.roles, mode: def.mode, state: "na", txnId: t.id, txnCode: t.code, txnName: t.name, note: "Cancelled" }));
        continue;
      }
      if (!mine.length) {
        txnSteps.push(emptyStep({
          key, stepId: def.stepId, title: def.title, ownerRoles: def.roles, mode: def.mode, state: "later", txnId: t.id, txnCode: t.code, txnName: t.name,
          tat: { target, targetText: tatTextOf(tats, def.tatKey, target === null ? "-" : undefined), actualText: null, late: 0, deadline: null },
        }));
        continue;
      }
      const segs = mine.flatMap((iv) => splitSegments(iv.start, iv.end, iv.base, t.holds, t.problems, now));
      allSegs.push(...segs);
      const start = mine[0].start;
      const openIv = mine.find((i) => i.end === null) ?? null;
      const end = openIv ? null : mine.at(-1)!.end;
      const holds = mine.flatMap((iv) => holdsBy.get(iv) ?? []).map((h) => ({ ...h, days: Math.max(1, holdDays([h], holidays, now)) }));
      const problems = mine.flatMap((iv) => problemsBy.get(iv) ?? []).map((p) => ({ ...p, days: Math.max(1, problemDays([p], holidays, now)) }));
      const openHold = t.holds.find((h) => !h.resumedAt);
      const openProblem = t.problems.find((p) => !p.resolvedAt);
      const lastSeg = segs.at(-1);
      const state: StepState = !openIv ? "done"
        : openProblem ? "problem" : openHold ? "hold" : lastSeg?.state === "waiting" ? "waiting" : "now";
      // The clock for this step (from its last start; it never pauses).
      const clockStart = openIv?.start ?? mine.at(-1)!.start;
      const clock = stepClock({ targetDays: target, start: clockStart, end }, holidays, now);
      const actualText = clock.done
        ? (target === null ? `Done in ${dd(Math.max(clock.used, 0))}` : clock.late > 0 ? `Done ${dd(clock.late)} late` : "Done on time")
        : target === null ? `Day ${Math.max(1, clock.used)}` : clock.late > 0 ? `${dd(clock.late)} late · Day ${Math.max(1, clock.used)} of ${target}` : `Day ${Math.min(Math.max(1, clock.used), Math.max(1, target))} of ${target}`;
      const who = [...new Map(mine.flatMap((iv) => iv.who).map((p) => [p.name, p])).values()];
      const owner = who.length ? who : ROLE_OF_KIND[kind] === "LA" ? [input.loan.openedBy] : [];
      const stepEvents = (evBy.get(kind) ?? []).sort((a, b) => b.at.getTime() - a.at.getTime());
      txnSteps.push(emptyStep({
        key, stepId: def.stepId, title: def.title, ownerRoles: def.roles, mode: def.mode, state,
        txnId: t.id, txnCode: t.code, txnName: t.name,
        ownerName: owner.map((p) => p.name).join(" and ") || null, ownerIds: owner.map((p) => p.id).filter((x): x is string => !!x),
        start, end, durationMs: Math.max(0, (end ?? now).getTime() - start.getTime()),
        tat: { target, targetText: tatTextOf(tats, def.tatKey, target === null ? "-" : undefined), actualText, late: clock.late, deadline: clock.deadline },
        segments: segs, stateMs: stateTotals(segs, now), holds, problems,
        attempts: kind === "PROCESS" ? [...t.attempts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) : [],
        stages: kind === "PROCESS" ? stageRowsOf(t, now) : undefined,
        note: kind === "PROCESS" && t.ltoOffice ? `At ${t.ltoOffice}` : undefined,
        events: stepEvents.map((e) => ({ at: e.at, text: e.text, by: e.by, simulated: e.simulated })),
        simulated: stepEvents.some((e) => e.simulated),
        open: !!openIv || holds.some((h) => !h.resumedAt) || problems.some((p) => !p.resolvedAt),
        openSince: openIv ? (lastSeg?.start ?? openIv.start) : (holds.find((h) => !h.resumedAt)?.raisedAt ?? problems.find((p) => !p.resolvedAt)?.raisedAt ?? null),
      }));
    }

    // Transaction row ("Where it is now" and Bars).
    const open = txnSteps.filter((s) => s.txnId === t.id && s.end === null && s.start !== null).at(-1);
    const finished = t.status === "COMPLETED";
    const processStep = txnSteps.find((s) => s.txnId === t.id && (s.stepId === PROCESS_STEP[t.code]?.id || (t.requiresDp ? s.stepId === "4.4" : s.stepId === "3.3")));
    // The same chip as every other screen (one mapping, lib/jobs/view.ts).
    const chip = finished || t.status === "CANCELLED" ? null : txnTat({
      status: t.status, statusSince: t.statusSince, fundsNeeded: t.fundsNeeded, type: { code: t.code }, advanceLines: [],
      problems: t.problems.map((p) => ({ raisedAt: p.raisedAt, resolvedAt: p.resolvedAt, reason: { name: p.reason } })),
      holds: t.holds.map((h) => ({ raisedAt: h.raisedAt, resumedAt: h.resumedAt, reason: { name: h.reason } })),
    }, tats, holidays, now);
    txns.push({
      id: t.id, code: t.code, name: t.name, status: t.status,
      state: t.status === "CANCELLED" ? "na" : finished ? "done" : open?.state ?? "now",
      owner: currentOwner(t, { loan: input.loan }),
      tat: chip,
      segments: mergeSegments(allSegs),
      start: t.createdAt,
      end: finished ? t.completedAt ?? t.statusSince : null,
      deadline: open?.tat.deadline ?? processStep?.tat.deadline ?? null,
      done: finished,
      openSegment: finished ? null : allSegs.at(-1)?.end === null ? allSegs.at(-1)! : null,
    });
  }

  // Phases: template order; per-transaction rows in place of their template step.
  const loanEvents = input.events.filter((e) => !eventsUsed.has(e.id));
  const phases: JPhase[] = PHASES.map((p, pi) => {
    const tp = template[pi];
    const steps: JStep[] = [];
    for (const s of tp.steps) {
      if (PER_TXN_IDS.has(s.id)) {
        // One row per transaction that has this step (in transaction order); only the first template id of a kind adds them.
        steps.push(...txnSteps.filter((x) => x.stepId === s.id && live.some((t) => t.id === x.txnId)));
        continue;
      }
      const evs = loanEvents.filter((e) => e.journeyStep === s.id && !e.txnId).sort((a, b) => b.at.getTime() - a.at.getTime());
      const state: StepState = s.state === "done" ? "done" : s.state === "current" ? "now" : s.state === "na" ? "na" : "later";
      const last = evs[0];
      const fundsStep = ["3.4", "3.5", "4.5"].includes(s.id);
      const note = fundsStep && input.advances.length
        ? input.advances.map((a) => `${a.number}: ${fundsWords(a)}`).join(" · ")
        : s.note;
      steps.push(emptyStep({
        key: s.id, stepId: s.id, title: s.title, ownerRoles: s.owner, mode: s.mode, state,
        ownerName: state === "done" ? s.who ?? null : null,
        end: state === "done" ? last?.at ?? s.when ?? null : null,
        tat: { target: s.tatKey ? targetOf(tats, s.tatKey) : null, targetText: s.tat, actualText: state === "done" ? "Done" : null, late: 0, deadline: null },
        events: evs.map((e) => ({ at: e.at, text: e.text, by: e.by, simulated: e.simulated })),
        note, simulated: !!s.simulated || evs.some((e) => e.simulated),
        open: state === "now", openSince: state === "now" ? input.loan.stageSince : null,
      }));
      for (const e of evs) eventsUsed.add(e.id);
    }
    const pevents = input.events
      .filter((e) => !eventsUsed.has(e.id) && e.phase === p.n)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .map((e) => ({ at: e.at, text: e.text, by: e.by, simulated: e.simulated }));
    const active = steps.some((s) => ["now", "waiting", "hold", "problem"].includes(s.state));
    const allDone = steps.length > 0 && steps.every((s) => s.state === "done" || s.state === "na");
    return { n: p.n, title: p.title, state: active ? "current" : allDone ? "done" : "upcoming", steps, events: pevents };
  });

  const nameOf = new Map(input.transactions.map((t) => [t.id, t]));
  const docs: JDoc[] = input.documents.map((d) => {
    const c = custodyOf(d, now);
    const t = d.txnId ? nameOf.get(d.txnId) : undefined;
    return {
      id: d.id, documentId: d.documentId, label: d.label, originality: d.originality, txnCode: t?.code ?? null, txnName: t?.name ?? null,
      holder: d.custodianLabel, place: d.location, since: d.since, trail: c.trail, periods: c.periods,
    };
  });

  return { phases, txns, docs, now };
}

export function fundsWords(a: AdvanceRec): string {
  const st = a.status === "REQUESTED" ? "Requested" : a.status === "APPROVED" ? "Approved, waiting for release" : a.status === "DENIED" ? "Denied"
    : a.status === "CANCELLED" ? "Cancelled" : ["LIQUIDATED", "CLOSED"].includes(a.status) ? "Settled" : "Funded";
  const amount = a.releasedCents ?? a.requestedCents;
  const words = amount === null ? st : `${st} (₱${(amount / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
  return a.linesText ? `${words} · ${a.linesText}` : words;
}

// ---------------------------------------------------------------------------
// Bars: one cell per calendar day, coloured by state (weekends and holidays dimmed)
// ---------------------------------------------------------------------------

export type CellState = SegState | "done" | "none";
export interface DayCell { date: string; state: CellState; offDay: boolean; deadline: boolean; today: boolean }

/** Day cells for a transaction from its first day to its last (or today). The highest state of the day wins. */
export function dayCells(t: Pick<JTxn, "segments" | "start" | "end" | "deadline" | "done">, holidays: ReadonlySet<string>, now: Date): DayCell[] {
  const first = businessDate(t.start);
  const lastInstant = t.end ?? now;
  let last = businessDate(lastInstant);
  if (t.deadline && t.deadline > last) last = t.deadline;
  const out: DayCell[] = [];
  const today = businessDate(now);
  const doneDay = t.done && t.end ? businessDate(t.end) : null;
  for (let d = first, guard = 0; d <= last && guard < 400; d = nextDay(d), guard++) {
    let best: SegState | null = null;
    for (const s of t.segments) {
      const a = businessDate(s.start);
      const b = businessDate(s.end ?? now);
      if (a <= d && d <= b && (best === null || PRIORITY[s.state] > PRIORITY[best])) best = s.state;
    }
    let state: CellState = best ?? "none";
    if (doneDay && d === doneDay) state = "done";
    if (d > (doneDay ?? today)) state = "none";
    out.push({ date: d, state, offDay: !isBusinessDay(d, holidays), deadline: d === t.deadline, today: d === today });
  }
  return out;
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Business days in a state span, for the bars legend and table. */
export const businessSpan = (a: Date, b: Date, holidays: ReadonlySet<string>) => Math.max(0, businessDaysBetween(businessDate(a), businessDate(b), holidays));

/** The processing stages of a transaction's jobs (latest job last), with what was recorded in each. */
export function stageRowsOf(t: TxnRec, now: Date): JStageRow[] {
  const rows = t.assignments.slice().reverse().flatMap((a) => a.stages ?? []);
  const first = rows.findIndex((r) => r.status !== "DONE");
  return rows.map((r, i) => ({
    ...r,
    state: r.status === "DONE" ? "done" : i === first ? "now" : "later",
    durationMs: r.startedAt ? (r.finishedAt ?? now).getTime() - r.startedAt.getTime() : null,
    holds: t.holds.filter((h) => h.stageId === r.id),
    problems: t.problems.filter((p) => p.stageId === r.id),
    attempts: t.attempts.filter((x) => x.stageId === r.id),
  }));
}
