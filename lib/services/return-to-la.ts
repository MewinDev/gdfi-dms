import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { acceptCore, forgetJobForDp, sentBackRecipients, whoOf, withJob } from "./jobs";
import { remarksSchema } from "@/lib/ui/holds";
import { heldFor } from "./pasuyo";
import { moveDocs } from "./custody";
import { recomputeStage } from "./stage";
import { UserError } from "./errors";
import { isIncluded } from "@/lib/workflow/checklist";

type ReturnableCheck = { id: string; required: boolean; checked: boolean; includedInFile: boolean; missingState: "MISSING" | "RECEIVED_LATE" | null; missingRemarks: string | null; otherLabel: string | null; rule: { label: string } | null };
/**
 * A paper the processor may name in a return: part of the file, and not already marked Missing by the
 * LA with a reason and remarks (that paper goes through as an exception; the file can still be
 * returned for another paper). A paper the LA marked Present that is not really there can be named.
 */
export function returnRefusal(c: ReturnableCheck): string | null {
  const name = c.rule?.label ?? c.otherLabel ?? "Other paper";
  if (c.missingState === "MISSING" && c.missingRemarks) return `${name} is already marked Missing by the Loan Associate, with remarks. It goes through as an exception: return the file for another paper or reason.`;
  if (!isIncluded({ required: c.required, checked: c.checked, missing: c.missingState, included: c.includedInFile })) return `${name} is optional and not part of this file. It cannot be a reason to return the file.`;
  return null;
}
export const returnablePapers = <C extends ReturnableCheck>(checks: C[]) => checks.filter((c) => !returnRefusal(c));

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
  /** The findings: what is wrong or missing (5 to 500 characters, required). */
  note: remarksSchema,
  /**
   * Papers handed over to the LA: every paper the processor holds (received at Accept) must be
   * ticked; the LA then confirms them back before sending again. There is no "keep the papers" and no
   * "keep the cash": the job is no longer the processor's.
   */
  handedOver: z.array(z.string().trim().min(1)).default([]),
});
/** The removed choices are refused, not ignored. */
const REMOVED = "The return no longer offers \"keep the papers\" or \"keep the cash\".";
function refuseRemoved(raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.papers !== undefined || r.cash !== undefined) throw new UserError(REMOVED);
}
export type ReturnInput = z.input<typeof returnSchema>;

export async function returnToLa(u: CurrentUser, assignmentId: string, raw: ReturnInput, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.JOBS_RETURN_TO_LA)) throw new UserError("Your role does not allow returning jobs to the Loan Associate.");
  refuseRemoved(raw);
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
    for (const c of named) { const why = returnRefusal(c!); if (why) throw new UserError(why, "checkIds"); }
    if (NEEDS_PAPERS.includes(reason.code) && named.length === 0 && !d.otherPaper) throw new UserError("Pick the papers that are missing or wrong.", "checkIds");

    // Cash released for this job stays on the processor's advance as "Cash to settle": the return is
    // allowed at once and the advance is liquidated beside it (receipts for what was spent, the rest
    // returned), as for forwarding. New cash for a re-send is requested again like any new job.
    const held = await heldFor(tx, a, u.id);
    const heldCents = held.reduce((s, h) => s + h.balance, 0);
    const actor = { id: u.id, label: u.name };

    // Papers handed over: every paper with the processor (received at Accept) must be ticked.
    const withDp = a.transaction.documents.filter((x) => x.stage === "WITH_DP");
    const handed = new Set(d.handedOver);
    // (By paper, or by its checklist row: at Accept the received papers are ticked by row.)
    if (withDp.some((x) => !handed.has(x.id) && !(x.checkId && handed.has(x.checkId)))) throw new UserError("Tick every paper you hand over to the Loan Associate.", "handedOver");

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
      data: {
        status: "WITHDRAWN", returnedAt: now, closedAt: now, returnReasonId: reason.id, returnReasons: `${reason.name}${names.length ? ` (${names.join(", ")})` : ""}: ${d.note}`,
        papersHandedAt: withDp.length ? now : null,
      },
    });
    await tx.loanTransaction.update({ where: { id: a.transactionId }, data: { status: "RETURNED" } });

    // Custody: handed over to the LA, in transit until the LA confirms them back (send again waits for that).
    if (withDp.length) {
      await moveDocs(tx, withDp, { stage: "IN_TRANSIT", custodian: a.assignedBy.name, role: "LA", userId: null, location: `Handed over by DP ${a.dpUser.name} to ${a.assignedBy.name}`, action: "HANDED_TO_LA" }, { by: actor });
    }

    const laName = a.assignedBy.name;
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: "job_returned_to_la", entityType: "DpAssignment", entityId: a.id, loanId: a.loanId, pn: a.loan.pn, journeyStep: "4.1",
      summary: `${u.name} returned ${a.transaction.type.name} to ${laName}: ${reason.name}${names.length ? ` (${names.join(", ")})` : ""}`,
      details: { reason: reason.code, papers: names, note: d.note, handedOver: withDp.map((x) => x.label), cashToSettleCents: heldCents },
    });
    // Only the LA who sent it is told (in-app, and by email when the switch is on). The DP gets nothing
    // and their notifications about this job are removed: it is no longer with them.
    await forgetJobForDp(tx, a);
    const to = await sentBackRecipients(tx, a);
    await notify(tx, {
      ...(to.email ? { email: { event: "returned_to_la" as const, transactionId: a.transactionId, to: to.ids, vars: { pn: a.loan.pn, transaction: a.transaction.type.name, who: u.name, reason: `${reason.name}${names.length ? ` (${names.join(", ")})` : ""}. ${d.note}` } } } : {}),
      userIds: to.ids,
      loanId: a.loanId, title: `${a.loan.pn}: ${a.transaction.type.name} returned by the processor`,
      body: `${u.name}: ${reason.name}${names.length ? ` (${names.join(", ")})` : ""}. ${d.note}${withDp.length ? ` Confirm the ${withDp.length} paper${withDp.length === 1 ? "" : "s"} handed over before sending again.` : ""}${to.note}`, link: `/loans/${a.loan.pn}?tab=todo&tx=${a.transaction.type.code}`,
    });
    await recomputeStage(tx, a.loanId);
    return { names, heldCents };
  });
}

