import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { can, inScope, loanScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { worksAtWhere } from "@/lib/branches/access";
import { andWhere, holdsWhere } from "@/lib/auth/holders";
import { handlersOrAdmins } from "./funds-handlers";
import { getSetting, getTatMap } from "@/lib/settings";
import { businessDate, fmtDate, fmtShort } from "@/lib/time";
import { daysFor, dueTone, pausedDays, type DueTone, type WorkCalendar } from "@/lib/calendar/core";
import { loadCalendar } from "@/lib/calendar/load";
import { canFunds } from "@/lib/funds/access";
import { isAway, outcomeText, poolTone, roundDue, roundResult, waitingDays, waitingText, type Outcome, type PoolTone } from "@/lib/work/rules";
import { UserError } from "./errors";

/**
 * Piece 9 (D-014, D-015, D-046): the inbox engine. Every hand-off is a WorkItem round with its history
 * (WorkMovement). The existing screens keep doing their work; they call these functions at each hand-off:
 *   arriveItem    new work in a branch pool, or in a named person's inbox (accepted at once for Find loan)
 *   acceptItem    Accept from the pool or the inbox (the first accept wins)
 *   takeItem      "counts as accept": Finance's Approve / Release, the receiving LA's Receive
 *   closeItem     forward, return (reason required), done, cancel, pull back
 *   moveItem      Back to the pool / Give to... (Move work items)
 * Times are the server's. Counting is the one calendar's, on the item's branch (D-041).
 */

export type WorkKind = "TRANSACTION" | "DP_JOB" | "FUND_REQUEST" | "PACKAGE" | "LOAN_CANDIDATE";
export type WorkRole = "LA" | "DP" | "FIN";
const OPEN = ["POOL", "INBOX", "HELD"];
const KIND_WORDS: Record<WorkKind, string> = { TRANSACTION: "Check and send", DP_JOB: "Processor's job", FUND_REQUEST: "Funds request", PACKAGE: "Package to receive", LOAN_CANDIDATE: "Released, not yet in the DMS" };

const day = (d: Date) => businessDate(d);
async function calendar(db: Tx | typeof prisma): Promise<WorkCalendar> { return loadCalendar(db); }

/** The open item of a subject (the latest round). */
export const openItem = (db: Tx | typeof prisma, kind: WorkKind, subjectId: string) =>
  db.workItem.findFirst({ where: { kind, subjectId, state: { in: OPEN } }, orderBy: { round: "desc" } });

async function nextRound(db: Tx, kind: WorkKind, subjectId: string) {
  const last = await db.workItem.findFirst({ where: { kind, subjectId }, orderBy: { round: "desc" }, select: { round: true } });
  return (last?.round ?? 0) + 1;
}

const moveRow = (tx: Tx, workItemId: string, action: string, by: Actor | null, extra: Partial<Prisma.WorkMovementUncheckedCreateInput> = {}) =>
  tx.workMovement.create({ data: { workItemId, action, byId: by?.id ?? null, byLabel: by?.label ?? "System", ...extra } });

export interface ArriveInput {
  kind: WorkKind; subjectId: string; role: WorkRole; branchId: string; label: string;
  loanId?: string | null; pn?: string | null; poolKey?: string;
  /** A named person (their inbox); null or missing: the branch pool. */
  holderUserId?: string | null;
  /** Accepted at the same moment (Find loan; a return to the person who sent it is NOT accepted). */
  accepted?: boolean;
  measure?: "TAT" | "WAITING";
  /** The target in working days (from the accept day for TAT, from arrival for WAITING), or the TatRule key. */
  targetDays?: number | null; targetKey?: string | null;
  /** A due date kept elsewhere (a DP job's saved TAT): shown as is. */
  dueDate?: string | null;
  overallDueDate?: string | null;
  sendInput?: Prisma.InputJsonValue;
  at?: Date; by?: Actor | null;
}

/** New work: in the branch pool, or in a named person's inbox (accepted at once when asked). Idempotent per subject. */
export async function arriveItem(tx: Tx, a: ArriveInput) {
  const open = await openItem(tx, a.kind, a.subjectId);
  if (open) return open;
  const at = a.at ?? new Date();
  const target = a.targetDays ?? (a.targetKey ? (await getTatMap(tx)).get(a.targetKey)?.businessDays ?? null : null);
  const days = daysFor(await calendar(tx), a.branchId);
  const measure = a.measure ?? "TAT";
  const accepted = !!a.accepted && !!a.holderUserId;
  const due = a.dueDate ?? (target === null ? null : measure === "WAITING" ? roundDue(day(at), target, days) : accepted ? roundDue(day(at), target, days) : null);
  const item = await tx.workItem.create({
    data: {
      kind: a.kind, subjectId: a.subjectId, round: await nextRound(tx, a.kind, a.subjectId), role: a.role, branchId: a.branchId, poolKey: a.poolKey ?? "",
      loanId: a.loanId ?? null, pn: a.pn ?? null, label: a.label, state: accepted ? "HELD" : a.holderUserId ? "INBOX" : "POOL", holderUserId: a.holderUserId ?? null,
      arrivedAt: at, acceptedAt: accepted ? at : null, dueDate: due, targetDays: target, overallDueDate: a.overallDueDate ?? due, measure, sendInput: a.sendInput,
    },
  });
  await moveRow(tx, item.id, "ARRIVE", a.by ?? null, { toUserId: a.holderUserId ?? null, at });
  if (accepted) await moveRow(tx, item.id, "ACCEPT", a.by ?? null, { toUserId: a.holderUserId!, at, waitingDays: 0 });
  return item;
}

/** Accept from the pool or the inbox. The first accept wins; the next one is told who has it (D-046 example 5). */
export async function acceptItemTx(tx: Tx, itemId: string, u: { id: string; name: string }, at: Date = new Date()) {
  const it = await tx.workItem.findUnique({ where: { id: itemId } });
  if (!it || it.state === "DONE") throw new UserError("This item is no longer open. Refresh the page.");
  const days = daysFor(await calendar(tx), it.branchId);
  const due = it.measure === "TAT" && it.targetDays !== null && !it.dueDate ? roundDue(day(at), it.targetDays, days) : it.dueDate;
  const r = await tx.workItem.updateMany({
    where: { id: it.id, state: { in: ["POOL", "INBOX"] }, OR: [{ holderUserId: null }, { holderUserId: u.id }] },
    data: { state: "HELD", holderUserId: u.id, acceptedAt: at, dueDate: due, overallDueDate: it.overallDueDate ?? due },
  });
  if (r.count === 0) {
    const now = await tx.workItem.findUnique({ where: { id: it.id }, include: { holder: { select: { name: true } } } });
    if (now?.holderUserId === u.id && now.state === "HELD") return now; // a double tap
    throw new UserError(now?.holder ? `Already accepted by ${now.holder.name} at ${fmtShort(now.acceptedAt)}. It is in their inbox now.` : "This item is no longer open. Refresh the page.");
  }
  await moveRow(tx, it.id, "ACCEPT", { id: u.id, label: u.name }, { toUserId: u.id, at, waitingDays: waitingDays(day(it.arrivedAt), day(at), days) });
  return tx.workItem.findUniqueOrThrow({ where: { id: it.id } });
}

/** "Counts as accept" (D-046 item 5): the first action takes the open item; nothing if it is already taken. */
export async function takeItem(tx: Tx, kind: WorkKind, subjectId: string, u: { id: string; name: string }, at: Date = new Date()) {
  const it = await openItem(tx, kind, subjectId);
  if (!it || it.state === "HELD") return it;
  return acceptItemTx(tx, it.id, u, at);
}

/** Paused working days of a round: holds whose reason "Pauses TAT" on its transaction (D-041). */
async function pausedFor(tx: Tx, it: { kind: string; subjectId: string; acceptedAt: Date | null }, end: Date, days: ReturnType<typeof daysFor>) {
  if (!it.acceptedAt || (it.kind !== "TRANSACTION" && it.kind !== "DP_JOB")) return 0;
  const holds = await tx.hold.findMany({ where: { transactionId: it.subjectId, raisedAt: { gte: it.acceptedAt, lte: end } }, include: { reason: { select: { pausesTat: true } } } });
  return pausedDays(holds.map((h) => ({ from: day(h.raisedAt), to: h.resumedAt ? day(h.resumedAt) : null, pauses: h.reason.pausesTat })), day(end), days);
}

const ACTION_OF: Record<Outcome, string> = { FORWARDED: "FORWARD", RETURNED: "RETURN", DONE: "DONE", MOVED_AWAY: "MOVE", BACK_TO_POOL: "BACK_TO_POOL", CANCELLED: "CANCEL", PULLED_BACK: "PULL_BACK" };

/**
 * Ends the open round of a subject. A return needs its reason (D-046 item 2). The round's numbers are kept on the
 * movement: waiting days, TAT used (less paused days; for a WAITING item: arrival to the action) and late.
 */
export async function closeItem(tx: Tx, kind: WorkKind, subjectId: string, outcome: Outcome, opts: { at?: Date; by?: Actor | null; reason?: string; remarks?: string; dueDate?: string | null } = {}) {
  if (outcome === "RETURNED" && !opts.reason?.trim()) throw new UserError("Pick a return reason.", "reasonId");
  const it = await openItem(tx, kind, subjectId);
  if (!it) return null;
  const at = opts.at ?? new Date();
  const days = daysFor(await calendar(tx), it.branchId);
  const due = opts.dueDate ?? it.dueDate;
  const start = it.measure === "WAITING" ? it.arrivedAt : it.acceptedAt;
  const res = start ? roundResult({ acceptedDay: day(start), endDay: day(at), dueDate: due, pausedDays: await pausedFor(tx, it, at, days), outcome, days }) : null;
  await tx.workItem.update({ where: { id: it.id }, data: { state: "DONE", outcome, doneAt: at, dueDate: due, returnReason: opts.reason?.trim() ?? "" } });
  await moveRow(tx, it.id, ACTION_OF[outcome], opts.by ?? null, {
    fromUserId: it.holderUserId, at, remarks: [opts.reason, opts.remarks].filter(Boolean).join(": ").slice(0, 500),
    waitingDays: waitingDays(day(it.arrivedAt), day(it.acceptedAt ?? at), days), tatDaysUsed: res?.used ?? null, isLate: res ? res.late : null,
  });
  return it;
}

// ---------------------------------------------------------------------------
// Moving work (D-046 item 3)
// ---------------------------------------------------------------------------

/** Who may hold an item of this role in this branch (and is not away today), through the one resolver. */
async function holders(db: Tx | typeof prisma, role: string, branchId: string, poolKey: string, today: string) {
  let ids: string[];
  if (role === "FIN") {
    ids = [...new Set([...(await handlersOrAdmins(db, "approve", poolKey || null, [branchId])), ...(await handlersOrAdmins(db, "release", poolKey || null, [branchId]))])];
  } else {
    const key = role === "LA" ? PERMISSIONS.CHECKLIST_TICK : PERMISSIONS.JOBS_WORK;
    ids = (await db.user.findMany({ where: andWhere(holdsWhere(key), worksAtWhere(branchId)), select: { id: true } })).map((x) => x.id);
  }
  const people = await db.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, name: true, awayFrom: true, awayTo: true }, orderBy: { name: "asc" } });
  return people.filter((p) => !isAway(p, today)).map((p) => ({ id: p.id, name: p.name }));
}

