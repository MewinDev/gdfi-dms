import "server-only";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { adminIds, ownsTransaction } from "./jobs";
import { currentStageIdFor } from "./job-stages";
import { NotInScopeError, UserError } from "./errors";

/**
 * Holds: a transaction waits on something that is not a fault (the borrower, another team, an LTO
 * appointment). Separate from problems; a hold and a problem may both be open (the problem wins for
 * colour). The TAT clock never pauses: a hold only changes the state and has its own timer.
 * Only one open hold per transaction (also a unique index in the database). One audit row per action.
 */

export const holdSchema = z.object({
  transactionId: z.string().trim().min(1),
  reasonId: z.string({ message: "Pick a reason." }).trim().min(1, "Pick a reason."),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").default(""),
});
export type HoldInput = z.input<typeof holdSchema>;

const firstIssue = (e: z.ZodError) => { const i = e.issues[0]; return new UserError(i.message, String(i.path[0] ?? "")); };

async function notifyHold(tx: Tx, t: { loanId: string; loan: { pn: string; branchId: string }; type: { name: string } }, what: "started" | "ended", text: string) {
  const la = await branchLaUserIds(tx, t.loan.branchId);
  await notify(tx, {
    email: { event: "hold_changed", to: la, vars: { pn: t.loan.pn, transaction: t.type.name, status: what === "started" ? "put on hold" : "resumed", reason: text } },
    userIds: [...la, ...(await adminIds(tx))], loanId: t.loanId,
    title: `${t.loan.pn}: ${t.type.name} ${what === "started" ? "put on hold" : "resumed"}`,
    body: text, link: `/loans/${t.loan.pn}?tab=journey`,
  });
}

/** Resume remarks: required, at least 3 characters. */
export const resumeSchema = z.object({
  note: z.string({ message: "Write the resume remarks." }).trim().min(3, "Write the resume remarks (at least 3 characters).").max(500, "Keep the remarks under 500 characters."),
});

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
        jobStageId, loanId: t.loanId, transactionId: t.id, reasonId: reason.id, note: d.note, raisedById: u.id, raisedByLabel: u.name, raisedAt: now },
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

/** Resume: the person who does the work (own holds), or anyone with "Resume any hold". Remarks are required; time and person are recorded by the server. */
export async function resumeHold(u: CurrentUser, holdId: string, note: string, now: Date = new Date()) {
  const h = await prisma.hold.findUnique({ where: { id: holdId }, include: { reason: true, transaction: { include: { type: true, loan: true } } } });
  if (!h || !inScope(u, h.transaction.loan.branchId)) throw new NotInScopeError();
  if (h.resumedAt) throw new UserError("This hold has already ended.");
  const any = can(u, PERMISSIONS.HOLDS_RESOLVE_ANY);
  if (!any && !(can(u, PERMISSIONS.HOLDS_RESOLVE) && (await ownsTransaction(u, h.transaction)))) throw new UserError("You can resume only holds on work you do.");
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
      summary: `${t.type.name} resumed after hold (${h.reason.name}): ${text}`,
    });
    await notifyHold(tx, { loanId: t.loanId, loan: t.loan, type: t.type }, "ended", `${u.name} resumed it: ${text}`);
  });
}

/** A finished transaction cannot stay on hold: its open hold ends with it (System, same record). */
export async function endHoldsOnCompletion(tx: Tx, t: { id: string; loanId: string; pn: string; name: string }, simulated: boolean, now: Date = new Date()) {
  const open = await tx.hold.findMany({ where: { transactionId: t.id, resumedAt: null }, include: { reason: true } });
  for (const h of open) {
    await tx.hold.update({ where: { id: h.id }, data: { resumedAt: now, resumedByLabel: "System", resumeNote: "Ended when the transaction was completed." } });
    await writeAudit(tx, {
      actor: { id: null, label: "System" }, mode: simulated ? "SIMULATED" : "AUTOMATIC", action: "hold_ended", entityType: "Hold", entityId: h.id, loanId: t.loanId, pn: t.pn,
      summary: `${simulated ? "Simulated: " : ""}${t.name} hold (${h.reason.name}) ended when the transaction was completed`,
    });
  }
}
