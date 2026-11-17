import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { UserError } from "./errors";

/**
 * Settings, Inbox waiting colours (D-046, D-048): how many working days an item may wait in a branch pool before it
 * turns amber, then red. Changed with "Change turnaround times"; validated (red after amber) and audited.
 */
export const POOL_LIMITS = { min: 1, max: 30 } as const;
const days = z.coerce.number({ message: `Enter a whole number of working days from ${POOL_LIMITS.min} to ${POOL_LIMITS.max}.` })
  .int(`Enter a whole number of working days from ${POOL_LIMITS.min} to ${POOL_LIMITS.max}.`)
  .min(POOL_LIMITS.min, `Enter a whole number of working days from ${POOL_LIMITS.min} to ${POOL_LIMITS.max}.`)
  .max(POOL_LIMITS.max, `Enter a whole number of working days from ${POOL_LIMITS.min} to ${POOL_LIMITS.max}.`);

export async function poolColours() {
  const [amber, red] = await Promise.all([getSetting("pool.amberAfterDays"), getSetting("pool.redAfterDays")]);
  return { amber, red };
}

export async function savePoolColours(u: CurrentUser, raw: { amber: unknown; red: unknown }): Promise<string> {
  if (!can(u, PERMISSIONS.SETTINGS_TAT)) throw new UserError("Your role does not allow changing turnaround times.");
  const a = days.safeParse(raw.amber);
  if (!a.success) throw new UserError(a.error.issues[0].message, "amber");
  const r = days.safeParse(raw.red);
  if (!r.success) throw new UserError(r.error.issues[0].message, "red");
  if (r.data <= a.data) throw new UserError("Red comes after amber: enter more days for red than for amber.", "red");
  const before = await poolColours();
  if (before.amber === a.data && before.red === r.data) return "No change.";
  await prisma.$transaction(async (tx) => {
    await setSetting("pool.amberAfterDays", a.data, tx);
    await setSetting("pool.redAfterDays", r.data, tx);
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "pool_colours_changed", entityType: "Setting", entityId: "pool.colours",
      summary: `${u.name} changed the pool waiting colours: amber after ${a.data}, red after ${r.data} working days (was ${before.amber} and ${before.red})`,
      before, after: { amber: a.data, red: r.data },
    });
  });
  return `Saved: amber after ${a.data} working day${a.data === 1 ? "" : "s"}, red after ${r.data}.`;
}
