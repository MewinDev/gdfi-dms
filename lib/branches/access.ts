import type { Prisma } from "@prisma/client";

/**
 * Branch access (where a person works). Roles say what a person can do; this says where.
 *
 *  - All branches: a flag on the user, no rows. Admin is always All.
 *  - Selected: the UNION of grants (a whole Division, a whole Area within a Division, one Branch) MINUS
 *    exceptions (a branch unticked inside a ticked Area or Division). Area and Division grants are
 *    dynamic: a branch added to them later is included.
 *  - The result is kept in user_branch_access (model UserBranch), rebuilt here whenever a user's grants
 *    change, a branch moves to another area or division, or a branch appears. Queries read that table.
 *  - Inactive and hidden branches stay in the set (their old loans stay visible); new work for them is
 *    refused where it starts.
 */

export interface GrantLike { kind: "DIVISION" | "AREA" | "BRANCH"; divisionId: string | null; areaId: string | null; branchId: string | null; exclude: boolean }
export interface BranchPlace { id: string; divisionId: string | null; areaId: string | null }

/** The effective branch ids of a set of grants (pure). */
export function effectiveBranchIds(grants: GrantLike[], branches: BranchPlace[]): Set<string> {
  const out = new Set<string>();
  const divs = new Set(grants.filter((g) => g.kind === "DIVISION" && g.divisionId).map((g) => g.divisionId!));
  const areas = grants.filter((g) => g.kind === "AREA" && g.areaId);
  for (const b of branches) {
    if (b.divisionId && divs.has(b.divisionId)) { out.add(b.id); continue; }
    // An Area grant is the pair (Division, Area); without a division it covers the area in every division.
    if (b.areaId && areas.some((g) => g.areaId === b.areaId && (!g.divisionId || g.divisionId === b.divisionId))) out.add(b.id);
  }
  for (const g of grants) if (g.kind === "BRANCH" && g.branchId && !g.exclude) out.add(g.branchId);
  for (const g of grants) if (g.kind === "BRANCH" && g.branchId && g.exclude) out.delete(g.branchId);
  return out;
}

/** Is a branch covered by a ticked Area or Division of these grants (so unticking it is an exception)? */
export function coveredByGroup(grants: GrantLike[], b: BranchPlace): boolean {
  return grants.some((g) => !g.exclude && ((g.kind === "DIVISION" && g.divisionId === b.divisionId) || (g.kind === "AREA" && g.areaId === b.areaId && (!g.divisionId || g.divisionId === b.divisionId))));
}

/**
 * Normalizes grants as typed on the screen: drops duplicates, a branch grant already covered by a
 * group, and exceptions that no group covers any more.
 */
export function normalizeGrants(grants: GrantLike[], branches: BranchPlace[]): GrantLike[] {
  const byId = new Map(branches.map((b) => [b.id, b]));
  const groups = grants.filter((g) => g.kind !== "BRANCH");
  const seen = new Set<string>();
  const out: GrantLike[] = [];
  const key = (g: GrantLike) => `${g.kind}:${g.divisionId ?? ""}:${g.areaId ?? ""}:${g.branchId ?? ""}:${g.exclude}`;
  for (const g of groups) { const k = key(g); if (!seen.has(k)) { seen.add(k); out.push({ ...g, exclude: false }); } }
  for (const g of grants.filter((x) => x.kind === "BRANCH" && x.branchId)) {
    const b = byId.get(g.branchId!);
    if (!b) continue;
    const covered = coveredByGroup(groups, b);
    if (g.exclude ? !covered : covered) continue;
    const k = key(g);
    if (!seen.has(k)) { seen.add(k); out.push({ kind: "BRANCH", divisionId: null, areaId: null, branchId: b.id, exclude: g.exclude }); }
  }
  return out;
}

/** "2 areas + 3 branches, 41 branches in total" (exceptions: "except 1 branch"). */
export function accessSummary(grants: GrantLike[], total: number, all: boolean): string {
  if (all) return "All branches";
  const n = (k: GrantLike["kind"], ex = false) => grants.filter((g) => g.kind === k && g.exclude === ex).length;
  const parts = [
    n("DIVISION") && `${n("DIVISION")} division${n("DIVISION") === 1 ? "" : "s"}`,
    n("AREA") && `${n("AREA")} area${n("AREA") === 1 ? "" : "s"}`,
    n("BRANCH") && `${n("BRANCH")} branch${n("BRANCH") === 1 ? "" : "es"}`,
  ].filter(Boolean);
  const ex = n("BRANCH", true);
  if (!parts.length) return "No branches";
  return `${parts.join(" + ")}${ex ? ` except ${ex} branch${ex === 1 ? "" : "es"}` : ""}, ${total} branch${total === 1 ? "" : "es"} in total`;
}

