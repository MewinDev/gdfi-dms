import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import {
  VISIBLE_PERMISSION_GROUPS, PERMISSIONS, ROLE_DEFAULTS, normalizePermissions, permissionLabel, type Permission,
} from "@/lib/auth/permissions";
import { effectivePermissions } from "@/lib/auth/access";
import { checkLockout } from "./lockout";
import { lastChangeWhat, roleImpact, type RoleImpact } from "@/lib/roles/impact";
import { fmtDate } from "@/lib/time";
import { toCsv } from "@/lib/import/csv";
import { UserError } from "./errors";

/**
 * Roles and access (Settings). Every change is checked on the server and writes one audit row
 * with the exact permissions added and removed. Nothing is deleted: roles are made inactive.
 */

const actorOf = (u: CurrentUser) => ({ id: u.id, label: u.name });

function requireManager(user: CurrentUser) {
  if (!can(user, PERMISSIONS.ROLES_MANAGE)) throw new UserError("Your role does not allow managing roles and access.");
}

export const ROLE_SCHEMA = z.object({
  name: z.string().trim().min(2, "Name: at least 2 characters.").max(40, "Name: at most 40 characters."),
  description: z.string().trim().max(160, "Description: keep it to one line (160 characters).").default(""),
  branchAccess: z.enum(["ASSIGNED", "ALL"], { message: "Pick the branch access." }),
  permissions: z.array(z.string()).default([]),
  /** New role only: the role whose ticks were copied ("Copy from another role"), for the audit row. */
  copiedFromId: z.string().optional(),
});

type RoleRow = NonNullable<Awaited<ReturnType<typeof prisma.role.findUnique>>>;

/** Plain diff for the audit row: "added Mark as done; removed Add a transaction". */
export function permissionDiff(before: Iterable<string>, after: Iterable<string>) {
  const b = new Set(before);
  const a = new Set(after);
  const added = [...a].filter((k) => !b.has(k));
  const removed = [...b].filter((k) => !a.has(k));
  const words = [
    added.length ? `added ${added.map(permissionLabel).join(", ")}` : "",
    removed.length ? `removed ${removed.map(permissionLabel).join(", ")}` : "",
  ].filter(Boolean).join("; ");
  return { added, removed, words };
}

/**
 * Lock-out protection (lib/services/lockout.ts): someone active must always keep "Manage roles" and
 * "Change branch access"; and the editor cannot take "Manage roles" away from their own role.
 */
export async function lockoutReason(user: CurrentUser, role: RoleRow, next: { permissions: Set<string>; active: boolean }): Promise<string | null> {
  const had = effectivePermissions(role).has(PERMISSIONS.ROLES_MANAGE) && role.active;
  const keeps = next.permissions.has(PERMISSIONS.ROLES_MANAGE) && next.active;
  if (had && !keeps && user.roleId === role.id) return "You cannot take \"Manage roles\" away from your own role. Ask another person who can manage roles.";
  return checkLockout({ kind: "role", roleId: role.id, permissions: next.permissions, active: next.active });
}
async function guardManageAbility(user: CurrentUser, role: RoleRow, next: { permissions: Set<string>; active: boolean }) {
  const why = await lockoutReason(user, role, next);
  if (why) throw new UserError(why, "permissions");
}

async function uniqueNameOrThrow(name: string, exceptId?: string) {
  const clash = await prisma.role.findFirst({ where: { name: { equals: name, mode: "insensitive" }, id: exceptId ? { not: exceptId } : undefined } });
  if (clash) throw new UserError(`A role called "${clash.name}" already exists. Pick another name.`, "name");
}

async function newRoleKey(name: string) {
  const base = `C_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 20) || "ROLE"}`;
  let key = base;
  for (let i = 2; await prisma.role.findUnique({ where: { key } }); i++) key = `${base}_${i}`;
  return key;
}

