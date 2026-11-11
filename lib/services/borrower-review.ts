import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { BORROWER_KEYS, FIELDS, type FieldChange, type Tracked } from "@/lib/myloans/changes";
import { fmtDateTime } from "@/lib/time";
import { UserError, NotInScopeError } from "./errors";

/**
 * "Borrower details" (name, address, contact number, CIF, CIN): MyLoans corrects the borrower, a person
 * decides. Never a silent update and never a block on Send, Accept or funds. One open item per loan (apart
 * from the Admin item for amount, status and replacement); a newer correction updates it and keeps the
 * earlier one in its history. Decided by the people with myloans:review_borrower in the loan's branch
 * (supervisors, approvers), or by Admin when the branch has nobody with the tick.
 */

type Db = Tx | typeof prisma;
type Mode = "MANUAL" | "AUTOMATIC" | "SIMULATED";
export type BorrowerKey = (typeof BORROWER_KEYS)[number];

/** Where the DMS keeps each one (what the screens show until a correction is accepted). */
const COLUMN: Record<BorrowerKey, "borrowerName" | "borrowerAddress" | "borrowerContactNo" | "cif" | "cin"> = {
  borrowerName: "borrowerName", address: "borrowerAddress", contactNo: "borrowerContactNo", cif: "cif", cin: "cin",
};
export const BORROWER_SELECT = { borrowerName: true, borrowerAddress: true, borrowerContactNo: true, cif: true, cin: true } as const;
type DmsBorrower = { borrowerName: string; borrowerAddress: string | null; borrowerContactNo: string | null; cif: string | null; cin: string | null };