/** The people an item may be given to (same work role, the branch, not away), for the Give to... list. */
export async function giveToCandidates(u: CurrentUser, itemId: string) {
  const it = await prisma.workItem.findUnique({ where: { id: itemId } });
  if (!it || !can(u, PERMISSIONS.WORKITEMS_MOVE) || !inScope(u, it.branchId)) return [];
  return (await holders(prisma, it.role, it.branchId, it.poolKey, businessDate(new Date()))).filter((p) => p.id !== it.holderUserId);
}

/**
 * Back to the pool, or Give to... The old round closes as "Moved (away)" (never late); the new round starts at the
 * move with a fresh target; the overall due date stays. A DP job given to another processor changes its processor.
 */
export async function moveItem(u: CurrentUser, itemId: string, to: { userId?: string | null; pool?: boolean }, note: string, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.WORKITEMS_MOVE)) throw new UserError("Ask a Superadmin to turn on \"Move work items\" for your role.");
  const it = await prisma.workItem.findUnique({ where: { id: itemId }, include: { holder: { select: { name: true } } } });
  if (!it || !OPEN.includes(it.state) || !inScope(u, it.branchId)) throw new UserError("This item is no longer open. Refresh the page.");
  if (note.trim().length < 5) throw new UserError("Say why it is moved (at least 5 characters).", "note");
  if (it.kind === "DP_JOB" && to.pool) throw new UserError("A processor's job is given to another processor (Give to...), not put back in the pool.");
  const today = businessDate(now);
  let target: { id: string; name: string } | null = null;
  if (!to.pool) {
    target = (await holders(prisma, it.role, it.branchId, it.poolKey, today)).find((p) => p.id === to.userId) ?? null;
    if (!target) throw new UserError("Pick someone of the same work role who has this branch and is not away.", "userId");
    if (target.id === it.holderUserId) throw new UserError("It is already with that person.", "userId");
  }
  const actor = { id: u.id, label: u.name };
  return prisma.$transaction(async (tx) => {
    await closeItem(tx, it.kind as WorkKind, it.subjectId, to.pool ? "BACK_TO_POOL" : "MOVED_AWAY", { at: now, by: actor, remarks: note.trim() });
    const days = daysFor(await calendar(tx), it.branchId);
    const fresh = it.targetDays === null ? null : roundDue(today, it.targetDays, days);
    let dueDate: string | null = it.kind === "DP_JOB" ? null : fresh;
    if (it.kind === "DP_JOB" && target) {
      const job = await tx.dpAssignment.findFirst({ where: { transactionId: it.subjectId, status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } }, orderBy: { endorsedAt: "desc" } });
      if (job) {
        const jobDue = job.status === "ACCEPTED" && job.targetDays !== null ? roundDue(today, job.targetDays, days) : job.dueDate;
        await tx.dpAssignment.update({ where: { id: job.id }, data: { dpUserId: target.id, ...(jobDue ? { dueDate: jobDue } : {}) } });
        dueDate = jobDue ?? null;
      }
    }
    const next = await tx.workItem.create({
      data: {
        kind: it.kind, subjectId: it.subjectId, round: await nextRound(tx, it.kind as WorkKind, it.subjectId), role: it.role, branchId: it.branchId, poolKey: it.poolKey,
        loanId: it.loanId, pn: it.pn, label: it.label, measure: it.measure, targetDays: it.targetDays, overallDueDate: it.overallDueDate, sendInput: it.sendInput ?? undefined,
        state: to.pool ? "POOL" : it.state === "HELD" ? "HELD" : "INBOX", holderUserId: target?.id ?? null, arrivedAt: now,
        acceptedAt: !to.pool && it.state === "HELD" ? now : null, dueDate: !to.pool && it.state === "HELD" ? dueDate : null,
      },
    });
    await moveRow(tx, next.id, to.pool ? "BACK_TO_POOL" : "MOVE", actor, { fromUserId: it.holderUserId, toUserId: target?.id ?? null, at: now, remarks: note.trim() });
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: to.pool ? "work_item_back_to_pool" : "work_item_moved", entityType: "WorkItem", entityId: next.id, loanId: it.loanId ?? undefined, pn: it.pn ?? undefined,
      summary: `${it.label}: ${to.pool ? "back to the pool" : `moved from ${it.holder?.name ?? "the pool"} to ${target!.name}`} (${note.trim()})`,
    });
    const link = it.kind === "DP_JOB" ? "/jobs" : "/inbox";
    const ids = [it.holderUserId, target?.id].filter((x): x is string => !!x);
    await notify(tx, { userIds: ids, loanId: it.loanId, title: `${it.label}: ${to.pool ? "back to the branch pool" : `now with ${target!.name}`}`, body: `${u.name} moved it: ${note.trim()}`, link });
    return next.id;
  });
}

