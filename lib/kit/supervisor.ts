import "server-only";
import { prisma } from "@/lib/db";
import { FORMER_SUPERVISOR_KEYS, ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { MIGRATION_NOTE } from "@/lib/services/role-migration";

/**
 * The kit's supervisors are on the built-in LA Supervisor/Head role (key SUP). Like the people the D-010
 * role migration moves, they keep the former Branch Supervisor ticks the new default lacks (move holds,
 * resolve any problem, Monitoring, TAT report) as per-user grants, so the kit's scenarios still work.
 */
export async function grantFormerSupervisorTicks(userId: string) {
  const extra = FORMER_SUPERVISOR_KEYS.filter((k) => !ROLE_DEFAULTS.SUP.permissions.includes(k));
  for (const key of extra) {
    await prisma.userPermissionOverride.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, effect: "GRANT", note: MIGRATION_NOTE }, update: {} });
  }
}
