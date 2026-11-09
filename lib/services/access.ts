import "server-only";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { accessSummary, branchPlaces, effectiveBranchIds, normalizeGrants, rebuildAccess, type GrantLike } from "@/lib/branches/access";
import { UserError } from "./errors";

/**
 * Writing a person's branch access (where they work). Roles say WHAT a person can do; this says WHERE.
 * Grants and exceptions are stored, never copied lists; the derived table user_branch_access is rebuilt
 * for that one user. saveUserAccess / applyAccess validate (permission, Admin always All, home branch
 * inside the access, a loan worker needs at least one branch, no new grant on an inactive or hidden
 * branch) and audit who changed what (before and after). writeUserAccess is the low-level writer used by
 * the seed and the Manual Test Kit.
 */
export interface AccessInput {
  /** All branches (no rows). */
  all: boolean;
  grants: GrantLike[];
  /** Default branch for new work and sending (inside the access). */
  homeBranchId: string | null;
}

export async function writeUserAccess(tx: Tx, userId: string, input: AccessInput) {
  await tx.userAccessGrant.deleteMany({ where: { userId } });
  if (!input.all && input.grants.length) {
    await tx.userAccessGrant.createMany({
      data: input.grants.map((g) => ({ userId, kind: g.kind, divisionId: g.divisionId, areaId: g.areaId, branchId: g.branchId, exclude: g.exclude })),
    });
  }
  await tx.user.update({ where: { id: userId }, data: { allBranches: input.all, homeBranchId: input.homeBranchId } });
  if (input.all) await tx.userBranch.deleteMany({ where: { userId } });
  return (await rebuildAccess(tx, [userId]))[0] ?? { userId, gained: [], lost: [] };
}

/** Single-branch grants for a list of branch ids (the users import, the seed and old callers). */
export const branchGrants = (branchIds: string[]): GrantLike[] => branchIds.map((branchId) => ({ kind: "BRANCH", divisionId: null, areaId: null, branchId, exclude: false }));

export async function setUserBranches(userId: string, branchIds: string[], homeBranchId: string | null = branchIds[0] ?? null, db: typeof prisma = prisma) {
  return db.$transaction((tx) => writeUserAccess(tx, userId, { all: false, grants: branchGrants(branchIds), homeBranchId }));
}

/** The access as the form sends it (a hidden JSON field). */
export const ACCESS_SCHEMA = z.object({
  all: z.boolean(),
  grants: z.array(z.object({
    kind: z.enum(["DIVISION", "AREA", "BRANCH"]),
    divisionId: z.string().nullable().default(null),
    areaId: z.string().nullable().default(null),
    branchId: z.string().nullable().default(null),
    exclude: z.boolean().default(false),
  })).max(2000, "Too many grants."),
  homeBranchId: z.string().nullable().default(null),
});

export function parseAccess(raw: unknown): AccessInput {
  let v = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw); } catch { throw new UserError("The branch access could not be read. Try again.", "access"); }
  }
  const p = ACCESS_SCHEMA.safeParse(v);
  if (!p.success) throw new UserError("The branch access could not be read. Try again.", "access");
  return p.data;
}

/** A role whose people work on loan files: they need at least one branch (or All). */
export function worksLoans(role: Pick<Role, "key" | "builtIn" | "permissions">): boolean {
  const p = effectivePermissions(role);
  return (p.has(PERMISSIONS.LOANS_VIEW) && p.has(PERMISSIONS.CHECKLIST_TICK)) || p.has(PERMISSIONS.DP_RECEIVE) || p.has(PERMISSIONS.RETURNS_ACCEPT);
}

/**
 * Checks an access for a user of this role and returns it normalized (the home branch picked when missing). `before` is the user's current grants: a branch already granted may stay even when
 * it is now inactive; a NEW grant on an inactive or hidden branch is refused.
 */
