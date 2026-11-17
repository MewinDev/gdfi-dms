import "server-only";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { businessDate, endOfBusinessDay, fmtDate } from "@/lib/time";
import { addWorkingDays, daysFor, lostWorkingDays, WEEKDAY_NAMES, workingDaysBetween, type CalendarEntry, type WorkCalendar } from "@/lib/calendar/core";
import { loadCalendar } from "@/lib/calendar/load";
import { OPEN_ADVANCE } from "@/lib/funds/rules";
import { UserError } from "./errors";

/**
 * Settings, Holidays and working days (D-018, D-041): the working weekdays, holidays and office closures, and
 * the ONE rule that moves saved due dates when a working day is taken away: an open item is extended by the
 * working days lost INSIDE its counting window (after its start, up to and including its due date), even when
 * it is already overdue. Every move is a DueDateChange row and an audit row, and its owner is told.
 *
 * Saved due dates today: a DP job's TAT (DpAssignment.dueDate, from the accept day, on the processor's branch)
 * and the liquidation due date (CashAdvance.liquidationDueAt, from liquidationDueFrom, on the requesting
 * processor's branch). LA steps without an accept are still counted live from the calendar (piece 9).
 */

export const HOLIDAY_TYPES = { REGULAR: "Regular holiday", SPECIAL_NON_WORKING: "Special non-working day", LOCAL: "Local holiday" } as const;
export type HolidayTypeKey = keyof typeof HOLIDAY_TYPES;

const ymd = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").refine((d) => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "That date does not exist.");

export const entrySchema = z.object({
  kind: z.enum(["HOLIDAY", "CLOSURE"]),
  date: ymd,
  name: z.string().trim().max(80, "Keep the name under 80 characters.").default(""),
  type: z.enum(["REGULAR", "SPECIAL_NON_WORKING", "LOCAL"]).default("REGULAR"),
  allBranches: z.boolean(),
  branchIds: z.array(z.string().min(1)).default([]),
  reason: z.string().trim().max(300, "Keep the reason under 300 characters.").default(""),
});
export type EntryInput = z.input<typeof entrySchema>;

/** One saved due date that a calendar change would move. */
export interface DueMove {
  subjectType: "DpAssignment" | "CashAdvance";
  subjectId: string;
  label: string;
  loanId: string | null;
  pn: string | null;
  branchId: string;
  ownerIds: string[];
  from: string;
  to: string;
  wasOverdue: boolean;
  link: string;
}

function requireCalendar(u: CurrentUser) {
  if (!can(u, PERMISSIONS.SETTINGS_HOLIDAYS)) throw new UserError("Ask a Superadmin to turn on \"Change holidays\" for your role.");
}

