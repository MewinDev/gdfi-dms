import "server-only";
import { z } from "zod";
import { prisma, withLoanLock } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { pendingJobInLock } from "./workflow";
import { withJob } from "./jobs";
import { financeIds } from "./funds";
import { NotInScopeError, UserError } from "./errors";
import { assertNotHeld } from "./locks";

/**
 * The LTO office of a job (where the processor takes it). The LA picks it when sending; before the
 * processor accepts, the LA can change it (the processor is told); after accepting, the processor can
 * change it when the real office differs, with a short note (the LA and Finance are told). One audit
 * row each (action "lto_office_changed").
 */

const firstIssue = (e: z.ZodError) => { const i = e.issues[0]; return new UserError(i.message, String(i.path[0] ?? "")); };
async function activeOffice(id: string) {
  const o = await prisma.ltoOffice.findFirst({ where: { id, active: true } });
  if (!o) throw new UserError("Pick an active LTO office.", "ltoOfficeId");
  return o;
}

export const laLtoSchema = z.object({ ltoOfficeId: z.string({ message: "Pick the LTO office." }).trim().min(1, "Pick the LTO office.") });

/** Before the processor accepts: the LA changes the office (part of "change before accept"). */
export async function laChangeLtoOffice(u: CurrentUser, transactionId: string, raw: unknown) {
  if (!can(u, PERMISSIONS.DP_SEND)) throw new UserError("Only the Loan Associate who sends work can change it.");
  const p = laLtoSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const t = await prisma.loanTransaction.findUnique({ where: { id: transactionId }, include: { type: true, loan: true } });
  if (!t || !inScope(u, t.loan.branchId)) throw new NotInScopeError();
  const office = await activeOffice(p.data.ltoOfficeId);
  return withLoanLock(t.loanId, async (tx) => {
    await assertNotHeld(tx, t.id);
    const job = await pendingJobInLock(tx, t.id);
    if (job.ltoOfficeId === office.id) throw new UserError("That is already the office.", "ltoOfficeId");
    const before = job.ltoOfficeId ? (await tx.ltoOffice.findUnique({ where: { id: job.ltoOfficeId } }))?.name ?? null : null;
    await tx.dpAssignment.update({ where: { id: job.id }, data: { ltoOfficeId: office.id } });
    const change = `LTO office: ${before ? `${before} to ` : ""}${office.name}`;
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "sent_job_updated", entityType: "DpAssignment", entityId: job.id, loanId: t.loanId, pn: t.loan.pn,
      summary: `${u.name} chose ${office.name} for ${t.type.name} before the processor accepted`, details: { changes: [change], change: "lto", from: before, to: office.name },
    });
    await notify(tx, { email: { event: "job_changed", transactionId: t.id, vars: { pn: t.loan.pn, transaction: t.type.name, who: u.name, reason: change } }, userIds: [job.dpUserId, ...(job.secondaryDpUserId ? [job.secondaryDpUserId] : [])], loanId: t.loanId, title: `${t.loan.pn}: ${t.type.name} LTO office changed`, body: `${u.name}: ${change}.`, link: `/jobs/${job.id}` });
  });
}

export const dpLtoSchema = z.object({
  ltoOfficeId: z.string({ message: "Pick the LTO office." }).trim().min(1, "Pick the LTO office."),
  note: z.string({ message: "Say why the office is different." }).trim().min(3, "Say why the office is different (at least 3 characters).").max(300, "Keep it under 300 characters."),
});

/** After accepting: the processor changes the office when the real one differs (note required). */
export async function dpChangeLtoOffice(u: CurrentUser, assignmentId: string, raw: unknown) {
  const p = dpLtoSchema.safeParse(raw);
  if (!p.success) throw firstIssue(p.error);
  const office = await activeOffice(p.data.ltoOfficeId);
  return withJob(u, assignmentId, async (tx, a) => {
    if (a.status !== "ACCEPTED" || a.transaction.status !== "IN_PROCESS" || a.processing) throw new UserError("You can change the office while you work on the job, before it is completed.");
    if (a.ltoOfficeId === office.id) throw new UserError("That is already the office.", "ltoOfficeId");
    const before = a.ltoOffice?.name ?? null;
    await tx.dpAssignment.update({ where: { id: a.id }, data: { ltoOfficeId: office.id } });
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "lto_office_changed", entityType: "DpAssignment", entityId: a.id, loanId: a.loanId, pn: a.loan.pn,
      summary: `${u.name} changed the LTO office for ${a.transaction.type.name}${before ? ` from ${before}` : ""} to ${office.name}: ${p.data.note}`,
      before: { ltoOffice: before }, after: { ltoOffice: office.name }, details: { note: p.data.note },
    });
    await notify(tx, {
      userIds: [...(await branchLaUserIds(tx, a.loan.branchId)), a.assignedById, ...(await financeIds(tx))], loanId: a.loanId,
      title: `${a.loan.pn}: ${a.transaction.type.name} LTO office changed`, body: `${u.name}: ${before ? `${before} to ` : ""}${office.name}. ${p.data.note}`, link: `/loans/${a.loan.pn}?tab=journey`,
    });
  });
}
