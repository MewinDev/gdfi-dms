import "server-only";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { evaluateChecklist, pendingJobInLock } from "./workflow";
import { moveDocs } from "./custody";
import { recomputeStage } from "./stage";
import { NotInScopeError, UserError } from "./errors";
import { assertNotHeld } from "./locks";

/**
 * Sent, not accepted yet: the LA can still change it (papers, funds, processor, a note) or pull it back.
 * Each change is checked inside the loan lock, so a simultaneous accept cannot be overwritten; once the
 * processor accepted, the plain refusal says to ask them to return it. The TAT clock does not reset.
 * One audit row per action (action "sent_job_updated" or "sent_job_pulled_back" on the assignment).
 */

const firstIssue = (e: z.ZodError) => { const i = e.issues[0]; return new UserError(i.message, String(i.path[0] ?? "")); };
const reasonText = (what: string) => z.string({ message: `Say why you ${what}.` }).trim().min(3, `Say why you ${what} (at least 3 characters).`).max(300, "Keep it under 300 characters.");

/** The LA of the branch who may send (the same rule as Send). Admin cannot. */
async function loadForLa(u: CurrentUser, transactionId: string) {
  if (!can(u, PERMISSIONS.DP_SEND)) throw new UserError("Only the Loan Associate who sends work can change it.");
  const t = await prisma.loanTransaction.findUnique({ where: { id: transactionId }, include: { type: true, loan: { include: { branch: true } } } });
  if (!t || !inScope(u, t.loan.branchId)) throw new NotInScopeError();
  return t;
}

type Loaded = Awaited<ReturnType<typeof loadForLa>>;
const updated = (tx: Tx, u: CurrentUser, t: Loaded, jobId: string, summary: string, changes: string[], extra: Record<string, unknown> = {}) =>
  writeAudit(tx, {
    actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "sent_job_updated", entityType: "DpAssignment", entityId: jobId, loanId: t.loanId, pn: t.loan.pn,
    summary, details: { changes, ...extra },
  });

export const noteSchema = z.object({ note: z.string({ message: "Write the note." }).trim().min(3, "Write the note (at least 3 characters).").max(300, "Keep the note under 300 characters.") });

/** A short note for the processor (shown in their "Updated by" list until they accept). */
export async function addProcessorNote(u: CurrentUser, transactionId: string, raw: unknown) {
  const p = noteSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const t = await loadForLa(u, transactionId);
  return withLoanLock(t.loanId, async (tx) => {
    await assertNotHeld(tx, t.id);
    const job = await pendingJobInLock(tx, t.id);
    await updated(tx, u, t, job.id, `Note for the processor: ${p.data.note}`, [`Note: ${p.data.note}`]);
    await notify(tx, { email: { event: "job_changed", transactionId: t.id, vars: { pn: t.loan.pn, transaction: t.type.name, who: u.name, reason: `Note: ${p.data.note}` } }, userIds: [job.dpUserId, ...(job.secondaryDpUserId ? [job.secondaryDpUserId] : [])], loanId: t.loanId, title: `${t.loan.pn}: note on ${t.type.name}`, body: `${u.name}: ${p.data.note}`, link: `/jobs/${job.id}` });
  });
}

export const processorSchema = z.object({
  dpUserId: z.string().trim().min(1, "Pick the processor."),
  secondaryDpUserId: z.string().trim().nullable().default(null),
  reason: reasonText("change the processor"),
});

const PROCESSOR_ROLE = { active: true, permissions: { has: PERMISSIONS.DP_RECEIVE } };

/** Reassign to a different processor (and add or remove the second processor). The first processor is told. */
export async function changeProcessor(u: CurrentUser, transactionId: string, raw: unknown) {
  const p = processorSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const d = p.data;
  const t = await loadForLa(u, transactionId);
  const dp = await prisma.user.findFirst({ where: { id: d.dpUserId, active: true, role: PROCESSOR_ROLE }, include: { branches: true } });
  if (!dp) throw new UserError("Pick an active processor.", "dpUserId");
  const second = d.secondaryDpUserId ? await prisma.user.findFirst({ where: { id: d.secondaryDpUserId, active: true, role: PROCESSOR_ROLE } }) : null;
  if (d.secondaryDpUserId && !second) throw new UserError("Pick an active second processor.", "secondaryDpUserId");
  if (second && second.id === dp.id) throw new UserError("The second processor must be a different person.", "secondaryDpUserId");
  return withLoanLock(t.loanId, async (tx) => {
    await assertNotHeld(tx, t.id);
    const job = await pendingJobInLock(tx, t.id);
    if (job.dpUserId === dp.id && (job.secondaryDpUserId ?? null) === (second?.id ?? null)) throw new UserError("Pick a different processor.", "dpUserId");
    const branchId = dp.branches.some((b) => b.branchId === job.dpBranchId) ? job.dpBranchId : dp.branches[0]?.branchId ?? job.dpBranchId;
    // Same job, same clock (sent time kept): only who does it changes.
    await tx.dpAssignment.update({ where: { id: job.id }, data: { dpUserId: dp.id, dpBranchId: branchId, secondaryDpUserId: second?.id ?? null, pasuyoReason: second ? d.reason : null } });
    if (second && second.id !== job.secondaryDpUserId) {
      await tx.pasuyoEvent.create({ data: { assignmentId: job.id, toUserId: second.id, toLabel: second.name, byUserId: u.id, byLabel: u.name, reason: d.reason } });
    }
    const docs = await tx.documentItem.findMany({ where: { transactionId: t.id, stage: "IN_TRANSIT" } });
    for (const doc of docs) {
      await tx.documentItem.update({ where: { id: doc.id }, data: { location: `In transit to DP ${dp.name}` } });
      await tx.documentMovement.create({ data: { documentItemId: doc.id, action: "REDIRECTED_TO_DP", fromCustodian: doc.custodianLabel, toCustodian: `${dp.name} (DP)`, location: `In transit to DP ${dp.name}`, actorId: u.id, actorLabel: u.name, remarks: `Processor changed before acceptance: ${d.reason}` } });
    }
    const changes = [
      ...(job.dpUserId !== dp.id ? [`Processor: ${job.dpUser.name} to ${dp.name}`] : []),
      ...((job.secondaryDpUserId ?? null) !== (second?.id ?? null) ? [second ? `Second processor: ${second.name}` : "Second processor removed"] : []),
    ];
    await updated(tx, u, t, job.id, `${changes.join("; ")} before the processor accepted: ${d.reason}`, changes, { reason: d.reason, from: job.dpUser.name, to: dp.name });
    if (job.dpUserId !== dp.id) {
      await notify(tx, { email: { event: "job_changed", transactionId: t.id, vars: { pn: t.loan.pn, transaction: t.type.name, who: u.name, reason: `Given to ${dp.name} before you accepted. Reason: ${d.reason}` } }, userIds: [job.dpUserId], loanId: t.loanId, title: `${t.loan.pn}: ${t.type.name} given to another processor`, body: `${u.name} gave it to ${dp.name} before you accepted. Reason: ${d.reason}`, link: "/jobs" });
    }
    await notify(tx, {
      userIds: [dp.id, ...(second ? [second.id] : [])], loanId: t.loanId, title: `New assignment: ${t.type.name} for ${t.loan.pn}`,
      body: `${u.name} sent ${t.type.name} (${t.loan.borrowerName}) to you. Please accept or decline today.`, link: `/jobs/${job.id}`, email: { event: "job_sent", transactionId: t.id, vars: { pn: t.loan.pn, transaction: t.type.name, who: u.name } },
    });
  });
}

