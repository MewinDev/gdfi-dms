import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { effectivePermissions } from "@/lib/auth/access";
import { CA_KEYS, FT_KEYS, ticksFromRole } from "@/lib/auth/effective";
import { ALL_PERMISSIONS, PERMISSIONS as P, ROLE_DEFAULTS, WORKFLOW_PERMISSIONS, permissionLabel, type Permission } from "@/lib/auth/permissions";
import { writeAudit, type Actor } from "@/lib/audit";

/**
 * D-010 role migration (piece 2). Moves people off the old roles without anyone silently losing what
 * they could do. Pure planning (planRoleMigration) and one apply step (applyRoleMigration), so the dry
 * run lists exactly what --apply writes. Run by scripts/migrate-roles-d010.ts; idempotent.
 *
 *   Branch Supervisor (key SUP) -> the same role, now "LA Supervisor/Head" with its v2 default ticks
 *     (every LA tick + approving Open Items). Each of its people is GRANTED the old ticks the new
 *     default lacks (holds transfer, resolve any problem, Monitoring, TAT report, ...).
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
export interface RolePlan {
  createRoles: string[];
  roleUpdates: { key: string; name: string; permissions?: Permission[]; deactivate?: boolean }[];
  moves: PlannedMove[];
  /** Steps skipped, in plain words (e.g. no Superadmin yet). */
  warnings: string[];
}

type RoleRow = { id: string; key: string; name: string; builtIn: boolean; active: boolean; permissions: string[] };
type UserRow = { id: string; name: string; email: string; active: boolean; roleId: string; handlesCa: boolean; handlesFt: boolean; permissionOverrides: { key: string; effect: string }[] };

const set = (keys: Iterable<string>) => new Set<string>(keys);
const minus = (a: Set<string>, b: Set<string>) => [...a].filter((k) => !b.has(k)) as Permission[];

/** Is this a custom funds role (an approver or per-type Finance role made on the Roles screen)? */
export function isCustomFundsRole(r: Pick<RoleRow, "builtIn" | "permissions">): boolean {
  if (r.builtIn) return false;
  const p = effectivePermissions(r);
  return [...CA_KEYS, ...FT_KEYS].some((k) => p.has(k)) && !WORK_KEYS.some((k) => p.has(k));
}

export function planRoleMigration(roles: RoleRow[], users: UserRow[]): RolePlan {
  const byKey = new Map(roles.map((r) => [r.key, r]));
  const plan: RolePlan = { createRoles: [], roleUpdates: [], moves: [], warnings: [] };
  for (const key of Object.keys(ROLE_DEFAULTS)) if (!byKey.has(key)) plan.createRoles.push(key);

  // Branch Supervisor -> LA Supervisor/Head (same role): grants for what the new default lacks.
  const sup = byKey.get(SUPERVISOR_KEY);
  const supDefault = set(ROLE_DEFAULTS.SUP.permissions);
  if (sup) {
    const old = effectivePermissions(sup) as Set<string>;
    const changed = old.size !== supDefault.size || [...old].some((k) => !supDefault.has(k));
    if (changed || sup.name !== ROLE_DEFAULTS.SUP.name) plan.roleUpdates.push({ key: SUPERVISOR_KEY, name: ROLE_DEFAULTS.SUP.name, permissions: changed ? [...supDefault] as Permission[] : undefined });
    if (changed) {
      const extra = minus(old, supDefault);
      for (const u of users.filter((x) => x.roleId === sup.id)) {
        const has = set(u.permissionOverrides.filter((o) => o.effect === "GRANT").map((o) => o.key));
        const grants = extra.filter((k) => !has.has(k));
        if (grants.length) plan.moves.push({ userId: u.id, name: u.name, email: u.email, active: u.active, fromRole: sup.name, toRole: ROLE_DEFAULTS.SUP.name, toRoleKey: SUPERVISOR_KEY, grants, denies: [], ticks: null });
      }
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
    const same = (keys: string[]) => has.size === keys.length && keys.every((k) => has.has(k));
    const earlier = [ALL_PERMISSIONS, ALL_PERMISSIONS.filter((k) => !WORKFLOW_PERMISSIONS.includes(k) && k !== P.LTO_REPORTS_NOTIFY)];
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

  // Operations Monitor -> "Monitoring (read-only)".
  const mon = byKey.get("MONITOR");
  if (mon && mon.name !== ROLE_DEFAULTS.MONITOR.name) plan.roleUpdates.push({ key: mon.key, name: ROLE_DEFAULTS.MONITOR.name });
  return plan;
}

/** Loads the database and plans (the dry run). */
export async function loadRolePlan(db: Tx | typeof prisma = prisma): Promise<RolePlan> {
  const [roles, users] = await Promise.all([
    db.role.findMany({ select: { id: true, key: true, name: true, builtIn: true, active: true, permissions: true } }),
    db.user.findMany({ select: { id: true, name: true, email: true, active: true, roleId: true, handlesCa: true, handlesFt: true, permissionOverrides: { select: { key: true, effect: true } } } }),
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
        data: { name: r.name, ...(r.permissions ? { permissions: r.permissions } : {}), ...(r.deactivate ? { active: false, builtIn: false, deactivatedAt: new Date() } : {}) },
      });
      await writeAudit(tx, { actor, mode: "AUTOMATIC", action: r.deactivate ? "role_deactivated" : "role_updated", entityType: "Role", entityId: r.key, summary: r.deactivate ? `Role ${r.name} made inactive: its people moved (D-010)` : `Role ${r.key} is now ${r.name}${r.permissions ? " with its v2 default ticks" : ""} (D-010)` });
    }
    return plan;
  }, { timeout: 60_000 });
}
