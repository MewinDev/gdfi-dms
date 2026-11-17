"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can, requireAnyPermission, requirePermission, requireUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { UserError } from "@/lib/services/errors";
import { runAction, str, type ActionState } from "@/lib/action";
import { acceptWork } from "@/lib/services/inbox";
import { moveItem, setAway } from "@/lib/services/work-items";
import { takeBackFromPool } from "@/lib/services/dp-pool";
import { prisma } from "@/lib/db";

/** Piece 9 (D-046): Accept, Move (Give to... / Back to the pool), Away, and taking a job back from the DP pool. */

/** Accept, then straight to the work (the job page or the loan file). */
export async function acceptWorkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let href = "";
  const r = await runAction(async () => {
    const user = await requireAnyPermission([PERMISSIONS.CHECKLIST_TICK, PERMISSIONS.JOBS_WORK]);
    href = await acceptWork(user, str(fd, "itemId"));
    revalidatePath("/inbox");
    revalidatePath("/jobs");
    return "Accepted. It is in your items now.";
  });
  if (r?.ok && href) redirect(href);
  return r;
}

export async function moveItemAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.WORKITEMS_MOVE);
    const to = str(fd, "to");
    await moveItem(user, str(fd, "itemId"), to === "POOL" ? { pool: true } : { userId: to }, str(fd, "note"));
    revalidatePath("/inbox");
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    return to === "POOL" ? "Back in the branch pool." : "Moved. Both people were told.";
  });
}

export async function setAwayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const userId = str(fd, "userId") || user.id;
    // Everyone may mark themselves away; someone else needs "Set who is away" (checked again in the service).
    if (userId !== user.id && !can(user, PERMISSIONS.USERS_AWAY)) throw new UserError("Ask a Superadmin to turn on \"Set who is away\" for your role.");
    const clear = str(fd, "intent") === "clear";
    await setAway(user, userId, clear ? null : { from: str(fd, "from"), to: str(fd, "to"), note: str(fd, "note") });
    revalidatePath("/inbox");
    revalidatePath("/admin/users");
    revalidatePath("/dashboard");
    return clear ? "No longer marked away." : "Marked away. They are not offered for new work on those days.";
  });
}

export async function takeBackFromPoolAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission(PERMISSIONS.DP_SEND);
    const transactionId = str(fd, "transactionId");
    await takeBackFromPool(user, transactionId, str(fd, "reason"));
    const t = await prisma.loanTransaction.findUnique({ where: { id: transactionId }, select: { loan: { select: { pn: true } } } });
    if (t) revalidatePath(`/loans/${t.loan.pn}`);
    revalidatePath("/inbox");
    return "Taken back. You can send it again.";
  });
}