type Db = Prisma.TransactionClient | typeof import("@/lib/db").prisma;

/** Every branch's place (division, area). Hidden and inactive included. */
export async function branchPlaces(db: Db): Promise<BranchPlace[]> {
  return db.branch.findMany({ select: { id: true, divisionId: true, areaId: true } });
}

/**
 * Rebuilds user_branch_access for the given users (or for everyone with an Area or Division grant when
 * `userIds` is "groups": after a branch appears, moves, or an area or division changes). Returns the
 * users whose set changed, with what they gained and lost.
 */
export async function rebuildAccess(db: Db, userIds: string[] | "groups", places?: BranchPlace[]): Promise<{ userId: string; gained: string[]; lost: string[] }[]> {
  const ids = userIds === "groups"
    ? [...new Set((await db.userAccessGrant.findMany({ where: { kind: { in: ["AREA", "DIVISION"] } }, select: { userId: true } })).map((g) => g.userId))]
    : userIds;
  if (!ids.length) return [];
  const all = places ?? (await branchPlaces(db));
  const [users, grants, rows] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, allBranches: true } }),
    db.userAccessGrant.findMany({ where: { userId: { in: ids } } }),
    db.userBranch.findMany({ where: { userId: { in: ids } }, select: { userId: true, branchId: true } }),
  ]);
  const changes: { userId: string; gained: string[]; lost: string[] }[] = [];
  const toAdd: { userId: string; branchId: string }[] = [];
  const toRemove: { userId: string; branchIds: string[] }[] = [];
  for (const u of users) {
    const want = u.allBranches ? new Set<string>() : effectiveBranchIds(grants.filter((g) => g.userId === u.id), all);
    const have = new Set(rows.filter((r) => r.userId === u.id).map((r) => r.branchId));
    const gained = [...want].filter((x) => !have.has(x));
    const lost = [...have].filter((x) => !want.has(x));
    if (gained.length || lost.length) changes.push({ userId: u.id, gained, lost });
    for (const b of gained) toAdd.push({ userId: u.id, branchId: b });
    if (lost.length) toRemove.push({ userId: u.id, branchIds: lost });
  }
  if (toAdd.length) await db.userBranch.createMany({ data: toAdd, skipDuplicates: true });
  for (const r of toRemove) await db.userBranch.deleteMany({ where: { userId: r.userId, branchId: { in: r.branchIds } } });
  return changes;
}

/**
 * Who would gain or lose access if the branches' places changed (the impact preview). Nothing is saved.
 * `patch` gives the new place of the branches that move, and new branches (with a temporary id).
 */
export async function accessImpact(db: Db, patch: BranchPlace[]): Promise<{ userId: string; name: string; gained: string[]; lost: string[] }[]> {
  const grants = await db.userAccessGrant.findMany({ where: { kind: { in: ["AREA", "DIVISION"] } }, include: { user: { select: { id: true, name: true, active: true, allBranches: true } } } });
  const userIds = [...new Set(grants.filter((g) => g.user.active && !g.user.allBranches).map((g) => g.userId))];
  if (!userIds.length || !patch.length) return [];
  const before = await branchPlaces(db);
  const byId = new Map(before.map((b) => [b.id, b]));
  for (const p of patch) byId.set(p.id, p);
  const after = [...byId.values()];
  const allGrants = await db.userAccessGrant.findMany({ where: { userId: { in: userIds } } });
  const out: { userId: string; name: string; gained: string[]; lost: string[] }[] = [];
  for (const id of userIds) {
    const g = allGrants.filter((x) => x.userId === id);
    const was = effectiveBranchIds(g, before);
    const now = effectiveBranchIds(g, after);
    const gained = [...now].filter((x) => !was.has(x));
    const lost = [...was].filter((x) => !now.has(x));
    if (gained.length || lost.length) out.push({ userId: id, name: grants.find((x) => x.userId === id)!.user.name, gained, lost });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Prisma filter: people who work at a branch (its id is in their access, or they have All branches;
 * the Admin role is always All). For "the LAs of the branch", receivers, processors of a branch.
 */
export const worksAtWhere = (branchId: string) =>
  ({ OR: [{ branches: { some: { branchId } } }, { allBranches: true }, { role: { key: "ADMIN" } }] }) satisfies Prisma.UserWhereInput;
