import "server-only";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { overseerIds, ownsTransaction } from "./jobs";
import { currentStageIdFor } from "./job-stages";
import { NotInScopeError, UserError } from "./errors";
import { NO_OWNER, holdRemarksSchema, journeyHoldTransferred, mayAddDetails, mayResumeHold, onlyHolderMessage, remarksSchema, resumeRemarksSchema } from "@/lib/ui/holds";
import { worksAtWhere } from "@/lib/branches/access";

/**
 * Holds: a transaction waits on something that is not a fault (the borrower, another team, an LTO
 * appointment). Separate from problems; a hold and a problem may both be open (the problem wins for
 * colour). The TAT clock never pauses: a hold only changes the state and has its own timer.
 * Only one open hold per transaction (also a unique index in the database). One audit row per action.
 */

export const holdSchema = z.object({
  transactionId: z.string().trim().min(1),
  reasonId: z.string({ message: "Pick a reason." }).trim().min(1, "Pick a reason."),
  /** Remarks are always required (not only for "Other"): what it is waiting on, as the person typed it. */
  note: holdRemarksSchema,
});
export type HoldInput = z.input<typeof holdSchema>;

const firstIssue = (e: z.ZodError) => { const i = e.issues[0]; return new UserError(i.message, String(i.path[0] ?? "")); };

async function notifyHold(tx: Tx, t: { loanId: string; loan: { pn: string; branchId: string }; type: { name: string } }, what: "started" | "ended", text: string) {
  const la = await branchLaUserIds(tx, t.loan.branchId);
  await notify(tx, {
    email: { event: "hold_changed", to: la, vars: { pn: t.loan.pn, transaction: t.type.name, status: what === "started" ? "put on hold" : "resumed", reason: text } },
    userIds: [...la, ...(await overseerIds(tx, t.loan.branchId))], loanId: t.loanId,
    title: `${t.loan.pn}: ${t.type.name} ${what === "started" ? "put on hold" : "resumed"}`,
    body: text, link: `/loans/${t.loan.pn}?tab=journey`,
  });
}

/** Resume remarks: required, at least 3 characters. */
export const resumeSchema = z.object({ note: resumeRemarksSchema });

/**
 * Put a transaction on hold. The LA on work in the LA's hands, the DP on their own jobs. Admin cannot.
 * When it started and who put it on hold are recorded by the server (the person cannot set them).
 */
export async function raiseHold(u: CurrentUser, raw: HoldInput, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.HOLDS_RAISE)) throw new UserError("Your role does not allow putting work on hold.");
  const p = holdSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const d = p.data;
  const t = await prisma.loanTransaction.findUnique({ where: { id: d.transactionId }, include: { type: true, loan: true } });
  if (!t || !inScope(u, t.loan.branchId)) throw new NotInScopeError();
  if (["COMPLETED", "CANCELLED"].includes(t.status)) throw new UserError("This transaction is already finished.");
  if (!(await ownsTransaction(u, t))) throw new UserError("You can put on hold only work you do.");
  const reason = await prisma.holdReason.findUnique({ where: { id: d.reasonId } });
  if (!reason || !reason.active) throw new UserError("Pick a reason.", "reasonId");
  return withLoanLock(t.loanId, async (tx) => {
    if (await tx.hold.findFirst({ where: { transactionId: t.id, resumedAt: null } })) throw new UserError("This transaction is already on hold.");
    const jobStageId = await currentStageIdFor(tx, t.id);
    const h = await tx.hold.create({
      data: {
        jobStageId, loanId: t.loanId, transactionId: t.id, reasonId: reason.id, reasonName: reason.name, note: d.note, raisedById: u.id, raisedByLabel: u.name, raisedAt: now, ownerId: u.id, ownerLabel: u.name },
    });
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "hold_started", entityType: "Hold", entityId: h.id, loanId: t.loanId, pn: t.loan.pn,
      summary: `${t.type.name} put on hold: ${reason.name}`,
      after: { reason: reason.code, raisedAt: now }, details: { note: d.note },
    });
    await notifyHold(tx, t, "started", `${u.name}: ${reason.name}. The turnaround time keeps counting.`);
    return h.id;
  });
}

/**
 * Resume: ONLY the person who put it on hold (no override, Admin included). Anyone else is refused
 * with "Only {name} can resume this." Remarks are required (5 to 500); time and person are recorded
 * by the server. Resuming lifts the lock.
 */