export async function checkAccess(db: Tx | typeof prisma, role: Role, input: AccessInput, before: { grants: GrantLike[]; homeBranchId: string | null } | null): Promise<{ input: AccessInput; effective: Set<string> | null }> {
  const places = await branchPlaces(db);
  const branches = await db.branch.findMany({ select: { id: true, name: true, code: true, active: true, hidden: true } });
  const byId = new Map(branches.map((b) => [b.id, b]));
  let grants: GrantLike[] = [];
  if (!input.all) {
    for (const g of input.grants) {
      if (g.kind === "BRANCH" && (!g.branchId || !byId.has(g.branchId))) throw new UserError("One of the branches no longer exists. Refresh and try again.", "access");
      if (g.kind === "AREA" && (!g.areaId || !(await db.area.findUnique({ where: { id: g.areaId }, select: { id: true } })))) throw new UserError("One of the areas no longer exists. Refresh and try again.", "access");
      if (g.kind === "DIVISION" && (!g.divisionId || !(await db.division.findUnique({ where: { id: g.divisionId }, select: { id: true } })))) throw new UserError("One of the divisions no longer exists. Refresh and try again.", "access");
    }
    grants = normalizeGrants(input.grants, places);
    const had = new Set((before?.grants ?? []).filter((g) => g.kind === "BRANCH" && !g.exclude && g.branchId).map((g) => g.branchId!));
    for (const g of grants) {
      if (g.kind !== "BRANCH" || g.exclude || had.has(g.branchId!)) continue;
      const b = byId.get(g.branchId!)!;
      if (b.hidden) throw new UserError(`${b.name} is hidden from the DMS: it cannot be chosen.`, "access");
      if (!b.active) throw new UserError(`${b.name} is inactive: it cannot be chosen for new work.`, "access");
    }
  }
  const effective = input.all ? null : effectiveBranchIds(grants, places);
  const loanWork = worksLoans(role);
  if (!input.all && loanWork && effective!.size === 0) throw new UserError(`Pick at least one branch: ${role.name} works on loan files.`, "access");
  let home = input.homeBranchId;
  if (home) {
    const b = byId.get(home);
    if (!b) throw new UserError("Pick the home branch again.", "homeBranchId");
    if (effective && !effective.has(home)) throw new UserError("The home branch must be one of the branches in the access.", "homeBranchId");
    if ((!b.active || b.hidden) && home !== before?.homeBranchId) throw new UserError(`${b.name} is ${b.hidden ? "hidden" : "inactive"}: pick another home branch.`, "homeBranchId");
  } else if (loanWork && effective) {
    // The first workable branch of the access, by name.
    home = [...effective].map((id) => byId.get(id)!).filter((b) => b.active && !b.hidden).sort((x, y) => x.name.localeCompare(y.name))[0]?.id ?? null;
  }
  return { input: { all: input.all, grants: input.all ? [] : grants, homeBranchId: home ?? null }, effective };
}

/** "All branches" or "1 area + 2 branches, 26 branches in total" (for audit and screens). */
export async function describeAccess(db: Tx | typeof prisma, userId: string): Promise<{ summary: string; all: boolean; grants: GrantLike[]; homeBranchId: string | null; branches: string[] }> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true, accessGrants: true, branches: { include: { branch: { select: { name: true, code: true } } } } } });
  const all = u.allBranches;
  const grants = u.accessGrants.map((g) => ({ kind: g.kind, divisionId: g.divisionId, areaId: g.areaId, branchId: g.branchId, exclude: g.exclude }));
  return { summary: accessSummary(grants, u.branches.length, all), all, grants, homeBranchId: u.homeBranchId, branches: u.branches.map((b) => `${b.branch.name}${b.branch.code ? ` (${b.branch.code})` : ""}`).sort() };
}