/** Add (id null) or change a role. */
export async function saveRole(user: CurrentUser, id: string | null, raw: unknown) {
  requireManager(user);
  const p = ROLE_SCHEMA.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw new UserError(i.message, String(i.path[0] ?? ""));
  }
  const d = p.data;
  const perms = new Set(normalizePermissions(d.permissions));

  if (!id) {
    await uniqueNameOrThrow(d.name);
    const max = await prisma.role.aggregate({ _max: { sortOrder: true } });
    const from = d.copiedFromId ? await prisma.role.findUnique({ where: { id: d.copiedFromId }, select: { id: true, name: true } }) : null;
    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          key: await newRoleKey(d.name), name: d.name, description: d.description, branchAccess: d.branchAccess,
          permissions: [...perms], canSignIn: false, builtIn: false, sortOrder: (max._max.sortOrder ?? 0) + 1,
        },
      });
      await writeAudit(tx, {
        actor: actorOf(user), mode: "MANUAL", action: "role_created", entityType: "role", entityId: created.id,
        summary: `Added role ${created.name}${from ? ` (copied from ${from.name})` : ""} (${d.branchAccess === "ALL" ? "all branches" : "assigned branches"}): ${perms.size ? [...perms].map(permissionLabel).join(", ") : "no permissions"}`,
        after: { name: created.name, branchAccess: d.branchAccess, permissions: [...perms] },
        details: { added: [...perms], removed: [], ...(from ? { copiedFrom: from.id } : {}) },
      });
      return created;
    });
    return role.id;
  }

  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw new UserError("Role not found. It may have been changed by someone else.");
  if (role.builtIn && d.name !== role.name) throw new UserError("Built-in role names cannot be changed.", "name");
  if (!role.builtIn) await uniqueNameOrThrow(d.name, id);

  await guardManageAbility(user, role, { permissions: perms, active: role.active });

  const diff = permissionDiff(effectivePermissions(role), perms);
  const parts = [
    role.name !== d.name ? `renamed from ${role.name}` : "",
    role.branchAccess !== d.branchAccess ? `branch access ${d.branchAccess === "ALL" ? "all branches" : "assigned branches only"}` : "",
    role.description !== d.description ? "description changed" : "",
    diff.words,
  ].filter(Boolean);
  if (parts.length === 0) return id;

  await prisma.$transaction(async (tx) => {
    await tx.role.update({ where: { id }, data: { name: d.name, description: d.description, branchAccess: d.branchAccess, permissions: [...perms] } });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "role_updated", entityType: "role", entityId: id,
      summary: `Role ${d.name}: ${parts.join("; ")}`,
      before: { name: role.name, branchAccess: role.branchAccess, permissions: role.permissions },
      after: { name: d.name, branchAccess: d.branchAccess, permissions: [...perms] },
      details: { added: diff.added, removed: diff.removed },
    });
  });
  return id;
}

/** "Copy of Loan Associate" (a custom role with the same switches). */
export async function duplicateRole(user: CurrentUser, id: string) {
  requireManager(user);
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw new UserError("Role not found.");
  let name = `Copy of ${role.name}`.slice(0, 40);
  for (let i = 2; await prisma.role.findFirst({ where: { name: { equals: name, mode: "insensitive" } } }); i++) name = `Copy of ${role.name}`.slice(0, 35) + ` (${i})`;
  const perms = [...effectivePermissions(role)];
  const max = await prisma.role.aggregate({ _max: { sortOrder: true } });
  return prisma.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: { key: await newRoleKey(name), name, description: role.description, branchAccess: role.branchAccess, permissions: perms, canSignIn: false, builtIn: false, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "role_duplicated", entityType: "role", entityId: created.id,
      summary: `Duplicated role ${role.name} as ${name}`, after: { name, branchAccess: role.branchAccess, permissions: perms }, details: { from: role.id },
    });
    return created.id;
  });
}

