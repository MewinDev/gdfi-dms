import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { effectivePermissions } from "@/lib/auth/access";
import { keySource, type OverrideLike } from "@/lib/auth/effective";
import { OPEN_ITEM_APPROVER_KEYS, PERMISSIONS as P, permissionDef, permissionLabel } from "@/lib/auth/permissions";
import { writeAudit, type Actor } from "@/lib/audit";
import { checkLockout } from "./lockout";
import { UserError } from "./errors";

/**
 * Who may change a person's access and scope (D-023), and the per-user overrides (D-008).
 *
 *   Superadmin only (by default): the permission matrix, per-user overrides, "Can approve LA Open Items",
 *     "All branches" (keys roles:manage, access:all_branches).
 *   Admin and Superadmin: specific branches and Handles CA / Handles FT (access:manage).
 *   Nobody: their own role, access, scope or overrides.
 * Every change is audit-logged with before and after. The rules are checked here, on the server, for the
 * Users screen, the users import and Copy access alike.
 */

const actorOf = (u: CurrentUser): Actor => ({ id: u.id, label: u.name });

export function refuseSelf(actor: Pick<CurrentUser, "id">, targetUserId: string | null, what: string) {
  if (targetUserId && actor.id === targetUserId) throw new UserError(`You cannot change your own ${what}. Ask another person who can.`);
}

/** Turning "All branches" on or off is the Superadmin's (access:all_branches). */
export function refuseAllBranchesChange(actor: CurrentUser, wasAll: boolean, nowAll: boolean) {
  if (wasAll !== nowAll && !can(actor, P.ACCESS_ALL_BRANCHES)) {
    throw new UserError(`Only someone who can ${permissionDef(P.ACCESS_ALL_BRANCHES)!.can} may turn "All branches" ${nowAll ? "on" : "off"}. Pick specific branches instead.`, "access");
  }
}

/** The Superadmin's powers (D-023): only someone who manages permissions may give a role that has them. */
export const SUPERADMIN_ONLY_KEYS = [P.ROLES_MANAGE, P.ACCESS_ALL_BRANCHES];

/**
 * Giving a role: day-to-day staffing is the Admin's (any LA, DP, Finance, ... role), but a role that can
 * manage permissions or give All branches only by someone who can manage permissions (no escalation).
 */
export function refuseRoleEscalation(actor: CurrentUser, role: { name: string; permissions: string[] }) {
  if (can(actor, P.ROLES_MANAGE)) return;
  const has = effectivePermissions(role);
  const power = SUPERADMIN_ONLY_KEYS.filter((k) => has.has(k));
  if (power.length) {
    throw new UserError(`You cannot give the role ${role.name}: it can ${power.map((k) => permissionDef(k)?.can ?? k).join(" and ")}. Ask someone who can manage permissions.`, "roleId");
  }
}

// ---------------------------------------------------------------------------
// Per-user overrides (Inherited / Granted / Denied)
// ---------------------------------------------------------------------------

const OVERRIDE_SCHEMA = z.object({
  key: z.string().refine((k) => !!permissionDef(k), "Unknown permission."),
  value: z.enum(["INHERIT", "GRANT", "DENY"]),
  note: z.string().trim().max(200, "Keep the reason under 200 characters.").default(""),
});
export const OVERRIDES_SCHEMA = z.array(OVERRIDE_SCHEMA).max(200);
export type OverrideInput = z.input<typeof OVERRIDE_SCHEMA>;

const word = { GRANT: "Granted", DENY: "Denied", INHERIT: "Inherited" } as const;

/**
 * Sets some of a person's overrides (keys not sent are kept). INHERIT removes the override. Needs
 * "Manage permissions"; never your own; the last holder of "Manage permissions" / "Change branch
 * access" cannot be taken away (lock-out). One audit row lists every change with before and after.
 */
