import "server-only";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { businessDate } from "@/lib/time";
import { OPEN_ADVANCE, peso } from "@/lib/funds/rules";
import { lineTotals, withJob, type AssignmentFull } from "./jobs";
import { financeIds, nextNumber, refreshAdvance } from "./funds";
import { UserError } from "./errors";
import { noteDocs } from "./custody";

/**
 * Pasuyo: a second processor works a job for the processor it was sent to. The first processor stays
 * the accountable assignee (Jobs, TAT, notices); the second processor can see and work the job.
 * Passing never resets or pauses the TAT clock. History is append-only (PasuyoEvent).
 */

export const pasuyoSchema = z.object({
  toUserId: z.string().trim().min(1, "Pick the second processor."),
  reason: z.string().trim().min(3, "Tell us why a second processor is needed.").max(300),
  note: z.string().trim().max(500).default(""),
  /** Cash the passing processor holds for this job: return it to Finance, or hand it to the second processor. */
  funds: z.enum(["RETURN", "HAND"]).nullable().default(null),
});
export type PasuyoInput = z.infer<typeof pasuyoSchema>;

/** Released, unliquidated cash the person holds for this job (per line, after spends and returns). */
export async function heldFor(db: Tx | typeof prisma, a: Pick<AssignmentFull, "transaction">, userId: string) {
  const out: { lineId: string; advanceId: string; number: string; kind: string; balance: number; dueAt: Date | null }[] = [];
  for (const l of a.transaction.advanceLines) {
    if (l.denied || l.releasedCents <= 0 || l.advance.requestedById !== userId || !OPEN_ADVANCE.includes(l.advance.status)) continue;
    const { balance } = await lineTotals(db, l.id);
    if (balance > 0) out.push({ lineId: l.id, advanceId: l.advanceId, number: l.advance.number, kind: l.kind, balance, dueAt: l.advance.liquidationDueAt });
  }
  return out;
}

