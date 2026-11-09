import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "./session";
import type { Permission } from "./permissions";
import { maySignIn } from "./access";
import { CURRENT_USER_INCLUDE, toCurrentUser, type CurrentUser } from "./build-user";
import { isTestMode } from "@/lib/test-mode";

export type { CurrentUser } from "./build-user";

/**
 * The signed-in user, re-read from the database on every request: a change to a role, its
 * permissions or branch access applies on the person's next request. (React cache() only shares
 * the result within one request; nothing is cached across requests.)
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const session = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.sub }, include: CURRENT_USER_INCLUDE });
  if (!user || !maySignIn(user, user.role, isTestMode())) return null;
  return toCurrentUser(user);
});

/** The one authorization check. Every server check goes through here. */
export function can(user: CurrentUser | null, p: Permission): boolean {
  return !!user && user.permissions.has(p);
}

/** For pages: redirect to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: 404 when the permission is missing (do not reveal the page exists). */
export async function requirePagePermission(p: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, p)) notFound();
  return user;
}

export class AuthzError extends Error {
  constructor(message = "You do not have permission to do this.") {
    super(message);
    this.name = "AuthzError";
  }
}

/** For server actions and route handlers: throws AuthzError. */
export async function requirePermission(p: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthzError("Your session has ended. Sign in again.");
  if (!can(user, p)) throw new AuthzError();
  return user;
}

/** Prisma where-clause for loans the user may see. */
export function loanScope(user: CurrentUser) {
  return user.scopeBranchIds === null ? {} : { branchId: { in: user.scopeBranchIds } };
}

export function inScope(user: CurrentUser, branchId: string): boolean {
  return user.scopeBranchIds === null || user.scopeBranchIds.includes(branchId);
}

/** For pages reachable with any one of several permissions (e.g. Settings): 404 when none. */
export async function requirePageAny(ps: Permission[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!ps.some((p) => can(user, p))) notFound();
  return user;
}

/** For actions allowed by any one of several permissions. */
export async function requireAnyPermission(ps: Permission[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthzError("Your session has ended. Sign in again.");
  if (!ps.some((p) => can(user, p))) throw new AuthzError();
  return user;
}