// ---------------------------------------------------------------------------
// Away (D-046 item 3)
// ---------------------------------------------------------------------------

const ymd = /^\d{4}-\d{2}-\d{2}$/;
/** Mark a person away from / to (both days included), or clear it (null). Their own, or anyone's with the tick. */
export async function setAway(u: CurrentUser, userId: string, away: { from: string; to: string; note?: string } | null) {
  const self = userId === u.id;
  if (!self && !can(u, PERMISSIONS.USERS_AWAY)) throw new UserError("Ask a Superadmin to turn on \"Set who is away\" for your role.");
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { branches: true } });
  if (!target) throw new UserError("Pick a person.");
  if (!self && !target.allBranches && !target.branches.some((b) => inScope(u, b.branchId))) throw new UserError("Pick a person of your branches.");
  if (away && (!ymd.test(away.from) || !ymd.test(away.to))) throw new UserError("Pick the first and the last day away.", "from");
  if (away && away.to < away.from) throw new UserError("The last day comes after the first day.", "to");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: away ? { awayFrom: away.from, awayTo: away.to, awayNote: (away.note ?? "").trim().slice(0, 200) } : { awayFrom: null, awayTo: null, awayNote: "" } });
    await writeAudit(tx, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action: away ? "user_away_set" : "user_away_cleared", entityType: "User", entityId: userId, summary: away ? `${target.name} away from ${fmtDate(away.from)} to ${fmtDate(away.to)}` : `${target.name} is no longer marked away` });
  });
}

