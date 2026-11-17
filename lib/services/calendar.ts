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
 * Settings, Holidays and working days (D-018, D-041, D-042): the working weekdays, holidays and office closures,
 * and the ONLY ways a working day is taken away or given back. Every path (the Settings screen, the CSV import,
 * Make inactive / active) goes through here, so the same rule always applies:
 *   - a non-working day added (a holiday, a closure, a weekday unticked, an entry made active again) extends each
 *     open saved due date whose counting window holds it (after its start, up to and including its due date),
 *     even when it is already overdue;
 *   - an entry made inactive undoes ONLY the extensions that entry caused (per item);
 *   - an admin may correct one saved due date, with a reason.
 * Every move is a DueDateChange row and an audit row, and the owner is told. Previews run the real change in a
 * transaction that is rolled back, so "This will extend N items (M currently overdue)" is exactly what Save does.
 *
 * Saved due dates today: a DP job's TAT (DpAssignment.dueDate, from the accept day, on the processor's branch)
 * and the liquidation due date (CashAdvance.liquidationDueAt, from liquidationDueFrom, on the requesting
 * processor's branch). LA steps without an accept are still counted live from the calendar (piece 9).
 */

export const HOLIDAY_TYPES = { REGULAR: "Regular holiday", SPECIAL_NON_WORKING: "Special non-working day", LOCAL: "Local holiday" } as const;
export type HolidayTypeKey = keyof typeof HOLIDAY_TYPES;

const realYmd = (d: string) => !Number.isNaN(new Date(`${d}T00:00:00Z`).getTime()) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const ymd = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").refine(realYmd, "That date does not exist.");

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
export type CheckedEntry = z.output<typeof entrySchema>;

/** One saved due date that a calendar change moves. */
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
  /** The extension this move undoes (an entry made inactive). */
  reverses?: string;
}

/** What a change did (or, in a preview, would do). */
export interface CalendarPreview { extend: number; overdue: number; back: number; text: string }
export interface Tally { extend: number; overdue: number; back: number }
export const newTally = (): Tally => ({ extend: 0, overdue: 0, back: 0 });
export function previewText(t: Tally): string {
  const parts: string[] = [];
  if (t.extend) parts.push(`This will extend ${t.extend} item${t.extend === 1 ? "" : "s"} (${t.overdue} currently overdue).`);
  if (t.back) parts.push(`This will move ${t.back} item${t.back === 1 ? "" : "s"} back to the due date${t.back === 1 ? "" : "s"} they had before.`);
  return parts.join(" ") || "No saved due date changes.";
}
const asPreview = (t: Tally): CalendarPreview => ({ ...t, text: previewText(t) });

function requireCalendar(u: CurrentUser) {
  if (!can(u, PERMISSIONS.SETTINGS_HOLIDAYS)) throw new UserError("Ask a Superadmin to turn on \"Change holidays\" for your role.");
}