/**
 * At Accept, the processor has fewer papers than were ticked: accept the papers that arrived (one
 * "Received by the processor" movement each), note the others as not received, then the existing
 * Return to LA with those papers named.
 */
export async function acceptWithMissing(u: CurrentUser, assignmentId: string, raw: ReturnInput, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.JOBS_RETURN_TO_LA)) throw new UserError("Your role does not allow returning jobs to the Loan Associate.");
  const p = returnSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const missing = new Set(p.data.checkIds);
  if (!missing.size && !p.data.otherPaper) throw new UserError("Pick the papers that are missing.", "checkIds");
  await withJob(u, assignmentId, async (tx, a) => {
    const reason = await tx.returnReason.findUnique({ where: { id: p.data.reasonId } });
    if (!reason || !reason.active) throw new UserError("Pick a reason.", "reasonId");
    const checks = await tx.checklistCheck.findMany({ where: { transactionId: a.transactionId }, include: { rule: true } });
    if ([...missing].some((id) => !checks.some((c) => c.id === id))) throw new UserError("Pick papers of this transaction only.", "checkIds");
    for (const id of missing) { const why = returnRefusal(checks.find((c) => c.id === id)!); if (why) throw new UserError(why, "checkIds"); }
    const notHere = a.transaction.documents.filter((d) => d.checkId && missing.has(d.checkId) && d.stage === "IN_TRANSIT");
    // Check the hand-over before accepting, so a refusal leaves the job exactly as it was.
    const handed = new Set(p.data.handedOver);
    const received = a.transaction.documents.filter((d) => (d.stage === "IN_TRANSIT" && !notHere.includes(d)) || d.stage === "WITH_DP");
    if (received.some((d) => !handed.has(d.id) && !(d.checkId && handed.has(d.checkId)))) throw new UserError("Tick every paper you hand over to the Loan Associate.", "handedOver");
    await acceptCore(tx, { ...a, transaction: { ...a.transaction, documents: a.transaction.documents.filter((d) => !notHere.includes(d)) } }, whoOf(u));
    await moveDocs(tx, notHere, { stage: "AT_BRANCH", custodian: null, role: "LA", userId: null, location: `${a.loan.branch.name} branch`, action: "NOT_RECEIVED_BY_DP" }, { by: { id: u.id, label: u.name } });
  });
  return returnToLa(u, assignmentId, raw, now);
}