export const pullBackSchema = z.object({ reason: reasonText("pull it back") });

/**
 * Pull back: cancels the send. The transaction is Ready to send again for the LA; the job leaves the
 * processor's list (kept in history). Papers in transit were never received, so they are recorded as
 * not handed over and stay with the LA. The clock is not reset.
 */
export async function pullBack(u: CurrentUser, transactionId: string, raw: unknown) {
  const p = pullBackSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const t = await loadForLa(u, transactionId);
  return withLoanLock(t.loanId, async (tx) => {
    await assertNotHeld(tx, t.id);
    const job = await pendingJobInLock(tx, t.id);
    const now = new Date();
    await tx.dpAssignment.update({ where: { id: job.id }, data: { status: "PULLED_BACK", closedAt: now, returnReasons: `Pulled back by ${u.name}: ${p.data.reason}` } });
    const checks = await tx.checklistCheck.findMany({ where: { transactionId: t.id }, include: { rule: true } });
    // Back to where it was before Send (Ready to send); the clock keeps its start (when it became ready).
    const ready = await tx.auditLog.findFirst({ where: { action: "checklist_saved", journeyStep: "3.1", entityId: t.id, at: { lte: job.endorsedAt } }, orderBy: { at: "desc" } });
    await tx.loanTransaction.update({
      where: { id: t.id },
      data: { status: evaluateChecklist(checks).complete ? "READY" : "FOR_CHECKLIST", statusSince: ready?.at ?? job.endorsedAt },
    });
    const docs = await tx.documentItem.findMany({ where: { transactionId: t.id, stage: "IN_TRANSIT" } });
    await moveDocs(tx, docs, { stage: "AT_BRANCH", custodian: null, role: "LA", userId: null, location: `${t.loan.branch.name} branch`, action: "NOT_HANDED_OVER" }, { by: { id: u.id, label: u.name } });
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "sent_job_pulled_back", entityType: "DpAssignment", entityId: job.id, loanId: t.loanId, pn: t.loan.pn,
      summary: `Pulled back ${t.type.name} from ${job.dpUser.name} before they accepted: ${p.data.reason}`, details: { reason: p.data.reason, dp: job.dpUser.name },
    });
    await notify(tx, { email: { event: "job_changed", transactionId: t.id, vars: { pn: t.loan.pn, transaction: t.type.name, who: u.name, reason: `Pulled back before you accepted. Reason: ${p.data.reason}` } },
      userIds: [job.dpUserId, ...(job.secondaryDpUserId ? [job.secondaryDpUserId] : [])], loanId: t.loanId,
      title: `${t.loan.pn}: ${t.type.name} pulled back`, body: `${u.name} pulled it back before you accepted. Reason: ${p.data.reason}`, link: "/jobs",
    });
    await recomputeStage(tx, t.loanId);
  });
}

/** What the LA changed since sending, for the processor's "Updated by" tag (until they accept). */
export async function updatesBeforeAccept(job: { id: string; transactionId: string; endorsedAt: Date; dpUserId: string }) {
  const rows = await prisma.auditLog.findMany({
    where: {
      at: { gte: job.endorsedAt }, actorId: { not: job.dpUserId },
      OR: [
        { action: "sent_job_updated", entityId: job.id },
        { action: "funds_flag_changed", entityId: job.transactionId },
      ],
    },
    orderBy: { at: "asc" },
  });
  const changes = rows.flatMap((r) => ((r.details as { changes?: unknown } | null)?.changes as string[] | undefined) ?? [r.summary]);
  const last = rows.at(-1);
  return last ? { by: last.actorLabel, at: last.at, changes } : null;
}
