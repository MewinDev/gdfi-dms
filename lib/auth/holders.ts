/**
 * "Who holds this permission?" as a database filter on User (D-008): the ONE way to find the people to
 * notify, to pick (processors, receivers, hold movers) or to check (lock-out). It applies the same rule
 * as lib/auth/effective.ts: an active person with an active role, the key on the role and not DENIED,
 * or GRANTED to the person; and, for a per-type funds key, the type ticked on the person (Handles CA / FT).
 * Code outside lib/auth never filters on `role.permissions` itself (lib/auth/scope.test.ts enforces it).
 */
import type { Prisma } from "@prisma/client";
import type { Permission } from "./permissions";
import { CA_KEYS, FT_KEYS } from "./effective";

function tickWhere(key: Permission): Prisma.UserWhereInput {
  if (CA_KEYS.includes(key)) return { handlesCa: true };
  if (FT_KEYS.includes(key)) return { handlesFt: true };
  return {};
}

/** Active people with an active role who hold `key` (role tick not denied, or granted). */
export function holdsWhere(key: Permission): Prisma.UserWhereInput {
  return {
    AND: [
      { active: true, role: { active: true } },
      {
        OR: [
          { role: { permissions: { has: key } }, permissionOverrides: { none: { key, effect: "DENY" } } },
          { permissionOverrides: { some: { key, effect: "GRANT" } } },
        ],
      },
      tickWhere(key),
    ],
  };
}

/** Holds at least one of the keys. */
export function holdsAnyWhere(keys: Permission[]): Prisma.UserWhereInput {
  return keys.length === 1 ? holdsWhere(keys[0]) : { OR: keys.map(holdsWhere) };
}

/** Holds every one of the keys. */
export function holdsAllWhere(keys: Permission[]): Prisma.UserWhereInput {
  return { AND: keys.map(holdsWhere) };
}

/** Does NOT hold the key (for "people with X but not Y"). */
export function lacksWhere(key: Permission): Prisma.UserWhereInput {
  return { NOT: holdsWhere(key) };
}

/** Combines a holders filter with other filters without key clashes (both OR-free). */
export const andWhere = (...parts: Prisma.UserWhereInput[]): Prisma.UserWhereInput => ({ AND: parts.filter((p) => Object.keys(p).length) });
