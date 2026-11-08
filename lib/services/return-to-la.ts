import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { businessDate } from "@/lib/time";
import { peso } from "@/lib/funds/rules";
import { acceptCore, whoOf, withJob } from "./jobs";
import { heldFor } from "./pasuyo";
import { financeIds, refreshAdvance } from "./funds";
import { moveDocs, noteDocs } from "./custody";
import { recomputeStage } from "./stage";
import { UserError } from "./errors";

/**
 * Return to LA: papers needed. After accepting, the processor sends the job back to the Loan
 * Associate when a paper is missing or wrong. It reuses the existing return path (the assignment ends
 * as returned, the transaction is Returned to the LA, who re-sends it); the papers asked for are a
 * missing-paper request "asked by DP" with a Requested tag on each. It is a status change, not a
 * Problem, and the turnaround clock is neither reset nor paused.
 */

/** Reasons that must name the papers. */
export const NEEDS_PAPERS = ["MISSING", "WRONG"];

export const returnSchema = z.object({
  reasonId: z.string({ message: "Pick a reason." }).trim().min(1, "Pick a reason."),
  checkIds: z.array(z.string().trim().min(1)).default([]),
  otherPaper: z.string().trim().max(120, "Keep the paper name under 120 characters.").default(""),
  note: z.string({ message: "Write a short note." }).trim().min(3, "Write a short note (at least 3 characters).").max(500, "Keep the note under 500 characters."),
  papers: z.enum(["KEEP", "RETURN"]).default("KEEP"),
  cash: z.enum(["KEEP", "RETURN"]).nullable().default(null),
});
export type ReturnInput = z.input<typeof returnSchema>;

export async function returnToLa(u: CurrentUser, assignmentId: string, raw: ReturnInput, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.JOBS_RETURN_TO_LA)) throw new UserError("Your role does not allow returning jobs to the Loan Associate.");
  const p = returnSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const d = p.data;
  return withJob(u, assignmentId, async (tx, a) => {
    if (a.status !== "ACCEPTED" || a.transaction.status !== "IN_PROCESS" || a.processing) {
      throw new UserError("Only an accepted job that is not completed yet can be returned to the Loan Associate.");
    }
    const reason = await tx.returnReason.findUnique({ where: { id: d.reasonId } });
    if (!reason || !reason.active) throw new UserError("Pick a reason.", "reasonId");
    const checks = await tx.checklistCheck.findMany({ where: { transactionId: a.transactionId }, include: { rule: true } });
    const named = [...new Set(d.checkIds)].map((id) => checks.find((c) => c.id === id));
    if (named.some((c) => !c)) throw new UserError("Pick papers of this transaction only.", "checkIds");
    if (NEEDS_PAPERS.includes(reason.code) && named.length === 0 && !d.otherPaper) throw new UserError("Pick the papers that are missing or wrong.", "checkIds");

    // Cash held for this job: keep it for the re-send (same line, same person) or return it (Finance confirms).
    const held = await heldFor(tx, a, u.id);
    const heldCents = held.reduce((s, h) => s + h.balance, 0);
    if (heldCents > 0 && !d.cash) throw new UserError(`You hold ${peso(heldCents)} for this job. Choose: keep the cash for the re-send, or return the cash.`, "cash");
    const actor = { id: u.id, label: u.name };
    if (heldCents > 0 && d.cash === "RETURN") {
      for (const h of held) {
        await tx.cashReturn.create({ data: { advanceId: h.advanceId, lineId: h.lineId, cents: h.balance, date: businessDate(now), recordedById: u.id } });
        await refreshAdvance(tx, h.advanceId);
        await writeAudit(tx, { actor, mode: "MANUAL", action: "cash_returned", entityType: "CashAdvance", entityId: h.advanceId, loanId: a.loanId, pn: a.loan.pn, summary: `${h.number}: ${u.name} returned ${peso(h.balance)} cash when returning ${a.transaction.type.name} to the Loan Associate` });
      }
      await notify(tx, { email: { event: "cash_returned", vars: { number: a.loan.pn, who: u.name, status: "cash returned with a returned job", reason: "Confirm receipt." } }, userIds: await financeIds(tx), title: `${a.loan.pn}: cash returned`, body: `${u.name} returned ${peso(heldCents)} when returning a job to the Loan Associate. Confirm receipt.`, link: "/funds?tab=outstanding" });
    }

    // The papers asked for: the named rows are unticked again (the LA ticks them when they arrive);
    // an "Other paper" becomes a required row of its own.
    const names = named.map((c) => c!.rule?.label ?? c!.otherLabel ?? "Other paper");
    const ids = named.map((c) => c!.id);
    for (const c of named) await tx.checklistCheck.update({ where: { id: c!.id }, data: { checked: false, checkedAt: null, checkedById: null } });
    if (d.otherPaper) {
      const extra = await tx.checklistCheck.create({ data: { transactionId: a.transactionId, otherLabel: d.otherPaper, required: true, checked: false } });
      ids.push(extra.id);
      names.push(d.otherPaper);
    }
    if (ids.length) {
      const open = await tx.loanException.findMany({ where: { transactionId: a.transactionId, type: "LEGAL_DOCS_COMPLETION", status: "OPEN" } });
      for (const ex of open) await tx.loanException.update({ where: { id: ex.id }, data: { status: "RESOLVED", resolvedAt: now, resolvedByLabel: "System", resolution: "Replaced by the processor's return." } });
      await tx.loanException.create({
        data: {
          loanId: a.loanId, transactionId: a.transactionId, type: "LEGAL_DOCS_COMPLETION",
          reason: `${u.name} (processor) needs for ${a.transaction.type.name}: ${names.join("; ")}. ${reason.name}. ${d.note}`,
          details: { checkIds: ids, missing: names, askedBy: "DP", askedFrom: null, reason: reason.name, note: d.note } as Prisma.InputJsonValue,
          raisedById: u.id, raisedByLabel: u.name,
        },
      });
    }

    // The existing return path: the assignment ends as returned; the transaction is back with the LA.
    // statusSince is kept: the clock is not reset.
    await tx.dpAssignment.update({
      where: { id: a.id },
      data: { status: "WITHDRAWN", returnedAt: now, closedAt: now, returnReasonId: reason.id, returnReasons: `${reason.name}${names.length ? ` (${names.join(", ")})` : ""}: ${d.note}` },
    });
    await tx.loanTransaction.update({ where: { id: a.transactionId }, data: { status: "RETURNED" } });

    // Custody: the papers come back (in transit to the branch until the LA receives them), or stay with the processor.
    const withDp = a.transaction.documents.filter((x) => x.stage === "WITH_DP");
    if (d.papers === "RETURN") {
      await moveDocs(tx, withDp, { stage: "AT_BRANCH", custodian: null, role: "LA", userId: null, location: `${a.loan.branch.name} branch`, action: "RETURNED_BY_DP" }, { by: actor });
    } else {
      await noteDocs(tx, withDp, { action: "KEPT_BY_DP", location: `With DP ${a.dpUser.name}`, remarks: "Kept by the processor for the re-send", by: actor });
    }

    const laName = a.assignedBy.name;
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: "job_returned_to_la", entityType: "DpAssignment", entityId: a.id, loanId: a.loanId, pn: a.loan.pn, journeyStep: "4.1",
      summary: `${u.name} returned ${a.transaction.type.name} to ${laName}: ${reason.name}${names.length ? ` (${names.join(", ")})` : ""}`,
      details: { reason: reason.code, papers: names, note: d.note, keptPapers: d.papers === "KEEP", cash: heldCents ? d.cash : null },
    });
    await notify(tx, { email: { event: "returned_to_la", transactionId: a.transactionId, to: [...(await branchLaUserIds(tx, a.loan.branchId)), a.assignedById], vars: { pn: a.loan.pn, transaction: a.transaction.type.name, who: u.name, reason: `${reason.name}${names.length ? ` (${names.join(", ")})` : ""}. ${d.note}` } },
      userIds: [...(await branchLaUserIds(tx, a.loan.branchId)), a.assignedById, ...(a.secondaryDpUserId && a.secondaryDpUserId !== u.id ? [a.secondaryDpUserId] : []), ...(a.dpUserId !== u.id ? [a.dpUserId] : [])],
      loanId: a.loanId, title: `${a.loan.pn}: ${a.transaction.type.name} returned by the processor`,
      body: `${u.name}: ${reason.name}${names.length ? ` (${names.join(", ")})` : ""}. ${d.note}`, link: `/loans/${a.loan.pn}?tab=todo&tx=${a.transaction.type.code}`,
    });
    await recomputeStage(tx, a.loanId);
    return { names, heldCents };
  });
}

