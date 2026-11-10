"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/auth/current-user";
import { anyStepKeys } from "@/lib/funds/access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { toCents } from "@/lib/funds/rules";
import {
  acceptJob, changeFundsFlag, completeJob, declineJob, finishStage, forwardJob, logAttempt, markOutsideControl, raiseProblem, receivePackage, resolveProblem, returnJob,
  somethingMissing, startStage, verifyPaper,
} from "@/lib/services/jobs";
import { storeEvidenceFile } from "@/lib/services/job-stages";
import {
  addReceipt, changeFundsType, closeAdvance, confirmReturn, decideAdvance, decideCarryOver, decideTopUp, grantException, recordReturn, releaseAdvance, releaseTopUp, requestAdvance, requestTopUp,
} from "@/lib/services/funds";
import { UserError } from "@/lib/services/errors";
import { passJob } from "@/lib/services/pasuyo";
import { addHoldDetails, raiseHold, resumeHold, transferHold } from "@/lib/services/holds";
import { acceptWithMissing, returnToLa } from "@/lib/services/return-to-la";
import { dpChangeLtoOffice } from "@/lib/services/lto";
import { txnName } from "@/lib/ui/plain";
import { MAX_RECEIPT_BYTES, receiptStore, sniffReceipt } from "@/lib/storage/receipts";

/** Every page that shows jobs, funds or a loan file can change after one of these. */
async function refresh(assignmentId?: string) {
  revalidatePath("/dashboard");
  revalidatePath("/jobs");
  revalidatePath("/my-funds");
  revalidatePath("/funds");
  if (assignmentId) {
    revalidatePath(`/jobs/${assignmentId}`);
    const a = await prisma.dpAssignment.findUnique({ where: { id: assignmentId }, select: { loan: { select: { pn: true } } } });
    if (a) revalidatePath(`/loans/${a.loan.pn}`);
  }
}
async function refreshTxn(transactionId: string) {
  const t = await prisma.loanTransaction.findUnique({ where: { id: transactionId }, select: { loan: { select: { pn: true } } } });
  if (t) revalidatePath(`/loans/${t.loan.pn}`);
  revalidatePath("/jobs", "layout");
  revalidatePath("/dashboard");
}
const json = (fd: FormData) => {
  try { return JSON.parse(str(fd, "json") || "{}"); } catch { throw new UserError("Something in the form could not be read. Try again."); }
};
const cents = (fd: FormData, k: string) => {
  const c = toCents(str(fd, k));
  if (c === null) throw new UserError("Enter an amount like 1,500.00.", k);
  return c;
};

// --- DP: jobs -------------------------------------------------------------------

export async function acceptJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    await acceptJob(u, id, fd.get("labels") === "on");
    await refresh(id);
    return "Accepted. The job is yours.";
  });
}

export async function declineJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    const body = { reasons: fd.getAll("reasons").map(String), remarks: str(fd, "remarks") };
    if (str(fd, "mode") === "return") await returnJob(u, id, body);
    else await declineJob(u, id, body);
    await refresh(id);
    return str(fd, "mode") === "return" ? "Returned to the Loan Associate." : "Declined. The Loan Associate was told.";
  });
}

export async function logAttemptAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    await logAttempt(u, id, json(fd));
    await refresh(id);
    return "Attempt saved.";
  });
}

export async function completeJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    const raw: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) if (!k.startsWith("$") && k !== "assignmentId") raw[k] = String(v).trim();
    if ("annotatedOrCr" in raw) raw.annotatedOrCr = raw.annotatedOrCr === "on";
    await completeJob(u, id, raw);
    await refresh(id);
    return "Completed. Forward the package to the branch next.";
  });
}

export async function forwardJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    await forwardJob(u, id, { branchId: str(fd, "branchId"), receivingLaId: str(fd, "receivingLaId"), note: str(fd, "note") });
    await refresh(id);
    return "Forwarded. The Loan Associate was told.";
  });
}

// --- DP: job stages (Start and Finish are system times; nobody types them) --------------

export async function startStageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    const row = await startStage(u, id, str(fd, "stageId"));
    await refresh(id);
    return `${row.name} started.`;
  });
}

