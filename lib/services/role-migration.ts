import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { effectivePermissions } from "@/lib/auth/access";
import { CA_KEYS, FT_KEYS, ticksFromRole } from "@/lib/auth/effective";
import { ALL_PERMISSIONS, KEYS_ADDED_D031, PERMISSIONS as P, ROLE_DEFAULTS, SUPERADMIN_DEFAULT_BEFORE_D028, SUP_DEFAULT_BEFORE_D029, SUP_DEFAULT_D029, FIN_DEFAULT_BEFORE_D034, WORKFLOW_PERMISSIONS, permissionLabel, type Permission } from "@/lib/auth/permissions";
import { writeAudit, type Actor } from "@/lib/audit";

/**
 * D-010 role migration (piece 2). Moves people off the old roles without anyone silently losing what
 * they could do. Pure planning (planRoleMigration) and one apply step (applyRoleMigration), so the dry
 * run lists exactly what --apply writes. Run by scripts/migrate-roles-d010.ts; idempotent.
 *
 *   Branch Supervisor (key SUP) -> the same role, now "LA Supervisor/Head" with its default ticks (every
 *     LA tick, approving Open Items, moving holds; D-029). No per-person legacy grants: the grants an
 *     earlier run of this migration gave its people are removed, and each removal is listed.
 *   Approvers (APPR) and custom funds roles (a role that is not built-in, has per-type funds keys and no
 *     LA or DP work) -> Finance. Each person's abilities stay exactly the same: GRANT what the old role
 *     had and Finance lacks, DENY what Finance has and the old role lacked; Handles CA / FT from the old
 *     role's funds keys. Emptied roles are made inactive.
 *   Operations Monitor -> renamed "Monitoring (read-only)" (same ticks, D-010).
 *   Built-in roles missing from the database (Superadmin, Archiver) are created with their defaults.
 */

export const MIGRATION_NOTE = "Kept from the old role when roles were merged (D-010).";
const FINANCE_KEY = "FIN";
const SUPERVISOR_KEY = "SUP";
const APPROVERS_KEY = "APPR";
const WORK_KEYS: Permission[] = [P.CHECKLIST_TICK, P.JOBS_WORK, P.DP_RECEIVE, P.LOANS_OPEN];

export interface PlannedMove {
  userId: string; name: string; email: string; active: boolean;
  fromRole: string; toRole: string; toRoleKey: string;
  grants: Permission[]; denies: Permission[];
  ticks: { handlesCa: boolean; handlesFt: boolean } | null;
}
/** Per-person legacy grants removed (D-029): what each LA Supervisor/Head no longer has. */
export interface PlannedRemoval { userId: string; name: string; email: string; active: boolean; keys: Permission[]; /** Of `keys`, what the LA Supervisor/Head role does not give back (D-034). */ lost: Permission[] }
export interface RolePlan {
  createRoles: string[];
  removals: PlannedRemoval[];
  roleUpdates: { key: string; name: string; permissions?: Permission[]; branchAccess?: "ASSIGNED" | "ALL"; deactivate?: boolean }[];
  moves: PlannedMove[];
  /** Steps skipped, in plain words (e.g. no Superadmin yet). */
  warnings: string[];
}

type RoleRow = { id: string; key: string; name: string; builtIn: boolean; active: boolean; permissions: string[] };
type UserRow = { id: string; name: string; email: string; active: boolean; roleId: string; handlesCa: boolean; handlesFt: boolean; allBranches?: boolean; permissionOverrides: { key: string; effect: string; note?: string }[] };

const set = (keys: Iterable<string>) => new Set<string>(keys);
/** Compares two tick lists ignoring the keys a later SQL migration added to the built-in roles (D-031). */
function sameTicks(has: Set<string>, keys: string[]): boolean {
  const a = [...has].filter((k) => !KEYS_ADDED_D031.includes(k as Permission));
  const b = [...new Set(keys)].filter((k) => !KEYS_ADDED_D031.includes(k as Permission));
  return a.length === b.length && b.every((k) => has.has(k));
}
const minus = (a: Set<string>, b: Set<string>) => [...a].filter((k) => !b.has(k)) as Permission[];