/** Built-in roles: restore the seeded switches, branch access and description. */
export async function resetRoleToDefault(user: CurrentUser, id: string) {
  requireManager(user);
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw new UserError("Role not found.");
  const def = role.builtIn ? ROLE_DEFAULTS[role.key] : undefined;
  if (!def) throw new UserError("Only built-in roles have a default to go back to.");
  const perms = new Set<string>(def.permissions);
  await guardManageAbility(user, role, { permissions: perms, active: role.active });
  const diff = permissionDiff(effectivePermissions(role), perms);
  await prisma.$transaction(async (tx) => {
    await tx.role.update({ where: { id }, data: { permissions: [...perms], branchAccess: def.branchAccess, description: def.description } });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "role_reset", entityType: "role", entityId: id,
      summary: `Role ${role.name} reset to default${diff.words ? `: ${diff.words}` : " (no change)"}`,
      before: { branchAccess: role.branchAccess, permissions: role.permissions }, after: { branchAccess: def.branchAccess, permissions: [...perms] },
      details: { added: diff.added, removed: diff.removed },
    });
  });
}

/** Inactive instead of delete. Refused while people have the role. */
export async function setRoleActive(user: CurrentUser, id: string, active: boolean) {
  requireManager(user);
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw new UserError("Role not found.");
  if (role.active === active) return;
  if (!active) {
    const people = await prisma.user.count({ where: { roleId: id } });
    if (people > 0) throw new UserError(`${people} ${people === 1 ? "person has" : "people have"} this role. Move them to another role first.`, "people");
    await guardManageAbility(user, role, { permissions: effectivePermissions(role), active: false });
  }
  await prisma.$transaction(async (tx) => {
    await tx.role.update({ where: { id }, data: active ? { active: true, deactivatedAt: null, deactivatedById: null } : { active: false, deactivatedAt: new Date(), deactivatedById: user.id } });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: active ? "made_active" : "made_inactive", entityType: "role", entityId: id,
      summary: `Role ${role.name} made ${active ? "active" : "inactive"}`, before: { active: role.active }, after: { active },
    });
  });
}

/**
 * The role editor's check before Save (and before Make inactive): who gains or loses what, and the
 * lock-out reason when the change would be refused. Same rules as the save itself.
 */
export async function checkRoleChange(user: CurrentUser, id: string | null, keys: string[], active?: boolean): Promise<{ impact: RoleImpact; lockout: string | null }> {
  requireManager(user);
  const after = new Set<string>(normalizePermissions(keys));
  if (!id) return { impact: roleImpact([], after, 0), lockout: null };
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) throw new UserError("Role not found. It may have been changed by someone else.");
  const users = await prisma.user.count({ where: { roleId: id, active: true } });
  const nextActive = active ?? role.active;
  return {
    impact: roleImpact(effectivePermissions(role), after, role.active ? users : 0),
    lockout: await lockoutReason(user, role, { permissions: after, active: nextActive }),
  };
}

/** The last recorded change of each role: "Last changed Nov 9, 2026 by Admin: added Refresh a loan from MyLoans". */
export async function lastRoleChanges(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: "role", entityId: { in: ids } },
    orderBy: { at: "desc" }, select: { entityId: true, at: true, actorLabel: true, summary: true, details: true },
  });
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.entityId || out.has(r.entityId)) continue;
    out.set(r.entityId, `Last changed ${fmtDate(r.at)} by ${r.actorLabel}: ${lastChangeWhat(r)}`);
  }
  return out;
}

/** Access matrix: one row per permission, one column per role, Yes/No (read-only). */
export async function accessMatrixCsv(): Promise<string> {
  const roles = await prisma.role.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const cols = roles.map((r) => `${r.name}${r.active ? "" : " (inactive)"}`);
  const header = ["area", "permission", "key", ...cols];
  const rows: Record<string, string>[] = [];
  for (const g of VISIBLE_PERMISSION_GROUPS) {
    for (const item of g.items) {
      const row: Record<string, string> = { area: g.label, permission: item.label, key: item.key };
      roles.forEach((r, i) => { row[cols[i]] = effectivePermissions(r).has(item.key as Permission) ? "Yes" : "No"; });
      rows.push(row);
    }
  }
  rows.push({ area: "Branch access", permission: "All branches", key: "branch_access", ...Object.fromEntries(roles.map((r, i) => [cols[i], r.branchAccess === "ALL" ? "Yes" : "No"])) });
  return toCsv(header, rows);
}