/** Refuses naming a person who is away (D-046: they cannot be chosen by name for new work). */
export async function refuseAway(db: Tx | typeof prisma, userId: string, now: Date = new Date()) {
  const p = await db.user.findUnique({ where: { id: userId }, select: { name: true, awayFrom: true, awayTo: true } });
  if (p && isAway(p, businessDate(now))) throw new UserError(`${p.name} is away until ${fmtDate(p.awayTo)}. Pick someone else, or the branch pool.`, "dpUserId");
}

// ---------------------------------------------------------------------------
// The lists (Inbox), supervisors' counts, the TAT report
// ---------------------------------------------------------------------------

export interface InboxRow {
  id: string; kind: WorkKind; role: WorkRole; kindText: string; label: string; pn: string | null; link: string; branchName: string;
  state: string; holder: string | null; arrivedText: string; waiting: number; waitingText: string; poolTone: PoolTone;
  dueDate: string | null; dueText: string | null; tone: DueTone | null; paused: boolean; measureText: string;
}

function linkOf(it: { kind: string; subjectId: string; pn: string | null }, jobId?: string | null): string {
  if (it.kind === "DP_JOB") return jobId ? `/jobs/${jobId}` : "/inbox";
  if (it.kind === "FUND_REQUEST") return "/funds";
  if (it.kind === "PACKAGE") return `/receive/${it.subjectId}`;
  return it.pn ? `/loans/${it.pn}` : "/inbox";
}

