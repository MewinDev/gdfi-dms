import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { notify } from "@/lib/notify";
import { holdsWhere } from "@/lib/auth/holders";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { UserError } from "./errors";

/**
 * Piece 8 (D-012, D-053): Reference data changes. A rename in myloans (area, division, company, branch or product
 * name) is not a change to a loan: it is applied by itself and logged here once (old, new, when, source), with the
 * number of loan files that took it. Admin and the LA Supervisor/Head see it ("See reference data changes") and get
 * an in-app notice for each new rename.
 */

export const ENTITY_WORDS: Record<string, string> = { AREA: "Area", DIVISION: "Division", COMPANY: "Company", BRANCH: "Branch", BRANCH_CODE: "Branch code", PRODUCT: "Product" };

/** One rename: logged the first time it is seen (and noticed); later loan files only add to its count. */
export async function recordReferenceChange(tx: Tx, r: { entity: string; key: string; oldValue: string | null; newValue: string | null; source: string; at?: Date }) {
  const at = r.at ?? new Date();
  const same = await tx.referenceChange.findFirst({
    where: { entity: r.entity, entityKey: r.key, oldValue: r.oldValue, newValue: r.newValue, at: { gte: new Date(at.getTime() - 7 * 86_400_000) } },
    orderBy: { at: "desc" },
  });
  if (same) {
    await tx.referenceChange.update({ where: { id: same.id }, data: { loanCount: { increment: 1 } } });
    return same;
  }
  const row = await tx.referenceChange.create({ data: { entity: r.entity, entityKey: r.key, oldValue: r.oldValue, newValue: r.newValue, source: r.source, at, loanCount: 1 } });
  const ids = (await tx.user.findMany({ where: holdsWhere(PERMISSIONS.REFDATA_VIEW), select: { id: true } })).map((u) => u.id);
  const what = `${ENTITY_WORDS[r.entity] ?? r.entity} renamed in myloans`;
  await notify(tx, { userIds: ids, title: what, body: `"${r.oldValue ?? "blank"}" is now "${r.newValue ?? "blank"}". Updated by itself on the loan files (no Open Item).`, link: "/admin/settings?open=reference-changes" });
  return row;
}

/** Settings, Reference data changes: the latest renames, newest first. */
export async function referenceChanges(u: CurrentUser, f: { entity?: string } = {}) {
  if (!can(u, PERMISSIONS.REFDATA_VIEW)) throw new UserError("Ask a Superadmin to turn on \"See reference data changes\" for your role.");
  return prisma.referenceChange.findMany({ where: f.entity ? { entity: f.entity } : {}, orderBy: { at: "desc" }, take: 200 });
}