export async function finishStageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    const raw: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("$") || k === "assignmentId" || k === "stageId") continue;
      if (typeof v === "string") raw[k] = v.trim();
      else if (v.size > 0) raw[k] = await storeEvidenceFile(v);
    }
    const row = await finishStage(u, id, str(fd, "stageId"), raw);
    await refresh(id);
    return `${row.name} done.`;
  });
}

export async function verifyPaperAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    await verifyPaper(u, id, str(fd, "stageId"), str(fd, "documentItemId"));
    await refresh(id);
    return "Received back and complete.";
  });
}

export async function somethingMissingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    await somethingMissing(u, id, str(fd, "stageId"), fd.getAll("papers").map(String), str(fd, "note"));
    await refresh(id);
    return "Problem opened: Missing paper. Resolve it when the paper is found, then verify again.";
  });
}

export async function changeFundsFlagJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    await changeFundsFlag(u, id, str(fd, "fundsNeeded") === "YES", fd.getAll("fundsKinds").map(String));
    await refresh(id);
    return "Funds flag saved.";
  });
}

// --- Problems (LA on own transactions, DP on own jobs, Admin resolves any) ---------

export async function raiseProblemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.PROBLEMS_RAISE);
    const transactionId = str(fd, "transactionId");
    await raiseProblem(u, { transactionId, reasonId: str(fd, "reasonId"), note: str(fd, "note") });
    await refreshTxn(transactionId);
    return "Problem raised. The turnaround time keeps counting.";
  });
}

export async function resolveProblemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission([PERMISSIONS.PROBLEMS_RESOLVE, PERMISSIONS.PROBLEMS_RESOLVE_ANY]);
    const p = await prisma.problem.findUnique({ where: { id: str(fd, "problemId") }, select: { transactionId: true } });
    await resolveProblem(u, str(fd, "problemId"), str(fd, "note"));
    if (p) await refreshTxn(p.transactionId);
    return "Resumed. The problem is resolved.";
  });
}

export async function outsideControlAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.PROBLEMS_OUTSIDE);
    await markOutsideControl(u, str(fd, "problemId"), str(fd, "on") === "1");
    revalidatePath("/dashboard");
    revalidatePath("/reports/tat");
    const p = await prisma.problem.findUnique({ where: { id: str(fd, "problemId") }, select: { transactionId: true } });
    if (p) await refreshTxn(p.transactionId);
    return "Saved.";
  });
}

// --- Holds (LA on own transactions, DP on own jobs, Admin resumes any) -----------------

export async function raiseHoldAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.HOLDS_RAISE);
    const transactionId = str(fd, "transactionId");
    await raiseHold(u, { transactionId, reasonId: str(fd, "reasonId"), note: str(fd, "note") });
    await refreshTxn(transactionId);
    const t = await prisma.loanTransaction.findUnique({ where: { id: transactionId }, select: { type: { select: { code: true, name: true } }, holds: { where: { resumedAt: null }, select: { reason: { select: { name: true } } } } } });
    return `${t ? txnName(t.type.code, t.type.name) : "It"} put on hold: ${t?.holds[0]?.reason.name ?? "on hold"}`;
  });
}

export async function resumeHoldAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.HOLDS_RESOLVE); // and only the holder (checked in resumeHold)
    const h = await prisma.hold.findUnique({ where: { id: str(fd, "holdId") }, select: { transactionId: true, transaction: { select: { type: { select: { code: true, name: true } } } } } });
    await resumeHold(u, str(fd, "holdId"), str(fd, "note"));
    if (h) await refreshTxn(h.transactionId);
    return `${h ? txnName(h.transaction.type.code, h.transaction.type.name) : "It"} resumed`;
  });
}

/** Older hold without remarks: the person who put it on hold (or Admin) adds them. */
export async function addHoldDetailsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.HOLDS_RESOLVE); // and only the holder (checked in addHoldDetails)
    const h = await prisma.hold.findUnique({ where: { id: str(fd, "holdId") }, select: { transactionId: true } });
    await addHoldDetails(u, str(fd, "holdId"), str(fd, "note"));
    if (h) await refreshTxn(h.transactionId);
    return "Details added";
  });
}