/** The DP passes the job to a second processor (Pasuyo). One audit row per action; notices to the second processor, the branch LAs and (for a handover) Finance. */
export async function passJob(u: CurrentUser, assignmentId: string, raw: unknown, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.JOBS_PASUYO)) throw new UserError("Your role does not allow passing a job to a second processor.");
  const p = pasuyoSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const d = p.data;
  return withJob(u, assignmentId, async (tx, a) => {
    if (a.status !== "ACCEPTED" || a.transaction.status !== "IN_PROCESS" || a.processing) {
      throw new UserError("A job can be passed on only while it is accepted and in process, before it is completed or forwarded.");
    }
    const to = await tx.user.findFirst({ where: { id: d.toUserId, active: true, role: { active: true, permissions: { has: PERMISSIONS.DP_RECEIVE } } }, select: { id: true, name: true, branches: { select: { branchId: true } } } });
    if (!to) throw new UserError("Pick an active processor.", "toUserId");
    if (to.id === u.id || to.id === a.dpUserId || to.id === a.secondaryDpUserId) throw new UserError("Pick a processor other than the current one.", "toUserId");

    const held = await heldFor(tx, a, u.id);
    const heldCents = held.reduce((s, h) => s + h.balance, 0);
    if (heldCents > 0 && !d.funds) throw new UserError(`You hold ${peso(heldCents)} for this job. Choose: return the cash, or hand the balance to the second processor.`, "funds");
    const date = businessDate(now);
    const actor = { id: u.id, label: u.name };

    for (const h of held) {
      if (d.funds === "RETURN") {
        await tx.cashReturn.create({ data: { advanceId: h.advanceId, lineId: h.lineId, cents: h.balance, date, recordedById: u.id } });
        await refreshAdvance(tx, h.advanceId);
        await writeAudit(tx, { actor, mode: "MANUAL", action: "cash_returned", entityType: "CashAdvance", entityId: h.advanceId, loanId: a.loanId, pn: a.loan.pn, summary: `${h.number}: ${u.name} returned ${peso(h.balance)} cash before passing ${a.transaction.type.name} to ${to.name} (Pasuyo)` });
        await notify(tx, { email: { event: "cash_returned", vars: { number: h.number, who: u.name, status: "cash returned before passing a job (Pasuyo)", reason: "Confirm receipt." } }, userIds: await financeIds(tx), title: `${h.number}: cash returned`, body: `${u.name} returned ${peso(h.balance)} before passing a job (Pasuyo). Confirm receipt.`, link: "/funds?tab=outstanding" });
      } else {
        // The balance moves to the second processor on a new advance (released, same due date); the old line shows it as handed over.
        const number = await nextNumber(tx, now);
        const branchId = to.branches[0]?.branchId ?? a.dpBranchId;
        const adv = await tx.cashAdvance.create({
          data: {
            number, requestedById: to.id, branchId, status: "RELEASED", requestedCents: h.balance, approvedCents: h.balance, releasedCents: h.balance,
            approvedAt: now, releasedAt: now, releaseRef: `Pasuyo from ${h.number}`, liquidationDueAt: h.dueAt,
            note: `Handed over from ${h.number} by ${u.name} (Pasuyo) for ${a.loan.pn} ${a.transaction.type.name}.`,
            lines: { create: { transactionId: a.transactionId, kind: h.kind as never, requestedCents: h.balance, approvedCents: h.balance, releasedCents: h.balance, note: `Handed over from ${h.number}` } },
          },
          include: { lines: true },
        });
        await tx.cashReturn.create({ data: { advanceId: h.advanceId, lineId: h.lineId, cents: h.balance, date, recordedById: u.id, kind: "HANDOVER", toLineId: adv.lines[0].id, confirmedById: u.id, confirmedAt: now } });
        const old = await tx.cashAdvance.findUniqueOrThrow({ where: { id: h.advanceId } });
        await tx.cashAdvance.update({ where: { id: h.advanceId }, data: { note: `${old.note ? `${old.note} ` : ""}${peso(h.balance)} handed to ${to.name} (${number}, Pasuyo).` } });
        await refreshAdvance(tx, h.advanceId);
        await writeAudit(tx, {
          actor, mode: "MANUAL", action: "advance_handed_over", entityType: "CashAdvance", entityId: h.advanceId, loanId: a.loanId, pn: a.loan.pn,
          summary: `${h.number}: ${u.name} handed ${peso(h.balance)} for ${a.transaction.type.name} to ${to.name} (Pasuyo); now on ${number}`,
          after: { from: h.number, to: number, cents: h.balance, toUser: to.name },
        });
        await notify(tx, { email: { event: "cash_returned", vars: { number: h.number, who: u.name, status: "balance handed over (Pasuyo)", reason: `Now on ${number}.` } }, userIds: await financeIds(tx), title: `${h.number}: balance handed over (Pasuyo)`, body: `${u.name} handed ${peso(h.balance)} to ${to.name}. It is now on ${number}.`, link: "/funds?tab=outstanding" });
      }
    }

    const from = a.secondaryDpUserId === u.id ? { id: u.id, name: u.name } : { id: a.dpUserId, name: a.dpUser.name };
    await tx.dpAssignment.update({ where: { id: a.id }, data: { secondaryDpUserId: to.id, pasuyoReason: d.reason } });
    // Custody trail: the papers go with the job to the second processor (the first stays accountable).
    await noteDocs(tx, a.transaction.documents.filter((x) => x.stage === "WITH_DP"), { action: "PASSED_TO_SECOND_PROCESSOR", location: `With second processor ${to.name}`, remarks: `Pasuyo: ${d.reason}`, by: actor });
    await tx.pasuyoEvent.create({
      data: { assignmentId: a.id, fromUserId: u.id, fromLabel: u.name, toUserId: to.id, toLabel: to.name, byUserId: u.id, byLabel: u.name, reason: d.reason, note: d.note, funds: !held.length ? "NONE" : d.funds === "RETURN" ? "RETURNED" : "HANDED" },
    });
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: "job_passed_pasuyo", entityType: "DpAssignment", entityId: a.id, loanId: a.loanId, pn: a.loan.pn, journeyStep: "4.1",
      summary: `${u.name} passed ${a.transaction.type.name} to ${to.name} (second processor, Pasuyo): ${d.reason}`,
      before: { secondary: a.secondaryDpUser?.name ?? null }, after: { secondary: to.name, from: from.name, funds: d.funds, heldCents },
    });
    await notify(tx, { email: { event: "pasuyo_passed", transactionId: a.transactionId, vars: { pn: a.loan.pn, transaction: a.transaction.type.name, who: u.name, reason: `Reason: ${d.reason}` } },
      userIds: [to.id, ...(await branchLaUserIds(tx, a.loan.branchId))], loanId: a.loanId,
      title: `${a.loan.pn}: ${a.transaction.type.name} passed to ${to.name} (Pasuyo)`,
      body: `${u.name} passed the job to ${to.name}. Reason: ${d.reason}${heldCents && d.funds === "HAND" ? ` ${peso(heldCents)} cash came with it.` : ""}`,
      link: `/jobs/${a.id}`,
    });
    return { to: to.name, heldCents };
  });
}