const norm = (v: unknown) => {
  const t = v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

/** The borrower details where the DMS and MyLoans now differ (was = the DMS, now = MyLoans). */
export function borrowerDiffs(dms: DmsBorrower, myloans: Pick<Tracked, BorrowerKey>): FieldChange[] {
  return BORROWER_KEYS.filter((k) => k in myloans && norm(dms[COLUMN[k]]) !== norm(myloans[k])).map((k) => ({
    field: k, label: FIELDS[k].label, kind: "borrower" as const, was: norm(dms[COLUMN[k]]), now: norm(myloans[k]),
  }));
}

/** People who may decide a correction on a loan of this branch: the tick, and the branch in their own access (not "All branches"). */
export async function branchDeciderIds(db: Db, branchId: string): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { active: true, allBranches: false, role: { active: true, permissions: { has: PERMISSIONS.SOURCE_REVIEW_BORROWER } }, branches: { some: { branchId } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
/** When the branch has nobody: Admin (those who also review MyLoans changes and hold the tick). */
async function adminDeciderIds(db: Db): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { active: true, role: { active: true, AND: [{ permissions: { has: PERMISSIONS.SOURCE_REVIEW_BORROWER } }, { permissions: { has: PERMISSIONS.SOURCE_REVIEW } }] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
export async function deciderIds(db: Db, branchId: string): Promise<{ ids: string[]; toAdmin: boolean }> {
  const branch = await branchDeciderIds(db, branchId);
  return branch.length ? { ids: branch, toAdmin: false } : { ids: await adminDeciderIds(db), toAdmin: true };
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const fieldWords = (cs: { label: string }[]) => list(cs.map((c) => c.label));

/**
 * After a refresh found a borrower detail changed in MyLoans: open or update the loan's one Borrower
 * details item. Values are compared with what the DMS shows, so after Keep current the same MyLoans value
 * does not alert again (the copy already has it) and a different later value does.
 */
export async function raiseBorrowerReview(tx: Tx, a: { loanId: string; pn: string; current: Tracked; hash: string; mode: Mode; now: Date }) {
  const loan = await tx.loan.findUniqueOrThrow({ where: { id: a.loanId }, select: { ...BORROWER_SELECT, branchId: true } });
  const diffs = borrowerDiffs(loan, a.current);
  const open = await tx.sourceChange.findFirst({ where: { loanId: a.loanId, state: "OPEN", category: "BORROWER" } });
  if (!diffs.length) {
    // MyLoans went back to what the DMS shows: nothing left to decide.
    if (open) {
      await tx.sourceChange.update({ where: { id: open.id }, data: { state: "KEPT", decidedByLabel: "MyLoans", decidedAt: a.now, note: "MyLoans changed it back to the details the DMS shows." } });
      await writeAudit(tx, { actor: SYSTEM_ACTOR, mode: a.mode, action: "borrower_change_withdrawn", entityType: "SourceChange", entityId: open.id, loanId: a.loanId, pn: a.pn, summary: "MyLoans changed the borrower's details back to what the DMS shows. Nothing to review." });
    }
    return null;
  }
  const changes = diffs.map((d) => ({ ...d, at: a.now.toISOString() }));
  let id: string;
  if (open) {
    const was = open.changes as unknown as (FieldChange & { at?: string })[];
    // A row whose MyLoans value did not change keeps when MyLoans first said it.
    const merged = changes.map((c) => { const o = was.find((x) => x.field === c.field && x.now === c.now); return o?.at ? { ...c, at: o.at } : c; });
    const history = [...((open.history as unknown[]) ?? []), { detectedAt: open.detectedAt, category: open.category, changes: open.changes }];
    await tx.sourceChange.update({ where: { id: open.id }, data: { detectedAt: a.now, changes: merged as unknown as Prisma.InputJsonValue, hash: a.hash, history: history as Prisma.InputJsonValue } });
    id = open.id;
  } else {
    id = (await tx.sourceChange.create({
      data: { loanId: a.loanId, category: "BORROWER", changes: changes as unknown as Prisma.InputJsonValue, proposed: {}, hash: a.hash, simulated: a.mode === "SIMULATED", detectedAt: a.now, firstSeenAt: a.now },
    })).id;
  }
  const who = await deciderIds(tx, loan.branchId);
  const what = `MyLoans changed the borrower's ${fieldWords(diffs)}`;
  const waiting = who.toAdmin ? "No supervisor or approver in this branch. Admin reviews it." : "Waiting for review by the branch supervisor or approver.";
  await writeAudit(tx, {
    actor: SYSTEM_ACTOR, mode: a.mode, action: "source_change_detected", entityType: "SourceChange", entityId: id, loanId: a.loanId, pn: a.pn,
    summary: `${what}. ${waiting}`, details: { category: "BORROWER", fields: diffs.map((d) => d.label), toAdmin: who.toAdmin },
  });
  // Field names only: the values (names, addresses, numbers) never go in a notification or an email.
  await notify(tx, {
    userIds: who.ids, loanId: a.loanId,
    title: `${a.pn}: MyLoans changed the borrower's details`, body: `${what}. Please review it.`, link: `/loans/${a.pn}?tab=todo&correction=1`,
    email: { event: "borrower_changed", vars: { pn: a.pn, reason: `${what}.` } },
  });
  return id;
}

// ---------------------------------------------------------------------------
// What the screens show
// ---------------------------------------------------------------------------

export interface BorrowerReviewData {
  id: string;
  title: string;
  /** "Name, Address" (the Open items row). */
  fields: string;
  rows: { field: string; label: string; dms: string; myloans: string; at: string }[];
  /** What it means: sent work whose papers may carry the old details, and what accepting changes. */
  sentences: string[];
  canDecide: boolean;
  /** The branch has nobody with the tick: Admin reviews it. */
  toAdmin: boolean;
  /** For people who cannot decide. */
  waiting: string;
  history: number;
  simulated: boolean;
}

/** Already with a processor, or done (papers may carry the old details). */
const PAST = ["ASSIGNED", "IN_PROCESS", "FORWARDED", "COMPLETED"] as const;

export async function borrowerMeaning(db: Db, loanId: string): Promise<string[]> {
  const txns = await db.loanTransaction.findMany({ where: { loanId, status: { in: [...PAST] } }, include: { type: true }, orderBy: { createdAt: "asc" } });
  const names = txns.map((t) => `${t.type.name} (${t.status === "COMPLETED" ? "done" : "sent to a processor"})`);
  return [
    names.length
      ? `Already sent or done: ${list(names)}. Their papers may carry the old details.`
      : "Nothing was sent to a processor yet.",
    "Accepting changes the details shown in the DMS. It does not change papers already prepared.",
  ];
}

export const mayDecideBorrower = (u: CurrentUser, branchId: string) => can(u, PERMISSIONS.SOURCE_REVIEW_BORROWER) && inScope(u, branchId);

export async function borrowerReviewFor(user: CurrentUser, loanId: string): Promise<BorrowerReviewData | null> {
  const item = await prisma.sourceChange.findFirst({ where: { loanId, state: "OPEN", category: "BORROWER" }, include: { loan: { select: { branchId: true } } } });
  if (!item || !inScope(user, item.loan.branchId)) return null;
  const changes = item.changes as unknown as (FieldChange & { at?: string })[];
  const who = await deciderIds(prisma, item.loan.branchId);
  const canDecide = mayDecideBorrower(user, item.loan.branchId);
  return {
    id: item.id,
    title: `MyLoans corrected the borrower's details · ${fmtDateTime(item.detectedAt)}`,
    fields: changes.map((c) => c.label).join(", "),
    rows: changes.map((c) => ({ field: c.field, label: c.label, dms: c.was === null ? "blank" : String(c.was), myloans: c.now === null ? "blank" : String(c.now), at: fmtDateTime(c.at ? new Date(c.at) : item.detectedAt) })),
    sentences: await borrowerMeaning(prisma, loanId),
    canDecide,
    toAdmin: who.toAdmin,
    waiting: who.toAdmin ? "No supervisor or approver in this branch. Admin reviews it." : "Waiting for review by your supervisor.",
    history: (item.history as unknown[]).length,
    simulated: item.simulated,
  };
}

/** Loans with an open Borrower details item (the chip on lists and cards). */
export async function borrowerChangedLoanIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.sourceChange.findMany({ where: { loanId: { in: ids }, state: "OPEN", category: "BORROWER" }, select: { loanId: true } });
  return new Set(rows.map((r) => r.loanId));
}
export { BORROWER_CHIP } from "@/lib/ui/borrower-chip";

/** Home: the corrections this person may decide (their branches), oldest first; Admin also those routed to Admin. */
export async function borrowerToDo(user: CurrentUser, take = 5) {
  if (!can(user, PERMISSIONS.SOURCE_REVIEW_BORROWER)) return { count: 0, items: [] as { pn: string; borrowerName: string; fields: string; since: string }[] };
  const scope = user.scopeBranchIds === null ? {} : { branchId: { in: user.scopeBranchIds } };
  const rows = await prisma.sourceChange.findMany({
    where: { state: "OPEN", category: "BORROWER", loan: scope }, orderBy: { firstSeenAt: "asc" },
    include: { loan: { select: { pn: true, borrowerName: true } } },
  });
  return {
    count: rows.length,
    items: rows.slice(0, take).map((r) => ({ pn: r.loan.pn, borrowerName: r.loan.borrowerName, fields: (r.changes as unknown as FieldChange[]).map((c) => c.label).join(", "), since: fmtDateTime(r.firstSeenAt) })),
  };
}

/** Admin Home count: open Borrower details items whose branch has nobody with the tick. */
export async function borrowerItemsForAdmin(): Promise<number> {
  const rows = await prisma.sourceChange.findMany({ where: { state: "OPEN", category: "BORROWER" }, select: { loan: { select: { branchId: true } } } });
  const branches = [...new Set(rows.map((r) => r.loan.branchId))];
  const empty = new Set<string>();
  for (const b of branches) if (!(await branchDeciderIds(prisma, b)).length) empty.add(b);
  return rows.filter((r) => empty.has(r.loan.branchId)).length;
}

// ---------------------------------------------------------------------------
// Decisions (myloans:review_borrower, the loan's branch in the person's access)
// ---------------------------------------------------------------------------

const noteSchema = z.string().trim().min(5, "Write a short note (at least 5 characters).").max(500, "Keep the note under 500 characters.");
function noteOf(raw: unknown) {
  const p = noteSchema.safeParse(raw ?? "");
  if (!p.success) throw new UserError(p.error.issues[0].message, "note");
  return p.data;
}
const actorOf = (u: CurrentUser): Actor => ({ id: u.id, label: u.name });

async function openBorrowerItem(tx: Tx, u: CurrentUser, id: string) {
  const item = await tx.sourceChange.findUnique({ where: { id }, include: { loan: true } });
  if (!item || item.category !== "BORROWER" || !inScope(u, item.loan.branchId)) throw new NotInScopeError();
  if (!can(u, PERMISSIONS.SOURCE_REVIEW_BORROWER)) throw new UserError("Your role does not review borrower detail corrections. Your view is read-only.");
  if (item.state !== "OPEN") throw new UserError("This correction was already decided.");
  return item;
}
async function lockOf(id: string) {
  const it = await prisma.sourceChange.findUnique({ where: { id }, select: { loanId: true } });
  if (!it) throw new NotInScopeError();
  return it.loanId;
}
const arrow = (c: FieldChange) => `${c.label}: ${c.was ?? "blank"} → ${c.now ?? "blank"}`;

/** Accept the correction: the loan's details become MyLoans' values; one Journey line; audit with old and new. */
export async function acceptBorrowerCorrection(u: CurrentUser, id: string, rawNote: unknown) {
  const note = noteOf(rawNote);
  return withLoanLock(await lockOf(id), async (tx) => {
    const item = await openBorrowerItem(tx, u, id);
    const changes = item.changes as unknown as FieldChange[];
    const data: Prisma.LoanUpdateInput = {};
    for (const c of changes) {
      const col = COLUMN[c.field as BorrowerKey];
      if (!col) continue;
      if (col === "borrowerName") { if (c.now) data.borrowerName = String(c.now); } else data[col] = c.now === null ? null : String(c.now);
    }
    await tx.loan.update({ where: { id: item.loanId }, data });
    const now = new Date();
    await tx.sourceChange.update({ where: { id }, data: { state: "APPLIED", decidedById: u.id, decidedByLabel: u.name, decidedAt: now, note } });
    await writeAudit(tx, {
      actor: actorOf(u), mode: "MANUAL", action: "borrower_details_corrected", entityType: "Loan", entityId: item.loanId, loanId: item.loanId, pn: item.loan.pn,
      summary: `Borrower details corrected: ${changes.map(arrow).join("; ")}. Note: ${note}`,
      before: Object.fromEntries(changes.map((c) => [c.label, c.was])), after: Object.fromEntries(changes.map((c) => [c.label, c.now])),
      details: { sourceChangeId: id, note },
    });
  });
}

/** Keep current: the DMS keeps its details; the MyLoans value stays in the copy, so the same difference does not alert again. */
export async function keepBorrowerCurrent(u: CurrentUser, id: string, rawNote: unknown) {
  const note = noteOf(rawNote);
  return withLoanLock(await lockOf(id), async (tx) => {
    const item = await openBorrowerItem(tx, u, id);
    const changes = item.changes as unknown as FieldChange[];
    await tx.sourceChange.update({ where: { id }, data: { state: "KEPT", decidedById: u.id, decidedByLabel: u.name, decidedAt: new Date(), note } });
    await writeAudit(tx, {
      actor: actorOf(u), mode: "MANUAL", action: "borrower_details_kept", entityType: "SourceChange", entityId: id, loanId: item.loanId, pn: item.loan.pn,
      summary: `MyLoans changed the borrower's ${fieldWords(changes)}. ${u.name} kept the DMS details: ${note}`,
      details: { kept: Object.fromEntries(changes.map((c) => [c.label, c.was])), myloans: Object.fromEntries(changes.map((c) => [c.label, c.now])) },
    });
  });
}