/** A supervisor or Admin gives the hold to another owner (never resumes it). */
export async function transferHoldAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.HOLDS_TRANSFER);
    const holdId = str(fd, "holdId");
    const h = await prisma.hold.findUnique({ where: { id: holdId }, select: { transactionId: true } });
    await transferHold(u, holdId, str(fd, "toUserId"), str(fd, "note"));
    if (h) await refreshTxn(h.transactionId);
    const t = await prisma.hold.findUnique({ where: { id: holdId }, select: { ownerLabel: true } });
    return `Hold transferred to ${t?.ownerLabel ?? "the new owner"}`;
  });
}

// --- The processor changes the LTO office (the real office differs) ------------------------

export async function dpChangeLtoOfficeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    await dpChangeLtoOffice(u, id, { ltoOfficeId: str(fd, "ltoOfficeId"), note: str(fd, "note") });
    await refresh(id);
    return "LTO office changed. The Loan Associate and Finance were told.";
  });
}

// --- Return to LA: papers needed (after accepting) ------------------------------------

export async function returnToLaAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_RETURN_TO_LA);
    const id = str(fd, "assignmentId");
    const r = await returnToLa(u, id, {
      reasonId: str(fd, "reasonId"), checkIds: fd.getAll("checkIds").map(String), otherPaper: str(fd, "otherPaper"), note: str(fd, "note"),
      handedOver: fd.getAll("handedOver").map(String),
    });
    await refresh(id);
    return `Returned to the Loan Associate${r.names.length ? `: ${r.names.join(", ")}` : ""}`;
  });
}

/** At Accept: some papers did not arrive. Accept the ones received, then Return to LA for the others. */
export async function acceptWithMissingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_WORK);
    const id = str(fd, "assignmentId");
    const r = await acceptWithMissing(u, id, fd.get("labels") === "on", {
      reasonId: str(fd, "reasonId"), checkIds: fd.getAll("checkIds").map(String), otherPaper: str(fd, "otherPaper"), note: str(fd, "note"),
      handedOver: fd.getAll("handedOver").map(String),
    });
    await refresh(id);
    return `Accepted the papers received and returned to the Loan Associate for: ${r.names.join(", ")}`;
  });
}

// --- Phase 5: the receiving LA ------------------------------------------------------

export async function receivePackageAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.RETURNS_ACCEPT);
    const id = str(fd, "assignmentId");
    const result = str(fd, "result") as "complete" | "incomplete" | "other";
    await receivePackage(u, id, { result, note: str(fd, "note"), blocking: fd.get("blocking") === "on" });
    await refresh(id);
    return result === "complete" || (result === "other" && fd.get("blocking") !== "on")
      ? "Received. The transaction is complete."
      : "Recorded as incomplete. The processor was told and will correct it and forward again.";
  });
}

// --- Funds: DP ----------------------------------------------------------------------

export async function requestAdvanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.FUNDS_REQUEST);
    const r = await requestAdvance(u, json(fd));
    await refresh();
    return `${r.number} sent to Finance for approval.`;
  });
}

export async function requestTopUpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.FUNDS_REQUEST);
    await requestTopUp(u, str(fd, "lineId"), cents(fd, "extra"), str(fd, "reason"));
    await refresh();
    return "Top-up sent for approval.";
  });
}

export async function addReceiptAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.FUNDS_LIQUIDATE);
    const f = fd.get("file");
    let file: { key: string; name: string; mime: string } | null = null;
    if (f instanceof File && f.size > 0) {
      if (f.size > MAX_RECEIPT_BYTES) throw new UserError("The file is over 5 MB. Take a smaller photo or scan.", "file");
      const bytes = new Uint8Array(await f.arrayBuffer());
      const kind = sniffReceipt(bytes);
      if (!kind) throw new UserError("Upload a photo (JPG, PNG, WEBP) or a PDF.", "file");
      file = { key: await receiptStore.put(bytes, kind.ext), name: f.name.slice(0, 120), mime: kind.mime };
    }
    await addReceipt(u, { lineId: str(fd, "lineId"), date: str(fd, "date"), cents: cents(fd, "amount"), number: str(fd, "number") }, file);
    await refresh();
    return "Receipt added.";
  });
}