/** Is this a custom funds role (an approver or per-type Finance role made on the Roles screen)? */
export function isCustomFundsRole(r: Pick<RoleRow, "builtIn" | "permissions">): boolean {
  if (r.builtIn) return false;
  const p = effectivePermissions(r);
  return [...CA_KEYS, ...FT_KEYS].some((k) => p.has(k)) && !WORK_KEYS.some((k) => p.has(k));
}

export function planRoleMigration(roles: RoleRow[], users: UserRow[]): RolePlan {
  const byKey = new Map(roles.map((r) => [r.key, r]));
  const plan: RolePlan = { createRoles: [], removals: [], roleUpdates: [], moves: [], warnings: [] };
  for (const key of Object.keys(ROLE_DEFAULTS)) if (!byKey.has(key)) plan.createRoles.push(key);

  // Branch Supervisor -> LA Supervisor/Head (same role) with today's default (D-029). The role is brought
  // up to date when it is still the old Branch Supervisor (its old name) or still exactly the default from
  // before D-029; a role someone changed by hand keeps its ticks.
  const sup = byKey.get(SUPERVISOR_KEY);
  if (sup) {
    const has = effectivePermissions(sup) as Set<string>;
    const same = (keys: string[]) => sameTicks(has, keys);
    const oldName = sup.name !== ROLE_DEFAULTS.SUP.name;
    const update = !same(ROLE_DEFAULTS.SUP.permissions) && (oldName || same(SUP_DEFAULT_BEFORE_D029) || same(SUP_DEFAULT_D029));
    if (update || oldName) plan.roleUpdates.push({ key: SUPERVISOR_KEY, name: ROLE_DEFAULTS.SUP.name, permissions: update ? [...ROLE_DEFAULTS.SUP.permissions] : undefined });
    // The per-person grants an earlier run gave (note MIGRATION_NOTE) are removed and listed.
    for (const u of users.filter((x) => x.roleId === sup.id)) {
      const keys = u.permissionOverrides.filter((o) => o.effect === "GRANT" && o.note === MIGRATION_NOTE).map((o) => o.key as Permission);
      // What the role now gives them anyway (D-034) is not lost: only the rest is listed as lost.
      if (keys.length) plan.removals.push({ userId: u.id, name: u.name, email: u.email, active: u.active, keys, lost: keys.filter((k) => !ROLE_DEFAULTS.SUP.permissions.includes(k)) });
    }
  }

  // Finance (D-034): branch-scoped by default, without borrower corrections. Brought up to date only when the
  // role is still exactly its earlier default; existing Finance people keep their own access (listed).
  const finRole = byKey.get(FINANCE_KEY);
  if (finRole) {
    const has = effectivePermissions(finRole) as Set<string>;
    if (!sameTicks(has, ROLE_DEFAULTS.FIN.permissions) && sameTicks(has, FIN_DEFAULT_BEFORE_D034)) {
      plan.roleUpdates.push({ key: FINANCE_KEY, name: finRole.name, permissions: [...ROLE_DEFAULTS.FIN.permissions], branchAccess: "ASSIGNED" });
    }
    for (const u of users.filter((x) => x.active && x.roleId === finRole.id && x.allBranches)) {
      plan.warnings.push(`${u.name} (${u.email}) is Finance with "All branches": kept. Only a Superadmin gives or removes All branches (D-035).`);
    }
  }

  // Approvers and custom funds roles -> Finance, abilities kept exactly.
  const fin = byKey.get(FINANCE_KEY);
  const finKeys = fin ? (effectivePermissions(fin) as Set<string>) : set(ROLE_DEFAULTS.FIN.permissions);
  const sources = roles.filter((r) => r.key === APPROVERS_KEY || isCustomFundsRole(r));
  for (const r of sources) {
    const old = effectivePermissions(r) as Set<string>;
    const people = users.filter((u) => u.roleId === r.id);
    const ticks = ticksFromRole(old);
    // Keys of a type the person does not handle are already off (Handles CA / FT): no deny needed for them.
    const offByTicks = (k: Permission) => (!ticks.handlesCa && CA_KEYS.includes(k)) || (!ticks.handlesFt && FT_KEYS.includes(k));
    for (const u of people) {
      plan.moves.push({
        userId: u.id, name: u.name, email: u.email, active: u.active, fromRole: r.name, toRole: fin?.name ?? ROLE_DEFAULTS.FIN.name, toRoleKey: FINANCE_KEY,
        // Exactly as before: an approver stays an approver (no release or settle it never had, D-024).
        grants: minus(old, finKeys), denies: minus(finKeys, old).filter((k) => !offByTicks(k)),
        ticks,
      });
    }
    if (r.active) plan.roleUpdates.push({ key: r.key, name: r.name, deactivate: true });
  }

  // Superadmin: its default changed twice while piece 2 was built (16-17 Nov 2026). Only a role still holding
  // exactly one of those earlier defaults is brought to today's default; a role someone changed is kept.
  const sa = byKey.get("SUPERADMIN");
  if (sa) {
    const has = effectivePermissions(sa) as Set<string>;
    const same = (keys: string[]) => sameTicks(has, keys);
    const earlier = [ALL_PERMISSIONS, ALL_PERMISSIONS.filter((k) => !WORKFLOW_PERMISSIONS.includes(k) && k !== P.LTO_REPORTS_NOTIFY), SUPERADMIN_DEFAULT_BEFORE_D028];
    if (!same(ROLE_DEFAULTS.SUPERADMIN.permissions) && earlier.some(same)) plan.roleUpdates.push({ key: sa.key, name: sa.name, permissions: [...ROLE_DEFAULTS.SUPERADMIN.permissions] });
  }

  // Admin (D-023): the permission matrix and overrides become the Superadmin's. Only once an active
  // Superadmin exists, so someone always keeps "Manage permissions" (lock-out).
  const admin = byKey.get("ADMIN");
  if (admin && (effectivePermissions(admin) as Set<string>).has(P.ROLES_MANAGE)) {
    const superRole = byKey.get("SUPERADMIN");
    const supers = superRole && superRole.active ? users.filter((u) => u.active && u.roleId === superRole.id).length : 0;
    if (supers > 0) plan.roleUpdates.push({ key: admin.key, name: admin.name, permissions: [...effectivePermissions(admin)].filter((k) => k !== P.ROLES_MANAGE && k !== P.ACCESS_ALL_BRANCHES) as Permission[] });
    else plan.warnings.push('Admin keeps "Manage permissions": there is no active Superadmin yet. Add one, then run this again (D-023).');
  }

  // Admin approves Open Items for every branch by default (D-029): an Admin without "All branches" only
  // approves for their own branches. Listed, never changed here (the Superadmin decides).
  if (admin) {
    for (const u of users.filter((x) => x.active && x.roleId === admin.id && x.allBranches === false)) {
      plan.warnings.push(`${u.name} (${u.email}) is an Admin without "All branches": they approve Open Items only for their own branches. A Superadmin can give "All branches" on Users, Edit.`);
    }
  }
  // Superadmins (D-028): keep two active, so one can always fix the other's access.
  const saRole = byKey.get("SUPERADMIN");
  const activeSupers = saRole && saRole.active ? users.filter((u) => u.active && u.roleId === saRole.id).length : 0;
  if (activeSupers === 1) plan.warnings.push("Only one active Superadmin. Add a second one (D-028).");

  // Operations Monitor -> "Monitoring (read-only)".
  const mon = byKey.get("MONITOR");
  if (mon && mon.name !== ROLE_DEFAULTS.MONITOR.name) plan.roleUpdates.push({ key: mon.key, name: ROLE_DEFAULTS.MONITOR.name });
  return plan;
}

