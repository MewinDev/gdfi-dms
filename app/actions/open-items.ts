"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { runAction, str, type ActionState } from "@/lib/action";
import { decideOpenItem } from "@/lib/services/open-items";
import { askCashBack, moveCashToNewPn } from "@/lib/services/source-sync";
import { saveMonitoredFields } from "@/lib/services/open-items-settings";

async function revalidateLoan(loanId: string) {
  const l = await prisma.loan.findUnique({ where: { id: loanId }, select: { pn: true, replacedByPn: true } });
  for (const pn of [l?.pn, l?.replacedByPn]) if (pn) revalidatePath(`/loans/${pn}`);
  revalidatePath("/open-items");
  revalidatePath("/dashboard");
}

/** Approve or Reject (the pressed button decides), remarks 5 to 500; the rule group's picks when it becomes Financing. */
export async function decideOpenItemAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    // The item's own tick (loan or borrower approver) and its branch are checked in decideOpenItem.
    const u = await requireAnyPermission([PERMISSIONS.SOURCE_REVIEW, PERMISSIONS.SOURCE_REVIEW_BORROWER]);
    const id = str(fd, "itemId");
    const msg = await decideOpenItem(u, id, {
      decision: str(fd, "decision") as "APPROVE" | "REJECT", remarks: str(fd, "remarks"),
      financingType: (str(fd, "financingType") || null) as never, orcrStatus: (str(fd, "orcrStatus") || null) as never,
    });
    const it = await prisma.openItem.findUnique({ where: { id }, select: { loanId: true } });
    if (it) await revalidateLoan(it.loanId);
    return msg;
  });
}

/** A loan that left Released with cash out: ask the processor for the cash back (Finance confirms). Remarks required. */
export async function askCashBackAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SOURCE_REVIEW);
    const loanId = str(fd, "loanId");
    await askCashBack(u, loanId, str(fd, "remarks"));
    await revalidateLoan(loanId);
    return "Asked for the cash back. Approve the item once the cash is returned.";
  });
}

/** Replaced loan: move released cash to the new PN (through the approval band). */
export async function moveCashAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SOURCE_REVIEW);
    const loanId = str(fd, "loanId");
    const r = await moveCashToNewPn(u, loanId, str(fd, "lineId"));
    await revalidateLoan(loanId);
    return `${r.number} waits for approval: the cash moves to the new PN once approved.`;
  });
}

/** Settings, Open Items: which fields raise Open Items (myloans:manage). */
export async function monitoredFieldsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const u = await requirePermission(PERMISSIONS.SOURCE_MANAGE);
    await saveMonitoredFields(u, fd.getAll("fields").map(String));
    revalidatePath("/admin/settings");
    return "Saved.";
  });
}
