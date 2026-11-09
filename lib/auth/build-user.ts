import type { Branch, Role, User, UserBranch } from "@prisma/client";
import { effectivePermissions, isLockedAdminRole } from "./access";

/**
 * The signed-in person as the app uses it. Roles say WHAT a person can do; branch access says WHERE
 * (per user: All branches, or the derived set in user_branch_access built from grants and exceptions).
 */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  roleKey: string;
  roleName: string;
  permissions: Set<string>;
  /** The branches in the person's access (user_branch_access). Empty with All branches. */
  branchIds: string[];
  branchNames: string[];
  /** The MyLoans codes of those branches (null = "Code needed"). Same order as branchIds. */
  branchCodes: (string | null)[];
  /** null = all branches (All branches, or the Admin role, which is always All). */
  scopeBranchIds: string[] | null;
  /** Default branch for new work and sending (inside the access). */
  homeBranchId: string | null;
}

export type UserWithAccess = User & { role: Role; branches: (UserBranch & { branch: Pick<Branch, "name" | "code"> })[] };

/** The Prisma include that toCurrentUser needs. */
export const CURRENT_USER_INCLUDE = { role: true, branches: { include: { branch: { select: { name: true, code: true } } } } } as const;

/** Same rule for the app (every request), the Manual Test Kit and the tests. */
export function toCurrentUser(u: UserWithAccess): CurrentUser {
  const all = u.allBranches || isLockedAdminRole(u.role);
  const rows = [...u.branches].sort((a, b) => a.branch.name.localeCompare(b.branch.name));
  const branchIds = all ? [] : rows.map((b) => b.branchId);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    roleKey: u.role.key,
    roleName: u.role.name,
    permissions: effectivePermissions(u.role) as Set<string>,
    branchIds,
    branchNames: all ? [] : rows.map((b) => b.branch.name),
    branchCodes: all ? [] : rows.map((b) => b.branch.code),
    // Inactive and hidden branches stay in scope: their existing loan files keep working. New work for
    // them is refused where it starts (lib/services/loan-file.ts, the pickers).
    scopeBranchIds: all ? null : branchIds,
    homeBranchId: u.homeBranchId,
  };
}