/** Loads the database and plans (the dry run). */
export async function loadRolePlan(db: Tx | typeof prisma = prisma): Promise<RolePlan> {
  const [roles, users] = await Promise.all([
    db.role.findMany({ select: { id: true, key: true, name: true, builtIn: true, active: true, permissions: true } }),
    db.user.findMany({ select: { id: true, name: true, email: true, active: true, roleId: true, handlesCa: true, handlesFt: true, allBranches: true, permissionOverrides: { select: { key: true, effect: true, note: true } } } }),
  ]);
  return planRoleMigration(roles, users);
}

/** Writes the plan in one transaction; one audit row per person and per role. Returns what it did. */
export async function applyRoleMigration(actor: Actor = { id: null, label: "Role migration (D-010)" }): Promise<RolePlan> {
  return prisma.$transaction(async (tx) => {
    const plan = await loadRolePlan(tx);
    for (const key of plan.createRoles) {
      const d = ROLE_DEFAULTS[key];
      await tx.role.create({ data: { key, name: d.name, description: d.description, permissions: d.permissions, canSignIn: d.canSignIn, sortOrder: d.sortOrder, branchAccess: d.branchAccess, builtIn: true } });
      await writeAudit(tx, { actor, mode: "AUTOMATIC", action: "role_created", entityType: "Role", entityId: key, summary: `Role ${d.name} added (D-002)` });
    }
    const roleId = async (key: string) => (await tx.role.findUniqueOrThrow({ where: { key } })).id;
    for (const r of plan.removals) {
      await tx.userPermissionOverride.deleteMany({ where: { userId: r.userId, key: { in: r.keys }, effect: "GRANT", note: MIGRATION_NOTE } });
      await writeAudit(tx, {
        actor, mode: "AUTOMATIC", action: "legacy_grants_removed", entityType: "User", entityId: r.userId,
        summary: `${r.name}: per-person grants from the role merge removed (D-029): ${r.keys.map(permissionLabel).join(", ")}`,
        before: { grants: r.keys }, after: { grants: [] },
      });
    }
    // People first (their old role must still exist for the audit text), then the roles.
    for (const m of plan.moves) {
      const to = await roleId(m.toRoleKey);
      await tx.user.update({ where: { id: m.userId }, data: { roleId: to, ...(m.ticks ?? {}) } });
      for (const key of m.grants) await tx.userPermissionOverride.upsert({ where: { userId_key: { userId: m.userId, key } }, create: { userId: m.userId, key, effect: "GRANT", note: MIGRATION_NOTE }, update: { effect: "GRANT", note: MIGRATION_NOTE } });
      for (const key of m.denies) await tx.userPermissionOverride.upsert({ where: { userId_key: { userId: m.userId, key } }, create: { userId: m.userId, key, effect: "DENY", note: MIGRATION_NOTE }, update: { effect: "DENY", note: MIGRATION_NOTE } });
      await writeAudit(tx, {
        actor, mode: "AUTOMATIC", action: "role_migrated", entityType: "User", entityId: m.userId,
        summary: `${m.name}: ${m.fromRole} -> ${m.toRole}${m.grants.length ? `; granted ${m.grants.map(permissionLabel).join(", ")}` : ""}${m.denies.length ? `; denied ${m.denies.map(permissionLabel).join(", ")}` : ""}${m.ticks ? `; handles ${[m.ticks.handlesCa && "CA", m.ticks.handlesFt && "FT"].filter(Boolean).join(" and ") || "no fund type"}` : ""}`,
        before: { role: m.fromRole }, after: { role: m.toRole, grants: m.grants, denies: m.denies, ticks: m.ticks },
      });
    }
    for (const r of plan.roleUpdates) {
      await tx.role.update({
        where: { key: r.key },
        data: { name: r.name, ...(r.permissions ? { permissions: r.permissions } : {}), ...(r.branchAccess ? { branchAccess: r.branchAccess } : {}), ...(r.deactivate ? { active: false, builtIn: false, deactivatedAt: new Date() } : {}) },
      });
      await writeAudit(tx, { actor, mode: "AUTOMATIC", action: r.deactivate ? "role_deactivated" : "role_updated", entityType: "Role", entityId: r.key, summary: r.deactivate ? `Role ${r.name} made inactive: its people moved (D-010)` : `Role ${r.key} is now ${r.name}${r.permissions ? " with its v2 default ticks" : ""} (D-010)` });
    }
    return plan;
  }, { timeout: 60_000 });
}