/** The back-dating rule (D-041): a date before today needs a reason and may be at most N days back. */
async function checkBackdate(date: string, reason: string, today: string, db: Tx | typeof prisma) {
  if (date >= today) return;
  const max = await getSetting("calendar.backdateMaxDays", db);
  const back = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${date}T00:00:00Z`).getTime()) / 86_400_000);
  if (back > max) throw new UserError(`A date in the past can be changed up to ${max} day${max === 1 ? "" : "s"} back. This one is ${back} days back.`, "date");
  if (reason.trim().length < 5) throw new UserError("This date is in the past: say why it is changed now (at least 5 characters).", "reason");
}

/** Checks an entry: a name or a reason, the branches, and the back-dating limit. */
export async function checkEntry(raw: EntryInput, today: string, db: Tx | typeof prisma = prisma): Promise<CheckedEntry> {
  const p = entrySchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const e = p.data;
  if (e.kind === "HOLIDAY" && e.name.length < 3) throw new UserError("Give the holiday its name.", "name");
  if (e.kind === "CLOSURE" && e.reason.length < 5) throw new UserError("Say why the office is closed (at least 5 characters).", "reason");
  if (!e.allBranches && !e.branchIds.length) throw new UserError("Tick at least one branch, or choose All branches.", "branchIds");
  if (e.kind === "CLOSURE" && e.allBranches) throw new UserError("An office closure is for the branches you tick. For every branch, add a holiday.", "branchIds");
  await checkBackdate(e.date, e.reason, today, db);
  if (!e.allBranches) {
    const n = await db.branch.count({ where: { id: { in: e.branchIds } } });
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
type OpenDue = Awaited<ReturnType<typeof openDueDates>>[number];

/** Non-working days added: each open item gains the working days lost inside its window. */
export async function dueMoves(before: WorkCalendar, after: WorkCalendar, today: string, db: Tx | typeof prisma = prisma): Promise<DueMove[]> {
  const out: DueMove[] = [];
  for (const i of await openDueDates(db)) {
    const b = daysFor(before, i.branchId), a = daysFor(after, i.branchId);
    const lost = lostWorkingDays(i.start, i.due, b, a);
    if (lost > 0) out.push(moveOf(i, addWorkingDays(i.due, lost, a), today));
  }
  return out;
}
const moveOf = (i: OpenDue, to: string, today: string, reverses?: string): DueMove => ({
  subjectType: i.subjectType, subjectId: i.subjectId, label: i.label, loanId: i.loanId, pn: i.pn, branchId: i.branchId, ownerIds: i.ownerIds,
  from: i.due, to, wasOverdue: today > i.due, link: i.link, reverses,
});

/**
 * An entry made inactive (D-042): only the items it extended move back, by the working days it took from their
 * window (days that are working again without it). One move per item, linked to the extension it undoes.
 */
async function reversalMoves(tx: Tx, entryId: string, before: WorkCalendar, after: WorkCalendar, today: string): Promise<DueMove[]> {
  const caused = await tx.dueDateChange.findMany({ where: { calendarEntryId: entryId, cause: { in: ["HOLIDAY", "CLOSURE"] } }, orderBy: { at: "desc" } });
  const undone = new Set((await tx.dueDateChange.findMany({ where: { reversesChangeId: { in: caused.map((c) => c.id) } }, select: { reversesChangeId: true } })).map((c) => c.reversesChangeId));
  const latest = new Map<string, string>();
  for (const c of caused) if (!undone.has(c.id) && !latest.has(`${c.subjectType}:${c.subjectId}`)) latest.set(`${c.subjectType}:${c.subjectId}`, c.id);
  const out: DueMove[] = [];
  for (const i of await openDueDates(tx)) {
    const changeId = latest.get(`${i.subjectType}:${i.subjectId}`);
    if (!changeId) continue;
    const b = daysFor(before, i.branchId), a = daysFor(after, i.branchId);
    // Days in the window that were off with the entry and are working days again without it.
    const regained = lostWorkingDays(i.start, i.due, a, b);
    if (regained > 0) out.push(moveOf(i, addWorkingDays(i.due, -regained, a), today, changeId));
  }
  return out;
}

const CAUSE_WORDS = { HOLIDAY: "holiday", CLOSURE: "office closure", WORKING_DAYS: "working days", HOLIDAY_REMOVED: "holiday made inactive", CLOSURE_REMOVED: "closure made inactive", CORRECTION: "correction" } as const;
type Cause = keyof typeof CAUSE_WORDS;

/** Moves the saved due dates (one DueDateChange and audit row each), tells each owner, and counts. */
async function applyMoves(tx: Tx, moves: DueMove[], cause: Cause, why: string, actor: Actor, entryId: string | null, tally?: Tally) {
  for (const m of moves) {
    if (m.subjectType === "DpAssignment") await tx.dpAssignment.update({ where: { id: m.subjectId }, data: { dueDate: m.to } });
    else await tx.cashAdvance.update({ where: { id: m.subjectId }, data: { liquidationDueAt: endOfBusinessDay(m.to), overdueNotifiedAt: null } });
    await tx.dueDateChange.create({ data: { subjectType: m.subjectType, subjectId: m.subjectId, loanId: m.loanId, pn: m.pn, fromDate: m.from, toDate: m.to, cause, calendarEntryId: entryId, reversesChangeId: m.reverses ?? null, wasOverdue: m.wasOverdue, note: why, byId: actor.id, byLabel: actor.label } });
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: m.reverses ? "due_date_restored" : "due_date_extended", entityType: m.subjectType, entityId: m.subjectId, loanId: m.loanId ?? undefined, pn: m.pn ?? undefined,
      summary: `${m.label}: due date moved from ${fmtDate(m.from)} to ${fmtDate(m.to)} (${why})${m.wasOverdue ? "; it was overdue" : ""}`,
      before: { due: m.from }, after: { due: m.to }, details: { cause, calendarEntryId: entryId, reverses: m.reverses ?? null },
    });
    await notify(tx, { userIds: m.ownerIds, loanId: m.loanId, title: `${m.label}: due date moved to ${fmtDate(m.to)}`, body: `${why} The due date moved from ${fmtDate(m.from)} to ${fmtDate(m.to)}.`, link: m.link });
    if (tally) { if (m.reverses) tally.back++; else { tally.extend++; if (m.wasOverdue) tally.overdue++; } }
  }
}

const withEntry = (cal: WorkCalendar, e: CalendarEntry): WorkCalendar => ({ ...cal, entries: [...cal.entries, e] });
const withoutEntry = (cal: WorkCalendar, id: string): WorkCalendar => ({ ...cal, entries: cal.entries.filter((e) => e.id !== id) });

async function branchWords(tx: Tx, allBranches: boolean, branchIds: string[]) {
  return allBranches ? "all branches" : (await tx.branch.findMany({ where: { id: { in: branchIds } }, select: { name: true }, orderBy: { name: "asc" } })).map((b) => b.name).join(", ");
}

/**
 * Adds a holiday or closure inside a transaction (the Settings screen and the CSV import both use it), then
 * extends the items whose window holds it.
 */
export async function addEntryInTx(tx: Tx, u: CurrentUser, raw: EntryInput, today: string, tally?: Tally) {
  const e = await checkEntry(raw, today, tx);
  const actor = { id: u.id, label: u.name };
  const before = await loadCalendar(tx);
  const row = await tx.holidayCalendar.create({
    data: { kind: e.kind, date: e.date, name: e.name, type: e.kind === "CLOSURE" ? "LOCAL" : e.type, allBranches: e.allBranches, reason: e.reason, createdById: u.id, branches: e.allBranches ? undefined : { create: e.branchIds.map((branchId) => ({ branchId })) } },
  });
  const names = await branchWords(tx, e.allBranches, e.branchIds);
  const why = e.kind === "CLOSURE" ? `${names} office closed on ${fmtDate(e.date)}: ${e.reason}.` : `${fmtDate(e.date)} is a holiday (${e.name}) for ${names}.`;
  await writeAudit(tx, {
    actor, mode: "MANUAL", action: e.kind === "CLOSURE" ? "office_closure_added" : "holiday_added", entityType: "HolidayCalendar", entityId: row.id,
    summary: e.kind === "CLOSURE" ? `Office closure added: ${names}, ${fmtDate(e.date)} (${e.reason})` : `Holiday added: ${e.name}, ${fmtDate(e.date)} (${HOLIDAY_TYPES[e.type]}, ${names})${e.date < today ? `, back-dated: ${e.reason}` : ""}`,
    after: { date: e.date, kind: e.kind, type: e.type, allBranches: e.allBranches, branchIds: e.branchIds, reason: e.reason },
  });
  const moves = await dueMoves(before, withEntry(before, { id: row.id, date: e.date, allBranches: e.allBranches, branchIds: e.branchIds }), today, tx);
  await applyMoves(tx, moves, e.kind === "CLOSURE" ? "CLOSURE" : "HOLIDAY", why, actor, row.id, tally);
  return row.id;
}

/**
 * Makes a holiday or closure inactive (undoes only its own extensions) or active again (extends like a new one),
 * inside a transaction. A back-dated change needs a reason, like adding one.
 */
export async function setEntryActiveInTx(tx: Tx, u: CurrentUser, id: string, active: boolean, today: string, reason = "", tally?: Tally) {
  const row = await tx.holidayCalendar.findUnique({ where: { id }, include: { branches: { select: { branchId: true } } } });
  if (!row) throw new UserError("Not found. It may have been changed by someone else.");
  if (row.active === active) return;
  await checkBackdate(row.date, reason, today, tx);
  const actor = { id: u.id, label: u.name };
  const before = await loadCalendar(tx);
  await tx.holidayCalendar.update({ where: { id }, data: active ? { active: true, deactivatedAt: null, deactivatedById: null } : { active: false, deactivatedAt: new Date(), deactivatedById: u.id } });
  const branchIds = row.branches.map((b) => b.branchId);
  const names = await branchWords(tx, row.allBranches, branchIds);
  const what = row.kind === "CLOSURE" ? `the ${names} office closure on ${fmtDate(row.date)}` : `the holiday ${row.name} on ${fmtDate(row.date)}`;
  await writeAudit(tx, {
    actor, mode: "MANUAL", action: active ? "made_active" : "made_inactive", entityType: "holiday", entityId: id,
    summary: `${what[0].toUpperCase()}${what.slice(1)} made ${active ? "active" : "inactive"}${reason ? `: ${reason}` : ""}`, before: { active: !active }, after: { active },
  });
  const entry: CalendarEntry = { id, date: row.date, allBranches: row.allBranches, branchIds };
  if (active) {
    const moves = await dueMoves(before, withEntry(withoutEntry(before, id), entry), today, tx);
    await applyMoves(tx, moves, row.kind === "CLOSURE" ? "CLOSURE" : "HOLIDAY", `${what[0].toUpperCase()}${what.slice(1)} is a non-working day again.`, actor, id, tally);
  } else {
    const moves = await reversalMoves(tx, id, withEntry(withoutEntry(before, id), entry), withoutEntry(before, id), today);
    await applyMoves(tx, moves, row.kind === "CLOSURE" ? "CLOSURE_REMOVED" : "HOLIDAY_REMOVED", `${what[0].toUpperCase()}${what.slice(1)} is a working day again; the extension it caused is undone.`, actor, id, tally);
  }
}

/** Runs a change in a transaction and rolls it back: the exact preview of what Save does. */
class Rollback extends Error {}
async function dryRun(fn: (tx: Tx, tally: Tally) => Promise<unknown>): Promise<Tally> {
  const tally = newTally();
  try {
    await prisma.$transaction(async (tx) => { await fn(tx, tally); throw new Rollback(); }, { timeout: 60_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return tally;
}
export { dryRun as previewInTransaction };

/** The preview of adding a holiday or closure (nothing is saved). */
export async function previewEntry(u: CurrentUser, raw: EntryInput, now: Date = new Date()): Promise<CalendarPreview> {
  requireCalendar(u);
  return asPreview(await dryRun((tx, t) => addEntryInTx(tx, u, raw, businessDate(now), t)));
}

/** Adds a holiday or an office closure, then extends the items whose window holds it (D-041). */
export async function addCalendarEntry(u: CurrentUser, raw: EntryInput, now: Date = new Date()) {
  requireCalendar(u);
  const tally = newTally();
  const id = await prisma.$transaction((tx) => addEntryInTx(tx, u, raw, businessDate(now), tally), { timeout: 60_000 });
  return { id, ...asPreview(tally) };
}

/** The preview of making a holiday or closure inactive or active again. */
export async function previewEntryActive(u: CurrentUser, id: string, active: boolean, reason = "", now: Date = new Date()): Promise<CalendarPreview> {
  requireCalendar(u);
  return asPreview(await dryRun((tx, t) => setEntryActiveInTx(tx, u, id, active, businessDate(now), reason, t)));
}

export async function setCalendarEntryActive(u: CurrentUser, id: string, active: boolean, reason = "", now: Date = new Date()): Promise<CalendarPreview> {
  requireCalendar(u);
  const tally = newTally();
  await prisma.$transaction((tx) => setEntryActiveInTx(tx, u, id, active, businessDate(now), reason, tally), { timeout: 60_000 });
  return asPreview(tally);
}

/** The working weekdays (Sunday first). At least one must be on. */
export const weekdaysSchema = z.array(z.boolean()).length(7).refine((w) => w.some(Boolean), "Keep at least one working day.");

async function workingDaysInTx(tx: Tx, u: CurrentUser, weekdays: boolean[], today: string, tally: Tally) {
  const w = weekdaysSchema.safeParse(weekdays);
  if (!w.success) throw new UserError(w.error.issues[0].message, "workingDays");
  const actor = { id: u.id, label: u.name };
  const before = await loadCalendar(tx);
  const was = before.workingWeekdays;
  if (was.every((x, i) => x === w.data[i])) return;
  await setSetting("calendar.workingDays", w.data, tx);
  const words = (xs: readonly boolean[]) => WEEKDAY_NAMES.filter((_, i) => xs[i]).join(", ");
  await writeAudit(tx, { actor, mode: "MANUAL", action: "working_days_changed", entityType: "Setting", entityId: "calendar.workingDays", summary: `Working days changed to ${words(w.data)} (were ${words(was)})`, before: { workingDays: was }, after: { workingDays: w.data } });
  const moves = await dueMoves(before, { ...before, workingWeekdays: w.data }, today, tx);
  await applyMoves(tx, moves, "WORKING_DAYS", `The working days are now ${words(w.data)}.`, actor, null, tally);
}

export async function previewWorkingDays(u: CurrentUser, weekdays: boolean[], now: Date = new Date()): Promise<CalendarPreview> {
  requireCalendar(u);
  return asPreview(await dryRun((tx, t) => workingDaysInTx(tx, u, weekdays, businessDate(now), t)));
}

/** Saves the working weekdays; a day taken away extends the saved due dates like a holiday (D-041). */
export async function saveWorkingDays(u: CurrentUser, weekdays: boolean[], now: Date = new Date()): Promise<CalendarPreview> {
  requireCalendar(u);
  const tally = newTally();
  await prisma.$transaction((tx) => workingDaysInTx(tx, u, weekdays, businessDate(now), tally), { timeout: 60_000 });
  return asPreview(tally);
}

// ---------------------------------------------------------------------------
// Admin correction (D-042): one item at a time, a reason, logged and shown in the item's history.
// ---------------------------------------------------------------------------

export const correctionSchema = z.object({
  subjectType: z.enum(["DpAssignment", "CashAdvance"]),
  subjectId: z.string().min(1),
  date: ymd,
  reason: z.string().trim().min(5, "Say why the due date is corrected (at least 5 characters).").max(300, "Keep the reason under 300 characters."),
});

export async function correctDueDate(u: CurrentUser, raw: z.input<typeof correctionSchema>, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.DUEDATES_CORRECT)) throw new UserError("Ask a Superadmin to turn on \"Correct due dates\" for your role.");
  const p = correctionSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const c = p.data;
  const today = businessDate(now);
  return prisma.$transaction(async (tx) => {
    const item = (await openDueDates(tx)).find((i) => i.subjectType === c.subjectType && i.subjectId === c.subjectId);
    if (!item) throw new UserError("This item has no open due date to correct (it is finished, or has no saved due date).");
    if (c.date === item.due) throw new UserError("That is already the due date.", "date");
    if (c.date <= item.start) throw new UserError(`The due date must be after the start of its count (${fmtDate(item.start)}).`, "date");
    if (!daysFor(await loadCalendar(tx), item.branchId).isWorkingDay(c.date)) throw new UserError("Pick a working day of the item's branch.", "date");
    await applyMoves(tx, [moveOf(item, c.date, today)], "CORRECTION", `Corrected by ${u.name}: ${c.reason}`, { id: u.id, label: u.name }, null);
    return { from: item.due, to: c.date, days: workingDaysBetween(item.due, c.date, daysFor(await loadCalendar(tx), item.branchId)) };
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

/** An item's due-date history (holidays, closures, pauses, reversals, corrections), oldest first. */
export async function dueChanges(subjectType: "DpAssignment" | "CashAdvance", subjectId: string) {
  return prisma.dueDateChange.findMany({ where: { subjectType, subjectId }, orderBy: { at: "asc" } });
}

/** Plain words for a history line. */
export const dueChangeWords = (cause: string) => CAUSE_WORDS[cause as Cause] ?? (cause === "HOLD_PAUSE" ? "paused on hold" : cause.toLowerCase());