export async function resumeHold(u: CurrentUser, holdId: string, note: string, now: Date = new Date()) {
  const h = await prisma.hold.findUnique({ where: { id: holdId }, include: { reason: true, transaction: { include: { type: true, loan: true } } } });
  if (!h || !inScope(u, h.transaction.loan.branchId)) throw new NotInScopeError();
  if (h.resumedAt) throw new UserError("This hold has already ended.");
  if (!mayResumeHold(h, u)) throw new UserError(h.ownerLabel ? onlyHolderMessage(h.ownerLabel) : NO_OWNER);
  const r0 = resumeSchema.safeParse({ note });
  if (!r0.success) throw firstIssue(r0.error);
  const text = r0.data.note;
  const t = h.transaction;
  return withLoanLock(t.loanId, async (tx) => {
    // Closes the same record (no new row): the open segment becomes a finished one.
    const r = await tx.hold.updateMany({ where: { id: h.id, resumedAt: null }, data: { resumedAt: now, resumedById: u.id, resumedByLabel: u.name, resumeNote: text } });
    if (r.count === 0) throw new UserError("This hold has already ended.");
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "hold_ended", entityType: "Hold", entityId: h.id, loanId: t.loanId, pn: t.loan.pn,
      summary: `${t.type.name} resumed after hold (${h.reasonName || h.reason.name}): ${text}`,
    });
    await notifyHold(tx, { loanId: t.loanId, loan: t.loan, type: t.type }, "ended", `${u.name} resumed it: ${text}`);
  });
}

/**
 * Older holds were saved without remarks. Only the person who put it on hold may add them, once
 * (same rules as new remarks). Who and when are recorded in the audit row; the hold itself keeps its
 * start time and person.
 */
export async function addHoldDetails(u: CurrentUser, holdId: string, note: string) {
  const h = await prisma.hold.findUnique({ where: { id: holdId }, include: { reason: true, transaction: { include: { type: true, loan: true } } } });
  if (!h || !inScope(u, h.transaction.loan.branchId)) throw new NotInScopeError();
  if (h.resumedAt) throw new UserError("This hold has already ended.");
  if (h.note.trim()) throw new UserError("This hold already has remarks.");
  if (!mayAddDetails(h, u)) throw new UserError(h.ownerLabel ? `Only ${h.ownerLabel} can add the details.` : NO_OWNER);
  const p = holdRemarksSchema.safeParse(note);
  if (!p.success) throw new UserError(p.error.issues[0].message, "note");
  const t = h.transaction;
  return withLoanLock(t.loanId, async (tx) => {
    const r = await tx.hold.updateMany({ where: { id: h.id, resumedAt: null, note: "" }, data: { note: p.data } });
    if (r.count === 0) throw new UserError("This hold changed. Refresh the page.");
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "hold_details_added", entityType: "Hold", entityId: h.id, loanId: t.loanId, pn: t.loan.pn,
      summary: `${t.type.name} hold (${h.reasonName || h.reason.name}): details added`, details: { note: p.data },
    });
  });
}

// ---------------------------------------------------------------------------
// Transfer hold: a supervisor or Admin gives the hold to another owner. Never resumes it.
// ---------------------------------------------------------------------------

/** The work role of a hold: an LA hold (work in the LA's hands) or a DP hold (a processor's job). */
async function holdKind(h: { raisedById: string | null; transactionId: string }): Promise<{ kind: "LA" | "DP"; roleId: string | null }> {
  if (h.raisedById) {
    const r = await prisma.user.findUnique({ where: { id: h.raisedById }, select: { roleId: true, role: { select: { permissions: true } } } });
    if (r) return { kind: r.role.permissions.includes(PERMISSIONS.JOBS_WORK) ? "DP" : "LA", roleId: r.roleId };
  }
  const job = await prisma.dpAssignment.findFirst({ where: { transactionId: h.transactionId, status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } } });
  return { kind: job ? "DP" : "LA", roleId: null };
}

/**
 * May this person move this hold to another person? With holds:transfer ("Move a hold to another
 * person"): only holds in the branches of their own access (All branches: any hold).
 */
export function mayTransferHold(u: CurrentUser, loanBranchId: string): boolean {
  if (!can(u, PERMISSIONS.HOLDS_TRANSFER)) return false;
  return inScope(u, loanBranchId);
}

/**
 * Who can receive a hold: active people with the same work role as the original holder (the same
 * role; an LA hold goes to an LA, a DP hold to a DP) who also have access to the loan's branch (or All
 * branches). Never the person moving it and never the current owner.
 */
export async function transferCandidates(u: CurrentUser, holdId: string): Promise<{ id: string; name: string }[]> {
  const h = await prisma.hold.findUnique({ where: { id: holdId }, include: { loan: { select: { branchId: true } } } });
  if (!h || h.resumedAt) return [];
  const { kind, roleId } = await holdKind(h);
  const people = await prisma.user.findMany({
    where: {
      active: true, id: { notIn: [u.id, ...(h.ownerId ? [h.ownerId] : [])] },
      role: { active: true, ...(roleId ? { id: roleId } : {}), permissions: { has: kind === "DP" ? PERMISSIONS.JOBS_WORK : PERMISSIONS.CHECKLIST_TICK } },
      ...worksAtWhere(h.loan.branchId),
    },
    orderBy: { name: "asc" }, select: { id: true, name: true },
  });
  return people;
}

