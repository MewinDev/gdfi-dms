import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canFunds } from "@/lib/funds/access";
import { canSeeJob } from "./jobs";

/**
 * Who may open a stored file (D-019). The download routes call these and answer "not found" (404) to
 * everyone else, so the rule is tested without HTTP. Branch scope comes from lib/auth/scope.ts.
 */

/** A receipt: the processor who owns the advance, or someone who sees that fund type AND the advance's branch. */
export function mayOpenReceipt(user: CurrentUser, advance: { requestedById: string; fundsTypeId: string | null; branchId: string }): boolean {
  if (advance.requestedById === user.id) return true;
  return canFunds(user, "view", advance) && inScope(user, advance.branchId);
}

/** Stage evidence: someone who sees loan files and the job (their own job) or the loan's branch. */
export function mayOpenStageFile(
  user: CurrentUser,
  assignment: Parameters<typeof canSeeJob>[1] & { loan: { branchId: string } },
): boolean {
  if (!can(user, PERMISSIONS.LOANS_VIEW)) return false;
  return canSeeJob(user, assignment) || inScope(user, assignment.loan.branchId);
}
