import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { effectivePermissions } from "@/lib/auth/access";
import { PERMISSIONS, permissionDef, type Permission } from "@/lib/auth/permissions";

/**
 * Lock-out protection. Roles are just ticks, so a careless change could leave nobody able to change
 * roles or branch access again. These two ticks must always stay with at least one active role that at
 * least one active person holds. Checked on the server for every role change (ticks, inactive, reset),
 * every user change (role, inactive) and the users import; the role editor shows the same reason first.
 * Nothing here looks at a role's name or key.
 */
export const KEEP_PERMISSIONS: Permission[] = [PERMISSIONS.ROLES_MANAGE, PERMISSIONS.ACCESS_MANAGE];

type Db = typeof prisma | Prisma.TransactionClient;
export interface AccessSnapshot {
  roles: Map<string, { name: string; active: boolean; permissions: Set<string> }>;
  users: Map<string, { active: boolean; roleId: string }>;
}

export async function loadSnapshot(db: Db = prisma): Promise<AccessSnapshot> {
  const [roles, users] = await Promise.all([
    db.role.findMany({ select: { id: true, name: true, active: true, permissions: true } }),
    db.user.findMany({ select: { id: true, active: true, roleId: true } }),
  ]);
  return {
    roles: new Map(roles.map((r) => [r.id, { name: r.name, active: r.active, permissions: effectivePermissions(r) as Set<string> }])),
    users: new Map(users.map((u) => [u.id, { active: u.active, roleId: u.roleId }])),
  };
}

export type AccessChange =
  | { kind: "role"; roleId: string; permissions?: Iterable<string>; active?: boolean }
  | { kind: "user"; userId: string; roleId?: string; active?: boolean };

/** The snapshot after one change (a copy; the input is not touched). */
export function applyChange(s: AccessSnapshot, c: AccessChange): AccessSnapshot {
  const next: AccessSnapshot = { roles: new Map(s.roles), users: new Map(s.users) };
  if (c.kind === "role") {
    const r = next.roles.get(c.roleId);
    if (r) next.roles.set(c.roleId, { ...r, ...(c.permissions ? { permissions: new Set(c.permissions) } : {}), ...(c.active !== undefined ? { active: c.active } : {}) });
  } else {
    const u = next.users.get(c.userId) ?? { active: true, roleId: c.roleId ?? "" };
    next.users.set(c.userId, { roleId: c.roleId ?? u.roleId, active: c.active ?? u.active });
  }
  return next;
}

const rolesWith = (s: AccessSnapshot, key: string) => [...s.roles.entries()].filter(([, r]) => r.active && r.permissions.has(key)).map(([id]) => id);
const peopleWith = (s: AccessSnapshot, key: string) => {
  const roles = new Set(rolesWith(s, key));
  return [...s.users.values()].filter((u) => u.active && roles.has(u.roleId)).length;
};

/** How many active people hold each protected tick (for the role editor's notes). */
export function keepCounts(s: AccessSnapshot): Record<string, { roles: number; people: number }> {
  return Object.fromEntries(KEEP_PERMISSIONS.map((k) => [k, { roles: rolesWith(s, k).length, people: peopleWith(s, k) }]));
}

/**
 * Why the change may not be made (plain words), or null. Only a change that takes the LAST holder away
 * is refused: a database that already had nobody (a fresh test setup) is never made worse by it.
 */
export function lockoutRefusal(before: AccessSnapshot, c: AccessChange): string | null {
  const after = applyChange(before, c);
  for (const key of KEEP_PERMISSIONS) {
    const label = permissionDef(key)!.label;
    const can = permissionDef(key)!.can;
    const rolesBefore = rolesWith(before, key);
    if (c.kind === "role" && rolesBefore.length > 0 && rolesWith(after, key).length === 0) {
      return `${before.roles.get(c.roleId)?.name ?? "This role"} is the last role that can ${can}. Keep "${label}" ticked, or tick it on another role first.`;
    }
    if (peopleWith(before, key) > 0 && peopleWith(after, key) === 0) {
      return c.kind === "role"
        ? `Nobody active could ${can} after this change. Keep "${label}" ticked, or give a role with it to another active person first.`
        : `This is the last active person who can ${can}. Give "${label}" to another active person first.`;
    }
  }
  return null;
}

/** Loads the current state and checks one change. */
export async function checkLockout(c: AccessChange, db: Db = prisma): Promise<string | null> {
  return lockoutRefusal(await loadSnapshot(db), c);
}
