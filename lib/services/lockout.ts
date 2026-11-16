import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { effectivePermissions } from "@/lib/auth/access";
import { userPermissions, type OverrideLike } from "@/lib/auth/effective";
import { PERMISSIONS, permissionDef, type Permission } from "@/lib/auth/permissions";

/**
 * Lock-out protection. Roles are just ticks and people can have overrides (D-008), so a careless change
 * could leave nobody able to manage permissions or branch access again. These ticks must always stay with
 * at least one active role AND at least one active person who effectively holds them (role tick, not
 * denied, or granted). Checked on the server for every role change (ticks, inactive, reset), every user
 * change (role, inactive, overrides) and the users import; the screens show the same reason first.
 * Nothing here looks at a role's name or key.
 */
export const KEEP_PERMISSIONS: Permission[] = [PERMISSIONS.ROLES_MANAGE, PERMISSIONS.ACCESS_MANAGE];

type Db = typeof prisma | Prisma.TransactionClient;
interface SnapUser { active: boolean; roleId: string; overrides: OverrideLike[]; handlesCa: boolean; handlesFt: boolean }
export interface AccessSnapshot {
  roles: Map<string, { name: string; active: boolean; permissions: Set<string> }>;
  users: Map<string, SnapUser>;
}

export async function loadSnapshot(db: Db = prisma): Promise<AccessSnapshot> {
  const [roles, users] = await Promise.all([
    db.role.findMany({ select: { id: true, name: true, active: true, permissions: true } }),
    db.user.findMany({ select: { id: true, active: true, roleId: true, handlesCa: true, handlesFt: true, permissionOverrides: { select: { key: true, effect: true } } } }),
  ]);
  return {
    roles: new Map(roles.map((r) => [r.id, { name: r.name, active: r.active, permissions: effectivePermissions(r) as Set<string> }])),
    users: new Map(users.map((u) => [u.id, { active: u.active, roleId: u.roleId, overrides: u.permissionOverrides, handlesCa: u.handlesCa, handlesFt: u.handlesFt }])),
  };
}

export type AccessChange =
  | { kind: "role"; roleId: string; permissions?: Iterable<string>; active?: boolean }
  | { kind: "user"; userId: string; roleId?: string; active?: boolean; overrides?: OverrideLike[] };

/** The snapshot after one change (a copy; the input is not touched). */
export function applyChange(s: AccessSnapshot, c: AccessChange): AccessSnapshot {
  const next: AccessSnapshot = { roles: new Map(s.roles), users: new Map(s.users) };
  if (c.kind === "role") {
    const r = next.roles.get(c.roleId);
    if (r) next.roles.set(c.roleId, { ...r, ...(c.permissions ? { permissions: new Set(c.permissions) } : {}), ...(c.active !== undefined ? { active: c.active } : {}) });
  } else {
    const u = next.users.get(c.userId) ?? { active: true, roleId: c.roleId ?? "", overrides: [], handlesCa: false, handlesFt: false };
    next.users.set(c.userId, { ...u, roleId: c.roleId ?? u.roleId, active: c.active ?? u.active, overrides: c.overrides ?? u.overrides });
  }
  return next;
}

const rolesWith = (s: AccessSnapshot, key: string) => [...s.roles.entries()].filter(([, r]) => r.active && r.permissions.has(key)).map(([id]) => id);
/** Active people who effectively hold the key (their role's ticks, their overrides). */
const peopleWith = (s: AccessSnapshot, key: string) =>
  [...s.users.values()].filter((u) => {
    const role = s.roles.get(u.roleId);
    return u.active && role?.active && userPermissions(role.permissions, u.overrides, u).has(key as Permission);
  }).length;

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