async function rows(db: typeof prisma, where: Prisma.WorkItemWhereInput, now: Date): Promise<InboxRow[]> {
  const [items, cal, amber, red] = await Promise.all([
    db.workItem.findMany({ where, include: { holder: { select: { name: true } } }, orderBy: { arrivedAt: "asc" }, take: 500 }),
    loadCalendar(db), getSetting("pool.amberAfterDays", db), getSetting("pool.redAfterDays", db),
  ]);
  const txIds = items.filter((i) => i.kind === "TRANSACTION" || i.kind === "DP_JOB").map((i) => i.subjectId);
  const [branches, jobs, holds] = await Promise.all([
    db.branch.findMany({ where: { id: { in: [...new Set(items.map((i) => i.branchId))] } }, select: { id: true, name: true } }),
    db.dpAssignment.findMany({ where: { transactionId: { in: txIds }, status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } }, select: { id: true, transactionId: true, dueDate: true } }),
    db.hold.findMany({ where: { transactionId: { in: txIds }, resumedAt: null }, include: { reason: { select: { pausesTat: true } } } }),
  ]);
  const today = businessDate(now);
  return items.map((it) => {
    const days = daysFor(cal, it.branchId);
    const job = it.kind === "DP_JOB" ? jobs.find((j) => j.transactionId === it.subjectId) : undefined;
    const due = it.kind === "DP_JOB" ? job?.dueDate ?? null : it.dueDate;
    const paused = holds.some((h) => h.transactionId === it.subjectId && h.reason.pausesTat);
    const waiting = waitingDays(day(it.arrivedAt), it.acceptedAt ? day(it.acceptedAt) : today, days);
    return {
      id: it.id, kind: it.kind as WorkKind, role: it.role as WorkRole, kindText: KIND_WORDS[it.kind as WorkKind] ?? it.kind, label: it.label, pn: it.pn, link: linkOf(it, job?.id), branchName: branches.find((b) => b.id === it.branchId)?.name ?? "",
      state: it.state, holder: it.holder?.name ?? null, arrivedText: fmtShort(it.arrivedAt), waiting, waitingText: waitingText(waiting), poolTone: poolTone(waiting, amber, red),
      dueDate: due, dueText: due ? fmtDate(due) : null, tone: due ? dueTone(due, today, days, cal.amberWithinDays ?? 1, paused) : null, paused,
      measureText: it.measure === "WAITING" ? "Time to act (from arrival)" : "Turnaround time (from accept)",
    };
  });
}