/** Validates, writes and audits (who, before, after) one user's access inside a transaction. */
export async function applyAccess(tx: Tx, actor: Actor, userId: string, role: Role, input: AccessInput, o: { isNew?: boolean } = {}) {
  const cur = o.isNew ? null : await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { accessGrants: true } });
  const before = cur ? await describeAccess(tx, userId) : null;
  const checked = await checkAccess(tx, role, input, cur ? { grants: cur.accessGrants, homeBranchId: cur.homeBranchId } : null);
  const change = await writeUserAccess(tx, userId, checked.input);
  const after = await describeAccess(tx, userId);
  const same = before && before.all === after.all && before.homeBranchId === after.homeBranchId && JSON.stringify(before.grants) === JSON.stringify(after.grants);
  if (!same) {
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    await writeAudit(tx, {
      actor, mode: actor.id ? "MANUAL" : "AUTOMATIC", action: "access_changed", entityType: "User", entityId: userId,
      summary: `Branch access of ${u.name}: ${before ? `${before.summary} -> ` : ""}${after.summary}`,
      before: before ?? undefined, after,
      details: { gained: change.gained.length, lost: change.lost.length },
    });
  }
  return { ...change, summary: after.summary };
}

/** Users, Edit, Branch access (access:manage). */
export async function saveUserAccess(user: CurrentUser, targetUserId: string, raw: AccessInput | string) {
  if (!can(user, PERMISSIONS.ACCESS_MANAGE)) throw new UserError("Ask an Admin to turn on \"Change branch access\" for your role.");
  const input = parseAccess(raw);
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, include: { role: true } });
  if (!target) throw new UserError("User not found.");
  return prisma.$transaction((tx) => applyAccess(tx, { id: user.id, label: user.name }, target.id, target.role, input), { timeout: 30_000 });
}

/** Copy access from another user: the same grants and exceptions (and home branch when it fits). */
export async function copyAccess(user: CurrentUser, fromUserId: string, toUserId: string) {
  if (!can(user, PERMISSIONS.ACCESS_MANAGE)) throw new UserError("Ask an Admin to turn on \"Change branch access\" for your role.");
  const from = await describeAccess(prisma, fromUserId);
  const to = await prisma.user.findUniqueOrThrow({ where: { id: toUserId }, select: { homeBranchId: true } });
  const places = await branchPlaces(prisma);
  const eff = from.all ? null : effectiveBranchIds(from.grants, places);
  const home = [from.homeBranchId, to.homeBranchId].find((h) => h && (!eff || eff.has(h))) ?? null;
  return saveUserAccess(user, toUserId, { all: from.all, grants: from.grants, homeBranchId: home });
}

/** The Branch access tree (Division > Area > Branch; the pair Division+Area is the node), hidden branches left out. */
export async function accessTreeData(db: Tx | typeof prisma = prisma) {
  const [branches, users] = await Promise.all([
    db.branch.findMany({ include: { division: true, area: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { active: true }, include: { role: true, accessGrants: true }, orderBy: { name: "asc" } }),
  ]);
  const divisions = new Map<string, { id: string | null; name: string; areas: Map<string, { id: string | null; name: string; branches: { id: string; name: string; code: string | null; active: boolean }[] }> }>();
  for (const b of branches.filter((x) => !x.hidden)) {
    const dk = b.divisionId ?? "none";
    const d = divisions.get(dk) ?? { id: b.divisionId, name: b.division?.name ?? "No division", areas: new Map() };
    divisions.set(dk, d);
    const ak = b.areaId ?? "none";
    const a = d.areas.get(ak) ?? { id: b.areaId, name: b.area?.name ?? "No area", branches: [] };
    d.areas.set(ak, a);
    a.branches.push({ id: b.id, name: b.name, code: b.code, active: b.active });
  }
  const byName = <T extends { name: string; id: string | null }>(x: T, y: T) => (x.id === null ? 1 : y.id === null ? -1 : x.name.localeCompare(y.name));
  const tree = [...divisions.values()].sort(byName).map((d) => ({ id: d.id, name: d.name, areas: [...d.areas.values()].sort(byName) }));
  const hiddenPlaces = branches.filter((b) => b.hidden).map((b) => ({ id: b.id, divisionId: b.divisionId, areaId: b.areaId }));
  const others = users.map((u) => ({
    id: u.id, name: u.name, all: u.allBranches, homeBranchId: u.homeBranchId,
    grants: u.accessGrants.map((g) => ({ kind: g.kind, divisionId: g.divisionId, areaId: g.areaId, branchId: g.branchId, exclude: g.exclude })),
  }));
  return { tree, hiddenPlaces, others };
}
