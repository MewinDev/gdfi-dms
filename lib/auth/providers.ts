import { prisma } from "@/lib/db";
import { isTestMode } from "@/lib/test-mode";
import { maySignIn } from "./access";

/**
 * Identity providers. A provider only answers "which DMS user is this?". Everything after that
 * (session cookie, roles, branches, permission checks) is shared, so swapping the test sign-in
 * for Microsoft Entra ID does not touch any page.
 */
export interface AuthProvider {
  readonly id: "test" | "entra";
  readonly enabled: boolean;
}

export type AuthMode = "test" | "entra";
export function authMode(): AuthMode {
  return process.env.AUTH_MODE === "entra" ? "entra" : "test";
}

/** Test sign-in: pick a seeded test user. Only enabled when AUTH_MODE=test. */
export const testProvider = {
  id: "test" as const,
  get enabled() {
    return authMode() === "test";
  },
  async resolveUser(email: string) {
    if (!this.enabled) return null;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { role: true } });
    if (!user || !user.isTestUser || !maySignIn(user, user.role, isTestMode())) return null;
    return user;
  },
};

/**
 * Microsoft Entra ID. TODO(Entra): implement the OIDC authorization-code flow
 * (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET), verify the id_token, then call
 * `resolveUser` with the token's `oid` and `preferred_username`. Only @gdfi.ph accounts.
 * After resolving, sign the same session cookie with provider "entra".
 */
export const entraProvider = {
  id: "entra" as const,
  get enabled() {
    return authMode() === "entra";
  },
  async resolveUser(oid: string, email: string) {
    if (!email.toLowerCase().endsWith("@gdfi.ph")) return null;
    const user = await prisma.user.findFirst({
      where: { OR: [{ externalId: oid }, { email: email.toLowerCase() }], active: true },
      include: { role: true },
    });
    if (!user || !maySignIn(user, user.role, false)) return null;
    if (!user.externalId) await prisma.user.update({ where: { id: user.id }, data: { externalId: oid } });
    return user;
  },
};