export async function transferHold(u: CurrentUser, holdId: string, toUserId: string, note: string, now: Date = new Date()) {
  const h = await prisma.hold.findUnique({ where: { id: holdId }, include: { reason: true, transaction: { include: { type: true, loan: true } } } });
  if (!h || !inScope(u, h.transaction.loan.branchId)) throw new NotInScopeError();
  if (!can(u, PERMISSIONS.HOLDS_TRANSFER)) throw new UserError("Your role does not allow transferring holds.");
  if (!mayTransferHold(u, h.transaction.loan.branchId)) throw new UserError("You can transfer holds only in your branches.");
  if (h.resumedAt) throw new UserError("This hold has already ended.");
  if (!toUserId) throw new UserError("Choose the new owner.", "toUserId");
  if (toUserId === u.id) throw new UserError("You cannot transfer a hold to yourself.", "toUserId");
  if (toUserId === h.ownerId) throw new UserError("That person already owns this hold.", "toUserId");
  const p = remarksSchema.safeParse(note);
  if (!p.success) throw new UserError(p.error.issues[0].message, "note");
  const to = (await transferCandidates(u, holdId)).find((c) => c.id === toUserId);
  if (!to) throw new UserError("Choose an active person with the same work role as the holder who also has access to this branch.", "toUserId");
  const t = h.transaction;
  const from = { id: h.ownerId, label: h.ownerLabel ?? "Nobody (no owner)" };
  return withLoanLock(t.loanId, async (tx) => {
    const r = await tx.hold.updateMany({ where: { id: h.id, resumedAt: null, ownerId: h.ownerId }, data: { ownerId: to.id, ownerLabel: to.name } });
    if (r.count === 0) throw new UserError("This hold changed. Refresh the page.");
    const tr = await tx.holdTransfer.create({ data: { holdId: h.id, fromId: from.id, fromLabel: from.label, toId: to.id, toLabel: to.name, byId: u.id, byLabel: u.name, note: p.data, at: now } });
    const text = journeyHoldTransferred(tr);
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "hold_transferred", entityType: "Hold", entityId: h.id, loanId: t.loanId, pn: t.loan.pn,
      summary: `${t.type.name}: ${text}`, before: { owner: from.label }, after: { owner: to.name }, details: { note: p.data },
    });
    // The new owner, and the old owner if still active (in-app; by email when the switch is on).
    const oldActive = from.id ? (await tx.user.findUnique({ where: { id: from.id }, select: { active: true } }))?.active : false;
    const ids = [to.id, ...(oldActive && from.id ? [from.id] : [])];
    await notify(tx, {
      email: { event: "hold_changed", to: ids, vars: { pn: t.loan.pn, transaction: t.type.name, status: `transferred to ${to.name}`, reason: `${u.name}: ${p.data}` } },
      userIds: ids, loanId: t.loanId,
      title: `${t.loan.pn}: ${t.type.name} hold transferred to ${to.name}`,
      body: `${u.name} gave the hold to ${to.name}. ${to.name} is now the only person who can resume it. ${p.data}`,
      link: `/loans/${t.loan.pn}?tab=todo&tx=${t.type.code}`,
    });
    return tr.id;
  });
}

/** A finished transaction cannot stay on hold: its open hold ends with it (System, same record). */
export async function endHoldsOnCompletion(tx: Tx, t: { id: string; loanId: string; pn: string; name: string }, simulated: boolean, now: Date = new Date()) {
  const open = await tx.hold.findMany({ where: { transactionId: t.id, resumedAt: null }, include: { reason: true } });
  for (const h of open) {
    await tx.hold.update({ where: { id: h.id }, data: { resumedAt: now, resumedByLabel: "System", resumeNote: "Ended when the transaction was completed." } });
    await writeAudit(tx, {
      actor: { id: null, label: "System" }, mode: simulated ? "SIMULATED" : "AUTOMATIC", action: "hold_ended", entityType: "Hold", entityId: h.id, loanId: t.loanId, pn: t.pn,
      summary: `${simulated ? "Simulated: " : ""}${t.name} hold (${h.reasonName || h.reason.name}) ended when the transaction was completed`,
    });
  }
}

/**
 * Settings, Roles: the active branches where nobody can move a hold. From the derived branch access
 * (user_branch_access, or All branches) of the active people whose active role has "Move a hold to
 * another person". Hidden branches are left out (no new work there). Read only.
 */
export async function branchesWithoutHoldMover(): Promise<{ id: string; name: string; code: string | null }[]> {
  const movers = await prisma.user.findMany({
    where: { active: true, role: { active: true, permissions: { has: PERMISSIONS.HOLDS_TRANSFER } } },
    select: { allBranches: true, branches: { select: { branchId: true } } },
  });
  if (movers.some((m) => m.allBranches)) return [];
  const covered = new Set(movers.flatMap((m) => m.branches.map((b) => b.branchId)));
  const branches = await prisma.branch.findMany({ where: { active: true, hidden: false }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } });
  return branches.filter((b) => !covered.has(b.id));
}

/** "3 active branches have nobody who can move a hold." (empty at 0: the line is hidden). */
export function holdMoverHealthText(n: number): string {
  if (n <= 0) return "";
  return `${n} active branch${n === 1 ? " has" : "es have"} nobody who can move a hold.`;
}
