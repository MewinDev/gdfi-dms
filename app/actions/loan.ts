"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { can, getCurrentUser, requirePermission } from "@/lib/auth/current-user";
import { listLoans } from "@/lib/services/queries";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, strOrNull, type ActionState } from "@/lib/action";
import { openLoanFile, refreshFromMyLoans } from "@/lib/services/loan-file";
import {
  addCustomTransaction,
  assignToDp,
  completeLaTransaction,
  confirmPapersBack,
  markLabelsPrinted,
  overrideAutomaticResult,
  reportProblem,
  recordEdst,
  laSetFundsFlag,
  requestMissingDocuments,
  resolveException,
  saveChecklist,
} from "@/lib/services/workflow";
import { simulate, type SimAction } from "@/lib/services/simulator";
import { UserError } from "@/lib/services/errors";
import { raiseHold } from "@/lib/services/holds";
import { addProcessorNote, changeProcessor, pullBack } from "@/lib/services/sent-changes";
import { laChangeLtoOffice } from "@/lib/services/lto";

async function pnOfLoan(loanId: string) {
  return (await prisma.loan.findUnique({ where: { id: loanId }, select: { pn: true } }))?.pn;
}
async function pnOfTxn(transactionId: string) {
  return (await prisma.loanTransaction.findUnique({ where: { id: transactionId }, select: { loan: { select: { pn: true } } } }))?.loan.pn;
}
function revalidateLoan(pn?: string) {
  if (pn) revalidatePath(`/loans/${pn}`);
}

// --- Phase 1: Open Loan File -------------------------------------------------

export async function openLoanFileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let target: string | null = null;
  const state = await runAction(async () => {
    const user = await requirePermission(PERMISSIONS.LOANS_OPEN);
    const ft = strOrNull(fd, "financingType");
    const orcr = strOrNull(fd, "orcrStatus");
    if (ft && ft !== "UNDERTAKING" && ft !== "NON_UNDERTAKING") throw new UserError("Pick Undertaking or Non-Undertaking.", "financingType");
    if (orcr && orcr !== "TRANSFERRED" && orcr !== "UNTRANSFERRED") throw new UserError("Pick ORCR Transferred or Untransferred.", "orcrStatus");
    const r = await openLoanFile(user, { pn: str(fd, "pn"), financingType: ft as never, orcrStatus: orcr as never });
    target = `/loans/${r.pn}?tab=transactions${r.alreadyOpen ? "&notice=already-open" : "&notice=opened"}`;
  });
  if (state?.ok && target) redirect(target);
  return state;
}

export async function refreshLoanAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.LOANS_REFRESH);
    const loanId = str(fd, "loanId");
    const r = await refreshFromMyLoans(user, loanId);
    revalidateLoan(await pnOfLoan(loanId));
    if (!r.ok) throw new UserError(`${r.message} Work continues on the last copy.`);
    return r.changed ? "Changes found: review." : r.minor ? "MyLoans updated small details (name or address). No review needed." : "No changes.";
  });
}

// --- Phase 3 -----------------------------------------------------------------

export async function saveChecklistAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.CHECKLIST_TICK);
    const transactionId = str(fd, "transactionId");
    const r = await saveChecklist(user, {
      transactionId,
      checkedIds: fd.getAll("checked").map(String),
      newOthers: fd.getAll("newOther").map(String).filter((s) => s.trim()),
    });
    revalidateLoan(await pnOfTxn(transactionId));
    const ids = r.generated.length ? ` ${r.generated.length} Document ID(s) generated.` : "";
    return r.complete ? `Checklist saved and complete.${ids}` : `Checklist saved. Still missing: ${r.missing.join("; ")}.${ids}`;
  });
}