export async function saveUserOverrides(actor: CurrentUser, userId: string, raw: unknown) {
  if (!can(actor, P.ROLES_MANAGE)) throw new UserError("Only someone who can manage permissions may change a person's permissions.");
  refuseSelf(actor, userId, "permissions");
  const p = OVERRIDES_SCHEMA.safeParse(raw);
  if (!p.success) throw new UserError(p.error.issues[0].message);
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { role: true, permissionOverrides: true } });
  if (!target) throw new UserError("User not found.");

  const current = new Map(target.permissionOverrides.map((o) => [o.key, o]));
  const next = new Map<string, OverrideLike & { note: string }>(target.permissionOverrides.map((o) => [o.key, { key: o.key, effect: o.effect, note: o.note }]));
  const changes: { key: string; label: string; before: string; after: string; note: string }[] = [];
  for (const o of p.data) {
    const before = current.get(o.key)?.effect ?? "INHERIT";
    if (o.value === "INHERIT") next.delete(o.key);
    else next.set(o.key, { key: o.key, effect: o.value, note: o.note });
    if (before !== o.value || (o.value !== "INHERIT" && (current.get(o.key)?.note ?? "") !== o.note)) {
      if (o.value !== "INHERIT" && o.note.length < 3) throw new UserError(`Say why ${permissionLabel(o.key)} is ${word[o.value].toLowerCase()} (a short reason).`, `note:${o.key}`);
      changes.push({ key: o.key, label: permissionLabel(o.key), before: word[before], after: word[o.value], note: o.note });
    }
  }
  if (!changes.length) return { changed: 0 };
  const why = await checkLockout({ kind: "user", userId, overrides: [...next.values()] });
  if (why) throw new UserError(why);

  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      const n = next.get(c.key);
      if (!n) await tx.userPermissionOverride.deleteMany({ where: { userId, key: c.key } });
      else await tx.userPermissionOverride.upsert({ where: { userId_key: { userId, key: c.key } }, create: { userId, key: c.key, effect: n.effect, note: n.note, setById: actor.id }, update: { effect: n.effect, note: n.note, setById: actor.id, setAt: new Date() } });
    }
    await writeAudit(tx, {
      actor: actorOf(actor), mode: "MANUAL", action: "permissions_overridden", entityType: "User", entityId: userId,
      summary: `Permissions of ${target.name}: ${changes.map((c) => `${c.label} ${c.before} -> ${c.after}`).join("; ")}`,
      before: Object.fromEntries(changes.map((c) => [c.key, c.before])), after: Object.fromEntries(changes.map((c) => [c.key, c.after])),
      details: { notes: Object.fromEntries(changes.filter((c) => c.note).map((c) => [c.key, c.note])) },
    });
  });
  return { changed: changes.length };
}

/**
 * "Can approve LA Open Items" (D-010): on = GRANT both approver keys, off = DENY them, "role default" =
 * INHERIT. A Superadmin tick (it goes through saveUserOverrides: Manage permissions, never your own).
 */
export async function setOpenItemApprover(actor: CurrentUser, userId: string, value: "INHERIT" | "GRANT" | "DENY", note: string) {
  return saveUserOverrides(actor, userId, OPEN_ITEM_APPROVER_KEYS.map((key) => ({ key, value, note })));
}

/** The approver tick as the screen shows it: what the person has now, and where it comes from. */
export function approverState(roleKeys: string[], overrides: OverrideLike[]): { on: boolean; source: "INHERITED" | "GRANTED" | "DENIED" | "NONE" } {
  const sources = OPEN_ITEM_APPROVER_KEYS.map((k) => keySource(k, roleKeys, overrides));
  const source = sources.includes("DENIED") ? "DENIED" : sources.every((s) => s === "GRANTED") ? "GRANTED" : sources.every((s) => s === "INHERITED") ? "INHERITED" : "NONE";
  return { on: source === "GRANTED" || source === "INHERITED", source };
}

// ---------------------------------------------------------------------------
// Handles CA / Handles FT (D-009)
// ---------------------------------------------------------------------------

const TICKS_SCHEMA = z.object({ handlesCa: z.boolean(), handlesFt: z.boolean() });

/** Admin and Superadmin (Change branch access); never your own. Audited. */
export async function saveFundTypeTicks(actor: CurrentUser, userId: string, raw: unknown) {
  if (!can(actor, P.ACCESS_MANAGE)) throw new UserError("Your role does not allow changing who handles cash advances and fund transfers.");
  refuseSelf(actor, userId, "fund types");
  const p = TICKS_SCHEMA.safeParse(raw);
  if (!p.success) throw new UserError("Tick Handles CA and Handles FT again.");
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, handlesCa: true, handlesFt: true } });
  if (!before) throw new UserError("User not found.");
  if (before.handlesCa === p.data.handlesCa && before.handlesFt === p.data.handlesFt) return { changed: false };
  const label = (t: { handlesCa: boolean; handlesFt: boolean }) => [t.handlesCa && "CA", t.handlesFt && "FT"].filter(Boolean).join(" and ") || "none";
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: p.data });
    await writeAudit(tx, {
      actor: actorOf(actor), mode: "MANUAL", action: "fund_types_changed", entityType: "User", entityId: userId,
      summary: `Fund types handled by ${before.name}: ${label(before)} -> ${label(p.data)}`,
      before: { handlesCa: before.handlesCa, handlesFt: before.handlesFt }, after: p.data,
    });
  });
  return { changed: true };
}
