"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { copyReusablePapers, linkFromRelated, setMyLoansPaused, simulateSourceChange, SIM_SOURCE_KINDS, type SimSourceKind } from "@/lib/services/source-sync";
import { UserError } from "@/lib/services/errors";
import { runSyncNow, saveSyncSettings } from "@/lib/services/myloans-sync";

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
    await saveSyncSettings(u, Object.fromEntries(["refreshOnOpenMinutes", "refreshOnFindHours", "hourlyCeiling", "intervalMinutes", "catchUpTime", "catchUpHours", "alertAfterFailedRuns", "goLiveDate", "cutoffDate"].map((k) => [k, str(fd, k)])));
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

/** Run now (a change run) or Run the catch-up now (myloans:sync). */
export async function runSyncNowAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.MYLOANS_SYNC);
    const r = await runSyncNow(u, str(fd, "mode") === "CATCHUP" ? "CATCHUP" : "CHANGE");
    revalidatePath("/admin/settings");
    if (!r.ran) return r.skipped ?? "Skipped.";
    if (!r.ok) throw new UserError(`The sync failed: ${r.error}. The checkpoint was kept; the next run catches up.`);
    return `${r.rows} change${r.rows === 1 ? "" : "s"} read from myloans: ${r.reviews} loan${r.reviews === 1 ? "" : "s"} with Open Items, ${r.candidates} released not yet in the DMS${r.duplicates ? `, ${r.duplicates} sent twice` : ""}.`;
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
