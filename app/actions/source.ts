"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, strOrNull, type ActionState } from "@/lib/action";
import {
  applySourceChange, askCashBack, closeAsCancelled, copyReusablePapers, keepCurrent, linkFromRelated, linkReplacement, moveCashToNewPn,
  runSyncNow, saveSyncSettings, setMyLoansPaused, simulateSourceChange, SIM_SOURCE_KINDS, type SimSourceKind,
} from "@/lib/services/source-sync";
import { UserError } from "@/lib/services/errors";
import { acceptBorrowerCorrection, keepBorrowerCurrent } from "@/lib/services/borrower-review";

async function revalidateItem(id: string) {
  const it = await prisma.sourceChange.findUnique({ where: { id }, select: { loan: { select: { pn: true, replacedByPn: true, replacesPn: true } } } });
  for (const pn of [it?.loan.pn, it?.loan.replacedByPn, it?.loan.replacesPn]) if (pn) revalidatePath(`/loans/${pn}`);
  revalidatePath("/dashboard");
}

/** Apply, Keep current, Close as cancelled, Return the cash, Link, Move: one form, the pressed button decides. */
export async function sourceDecisionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SOURCE_REVIEW);
    const id = str(fd, "changeId");
    const what = str(fd, "$decision");
    let msg: string;
    if (what === "apply") {
      await applySourceChange(u, id, { note: str(fd, "note"), financingType: strOrNull(fd, "financingType"), orcrStatus: strOrNull(fd, "orcrStatus") });
      msg = "Change applied.";
    } else if (what === "keep") {
      await keepCurrent(u, id, str(fd, "note"));
      msg = "Kept the current setup.";
    } else if (what === "close") {
      await closeAsCancelled(u, id, str(fd, "note"));
      msg = "Closed as cancelled.";
    } else if (what === "cash") {
      await askCashBack(u, id, str(fd, "note"));
      msg = "Asked the processor to return the cash. Finance confirms it.";
    } else if (what === "link") {
      await linkReplacement(u, id, { newPn: str(fd, "newPn"), note: str(fd, "note"), confirmNoPayment: fd.get("confirmNoPayment") === "on", overrideNote: str(fd, "overrideNote") });
      msg = "Linked as the replacement.";
    } else if (what.startsWith("move:")) {
      const r = await moveCashToNewPn(u, id, what.slice(5));
      msg = `${r.number} waits for approval (the same approval band as a new request).`;
    } else {
      throw new UserError("Pick what to do.");
    }
    await revalidateItem(id);
    return msg;
  });
}

/** Borrower details correction: Accept the correction or Keep current (myloans:review_borrower, the loan's branch). */
export async function borrowerDecisionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SOURCE_REVIEW_BORROWER);
    const id = str(fd, "changeId");
    const what = str(fd, "$decision");
    let msg: string;
    if (what === "accept") {
      await acceptBorrowerCorrection(u, id, str(fd, "note"));
      msg = "Correction accepted. The loan shows the MyLoans details now.";
    } else if (what === "keep") {
      await keepBorrowerCurrent(u, id, str(fd, "note"));
      msg = "Kept the DMS details.";
    } else {
      throw new UserError("Pick what to do.");
    }
    await revalidateItem(id);
    revalidatePath("/loans");
    return msg;
  });
}

/** Related loans: link an unusual case by hand (confirmation and a note). */
export async function linkRelatedAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SOURCE_REVIEW);
    const loanId = str(fd, "loanId");
    await linkFromRelated(u, loanId, str(fd, "otherPn"), { note: str(fd, "note"), confirmNoPayment: fd.get("confirmNoPayment") === "on", overrideNote: str(fd, "overrideNote") });
    const l = await prisma.loan.findUnique({ where: { id: loanId }, select: { pn: true } });
    if (l) revalidatePath(`/loans/${l.pn}`);
    revalidatePath(`/loans/${str(fd, "otherPn")}`);
    return "Linked as replacement.";
  });
}

export async function copyPapersAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SOURCE_REVIEW);
    const loanId = str(fd, "loanId");
    const n = await copyReusablePapers(u, loanId, fd.getAll("checkIds").map(String));
    const l = await prisma.loan.findUnique({ where: { id: loanId }, select: { pn: true, replacesPn: true } });
    if (l) { revalidatePath(`/loans/${l.pn}`); if (l.replacesPn) revalidatePath(`/loans/${l.replacesPn}`); }
    return `${n} paper${n === 1 ? "" : "s"} copied.`;
  });
}

export async function syncSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SOURCE_MANAGE);
    await saveSyncSettings(u, {
      refreshOnOpenMinutes: str(fd, "refreshOnOpenMinutes"), refreshOnFindHours: str(fd, "refreshOnFindHours"), backgroundMinutes: str(fd, "backgroundMinutes"),
      businessHoursOnly: fd.get("businessHoursOnly") === "on", maxPerRun: str(fd, "maxPerRun"), pauseMs: str(fd, "pauseMs"),
      tierA: str(fd, "tierA"), tierB: str(fd, "tierB"), tierC: str(fd, "tierC"), hourlyCeiling: str(fd, "hourlyCeiling"), replacementWindowDays: str(fd, "replacementWindowDays"),
    });
    revalidatePath("/admin/settings");
    return "Saved.";
  });
}

/** Pause MyLoans calls on or off (myloans:manage). */
export async function pauseMyLoansAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SOURCE_MANAGE);
    const on = str(fd, "paused") === "on";
    await setMyLoansPaused(u, on);
    revalidatePath("/admin/settings");
    return on ? "MyLoans calls are paused." : "MyLoans calls are back on.";
  });
}

export async function runSyncNowAction(): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.MYLOANS_SYNC);
    const r = await runSyncNow(u);
    revalidatePath("/admin/settings");
    if (!r.ran) return r.reason;
    if (r.status === "paused") return "Paused: hourly limit reached. The next hour continues.";
    return `Checked ${r.checked} loan${r.checked === 1 ? "" : "s"}: ${r.changes} with changes, ${r.calls} call${r.calls === 1 ? "" : "s"} to MyLoans${r.failed ? `, ${r.failed} not answered` : ""}.`;
  });
}

export async function simulateSourceAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SIMULATOR_USE);
    const kind = str(fd, "kind") as SimSourceKind;
    if (!SIM_SOURCE_KINDS.includes(kind)) throw new UserError("Pick a change to simulate.");
    const loanId = str(fd, "loanId");
    const msg = await simulateSourceChange(u, loanId, kind);
    const l = await prisma.loan.findUnique({ where: { id: loanId }, select: { pn: true } });
    if (l) revalidatePath(`/loans/${l.pn}`);
    return `Simulated: ${msg}`;
  });
}