export async function requestMissingAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.CHECKLIST_TICK);
    const transactionId = str(fd, "transactionId");
    const from = str(fd, "askedFrom");
    const missing = await requestMissingDocuments(user, {
      transactionId, checkIds: fd.getAll("checkIds").map(String), note: str(fd, "note"),
      askedFrom: from === "BORROWER" || from === "BRANCH" || from === "OTHER" ? from : null,
    });
    let held = "";
    if (fd.get("alsoHold") === "on") {
      // A normal hold through the hold rules (permissions, one open hold, audit): a separate record.
      const reason = await prisma.holdReason.findFirst({ where: { active: true, code: { in: ["CLIENT-PAPERS", "BORROWER"] } }, orderBy: { sortOrder: "asc" } });
      try {
        if (!reason) throw new UserError("There is no active hold reason \"Waiting for the client's papers\".");
        await raiseHold(user, { transactionId, reasonId: reason.id, note: `Missing paper: ${missing.join(", ")}` });
        held = ` · On hold: ${reason.name}`;
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        held = ` · Not put on hold: ${e.message}`;
      }
    }
    revalidateLoan(await pnOfTxn(transactionId));
    return `Missing paper requested: ${missing.join(", ")}${held}`;
  });
}

export async function recordEdstAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.TXN_COMPLETE);
    const transactionId = str(fd, "transactionId");
    await recordEdst(user, { transactionId, reference: str(fd, "reference") });
    revalidateLoan(await pnOfTxn(transactionId));
    return "EDST recorded. For EDST is completed.";
  });
}

/** LA: change the funds flag (until the processor accepts). */
export async function setFundsFlagAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.FUNDS_FLAG);
    const transactionId = str(fd, "transactionId");
    await laSetFundsFlag(user, { transactionId, needed: str(fd, "fundsNeeded") === "YES", kinds: fd.getAll("fundsKinds").map(String) });
    revalidateLoan(await pnOfTxn(transactionId));
    return "Funds flag saved.";
  });
}

// --- Sent, not accepted yet: the LA can still change it -------------------------------

const refreshSent = async (transactionId: string) => {
  revalidateLoan(await pnOfTxn(transactionId));
  revalidatePath("/jobs", "layout");
  revalidatePath("/dashboard");
};

export async function changeProcessorAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.DP_SEND);
    const transactionId = str(fd, "transactionId");
    await changeProcessor(user, transactionId, { dpUserId: str(fd, "dpUserId"), secondaryDpUserId: str(fd, "secondaryDpUserId") || null, reason: str(fd, "reason") });
    await refreshSent(transactionId);
    return "Processor changed. Both processors were told.";
  });
}

export async function processorNoteAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.DP_SEND);
    const transactionId = str(fd, "transactionId");
    await addProcessorNote(user, transactionId, { note: str(fd, "note") });
    await refreshSent(transactionId);
    return "Note sent to the processor.";
  });
}

export async function changeLtoOfficeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.DP_SEND);
    const transactionId = str(fd, "transactionId");
    await laChangeLtoOffice(user, transactionId, { ltoOfficeId: str(fd, "ltoOfficeId") });
    await refreshSent(transactionId);
    return "LTO office changed. The processor was told.";
  });
}

export async function pullBackAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.DP_SEND);
    const transactionId = str(fd, "transactionId");
    await pullBack(user, transactionId, { reason: str(fd, "reason") });
    await refreshSent(transactionId);
    return "Pulled back. It is ready to send again.";
  });
}

export async function assignToDpAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.DP_SEND);
    const transactionId = str(fd, "transactionId");
    await assignToDp(user, {
      transactionId,
      dpBranchId: str(fd, "dpBranchId"),
      dpUserId: str(fd, "dpUserId"),
      ltoOfficeId: strOrNull(fd, "ltoOfficeId"),
      fundsNeeded: (str(fd, "fundsNeeded") || null) as "YES" | "NO" | null,
      fundsKinds: fd.getAll("fundsKinds").map(String),
      beyondTatReason: strOrNull(fd, "beyondTatReason"),
      pasuyo: fd.get("pasuyo") === "on",
      secondaryDpUserId: strOrNull(fd, "secondaryDpUserId"),
      pasuyoReason: strOrNull(fd, "pasuyoReason"),
    });
    revalidateLoan(await pnOfTxn(transactionId));
    return "Assigned to DP. The DP has been notified in-app and by email.";
  });
}