/** Inbox order (D-046): paused last; then least time left (overdue first); items with no due date after. */
export function sortInbox(r: InboxRow[]): InboxRow[] {
  const rank = (x: InboxRow) => (x.paused ? 2 : x.dueDate ? 0 : 1);
  return [...r].sort((a, b) => rank(a) - rank(b) || (a.dueDate && b.dueDate ? a.dueDate.localeCompare(b.dueDate) : 0) || b.waiting - a.waiting);
}

/** The person's items: accepted, and named but not accepted yet. */
export async function myItems(u: CurrentUser, now: Date = new Date()) {
  return sortInbox(await rows(prisma, { holderUserId: u.id, state: { in: ["INBOX", "HELD"] } }, now));
}

/** What a person can take from their branches' pools: by work role (and funds type for Finance). */
export async function poolItems(u: CurrentUser, now: Date = new Date()) {
  const roles: Prisma.WorkItemWhereInput[] = [];
  if (can(u, PERMISSIONS.CHECKLIST_TICK)) roles.push({ role: "LA" });
  if (can(u, PERMISSIONS.JOBS_WORK)) roles.push({ role: "DP" });
  for (const code of ["CA", "FT"]) if (canFunds(u, "approve", code) || canFunds(u, "release", code)) roles.push({ role: "FIN", poolKey: code });
  // Supervisors (Move work items) see every pool of their branches, to move work on.
  const all = can(u, PERMISSIONS.WORKITEMS_MOVE);
  if (!roles.length && !all) return [];
  const items = await rows(prisma, { state: "POOL", ...loanScope(u), ...(all ? {} : { OR: roles }) }, now);
  // Longest waiting first (the pool has no due date until someone takes it).
  return items.sort((a, b) => b.waiting - a.waiting);
}

/** Supervisors' Home (D-046): items waiting in the pool too long (red), and items with people who are away. */
export async function supervisorWorkCounts(u: CurrentUser, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.WORKITEMS_MOVE)) return { poolTooLong: 0, withAway: 0 };
  const today = businessDate(now);
  const [pool, held] = await Promise.all([
    rows(prisma, { state: "POOL", ...loanScope(u) }, now),
    prisma.workItem.findMany({ where: { state: { in: ["INBOX", "HELD"] }, ...loanScope(u), holder: { awayFrom: { lte: today }, awayTo: { gte: today } } }, select: { id: true } }),
  ]);
  return { poolTooLong: pool.filter((p) => p.poolTone === "red").length, withAway: held.length };
}

