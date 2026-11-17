import "server-only";
import { cache } from "react";
import { prisma, type Tx } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { DEFAULT_WORKING_WEEKDAYS, daysFor, type Days, type WorkCalendar } from "./core";

/**
 * The calendar from the database (D-041): the working weekdays (Settings, Holidays and working days) and every
 * active holiday and office closure with its branches. Small; read once per request on pages (getCalendar)
 * and inside a transaction where a write depends on it (loadCalendar).
 */
export async function loadCalendar(db: Tx | typeof prisma = prisma): Promise<WorkCalendar> {
  const [week, amber, rows] = await Promise.all([
    getSetting("calendar.workingDays", db),
    getSetting("tat.amberWithinDays", db),
    db.holidayCalendar.findMany({ where: { active: true }, select: { id: true, date: true, allBranches: true, kind: true, branches: { select: { branchId: true } } } }),
  ]);
  const weekdays = Array.isArray(week) && week.length === 7 && week.some(Boolean) ? week.map(Boolean) : [...DEFAULT_WORKING_WEEKDAYS];
  return { workingWeekdays: weekdays, amberWithinDays: amber, entries: rows.map((r) => ({ id: r.id, date: r.date, allBranches: r.allBranches, kind: r.kind, branchIds: r.branches.map((b) => b.branchId) })) };
}

/** The calendar for this request (cached per render). */
export const getCalendar = cache(() => loadCalendar());

/** One branch's calendar for this request. */
export async function getDays(branchId: string | null | undefined): Promise<Days> {
  return daysFor(await getCalendar(), branchId);
}
