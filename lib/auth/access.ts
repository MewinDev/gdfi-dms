/**
 * Who may sign in, and what a role effectively allows. Used by getCurrentUser (every request),
 * the test sign-in and the sign-in page, so the rule lives in one place.
 */
import { RENAMED_PERMISSIONS, permissionDef, type Permission } from "./permissions";

export interface RoleLike {
  key: string;
  builtIn: boolean;
  active: boolean;
  canSignIn: boolean;
  permissions: string[];
  branchAccess: "ASSIGNED" | "ALL";
}

/**
 * The permissions a role really grants: its ticks (the stored keys the app knows). Every role, Admin
 * included, is just its ticks; nothing depends on the role's name or key.
 */
export function effectivePermissions(role: Pick<RoleLike, "permissions">): Set<Permission> {
  return new Set(role.permissions.map((k) => RENAMED_PERMISSIONS[k] ?? k).filter((k) => permissionDef(k)) as Permission[]);
}

/**
 * Sign-in rule. Outside test mode (unchanged): the user must be active and the role must allow
 * sign-in (today Admin and Loan Associate). In test mode, test users may also sign in with any other
 * active role (built-in such as Document Processor or Finance, or custom), through the test sign-in.
 */
export function maySignIn(user: { active: boolean; isTestUser: boolean }, role: Pick<RoleLike, "builtIn" | "active" | "canSignIn">, testMode: boolean): boolean {
  if (!user.active || !role.active) return false;
  if (role.canSignIn) return true;
  return testMode && user.isTestUser;
}