/** Items held by people who are away (for the supervisor's Move list). */
export async function itemsWithAway(u: CurrentUser, now: Date = new Date()) {
  const today = businessDate(now);
  return sortInbox(await rows(prisma, { state: { in: ["INBOX", "HELD"] }, ...loanScope(u), holder: { awayFrom: { lte: today }, awayTo: { gte: today } } }, now));
}

/**
 * TAT per person (D-046): rounds finished in the dates, within the reader's branches. Migrated rounds are left out.
 * TAT rounds (accept to forward) and "time to act" rounds (Finance, receiving: arrival to the action) are separate.
 */
export interface PersonTat { userId: string; name: string; rounds: number; avgUsed: number | null; late: number; returns: number; moved: number; measure: "TAT" | "WAITING" }
export async function tatByPerson(u: CurrentUser, f: { from?: string; to?: string } = {}): Promise<PersonTat[]> {
  const range = f.from || f.to ? { ...(f.from ? { gte: new Date(`${f.from}T00:00:00+08:00`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59+08:00`) } : {}) } : undefined;
  const done = await prisma.workItem.findMany({
    where: { state: "DONE", migrated: false, holderUserId: { not: null }, ...loanScope(u), ...(range ? { doneAt: range } : {}), outcome: { notIn: ["CANCELLED", "PULLED_BACK", "BACK_TO_POOL"] } },
    include: { holder: { select: { name: true } }, movements: { where: { action: { in: ["FORWARD", "RETURN", "DONE", "MOVE"] } }, orderBy: { at: "desc" }, take: 1 } },
  });
  const by = new Map<string, PersonTat & { used: number[] }>();
  for (const it of done) {
    const k = `${it.holderUserId}|${it.measure}`;
    const r = by.get(k) ?? { userId: it.holderUserId!, name: it.holder?.name ?? "", rounds: 0, avgUsed: null, late: 0, returns: 0, moved: 0, measure: it.measure as "TAT" | "WAITING", used: [] };
    const m = it.movements[0];
    r.rounds++;
    if (it.outcome === "RETURNED") r.returns++;
    if (it.outcome === "MOVED_AWAY") r.moved++;
    else if (m?.tatDaysUsed !== null && m?.tatDaysUsed !== undefined) r.used.push(m.tatDaysUsed);
    if (m?.isLate) r.late++;
    by.set(k, r);
  }
  return [...by.values()].map(({ used, ...r }) => ({ ...r, avgUsed: used.length ? Math.round((used.reduce((s, x) => s + x, 0) / used.length) * 10) / 10 : null }))
    .sort((a, b) => a.measure.localeCompare(b.measure) || b.rounds - a.rounds);
}

// ---------------------------------------------------------------------------
// The feed hook (D-046): released loans not yet in the DMS. The sync (piece 7, on hold) will call it.
// ---------------------------------------------------------------------------

/** A released loan from myloans lands in the branch pool, until an LA opens it (Find loan closes it). */
export async function receiveReleasedLoan(tx: Tx, loan: { pn: string; branchId: string; borrowerName: string; at?: Date }) {
  return arriveItem(tx, { kind: "LOAN_CANDIDATE", subjectId: loan.pn, role: "LA", branchId: loan.branchId, pn: loan.pn, label: `${loan.pn}: ${loan.borrowerName}`, targetKey: "P1_OPEN", measure: "WAITING", at: loan.at });
}

export { outcomeText };

/** The Inbox badge: items named to the person and not accepted yet. */
export async function inboxCount(u: CurrentUser): Promise<number> {
  return prisma.workItem.count({ where: { holderUserId: u.id, state: "INBOX" } });
}