export async function markLabelsPrintedAction(ids: string[]): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.LABELS_PRINT);
    await markLabelsPrinted(user, ids);
    return "Labels marked as printed.";
  });
}

export async function resolveExceptionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.CHECKLIST_TICK);
    const exceptionId = str(fd, "exceptionId");
    await resolveException(user, { exceptionId, resolution: str(fd, "resolution") });
    const ex = await prisma.loanException.findUnique({ where: { id: exceptionId }, select: { loan: { select: { pn: true } } } });
    revalidateLoan(ex?.loan.pn);
    return "Exception resolved.";
  });
}

// --- Supervisor override (Admin for now) ---------------------------------------

export async function overrideAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.RULES_OVERRIDE);
    const loanId = str(fd, "loanId");
    await overrideAutomaticResult(user, {
      loanId,
      classification: str(fd, "classification") as "FINANCING",
      financingType: strOrNull(fd, "financingType") as never,
      orcrStatus: strOrNull(fd, "orcrStatus") as never,
      mortgage: strOrNull(fd, "mortgage") as never,
      reason: str(fd, "reason"),
    });
    revalidateLoan(await pnOfLoan(loanId));
    return "Override applied and audited.";
  });
}

// --- Test simulator ------------------------------------------------------------

export async function simulateAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.SIMULATOR_USE);
    const loanId = str(fd, "loanId");
    await simulate(user, { loanId, action: str(fd, "action") as SimAction, targetId: strOrNull(fd, "targetId") ?? undefined });
    revalidateLoan(await pnOfLoan(loanId));
    return "Simulated event recorded.";
  });
}

// --- Notifications ---------------------------------------------------------------

export async function addTransactionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.TXN_ADD);
    const loanId = str(fd, "loanId");
    await addCustomTransaction(user, { loanId, typeId: str(fd, "typeId") });
    revalidatePath(`/loans/${await pnOfLoan(loanId)}`);
    return "Transaction added. Tick its papers below.";
  });
}

export async function completeLaTransactionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.TXN_COMPLETE);
    const transactionId = str(fd, "transactionId");
    await completeLaTransaction(user, { transactionId });
    revalidatePath(`/loans/${await pnOfTxn(transactionId)}`);
    return "Marked as done.";
  });
}

export async function markNotificationsReadAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
}

export async function reportProblemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.CHECKLIST_TICK);
    const loanId = str(fd, "loanId");
    await reportProblem(user, { loanId, kind: str(fd, "kind") as "OTHER", details: str(fd, "details") });
    revalidateLoan(await pnOfLoan(loanId));
    return "Problem reported. Your supervisor has been told.";
  });
}

/** "Show results (N)" in the Filters panel: how many loan files the chosen filters would show. Read-only. */
export async function countLoansAction(fd: FormData): Promise<number | null> {
  const user = await getCurrentUser();
  if (!user || !can(user, PERMISSIONS.LOANS_VIEW)) return null;
  const v = (k: string) => (typeof fd.get(k) === "string" && fd.get(k) ? String(fd.get(k)) : undefined);
  const rows = await listLoans(user, { tab: v("tab") ?? "queue", stage: v("stage"), classification: v("classification"), branch: v("branch"), loanType: v("loanType"), tat: v("tat"), needsAction: v("needsAction"), q: v("q") });
  return rows.length;
}

/** The LA confirms the papers the processor handed over with a Return to LA (some may be "Not received"). */
export async function confirmPapersBackAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.CHECKLIST_TICK);
    const transactionId = str(fd, "transactionId");
    const r = await confirmPapersBack(user, { transactionId, notReceived: fd.getAll("notReceived").map(String) });
    revalidateLoan(await pnOfTxn(transactionId));
    return r.notReceived.length
      ? `Papers confirmed: ${r.received} received. Not received: ${r.notReceived.join(", ")} (a problem was raised).`
      : `Papers confirmed: all ${r.received} received. You can send it again.`;
  });
}
