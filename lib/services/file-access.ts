import { allInScope, can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canFunds } from "@/lib/funds/access";
import { canSeeJob } from "./jobs";

/**
 * Who may open a stored file (D-019). The download routes call these and answer "not found" (404) to
 * everyone else, so the rule is tested without HTTP. Branch scope comes from lib/auth/scope.ts.
 */

/**
 * A receipt: the processor who owns the advance, or someone who sees that fund type AND every branch of the
 * request (the advance's branch and its lines' loans, D-019).
 */
export function mayOpenReceipt(user: CurrentUser, advance: { requestedById: string; fundsTypeId: string | null; branchId: string; lineBranchIds?: (string | null | undefined)[] }): boolean {
  if (advance.requestedById === user.id) return true;
  return canFunds(user, "view", advance) && allInScope(user, [advance.branchId, ...(advance.lineBranchIds ?? [])]);
}

/** Stage evidence: someone who sees loan files and the job (D-039: their own job anywhere, else the loan's branch). */
export function mayOpenStageFile(user: CurrentUser, assignment: Parameters<typeof canSeeJob>[1]): boolean {
  if (!can(user, PERMISSIONS.LOANS_VIEW)) return false;
  return canSeeJob(user, assignment);
}