/** Checks an entry: a name or a reason, the branches, and the back-dating limit (D-041). */
async function checkEntry(raw: EntryInput, today: string) {
  const p = entrySchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const e = p.data;
  if (e.kind === "HOLIDAY" && e.name.length < 3) throw new UserError("Give the holiday its name.", "name");
  if (e.kind === "CLOSURE" && e.reason.length < 5) throw new UserError("Say why the office is closed (at least 5 characters).", "reason");
  if (!e.allBranches && !e.branchIds.length) throw new UserError("Tick at least one branch, or choose All branches.", "branchIds");
  if (e.kind === "CLOSURE" && e.allBranches) throw new UserError("An office closure is for the branches you tick. For every branch, add a holiday.", "branchIds");
  if (e.date < today) {
    const max = await getSetting("calendar.backdateMaxDays");
    const back = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${e.date}T00:00:00Z`).getTime()) / 86_400_000);
    if (back > max) throw new UserError(`A date in the past can be added up to ${max} day${max === 1 ? "" : "s"} back. This one is ${back} days back.`, "date");
    if (e.reason.length < 5) throw new UserError("This date is in the past: say why it is added now (at least 5 characters).", "reason");
  }
  if (!e.allBranches) {
    const n = await prisma.branch.count({ where: { id: { in: e.branchIds } } });
    if (n !== new Set(e.branchIds).size) throw new UserError("Pick branches from the list.", "branchIds");
  }
  return { ...e, name: e.kind === "CLOSURE" && !e.name ? "Office closed" : e.name };
}

/** Every open saved due date, with its window and its branch. */
async function openDueDates(db: Tx | typeof prisma) {
  const [jobs, advances] = await Promise.all([
    db.dpAssignment.findMany({
      where: { dueDate: { not: null }, status: "ACCEPTED", transaction: { status: "IN_PROCESS" } },
      select: { id: true, dueDate: true, decidedAt: true, dueBranchId: true, dpBranchId: true, dpUserId: true, secondaryDpUserId: true, loanId: true, loan: { select: { pn: true } }, transaction: { select: { type: { select: { name: true } } } } },
    }),
    db.cashAdvance.findMany({
      where: { status: { in: OPEN_ADVANCE as never }, liquidationDueAt: { not: null } },
      select: { id: true, number: true, branchId: true, requestedById: true, liquidationDueAt: true, liquidationDueFrom: true, releasedAt: true },
    }),
  ]);
  return [
    ...jobs.filter((j) => j.decidedAt).map((j) => ({
      subjectType: "DpAssignment" as const, subjectId: j.id, label: `${j.loan.pn}: ${j.transaction.type.name}`, loanId: j.loanId, pn: j.loan.pn,
      branchId: j.dueBranchId ?? j.dpBranchId, ownerIds: [j.dpUserId, ...(j.secondaryDpUserId ? [j.secondaryDpUserId] : [])],
      start: businessDate(j.decidedAt!), due: j.dueDate!, link: `/jobs/${j.id}`,
    })),
    ...advances.map((a) => ({
      subjectType: "CashAdvance" as const, subjectId: a.id, label: `${a.number}: liquidation`, loanId: null, pn: null,
      branchId: a.branchId, ownerIds: [a.requestedById],
      start: a.liquidationDueFrom ?? businessDate(a.releasedAt ?? a.liquidationDueAt!), due: businessDate(a.liquidationDueAt!), link: "/my-funds?tab=liquidation",
    })),
  ];
}

/** What a calendar change does to the saved due dates (the preview, and the list to apply). */
export async function dueMoves(before: WorkCalendar, after: WorkCalendar, today: string, db: Tx | typeof prisma = prisma): Promise<DueMove[]> {
  const out: DueMove[] = [];
  for (const i of await openDueDates(db)) {
    const b = daysFor(before, i.branchId), a = daysFor(after, i.branchId);
    const lost = lostWorkingDays(i.start, i.due, b, a);
    if (lost <= 0) continue;
    out.push({ subjectType: i.subjectType, subjectId: i.subjectId, label: i.label, loanId: i.loanId, pn: i.pn, branchId: i.branchId, ownerIds: i.ownerIds, from: i.due, to: addWorkingDays(i.due, lost, a), wasOverdue: today > i.due, link: i.link });
  }
  return out;
}

export interface CalendarPreview { extend: number; overdue: number; text: string; moves: DueMove[] }
const previewOf = (moves: DueMove[]): CalendarPreview => {
  const overdue = moves.filter((m) => m.wasOverdue).length;
  return { extend: moves.length, overdue, moves, text: moves.length ? `This will extend ${moves.length} item${moves.length === 1 ? "" : "s"} (${overdue} currently overdue).` : "No saved due date changes." };
};

const withEntry = (cal: WorkCalendar, e: CalendarEntry): WorkCalendar => ({ ...cal, entries: [...cal.entries, e] });

/** The preview of adding a holiday or closure (nothing is saved). */
export async function previewEntry(u: CurrentUser, raw: EntryInput, now: Date = new Date()): Promise<CalendarPreview> {
  requireCalendar(u);
  const today = businessDate(now);
  const e = await checkEntry(raw, today);
  const cal = await loadCalendar();
  return previewOf(await dueMoves(cal, withEntry(cal, { date: e.date, allBranches: e.allBranches, branchIds: e.branchIds }), today));
}

/** Moves the saved due dates (one DueDateChange and audit row each) and tells each owner. */
async function applyMoves(tx: Tx, moves: DueMove[], cause: "HOLIDAY" | "CLOSURE" | "WORKING_DAYS", why: string, actor: Actor, entryId: string | null) {
  for (const m of moves) {
    if (m.subjectType === "DpAssignment") await tx.dpAssignment.update({ where: { id: m.subjectId }, data: { dueDate: m.to } });
    else await tx.cashAdvance.update({ where: { id: m.subjectId }, data: { liquidationDueAt: endOfBusinessDay(m.to), overdueNotifiedAt: null } });
    await tx.dueDateChange.create({ data: { subjectType: m.subjectType, subjectId: m.subjectId, loanId: m.loanId, pn: m.pn, fromDate: m.from, toDate: m.to, cause, calendarEntryId: entryId, wasOverdue: m.wasOverdue, note: why, byId: actor.id, byLabel: actor.label } });
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: "due_date_extended", entityType: m.subjectType, entityId: m.subjectId, loanId: m.loanId ?? undefined, pn: m.pn ?? undefined,
      summary: `${m.label}: due date moved from ${fmtDate(m.from)} to ${fmtDate(m.to)} (${why})${m.wasOverdue ? "; it was overdue" : ""}`,
      before: { due: m.from }, after: { due: m.to }, details: { cause, calendarEntryId: entryId },
    });
    await notify(tx, { userIds: m.ownerIds, loanId: m.loanId, title: `${m.label}: due date moved to ${fmtDate(m.to)}`, body: `${why} The due date moved from ${fmtDate(m.from)} to ${fmtDate(m.to)}.`, link: m.link });
  }
}

/** Adds a holiday or an office closure, then extends the items whose window holds it (D-041). */
export async function addCalendarEntry(u: CurrentUser, raw: EntryInput, now: Date = new Date()) {
  requireCalendar(u);
  const today = businessDate(now);
  const e = await checkEntry(raw, today);
  const actor = { id: u.id, label: u.name };
  return prisma.$transaction(async (tx) => {
    const before = await loadCalendar(tx);
    const row = await tx.holidayCalendar.create({
      data: { kind: e.kind, date: e.date, name: e.name, type: e.kind === "CLOSURE" ? "LOCAL" : e.type, allBranches: e.allBranches, reason: e.reason, createdById: u.id, branches: e.allBranches ? undefined : { create: e.branchIds.map((branchId) => ({ branchId })) } },
    });
    const names = e.allBranches ? "all branches" : (await tx.branch.findMany({ where: { id: { in: e.branchIds } }, select: { name: true }, orderBy: { name: "asc" } })).map((b) => b.name).join(", ");
    const why = e.kind === "CLOSURE" ? `${names} office closed on ${fmtDate(e.date)}: ${e.reason}.` : `${fmtDate(e.date)} is a holiday (${e.name}) for ${names}.`;
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: e.kind === "CLOSURE" ? "office_closure_added" : "holiday_added", entityType: "HolidayCalendar", entityId: row.id,
      summary: e.kind === "CLOSURE" ? `Office closure added: ${names}, ${fmtDate(e.date)} (${e.reason})` : `Holiday added: ${e.name}, ${fmtDate(e.date)} (${HOLIDAY_TYPES[e.type]}, ${names})${e.date < today ? `, back-dated: ${e.reason}` : ""}`,
      after: { date: e.date, kind: e.kind, type: e.type, allBranches: e.allBranches, branchIds: e.branchIds, reason: e.reason },
    });
    const moves = await dueMoves(before, withEntry(before, { date: e.date, allBranches: e.allBranches, branchIds: e.branchIds }), today, tx);
    await applyMoves(tx, moves, e.kind === "CLOSURE" ? "CLOSURE" : "HOLIDAY", why, actor, row.id);
    return { id: row.id, ...previewOf(moves) };
  });
}

/** The working weekdays (Sunday first). At least one must be on. */
export const weekdaysSchema = z.array(z.boolean()).length(7).refine((w) => w.some(Boolean), "Keep at least one working day.");

export async function previewWorkingDays(u: CurrentUser, weekdays: boolean[], now: Date = new Date()): Promise<CalendarPreview> {
  requireCalendar(u);
  const w = weekdaysSchema.safeParse(weekdays);
  if (!w.success) throw new UserError(w.error.issues[0].message, "workingDays");
  const cal = await loadCalendar();
  return previewOf(await dueMoves(cal, { ...cal, workingWeekdays: w.data }, businessDate(now)));
}

/** Saves the working weekdays; a day taken away extends the saved due dates like a holiday (D-041). */
export async function saveWorkingDays(u: CurrentUser, weekdays: boolean[], now: Date = new Date()) {
  requireCalendar(u);
  const w = weekdaysSchema.safeParse(weekdays);
  if (!w.success) throw new UserError(w.error.issues[0].message, "workingDays");
  const today = businessDate(now);
  const actor = { id: u.id, label: u.name };
  return prisma.$transaction(async (tx) => {
    const before = await loadCalendar(tx);
    const was = before.workingWeekdays;
    if (was.every((x, i) => x === w.data[i])) return previewOf([]);
    await setSetting("calendar.workingDays", w.data, tx);
    const words = (xs: readonly boolean[]) => WEEKDAY_NAMES.filter((_, i) => xs[i]).join(", ");
    await writeAudit(tx, { actor, mode: "MANUAL", action: "working_days_changed", entityType: "Setting", entityId: "calendar.workingDays", summary: `Working days changed to ${words(w.data)} (were ${words(was)})`, before: { workingDays: was }, after: { workingDays: w.data } });
    const moves = await dueMoves(before, { ...before, workingWeekdays: w.data }, today, tx);
    await applyMoves(tx, moves, "WORKING_DAYS", `The working days are now ${words(w.data)}.`, actor, null);
    return previewOf(moves);
  });
}

/** The calendar rows for Settings: holidays and closures, newest first, with their branch names. */
export async function calendarRows() {
  const rows = await prisma.holidayCalendar.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }], include: { branches: { include: { branch: { select: { name: true } } } } } });
  return rows.map((r) => ({
    id: r.id, date: r.date, name: r.name, kind: r.kind, type: r.type, active: r.active, isSample: r.isSample, reason: r.reason,
    where: r.allBranches ? "All branches" : r.branches.map((b) => b.branch.name).sort().join(", "),
  }));
}

/** How far a due date moved in total (the job page's "moved by holidays / pauses" line). */
export async function dueChanges(subjectType: "DpAssignment" | "CashAdvance", subjectId: string) {
  return prisma.dueDateChange.findMany({ where: { subjectType, subjectId }, orderBy: { at: "asc" } });
}

export { workingDaysBetween };
