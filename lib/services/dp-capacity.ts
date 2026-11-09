import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { setSetting } from "@/lib/settings";
import { businessDate, fmtDate } from "@/lib/time";
import { AVAILABILITY } from "@/lib/monitoring/rules";
import { defaultCapacity } from "./monitoring";
import { UserError } from "./errors";

/**
 * Processor capacity and On leave (dpcapacity:manage): the default capacity in open jobs (Setting
 * dp.defaultCapacity), a processor's own capacity (blank = the default), and On leave with an optional
 * last day. One audit row per change.
 */

const capacityNumber = z.coerce.number({ message: `Enter a whole number from ${AVAILABILITY.minCapacity} to ${AVAILABILITY.maxCapacity}.` })
  .int(`Enter a whole number from ${AVAILABILITY.minCapacity} to ${AVAILABILITY.maxCapacity}.`)
  .min(AVAILABILITY.minCapacity, `Enter a whole number from ${AVAILABILITY.minCapacity} to ${AVAILABILITY.maxCapacity}.`)
  .max(AVAILABILITY.maxCapacity, `Enter a whole number from ${AVAILABILITY.minCapacity} to ${AVAILABILITY.maxCapacity}.`);

function need(u: CurrentUser) {
  if (!u.permissions.has(PERMISSIONS.DP_CAPACITY_MANAGE)) throw new UserError("Your role does not allow changing processor capacity.");
}

export async function saveDefaultCapacity(u: CurrentUser, raw: unknown): Promise<string> {
  need(u);
  const p = capacityNumber.safeParse(raw);
  if (!p.success) throw new UserError(p.error.issues[0].message, "defaultCapacity");
  const before = await defaultCapacity();
  if (before === p.data) return "No change.";
  await prisma.$transaction(async (tx) => {
    await setSetting("dp.defaultCapacity", p.data, tx);
    await writeAudit(tx, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "dp_capacity_default_changed", entityType: "Setting", entityId: "dp.defaultCapacity", summary: `${u.name} changed the default processor capacity from ${before} to ${p.data} open jobs`, before: { capacity: before }, after: { capacity: p.data } });
  });
  return `Default capacity: ${p.data} open jobs.`;
}

export interface DpCapacityInput { capacity: string; onLeave: boolean; leaveUntil: string }

export async function saveDpCapacity(u: CurrentUser, userId: string, input: DpCapacityInput, now: Date = new Date()): Promise<string> {
  need(u);
  const dp = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!dp || !dp.role.permissions.includes(PERMISSIONS.DP_RECEIVE)) throw new UserError("That person is not a processor.");
  let capacity: number | null = null;
  if (input.capacity.trim() !== "") {
    const p = capacityNumber.safeParse(input.capacity);
    if (!p.success) throw new UserError(p.error.issues[0].message, "capacity");
    capacity = p.data;
  }
  const until = input.onLeave && input.leaveUntil.trim() ? input.leaveUntil.trim() : null;
  if (until) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new UserError("Enter the last day of the leave.", "leaveUntil");
    if (until < businessDate(now)) throw new UserError("The last day of the leave cannot be in the past.", "leaveUntil");
  }
  const changes: string[] = [];
  if (capacity !== dp.dpCapacity) changes.push(`capacity ${dp.dpCapacity ?? "default"} to ${capacity ?? "default"}`);
  if (input.onLeave !== dp.dpOnLeave || (input.onLeave && until !== dp.dpLeaveUntil)) changes.push(input.onLeave ? `on leave${until ? ` until ${fmtDate(until)}` : ""}` : "back from leave");
  if (!changes.length) return "No change.";
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: dp.id }, data: { dpCapacity: capacity, dpOnLeave: input.onLeave, dpLeaveUntil: input.onLeave ? until : null } });
    await writeAudit(tx, {
      actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "dp_capacity_changed", entityType: "User", entityId: dp.id,
      summary: `${u.name} changed ${dp.name}: ${changes.join(", ")}`,
      before: { capacity: dp.dpCapacity, onLeave: dp.dpOnLeave, leaveUntil: dp.dpLeaveUntil }, after: { capacity, onLeave: input.onLeave, leaveUntil: input.onLeave ? until : null },
    });
  });
  return `${dp.name}: ${changes.join(", ")}.`;
}

/** For actions: the signed-in person with dpcapacity:manage. */
export const requireCapacityManager = () => requirePermission(PERMISSIONS.DP_CAPACITY_MANAGE);
