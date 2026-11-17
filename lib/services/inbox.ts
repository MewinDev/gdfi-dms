import "server-only";
import { prisma } from "@/lib/db";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { acceptJob } from "./jobs";
import { acceptFromPool } from "./dp-pool";
import { acceptItemTx } from "./work-items";
import { UserError } from "./errors";

/**
 * Accept on the Inbox (D-046): one button, whatever the item. A processor's job runs the job's own Accept (or,
 * from the Branch DP pool, becomes their job and is accepted at once); LA work is taken by the LA.
 * Funds requests and packages have no Accept: Approve / Release and Receive count as accept.
 * Returns where to go next.
 */
export async function acceptWork(u: CurrentUser, itemId: string): Promise<string> {
  const it = await prisma.workItem.findUnique({ where: { id: itemId } });
  if (!it || it.state === "DONE") throw new UserError("This item is no longer open. Refresh the page.");
  if (it.kind === "DP_JOB") {
    if (it.state === "POOL") return `/jobs/${await acceptFromPool(u, it.id)}`;
    const job = await prisma.dpAssignment.findFirst({ where: { transactionId: it.subjectId, status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } }, orderBy: { endorsedAt: "desc" } });
    if (!job) throw new UserError("This item is no longer open. Refresh the page.");
    if (job.status === "PENDING_ACCEPTANCE") await acceptJob(u, job.id);
    return `/jobs/${job.id}`;
  }
  if (it.kind === "FUND_REQUEST" || it.kind === "PACKAGE") throw new UserError(it.kind === "PACKAGE" ? "Open it and Receive it: that counts as accepting it." : "Open it and Approve or Release it: that counts as accepting it.");
  if (!can(u, PERMISSIONS.CHECKLIST_TICK) || !inScope(u, it.branchId)) throw new UserError("This item is for the branch's Loan Associates.");
  await prisma.$transaction((tx) => acceptItemTx(tx, it.id, u));
  // A released loan not yet in the DMS: Find loan with its PN filled in (opening it closes the item).
  if (it.kind === "LOAN_CANDIDATE") return `/loans?fill=${encodeURIComponent(it.subjectId)}`;
  return it.pn ? `/loans/${it.pn}` : "/inbox";
}