/**
 * At Accept, the processor has fewer papers than were ticked: accept the papers that arrived (one
 * "Received by the processor" movement each), note the others as not received, then the existing
 * Return to LA with those papers named. Labels must be confirmed on the papers received.
 */
export async function acceptWithMissing(u: CurrentUser, assignmentId: string, labels: boolean, raw: ReturnInput, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.JOBS_RETURN_TO_LA)) throw new UserError("Your role does not allow returning jobs to the Loan Associate.");
  const p = returnSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  if (!labels) throw new UserError("Tick \"Labels are on the papers I received\".", "labels");
  const missing = new Set(p.data.checkIds);
  if (!missing.size && !p.data.otherPaper) throw new UserError("Pick the papers that are missing.", "checkIds");
  await withJob(u, assignmentId, async (tx, a) => {
    const reason = await tx.returnReason.findUnique({ where: { id: p.data.reasonId } });
    if (!reason || !reason.active) throw new UserError("Pick a reason.", "reasonId");
    const checks = await tx.checklistCheck.findMany({ where: { transactionId: a.transactionId }, select: { id: true } });
    if ([...missing].some((id) => !checks.some((c) => c.id === id))) throw new UserError("Pick papers of this transaction only.", "checkIds");
    const notHere = a.transaction.documents.filter((d) => d.checkId && missing.has(d.checkId) && d.stage === "IN_TRANSIT");
    await acceptCore(tx, { ...a, transaction: { ...a.transaction, documents: a.transaction.documents.filter((d) => !notHere.includes(d)) } }, whoOf(u), true);
    await moveDocs(tx, notHere, { stage: "AT_BRANCH", custodian: null, role: "LA", userId: null, location: `${a.loan.branch.name} branch`, action: "NOT_RECEIVED_BY_DP" }, { by: { id: u.id, label: u.name } });
  });
  return returnToLa(u, assignmentId, raw, now);
}