export async function recordReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.FUNDS_LIQUIDATE);
    await recordReturn(u, str(fd, "advanceId"), cents(fd, "amount"), str(fd, "date"));
    await refresh();
    return "Cash return recorded. Finance will confirm it.";
  });
}

// --- Funds: Finance -----------------------------------------------------------------

export async function decideAdvanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission(anyStepKeys("approve"));
    const approve = str(fd, "decision") === "approve";
    const lines = fd.getAll("lineId").map(String).map((lineId) => {
      const c = toCents(str(fd, `amount-${lineId}`));
      if (c === null) throw new UserError("Enter each approved amount (0 to reject a line).", `amount-${lineId}`);
      return { lineId, cents: c };
    });
    await decideAdvance(u, str(fd, "advanceId"), { approve, lines: approve ? lines : [], note: str(fd, "note") });
    await refresh();
    return approve ? "Approved. It is now waiting for release." : "Denied. The processor and Loan Associates were told.";
  });
}

export async function releaseAdvanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission(anyStepKeys("release"));
    await releaseAdvance(u, str(fd, "advanceId"), releaseFields(fd));
    await refresh();
    return "Done. The jobs are Funded.";
  });
}

export async function decideTopUpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission(anyStepKeys("approve"));
    const approve = str(fd, "decision") === "approve";
    await decideTopUp(u, str(fd, "topUpId"), approve, approve && str(fd, "amount") ? cents(fd, "amount") : null, str(fd, "note"));
    await refresh();
    return approve ? "Top-up approved." : "Top-up denied.";
  });
}

export async function releaseTopUpAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission(anyStepKeys("release"));
    await releaseTopUp(u, str(fd, "topUpId"), { ...releaseFields(fd), fundsTypeId: str(fd, "fundsTypeId") || undefined, remarks: str(fd, "remarks") });
    await refresh();
    return "Top-up done.";
  });
}

/** What Finance typed at release (the service checks which fields the funds type needs). */
function releaseFields(fd: FormData) {
  return { ref: str(fd, "ref"), transferDate: str(fd, "transferDate"), accountProvider: str(fd, "accountProvider"), accountName: str(fd, "accountName"), accountLast4: str(fd, "accountLast4") };
}

/** Finance changes the funds type before the release (remarks 5 to 500 characters). */
export async function changeFundsTypeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission(anyStepKeys("changeType"));
    await changeFundsType(u, str(fd, "advanceId"), { fundsTypeId: str(fd, "fundsTypeId"), remarks: str(fd, "remarks") });
    await refresh();
    return "Type changed. It is in the history.";
  });
}

export async function decideCarryOverAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission(anyStepKeys("approve"));
    const approve = str(fd, "decision") === "approve";
    await decideCarryOver(u, str(fd, "carryId"), approve);
    await refresh();
    return approve ? "Carry-over approved." : "Carry-over denied. The processor will return the cash.";
  });
}

export async function confirmReturnAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission(anyStepKeys("settle"));
    await confirmReturn(u, str(fd, "returnId"));
    await refresh();
    return "Returned cash confirmed.";
  });
}

export async function closeAdvanceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requireAnyPermission(anyStepKeys("settle"));
    await closeAdvance(u, str(fd, "advanceId"));
    await refresh();
    return "Advance closed.";
  });
}

export async function grantExceptionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.FUNDS_EXCEPTION);
    await grantException(u, str(fd, "dpUserId"), str(fd, "note"));
    await refresh();
    return "Exception granted for one more request.";
  });
}

// --- Pasuyo: pass a job to a second processor -----------------------------------------

export async function passJobAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.JOBS_PASUYO);
    const id = str(fd, "assignmentId");
    const funds = str(fd, "funds");
    const r = await passJob(u, id, { toUserId: str(fd, "toUserId"), reason: str(fd, "reason"), note: str(fd, "note"), funds: funds === "RETURN" || funds === "HAND" ? funds : null });
    await refresh(id);
    return `Passed to ${r.to} (second processor, Pasuyo).`;
  });
}
