import { refuseInProduction } from "@/lib/env";
import "server-only";
import { buildPn, getPnFormat, parsePn } from "@/lib/pn";
import { resolveLoanBranch } from "./branches";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getMyLoansAdapter, myLoansMode, type MyLoansRecord } from "@/lib/myloans";
import { mapLoan } from "@/lib/myloans/live-mapping";
import { MINOR_ACCOUNT_COLUMNS, sourceTime } from "@/lib/myloans/account";
import {
  detectChanges, hashTracked, proposeEffect, trackedOf, trackedOfSaved, UNSENT,
  type ChangeCategory, type FieldChange, type Proposed, type Tracked, type TxnNow,
} from "@/lib/myloans/changes";
import { isTestMode } from "@/lib/test-mode";
import { getHolidaySet, getSetting, setSetting } from "@/lib/settings";
import { businessDate, isBusinessDay, startOfBusinessDay } from "@/lib/time";
import { advanceBalance, peso } from "@/lib/funds/rules";
import { MORTGAGE_THRESHOLDS, type FinancingType, type OrcrStatus } from "@/lib/rules";
import { recomputeStage } from "./stage";
import { beginStats, callsThisHour, lookupPn, noteCall, readStats } from "@/lib/myloans/client";
import { jitteredPause, nextCap, nextCheckAt } from "@/lib/myloans/tiers";
import { SETTING_DEFAULTS, type SettingValue } from "@/lib/settings";
import type { MyLoansAdapter, MyLoansLookup } from "@/lib/myloans/types";
import { RELATED_SELECT, relatedLoans, replacementCandidates } from "./related-loans";
import { paymentEvidence } from "@/lib/myloans/relation";
export { cashBlockReason, sendBlockReason, CANCELLED_REASON, CHANGED_REASON } from "./source-blocks";
import { UserError, NotInScopeError } from "./errors";
import { createTransactionOfType } from "./loan-file";
import { nextDocumentId } from "./workflow";
import { bandApprovers } from "./jobs";
import { financeIds, nextNumber } from "./funds";

/**
 * MyLoans sync: refresh a loan file's copy, detect changes, raise one review item per loan, and the
 * Admin's decisions (Apply, Keep current, Close as cancelled, replacement PNs). Never copies the whole
 * source; never blocks work because MyLoans did not answer.
 */

type Mode = "MANUAL" | "AUTOMATIC" | "SIMULATED";
/** find: the background refresh after Find a loan shows a saved loan (Settings > MyLoans sync, "When a saved loan is found"). */
export type Trigger = "open" | "button" | "background" | "simulator" | "find";
export type RefreshResult =
  | { ok: true; outcome: "none" | "minor" | "review"; category: ChangeCategory; checkedAt: Date }
  | { ok: false; message: string; checkedAt: Date };

const OPEN_JOB = ["PENDING_ACCEPTANCE", "ACCEPTED"] as const;
const OUT_ADVANCE = ["REQUESTED", "APPROVED", "RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"] as const;

/** The copy a snapshot holds (mock payloads wrap the record; live ones are the raw response). */
export function recordFromPayload(payload: unknown): MyLoansRecord | null {
  if (payload && typeof payload === "object" && "loan" in payload) return (payload as { loan: MyLoansRecord }).loan;
  return mapLoan(payload);
}

/** One plain line per transaction state ("sent to Grace Tan, waiting to accept"). */
function stateLine(t: { status: string; dpAssignments: { status: string; dpUser: { name: string } }[] }): string {
  const dp = t.dpAssignments.find((a) => (OPEN_JOB as readonly string[]).includes(a.status))?.dpUser.name;
  switch (t.status) {
    case "FOR_CHECKLIST": return "checking papers";
    case "READY": return "ready to send";
    case "RETURNED": return "back with the Loan Associate";
    case "ASSIGNED": return `sent to ${dp ?? "a processor"}, waiting to accept`;
    case "IN_PROCESS": return `with ${dp ?? "the processor"}, in process`;
    case "FORWARDED": return "papers on the way back to the branch";
    case "COMPLETED": return "done";
    default: return "cancelled";
  }
}

async function txnsNow(db: Tx | typeof prisma, loanId: string): Promise<TxnNow[]> {
  const rows = await db.loanTransaction.findMany({
    where: { loanId }, include: { type: true, dpAssignments: { include: { dpUser: { select: { name: true } } }, orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "asc" },
  });
  return rows.map((t) => ({ id: t.id, code: t.type.code, name: t.type.name, status: t.status, stateLine: `${t.type.name}: ${stateLine(t)}` }));
}

/** People who review MyLoans changes (every role with "Review MyLoans changes"). */
export async function reviewerIds(db: Tx | typeof prisma): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { active: true, role: { active: true, permissions: { has: PERMISSIONS.SOURCE_REVIEW } } }, select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function liveDpIds(db: Tx | typeof prisma, loanId: string): Promise<string[]> {
  const jobs = await db.dpAssignment.findMany({ where: { loanId, status: { in: [...OPEN_JOB] } }, select: { dpUserId: true, secondaryDpUserId: true } });
  return jobs.flatMap((j) => [j.dpUserId, ...(j.secondaryDpUserId ? [j.secondaryDpUserId] : [])]);
}

/** Other loan files of the same borrower (same CIN or CIF). Never by name. */
export async function sameBorrowerLoans(db: Tx | typeof prisma, loan: { id?: string; cin: string | null; cif: string | null }, openOnly = false) {
  const or = [...(loan.cin ? [{ cin: loan.cin }] : []), ...(loan.cif ? [{ cif: loan.cif }] : [])];
  if (!or.length) return [];
  return db.loan.findMany({
    where: { OR: or, ...(loan.id ? { id: { not: loan.id } } : {}), ...(openOnly ? { cancelledAt: null, closedAt: null } : {}) },
    select: { id: true, pn: true, sourceStatus: true, releasedAt: true, cancelledAt: true, replacesPn: true, replacedByPn: true },
    orderBy: { releasedAt: "desc" }, take: 10,
  });
}

const words = (cs: { label: string }[]) => {
  const xs = cs.map((c) => c.label);
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
};

/**
 * "MyLoans updated the borrower's name and address"; organisation fields are the loan's, not the
 * borrower's: "MyLoans updated the loan's area and division" (an ID and its name count once).
 */
function minorSummary(minor: FieldChange[]): string {
  const org = minor.filter((c) => c.field in MINOR_ACCOUNT_COLUMNS);
  const own = minor.filter((c) => !(c.field in MINOR_ACCOUNT_COLUMNS));
  const parts: string[] = [];
  if (own.length) parts.push(`the borrower's ${words(own).toLowerCase().replace(/^borrower name/, "name")}`);
  if (org.length) {
    const names = [...new Set(org.map((c) => c.field.replace(/Id$|Name$/, "")))].map((label) => ({ label }));
    parts.push(`the loan's ${words(names)}`);
  }
  return `MyLoans updated ${parts.join(" and ")}`;
}

/** Merges a newer detection into the open item: was = first seen, now = latest; unchanged-back rows drop out. */
function mergeChanges(older: FieldChange[], newer: FieldChange[]): FieldChange[] {
  const out = new Map(older.map((c) => [c.field, { ...c }]));
  for (const c of newer) {
    const o = out.get(c.field);
    if (o) o.now = c.now; else out.set(c.field, { ...c });
  }
  return [...out.values()].filter((c) => c.was !== c.now);
}
const RANK: Record<string, number> = { MATERIAL: 1, STATUS: 2, REPLACEMENT: 3 };

/**
 * Asks MyLoans for one loan and records what changed. Minor changes update the copy; material,
 * status and replacement changes open (or update) the loan's one review item. Nothing else changes.
 */
export async function refreshLoan(loanId: string, opts: { actor: Actor; mode: Mode; trigger: Trigger; now?: Date; lookup?: MyLoansLookup }): Promise<RefreshResult> {
  const now = opts.now ?? new Date();
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new UserError("Loan File not found.");
  // The background run passes what it already got; otherwise one shared call (coalesced; the button asks fresh).
  const lookup = opts.lookup ?? await lookupPn(getMyLoansAdapter(), loan.pn, { fresh: opts.trigger === "button" || opts.trigger === "simulator" });
  if (!lookup.ok) {
    // An outage never blocks work: the last copy stays, with "MyLoans did not answer".
    await prisma.$transaction(async (tx) => {
      await tx.loan.update({ where: { id: loan.id }, data: { lastCheckedAt: now, sourceCurrent: false, lastRefreshError: lookup.message } });
      if (opts.trigger === "button" || opts.trigger === "simulator") {
        await writeAudit(tx, { actor: opts.actor, mode: opts.mode, action: "source_refresh_failed", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn: loan.pn, summary: `Refresh from MyLoans: ${lookup.message} Work continues on the last copy.` });
      }
    });
    return { ok: false, message: lookup.message, checkedAt: now };
  }

  const current = trackedOf(lookup.record);
  const hash = hashTracked(current);
  let result: RefreshResult = { ok: true, outcome: "none", category: "NONE", checkedAt: now };
  await withLoanLock(loan.id, async (tx) => {
    const prev = await tx.loanSourceSnapshot.findFirst({ where: { loanId: loan.id }, orderBy: { retrievedAt: "desc" } });
    const prevRecord = prev ? recordFromPayload(prev.payload) : null;
    const previous: Tracked | null = (prev?.tracked as Tracked | null) ?? (prevRecord ? trackedOfSaved(prevRecord) : null);
    const det = detectChanges(previous, current);
    const tiers = await getSetting("myloans.tierMinutes", tx);
    const t = loan.syncTier === "A" || loan.syncTier === "B" || loan.syncTier === "C" ? loan.syncTier : null;
    await tx.loan.update({ where: { id: loan.id }, data: { lastCheckedAt: now, retrievedAt: lookup.retrievedAt, sourceCurrent: true, lastRefreshError: null, nextCheckAt: nextCheckAt(now, t, tiers), ...(lookup.record.sourceUpdatedAt ? { sourceUpdatedAt: sourceTime(lookup.record.sourceUpdatedAt) } : {}) } });
    if (det.category === "NONE") {
      // First copy with tracked fields: keep it as the baseline (no new row for an unchanged copy).
      if (!prev || !prev.hash) {
        await tx.loanSourceSnapshot.create({ data: { loanId: loan.id, retrievedAt: lookup.retrievedAt, adapter: lookup.adapter, payload: lookup.raw as Prisma.InputJsonValue, tracked: current as unknown as Prisma.InputJsonValue, hash, kind: "BASE" } });
      }
      if (opts.trigger === "button") {
        await writeAudit(tx, { actor: opts.actor, mode: opts.mode, action: "source_refreshed", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn: loan.pn, summary: "Refreshed from MyLoans: no changes" });
      }
      return;
    }
    // Retention: material, status and replacement copies are all kept; of the minor-only ones only the latest.
    if (det.category === "MINOR") await tx.loanSourceSnapshot.deleteMany({ where: { loanId: loan.id, kind: "MINOR" } });
    await tx.loanSourceSnapshot.create({
      data: {
        loanId: loan.id, retrievedAt: lookup.retrievedAt, adapter: lookup.adapter, payload: lookup.raw as Prisma.InputJsonValue,
        tracked: current as unknown as Prisma.InputJsonValue, hash, changes: det.changes as unknown as Prisma.InputJsonValue, kind: det.category,
      },
    });
    const mode: Mode = opts.mode === "SIMULATED" ? "SIMULATED" : "AUTOMATIC";
    const minor = det.changes.filter((c) => c.kind === "minor");
    if (minor.length) {
      // Minor: the copy is updated, no alert ("MyLoans updated the borrower's address").
      const data: Prisma.LoanUpdateInput = {};
      for (const c of minor) {
        if (c.field === "borrowerName" && c.now) data.borrowerName = String(c.now);
        if (c.field === "cin") data.cin = c.now === null ? null : String(c.now);
        if (c.field === "cif") data.cif = c.now === null ? null : String(c.now);
        // Area, division and company: the copy shown under More loan details.
        if (c.field in MINOR_ACCOUNT_COLUMNS) data[MINOR_ACCOUNT_COLUMNS[c.field as keyof typeof MINOR_ACCOUNT_COLUMNS]] = c.now === null ? null : String(c.now);
      }
      if (Object.keys(data).length) await tx.loan.update({ where: { id: loan.id }, data });
      await writeAudit(tx, {
        actor: SYSTEM_ACTOR, mode, action: "source_minor_updated", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn: loan.pn,
        summary: minorSummary(minor), details: { changes: minor },
      });
    }
    const big = det.changes.filter((c) => c.kind !== "minor");
    if (!big.length) { result = { ok: true, outcome: "minor", category: "MINOR", checkedAt: now }; return; }

    const category = det.category as Exclude<ChangeCategory, "NONE" | "MINOR">;
    let target = { id: loan.id, pn: loan.pn };
    let candidates: string[] = [];
    let itemChanges: FieldChange[] = big;
    if (category === "REPLACEMENT" && current.previousPn) {
      // MyLoans says this PN replaces another: link both files; the old one gets the review item.
      await tx.loan.update({ where: { id: loan.id }, data: { replacesPn: current.previousPn } });
      const old = await tx.loan.findUnique({ where: { pn: current.previousPn } });
      await writeAudit(tx, { actor: SYSTEM_ACTOR, mode, action: "replacement_linked", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn: loan.pn, summary: `MyLoans says ${loan.pn} replaces ${current.previousPn}. The files are linked.` });
      if (!old) { result = { ok: true, outcome: "minor", category: "REPLACEMENT", checkedAt: now }; return; }
      await tx.loan.update({ where: { id: old.id }, data: { replacedByPn: loan.pn } });
      await writeAudit(tx, { actor: SYSTEM_ACTOR, mode, action: "replacement_linked", entityType: "Loan", entityId: old.id, loanId: old.id, pn: old.pn, summary: `MyLoans says ${loan.pn} replaces ${old.pn}. The files are linked.` });
      target = { id: old.id, pn: old.pn };
      candidates = [loan.pn];
      itemChanges = [{ field: "previousPn", label: "Replaced by", kind: "replacement", was: null, now: loan.pn }];
    } else if (category === "STATUS") {
      // Only possible replacements: ended here, details match, released in time. Additional units are not suggested.
      const me = await tx.loan.findUniqueOrThrow({ where: { id: loan.id }, select: RELATED_SELECT });
      candidates = (await replacementCandidates(tx, me)).map((r) => r.loan.pn);
    }
    await raiseReview(tx, { loanId: target.id, pn: target.pn, category, changes: itemChanges, hash, candidates, mode, now });
    result = { ok: true, outcome: "review", category, checkedAt: now };
  });
  return result;
}

async function proposedFor(db: Tx | typeof prisma, loanId: string, category: ChangeCategory, picks?: { financingType?: FinancingType | null; orcrStatus?: OrcrStatus | null }): Promise<Proposed> {
  const loan = await db.loan.findUniqueOrThrow({ where: { id: loanId } });
  const snap = await db.loanSourceSnapshot.findFirst({ where: { loanId }, orderBy: { retrievedAt: "desc" } });
  const rec = snap ? recordFromPayload(snap.payload) : null;
  const next = (snap?.tracked as Tracked | null) ?? (rec ? trackedOf(rec) : null);
  if (!next) throw new UserError("There is no MyLoans copy to compare with.");
  return proposeEffect({ category, loan: { ...loan, financingType: loan.financingType as FinancingType | null, orcrStatus: loan.orcrStatus as OrcrStatus | null }, txns: await txnsNow(db, loanId), next, picks });
}

/** A new loan file of the same borrower: if it may replace an ended loan under review, add it as a possible replacement. */
export async function suggestOnOpen(newPn: string) {
  const nw = await prisma.loan.findUnique({ where: { pn: newPn }, select: RELATED_SELECT });
  if (!nw) return;
  for (const r of await relatedLoans(prisma, nw)) {
    if (r.tag !== "POSSIBLE" || r.oldPn !== r.loan.pn) continue;
    const open = await prisma.sourceChange.findFirst({ where: { loanId: r.loan.id, state: "OPEN" } });
    if (open && !open.candidates.includes(nw.pn)) await prisma.sourceChange.update({ where: { id: open.id }, data: { candidates: [...open.candidates, nw.pn] } });
  }
}

/** A new loan file whose MyLoans record names the PN it replaces: link both; the old one gets the review item. */
export async function linkOnOpen(newPn: string, previousPn: string) {
  const [nw, old] = await Promise.all([prisma.loan.findUnique({ where: { pn: newPn } }), prisma.loan.findUnique({ where: { pn: previousPn } })]);
  if (!nw) return;
  await withLoanLock(old?.id ?? nw.id, async (tx) => {
    await tx.loan.update({ where: { id: nw.id }, data: { replacesPn: previousPn } });
    await writeAudit(tx, { actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "replacement_linked", entityType: "Loan", entityId: nw.id, loanId: nw.id, pn: nw.pn, summary: `MyLoans says ${nw.pn} replaces ${previousPn}. The files are linked.` });
    if (!old) return;
    await tx.loan.update({ where: { id: old.id }, data: { replacedByPn: nw.pn } });
    await writeAudit(tx, { actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "replacement_linked", entityType: "Loan", entityId: old.id, loanId: old.id, pn: old.pn, summary: `MyLoans says ${nw.pn} replaces ${old.pn}. The files are linked.` });
    const snap = await tx.loanSourceSnapshot.findFirst({ where: { loanId: old.id }, orderBy: { retrievedAt: "desc" } });
    await raiseReview(tx, {
      loanId: old.id, pn: old.pn, category: "REPLACEMENT", changes: [{ field: "previousPn", label: "Replaced by", kind: "replacement", was: null, now: nw.pn }],
      hash: snap?.hash ?? "replacement", candidates: [nw.pn], mode: "AUTOMATIC", now: new Date(),
    });
  });
}

/** One open review item per loan: a newer change updates it and keeps the earlier one in its history. */
async function raiseReview(tx: Tx, a: { loanId: string; pn: string; category: Exclude<ChangeCategory, "NONE" | "MINOR">; changes: FieldChange[]; hash: string; candidates: string[]; mode: Mode; now: Date }) {
  const open = await tx.sourceChange.findFirst({ where: { loanId: a.loanId, state: "OPEN" } });
  const loan = await tx.loan.findUniqueOrThrow({ where: { id: a.loanId } });
  let id: string;
  let category = a.category;
  if (open) {
    if (RANK[open.category] > RANK[category]) category = open.category as typeof category;
    const changes = mergeChanges(open.changes as unknown as FieldChange[], a.changes);
    const history = [...((open.history as unknown[]) ?? []), { detectedAt: open.detectedAt, category: open.category, changes: open.changes }];
    await tx.sourceChange.update({
      where: { id: open.id },
      data: {
        detectedAt: a.now, category, changes: changes as unknown as Prisma.InputJsonValue, hash: a.hash, history: history as Prisma.InputJsonValue,
        candidates: [...new Set([...open.candidates, ...a.candidates])], proposed: (await proposedFor(tx, a.loanId, category)) as unknown as Prisma.InputJsonValue,
      },
    });
    id = open.id;
  } else {
    const created = await tx.sourceChange.create({
      data: {
        loanId: a.loanId, category, changes: a.changes as unknown as Prisma.InputJsonValue, hash: a.hash, candidates: a.candidates,
        proposed: (await proposedFor(tx, a.loanId, category)) as unknown as Prisma.InputJsonValue, simulated: a.mode === "SIMULATED", detectedAt: a.now, firstSeenAt: a.now,
      },
    });
    id = created.id;
  }
  if (!loan.cancelledAt) await tx.loan.update({ where: { id: a.loanId }, data: { syncTier: "A", nextCheckAt: loan.nextCheckAt && loan.nextCheckAt < a.now ? loan.nextCheckAt : a.now } });
  const what = category === "REPLACEMENT" ? `MyLoans gave this loan a replacement PN (${a.candidates[0] ?? "new PN"})` : `MyLoans changed ${words(a.changes)}`;
  await writeAudit(tx, {
    actor: SYSTEM_ACTOR, mode: a.mode, action: "source_change_detected", entityType: "SourceChange", entityId: id, loanId: a.loanId, pn: a.pn,
    summary: `${what}. Admin is reviewing.`, details: { category, fields: a.changes.map((c) => c.label) },
  });
  // Field names only: amounts are never in the notification or the email.
  await notify(tx, {
    userIds: [...(await reviewerIds(tx)), ...(await branchLaUserIds(tx, loan.branchId)), ...(await liveDpIds(tx, a.loanId))], loanId: a.loanId,
    title: `${a.pn}: MyLoans changed this loan`, body: `${what}. Admin is reviewing.`, link: `/loans/${a.pn}?tab=todo&review=1`,
    email: { event: "source_changed", vars: { pn: a.pn, transaction: "the loan file", reason: `${what}.`, status: category === "STATUS" ? "cancelled or not released" : category === "REPLACEMENT" ? "replaced" : "changed" } },
  });
}

// ---------------------------------------------------------------------------
// While a review item is open: what is blocked (never because of an outage)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Admin decisions (source:review)
// ---------------------------------------------------------------------------

function needReview(u: CurrentUser) {
  if (!can(u, PERMISSIONS.SOURCE_REVIEW)) throw new UserError("Only Admin reviews MyLoans changes. Your view is read-only.");
}
const noteSchema = z.string().trim().min(3, "Write a short note (at least 3 characters).").max(500, "Keep the note under 500 characters.");
function noteOf(raw: unknown) {
  const p = noteSchema.safeParse(raw ?? "");
  if (!p.success) throw new UserError(p.error.issues[0].message, "note");
  return p.data;
}
const actorOf = (u: CurrentUser): Actor => ({ id: u.id, label: u.name });
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

async function openItem(tx: Tx, id: string, u: CurrentUser) {
  const item = await tx.sourceChange.findUnique({ where: { id }, include: { loan: true } });
  if (!item || !inScope(u, item.loan.branchId)) throw new NotInScopeError();
  if (item.state !== "OPEN") throw new UserError("This change was already decided.");
  return item;
}

async function lockedItem(u: CurrentUser, id: string) {
  const it = await prisma.sourceChange.findUnique({ where: { id }, select: { loanId: true } });
  if (!it) throw new NotInScopeError();
  return it.loanId;
}

async function tellLoanPeople(tx: Tx, loan: { id: string; pn: string; branchId: string }, title: string, body: string) {
  await notify(tx, { userIds: [...(await branchLaUserIds(tx, loan.branchId)), ...(await liveDpIds(tx, loan.id))], loanId: loan.id, title, body, link: `/loans/${loan.pn}?tab=journey` });
}

const applySchema = z.object({
  note: z.unknown(),
  financingType: z.enum(["UNDERTAKING", "NON_UNDERTAKING"]).nullish(),
  orcrStatus: z.enum(["TRANSFERRED", "UNTRANSFERRED"]).nullish(),
});

/**
 * Apply (material change): re-run the rules on the new data and update the loan. Unsent transactions
 * are added or removed (ticked papers stay where the item still exists); sent or in-process ones are
 * never changed: that part is refused with the reason.
 */
export async function applySourceChange(u: CurrentUser, id: string, raw: unknown) {
  needReview(u);
  const d = applySchema.parse(raw);
  const note = noteOf(d.note);
  return withLoanLock(await lockedItem(u, id), async (tx) => {
    const item = await openItem(tx, id, u);
    if (item.category !== "MATERIAL") throw new UserError("Apply is for changes to amount, product or loan type. Use Close as cancelled or Keep current.");
    const p = await proposedFor(tx, item.loanId, "MATERIAL", { financingType: d.financingType ?? null, orcrStatus: d.orcrStatus ?? null });
    if (p.needsPicks) throw new UserError("Pick Undertaking or Non-Undertaking and the ORCR status to apply it (the product is now Financing).", "financingType");
    if (!p.ruleNext) throw new UserError(p.sentences[0] ?? "The rules cannot run on the new data. Keep current instead.");
    const locked = p.affected.filter((a) => a.locked);
    if (locked.length) {
      throw new UserError(`${listWords(locked.map((a) => a.stateLine))}. Apply never changes work that was sent. Ask the LA to pull it back or the processor to return it, or choose Keep current.`);
    }
    const snap = await tx.loanSourceSnapshot.findFirstOrThrow({ where: { loanId: item.loanId }, orderBy: { retrievedAt: "desc" } });
    const next = snap.tracked as unknown as Tracked;
    const loan = item.loan;
    const data: Prisma.LoanUpdateInput = {
      loanType: next.loanType ?? loan.loanType, productName: next.productName ?? "",
      // The rest of the material account details, as MyLoans now has them (a copy saved before they were
      // tracked has none of these keys: the loan keeps its own).
      ...("productCode" in next ? { productCode: next.productCode } : {}),
      ...("sourceLoanId" in next ? { sourceLoanId: next.sourceLoanId } : {}),
      ...(next.branchCode || next.branchName ? { sourceBranchCode: next.branchCode, sourceBranchName: next.branchName } : {}),
      totalReleasedAmount: typeof next.amount === "number" ? new Prisma.Decimal(next.amount / 100) : loan.totalReleasedAmount,
      classification: p.classificationNext!, mortgageResult: p.mortgageNext as never, ruleFired: p.ruleNext,
      financingType: p.classificationNext === "FINANCING" ? (d.financingType ?? loan.financingType) : null,
      orcrStatus: p.classificationNext === "FINANCING" ? (d.orcrStatus ?? loan.orcrStatus) : null,
    };
    if (next.releaseDate && next.releaseDate !== businessDate(loan.releasedAt)) data.releasedAt = startOfBusinessDay(next.releaseDate);
    // The loan's CURRENT branch comes from the MyLoans branch field (code first, then name); it changes
    // only here, when Admin applies the change. The PN's branch code stays: it says where it was opened.
    let moved: { from: string; to: string } | null = null;
    if (next.branchName || next.branchCode) {
      const br = await resolveLoanBranch(tx, { branchCode: next.branchCode ?? null, branchName: next.branchName });
      if (!br) throw new UserError(`MyLoans moved the loan to ${next.branchName ?? "a branch"}${next.branchCode ? ` (${next.branchCode})` : ""}, which is not a branch here. Accept it in Settings, Branches (Branch review) first, or keep current.`);
      if (br.id !== loan.branchId) {
        data.branch = { connect: { id: br.id } };
        const was = await tx.branch.findUniqueOrThrow({ where: { id: loan.branchId }, select: { name: true, code: true } });
        moved = { from: was.name, to: br.name };
      }
    }
    await tx.loan.update({ where: { id: loan.id }, data });

    const txns = await tx.loanTransaction.findMany({ where: { loanId: loan.id }, include: { type: true } });
    const now = new Date();
    for (const code of p.removed) {
      const t = txns.find((x) => x.type.code === code && x.status !== "CANCELLED");
      if (t && UNSENT.includes(t.status)) await tx.loanTransaction.update({ where: { id: t.id }, data: { status: "CANCELLED", statusSince: now } });
    }
    for (const code of p.added) {
      const back = txns.find((x) => x.type.code === code && x.status === "CANCELLED");
      if (back) {
        // Added back: the same checklist rows, so ticked papers stay ticked.
        const done = await tx.checklistCheck.count({ where: { transactionId: back.id, required: true, checked: false } });
        await tx.loanTransaction.update({ where: { id: back.id }, data: { status: done === 0 ? "READY" : "FOR_CHECKLIST", statusSince: now } });
      } else {
        const type = await tx.transactionType.findFirstOrThrow({ where: { code }, include: { rules: { where: { active: true }, include: { documentType: true }, orderBy: { sortOrder: "asc" } } } });
        await createTransactionOfType(tx, { loanId: loan.id, type, origin: "AUTOMATIC" });
      }
    }
    await tx.sourceChange.update({ where: { id: item.id }, data: { state: "APPLIED", decidedById: u.id, decidedByLabel: u.name, decidedAt: now, note, proposed: p as unknown as Prisma.InputJsonValue } });
    await writeAudit(tx, {
      actor: actorOf(u), mode: "MANUAL", action: "source_change_applied", entityType: "SourceChange", entityId: item.id, loanId: loan.id, pn: loan.pn,
      summary: `MyLoans changed ${words(item.changes as unknown as FieldChange[])}. Admin ${u.name} applied it: ${moved ? `the loan's branch is now ${moved.to} (was ${moved.from}). ` : ""}${p.sentences.join(" ")} Note: ${note}`,
      before: { classification: loan.classification, mortgage: loan.mortgageResult, ...(moved ? { branch: moved.from } : {}) }, after: { classification: p.classificationNext, mortgage: p.mortgageNext, added: p.added, removed: p.removed, ...(moved ? { branch: moved.to } : {}) },
    });
    await recomputeStage(tx, loan.id);
    await tellLoanPeople(tx, loan, `${loan.pn}: MyLoans change applied`, `${u.name} applied it. ${p.sentences.join(" ")}`);
  });
}

/** Keep current: the loan stays as it is (the same change does not alert again). */
export async function keepCurrent(u: CurrentUser, id: string, raw: unknown) {
  needReview(u);
  const note = noteOf(raw);
  return withLoanLock(await lockedItem(u, id), async (tx) => {
    const item = await openItem(tx, id, u);
    await tx.sourceChange.update({ where: { id }, data: { state: "KEPT", decidedById: u.id, decidedByLabel: u.name, decidedAt: new Date(), note } });
    await writeAudit(tx, {
      actor: actorOf(u), mode: "MANUAL", action: "source_change_kept", entityType: "SourceChange", entityId: id, loanId: item.loanId, pn: item.loan.pn,
      summary: `MyLoans changed ${words(item.changes as unknown as FieldChange[])}. Admin ${u.name} kept the current setup: ${note}`,
    });
    await tellLoanPeople(tx, item.loan, `${item.loan.pn}: MyLoans change reviewed`, `${u.name} kept the current setup: ${note}`);
  });
}

/** Cash still out on the loan's transactions: it must be handled before closing. */
export async function outstandingCash(db: Tx | typeof prisma, loanId: string) {
  const lines = await db.cashAdvanceLine.findMany({
    where: { transaction: { loanId }, advance: { status: { in: [...OUT_ADVANCE] } }, denied: false },
    include: { advance: { include: { requestedBy: { select: { id: true, name: true } } } }, transaction: { include: { type: true } }, receipts: true, returns: true },
  });
  return lines.map((l) => {
    const spent = l.receipts.reduce((s, r) => s + r.cents, 0);
    const returned = l.returns.reduce((s, r) => s + r.cents, 0);
    const released = l.releasedCents;
    const notReleased = ["REQUESTED", "APPROVED"].includes(l.advance.status);
    const balance = notReleased ? l.approvedCents ?? l.requestedCents : advanceBalance({ releasedCents: released, receiptCents: spent, returnedCents: returned });
    return { lineId: l.id, advanceId: l.advanceId, number: l.advance.number, fundsTypeId: l.advance.fundsTypeId, status: l.advance.status, notReleased, kind: l.kind, cents: balance, dp: l.advance.requestedBy, txnName: l.transaction?.type.name ?? "", txnCode: l.transaction?.type.code ?? "" };
  }).filter((x) => x.cents > 0);
}

/** Close as cancelled (status or replacement): needs a note; refused while cash is out. Nothing is deleted. */
export async function closeAsCancelled(u: CurrentUser, id: string, raw: unknown) {
  needReview(u);
  const note = noteOf(raw);
  return withLoanLock(await lockedItem(u, id), async (tx) => {
    const item = await openItem(tx, id, u);
    if (item.category === "MATERIAL") throw new UserError("Close as cancelled is for a cancelled, withdrawn or replaced loan.");
    const cash = await outstandingCash(tx, item.loanId);
    if (cash.length) {
      throw new UserError(`Cash is still out: ${cash.map((c) => `${c.number} (${c.dp.name}${c.notReleased ? ", not released yet" : ""})`).join(", ")}. Ask for the cash back (or deny the request) before closing.`);
    }
    const loan = item.loan;
    const reason = loan.replacedByPn ? `Replaced by ${loan.replacedByPn}` : "Cancelled in MyLoans";
    const now = new Date();
    const jobs = await tx.dpAssignment.findMany({ where: { loanId: loan.id, status: { in: [...OPEN_JOB] } }, include: { transaction: { include: { type: true } } } });
    for (const j of jobs) await tx.dpAssignment.update({ where: { id: j.id }, data: { status: "PULLED_BACK", closedAt: now } });
    const open = await tx.loanTransaction.findMany({ where: { loanId: loan.id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, include: { type: true } });
    for (const t of open) await tx.loanTransaction.update({ where: { id: t.id }, data: { status: "CANCELLED", statusSince: now } });
    await tx.loan.update({ where: { id: loan.id }, data: { cancelledAt: now, cancelReason: reason } });
    await tx.sourceChange.update({ where: { id }, data: { state: "CLOSED_CANCELLED", decidedById: u.id, decidedByLabel: u.name, decidedAt: now, note } });
    await writeAudit(tx, {
      actor: actorOf(u), mode: "MANUAL", action: "source_change_closed", entityType: "SourceChange", entityId: id, loanId: loan.id, pn: loan.pn,
      summary: `Admin ${u.name} closed the loan as "${reason}": ${note}${open.length ? `. Closed: ${listWords(open.map((t) => t.type.name))}` : ""}${jobs.length ? `. Processor jobs stopped: ${listWords(jobs.map((j) => j.transaction.type.name))}` : ""}`,
    });
    for (const j of jobs) {
      await notify(tx, {
        userIds: [j.dpUserId, ...(j.secondaryDpUserId ? [j.secondaryDpUserId] : [])], loanId: loan.id, title: `${loan.pn}: ${j.transaction.type.name} stopped`,
        body: `${reason}. Stop work on it and keep the papers safe; the Loan Associate will collect them.`, link: "/jobs",
        email: { event: "job_changed", transactionId: j.transactionId, vars: { pn: loan.pn, transaction: j.transaction.type.name, who: u.name, reason: `${reason}. Stop work on it.` } },
      });
    }
    await recomputeStage(tx, loan.id);
    await notify(tx, { userIds: await branchLaUserIds(tx, loan.branchId), loanId: loan.id, title: `${loan.pn}: closed as cancelled`, body: `${reason}. ${note}`, link: `/loans/${loan.pn}` });
  });
}

/** Return the cash: asks the processor for a normal cash return that Finance confirms. Nothing moves by itself. */
export async function askCashBack(u: CurrentUser, id: string) {
  needReview(u);
  return withLoanLock(await lockedItem(u, id), async (tx) => {
    const item = await openItem(tx, id, u);
    const cash = await outstandingCash(tx, item.loanId);
    if (!cash.length) throw new UserError("No cash is out on this loan.");
    for (const c of cash) {
      await notify(tx, {
        userIds: [c.dp.id, ...(await financeIds(tx, c, c.notReleased ? "approve" : "settle"))], loanId: item.loanId, title: `${c.number}: return the cash for ${item.loan.pn}`,
        body: `${item.loan.pn} is cancelled in MyLoans. ${c.notReleased ? "This request is not released yet: Finance, deny it." : `Return the balance for ${c.txnName} (My funds > Return cash); Finance confirms it.`}`,
        link: c.notReleased ? "/funds?tab=approve" : "/my-funds?tab=liquidation",
        email: { event: "cash_returned", amountCents: c.cents, vars: { number: c.number, who: u.name, status: "cash back asked", reason: `${item.loan.pn} is cancelled in MyLoans. Return {amount}`.replace("{amount}", "the balance") } },
      });
    }
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "source_cash_back_asked", entityType: "SourceChange", entityId: id, loanId: item.loanId, pn: item.loan.pn, summary: `Admin ${u.name} asked for the cash back on ${listWords(cash.map((c) => c.number))} before closing` });
  });
}

/** Link as replacement: this (old) loan is replaced by another loan file of the same borrower (CIN or CIF). */
export interface LinkInput { newPn?: unknown; note?: unknown; confirmNoPayment?: unknown; overrideNote?: unknown }

/**
 * Link two loans of the same borrower as replacement (old -> new). Allowed for a possible replacement
 * (old ended in MyLoans, details match), or manually from Related loans with a note. No payment on the
 * old PN: MyLoans' payments field when it has one (a recorded payment needs an override note), else the
 * Admin's confirmation. The confirmation and the note are saved on the new loan and audited.
 */
async function linkCore(tx: Tx, u: CurrentUser, oldPn: string, newPn: string, raw: LinkInput, manual: boolean) {
  const note = noteOf(raw.note);
  const [old, nw] = await Promise.all([tx.loan.findUnique({ where: { pn: oldPn }, select: RELATED_SELECT }), tx.loan.findUnique({ where: { pn: newPn }, select: RELATED_SELECT })]);
  if (!old || !nw || !inScope(u, old.branchId) || !inScope(u, nw.branchId)) throw new UserError("Pick one of the loans of the same borrower (same CIN or CIF).", "newPn");
  const rel = (await relatedLoans(tx, old)).find((r) => r.loan.pn === nw.pn);
  if (!rel) throw new UserError("Pick one of the loans of the same borrower (same CIN or CIF).", "newPn");
  if (old.replacedByPn && old.replacedByPn !== nw.pn) throw new UserError(`${old.pn} is already replaced by ${old.replacedByPn}.`, "newPn");
  if (nw.replacesPn && nw.replacesPn !== old.pn) throw new UserError(`${nw.pn} already replaces ${nw.replacesPn}.`, "newPn");
  if (!manual && rel.tag !== "POSSIBLE") throw new UserError(`${rel.relation?.reason ?? "This is not a replacement."} Link it from Related loans only if you are sure.`, "newPn");
  const pay = paymentEvidence(rel.paymentRecorded);
  const override = String(raw.overrideNote ?? "").trim();
  const confirmed = raw.confirmNoPayment === true || raw.confirmNoPayment === "on";
  if (pay.known && pay.recorded && override.length < 3) throw new UserError(`Payment recorded in MyLoans on ${old.pn}. A replacement needs no payment on the old PN: write an override note to link anyway.`, "overrideNote");
  if (!pay.known && !confirmed) throw new UserError("Tick \"I confirmed no payment was made on the old PN\".", "confirmNoPayment");
  const evidence = pay.known
    ? (pay.recorded ? `Payment recorded in MyLoans; linked by ${u.name} with an override: ${override}` : `No payment recorded in MyLoans (checked by ${u.name})`)
    : `${u.name} confirmed no payment was made on ${old.pn}`;
  await tx.loan.update({ where: { id: old.id }, data: { replacedByPn: nw.pn } });
  await tx.loan.update({ where: { id: nw.id }, data: { replacesPn: old.pn, replacementEvidence: `${evidence}. Note: ${note}` } });
  const open = await tx.sourceChange.findFirst({ where: { loanId: old.id, state: "OPEN" } });
  if (open) await tx.sourceChange.update({ where: { id: open.id }, data: { candidates: [...new Set([nw.pn, ...open.candidates])] } });
  const text = `Admin ${u.name} linked ${nw.pn} as the replacement of ${old.pn}${manual ? " (from Related loans)" : ""}. ${evidence}. Note: ${note}`;
  const details = { manual, matched: rel.relation?.matched ?? [], payment: pay.known ? (pay.recorded ? "recorded" : "none") : "no payments field", confirmedNoPayment: confirmed, overrideNote: override || null, note };
  for (const l of [old, nw]) {
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "replacement_linked", entityType: "Loan", entityId: l.id, loanId: l.id, pn: l.pn, summary: text, details });
  }
}

/** From the review pop-up of the old loan: link one of its possible replacements. */
export async function linkReplacement(u: CurrentUser, id: string, raw: LinkInput) {
  needReview(u);
  const newPn = String(raw.newPn ?? "").trim().toUpperCase();
  return withLoanLock(await lockedItem(u, id), async (tx) => {
    const item = await openItem(tx, id, u);
    await linkCore(tx, u, item.loan.pn, newPn, raw, false);
  });
}

/** From the Related loans panel: link an unusual case by hand (the same confirmation, plus a required note). */
export async function linkFromRelated(u: CurrentUser, loanId: string, otherPn: string, raw: LinkInput) {
  needReview(u);
  return withLoanLock(loanId, async (tx) => {
    const me = await tx.loan.findUnique({ where: { id: loanId }, select: RELATED_SELECT });
    if (!me || !inScope(u, me.branchId)) throw new NotInScopeError();
    const rel = (await relatedLoans(tx, me)).find((r) => r.loan.pn === otherPn.trim().toUpperCase());
    if (!rel) throw new UserError("Pick one of the loans of the same borrower (same CIN or CIF).", "newPn");
    await linkCore(tx, u, rel.oldPn, rel.newPn, raw, true);
  });
}

/**
 * Move the cash to the new PN (replacement): a request on the new PN's transaction for the balance,
 * decided by the same approval band as a new request. On approval it is released at once (the cash is
 * already with the processor) and the old line shows it handed over. Never automatic.
 */
export async function moveCashToNewPn(u: CurrentUser, id: string, lineId: string) {
  needReview(u);
  return withLoanLock(await lockedItem(u, id), async (tx) => {
    const item = await openItem(tx, id, u);
    const old = item.loan;
    if (!old.replacedByPn) throw new UserError("Link the replacement PN first.");
    const nw = await tx.loan.findUnique({ where: { pn: old.replacedByPn }, include: { transactions: { include: { type: true } } } });
    if (!nw) throw new UserError(`${old.replacedByPn} is not opened yet. Ask the LA to open it first.`);
    const cash = (await outstandingCash(tx, old.id)).find((c) => c.lineId === lineId);
    if (!cash || cash.notReleased) throw new UserError("Pick released cash that is still out.");
    if (await tx.cashAdvance.findFirst({ where: { movedFromLineId: lineId, status: "REQUESTED" } })) throw new UserError("A move for this cash is already waiting for approval.");
    const target = nw.transactions.find((t) => t.type.code === cash.txnCode && t.status !== "CANCELLED") ?? nw.transactions.find((t) => t.status !== "CANCELLED");
    if (!target) throw new UserError(`${nw.pn} has no open transaction to move the cash to.`);
    // The moved balance keeps the funds type of the record it came from (and its number prefix).
    const parent = (await tx.cashAdvanceLine.findUniqueOrThrow({ where: { id: lineId }, select: { advance: { select: { fundsTypeId: true, fundsTypeCode: true, fundsTypeName: true } } } })).advance;
    const number = await nextNumber(tx, new Date(), parent.fundsTypeCode);
    const adv = await tx.cashAdvance.create({
      data: {
        ...parent, number, requestedById: cash.dp.id, branchId: nw.branchId, status: "REQUESTED", requestedCents: cash.cents, movedFromLineId: lineId,
        note: `Move ${peso(cash.cents)} from ${cash.number} (${old.pn}, replaced) to ${nw.pn}. Asked by ${u.name}.`,
        lines: { create: { transactionId: target.id, kind: cash.kind as never, requestedCents: cash.cents, note: `Moved from ${cash.number} (${old.pn})` } },
      },
    });
    for (const l of [old, nw]) {
      await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "cash_move_requested", entityType: "CashAdvance", entityId: adv.id, loanId: l.id, pn: l.pn, summary: `Admin ${u.name} asked to move the cash on ${cash.number} (${old.pn}) to ${nw.pn} as ${number}; it waits for approval` });
    }
    await notify(tx, {
      userIds: await bandApprovers(tx, cash.cents, parent), loanId: nw.id, title: `${number}: move cash to ${nw.pn}`, body: `${old.pn} was replaced by ${nw.pn}. Approve moving the balance of ${cash.number}.`, link: "/funds?tab=approve",
      email: { event: "advance_requested", amountCents: cash.cents, vars: { number, who: u.name, kind: parent.fundsTypeName, reason: `Move the cash from ${cash.number} (${old.pn}) to ${nw.pn}.` } },
    });
    return { number };
  });
}

export const ORIGINAL_NOTE = (pn: string) => `Original is filed under ${pn}. Tick it here only if you hold another original or a certified copy.`;

export interface ReusableOption {
  fromCheckId: string; toCheckId: string; label: string; fromTxn: string; toTxn: string; documentId: string | null;
  fromPn: string; mode: "replacement" | "additional";
  /** Additional unit, Original form: not copied (the note says why). */
  blocked: string | null;
}

/**
 * Reusable papers (belong to the borrower) ticked on any related loan of the same borrower, and where
 * they would go on this loan. Replacement: as built. Additional unit: only papers whose form here is
 * Copy; Originals are listed with the reason and never copied. Unit papers are never listed.
 */
export async function reusablePapers(db: Tx | typeof prisma, newLoanId: string): Promise<ReusableOption[]> {
  const nw = await db.loan.findUnique({ where: { id: newLoanId }, select: RELATED_SELECT });
  if (!nw) return [];
  const related = (await relatedLoans(db, nw)).filter((r) => r.tag !== "REPLACES"); // never copy back onto the old loan
  if (!related.length) return [];
  const newChecks = await db.checklistCheck.findMany({
    where: { checked: false, transaction: { loanId: nw.id, status: { in: ["FOR_CHECKLIST", "READY", "RETURNED"] } } },
    include: { rule: { include: { documentType: true } }, transaction: { include: { type: true } } },
  });
  const oldChecks = await db.checklistCheck.findMany({
    where: { checked: true, transaction: { loanId: { in: related.map((r) => r.loan.id) } }, rule: { reusable: true } },
    include: { rule: true, transaction: { include: { type: true, loan: { select: { pn: true } } } }, documentItem: true },
    orderBy: { checkedAt: "asc" },
  });
  const used = new Set<string>();
  const out: ReusableOption[] = [];
  for (const o of oldChecks) {
    const fromPn = o.transaction.loan.pn;
    const mode = fromPn === nw.replacesPn ? "replacement" as const : "additional" as const;
    const to = newChecks.find((n) => !used.has(n.id) && n.ruleId === o.ruleId) ?? newChecks.find((n) => !used.has(n.id) && n.rule?.documentTypeId === o.rule?.documentTypeId);
    if (!to) continue;
    used.add(to.id);
    const blocked = mode === "additional" && to.rule?.originality !== "COPY" ? ORIGINAL_NOTE(fromPn) : null;
    out.push({ fromCheckId: o.id, toCheckId: to.id, label: o.rule?.label ?? "Paper", fromTxn: o.transaction.type.name, toTxn: to.transaction.type.name, documentId: o.documentItem?.documentId ?? null, fromPn, mode, blocked });
  }
  return out;
}

/** Copy reusable papers from a related loan, each one confirmed. Unit papers and Originals of an additional unit never. */
export async function copyReusablePapers(u: CurrentUser, newLoanId: string, fromCheckIds: string[]) {
  needReview(u);
  if (!fromCheckIds.length) throw new UserError("Tick the papers to copy.");
  return withLoanLock(newLoanId, async (tx) => {
    const nw = await tx.loan.findUniqueOrThrow({ where: { id: newLoanId } });
    if (!inScope(u, nw.branchId)) throw new NotInScopeError();
    const options = await reusablePapers(tx, newLoanId);
    const picked = options.filter((o) => fromCheckIds.includes(o.fromCheckId));
    if (picked.length !== new Set(fromCheckIds).size) throw new UserError("Only ticked papers that belong to the borrower can be copied.");
    const blocked = picked.find((o) => o.blocked);
    if (blocked) throw new UserError(`${blocked.label}: ${blocked.blocked}`);
    const now = new Date();
    const custodian = `${u.name} (Admin)`;
    for (const o of picked) {
      const to = await tx.checklistCheck.update({ where: { id: o.toCheckId }, data: { checked: true, checkedAt: now, checkedById: u.id }, include: { documentItem: true } });
      const oldDoc = await tx.documentItem.findFirst({ where: { checkId: o.fromCheckId } });
      const reuse = o.mode === "replacement";
      if (to.documentItem) {
        const documentId = to.documentItem.documentId ?? (await nextDocumentId(tx, nw.pn, to.documentItem.docTypeCode));
        await tx.documentItem.update({ where: { id: to.documentItem.id }, data: { documentId, stage: "AT_BRANCH", custodianLabel: oldDoc?.custodianLabel ?? custodian, custodianRole: oldDoc?.custodianRole ?? null, custodianUserId: oldDoc?.custodianUserId ?? null, location: oldDoc?.location ?? "", since: now } });
        await tx.documentMovement.create({
          data: {
            documentItemId: to.documentItem.id, action: reuse ? "REASSIGNED" : "REFERENCED", fromCustodian: oldDoc?.custodianLabel ?? null, toCustodian: oldDoc?.custodianLabel ?? custodian,
            purpose: reuse ? `Reused from ${o.fromPn}` : `Copy referenced from ${o.fromPn}`, remarks: reuse ? `Reassigned from ${o.fromPn}${o.documentId ? ` (${o.documentId})` : ""}` : `Referenced from ${o.fromPn}${o.documentId ? ` (${o.documentId})` : ""}`,
            actorId: u.id, actorLabel: u.name, location: oldDoc?.location ?? "", acknowledgedAt: now, acknowledgedById: u.id,
          },
        });
      }
      // A replacement takes the paper over; an additional unit only references a copy (the old file keeps its paper).
      if (oldDoc && reuse) {
        await tx.documentMovement.create({ data: { documentItemId: oldDoc.id, action: "REASSIGNED", fromCustodian: oldDoc.custodianLabel, toCustodian: oldDoc.custodianLabel, purpose: `Reused for ${nw.pn}`, remarks: `Reassigned to ${nw.pn}`, actorId: u.id, actorLabel: u.name, location: oldDoc.location, acknowledgedAt: now, acknowledgedById: u.id } });
      }
      const left = await tx.checklistCheck.count({ where: { transactionId: to.transactionId, required: true, checked: false } });
      const t = await tx.loanTransaction.findUniqueOrThrow({ where: { id: to.transactionId } });
      if (left === 0 && t.status === "FOR_CHECKLIST") await tx.loanTransaction.update({ where: { id: t.id }, data: { status: "READY", statusSince: now } });
    }
    for (const fromPn of [...new Set(picked.map((p) => p.fromPn))]) {
      const these = picked.filter((p) => p.fromPn === fromPn);
      const labels = listWords(these.map((p) => p.label));
      const reuse = these[0].mode === "replacement";
      await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "papers_reused", entityType: "Loan", entityId: nw.id, loanId: nw.id, pn: nw.pn, summary: reuse ? `Admin ${u.name} copied reusable papers from ${fromPn}: ${labels}` : `Admin ${u.name} referenced copies from ${fromPn} (additional unit): ${labels}` });
      const old = await tx.loan.findUnique({ where: { pn: fromPn } });
      if (old && reuse) await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "papers_reused", entityType: "Loan", entityId: old.id, loanId: old.id, pn: old.pn, summary: `Admin ${u.name} reassigned reusable papers to ${nw.pn}: ${labels}` });
    }
    await recomputeStage(tx, nw.id);
    return picked.length;
  });
}

// ---------------------------------------------------------------------------
// When to refresh: on open (older than N minutes), and in the background (active loans only)
// ---------------------------------------------------------------------------

/** Refresh a loan being opened when its copy is older than the setting (0 = always). Never throws. */
export async function refreshOnOpen(loan: { id: string; lastCheckedAt: Date | null; retrievedAt: Date; cancelledAt?: Date | null }, now: Date = new Date()): Promise<RefreshResult | null> {
  const minutes = await getSetting("myloans.refreshOnOpenMinutes");
  const last = loan.lastCheckedAt ?? loan.retrievedAt;
  if (minutes > 0 && now.getTime() - last.getTime() < minutes * 60_000) return null;
  try {
    return await refreshLoan(loan.id, { actor: SYSTEM_ACTOR, mode: "AUTOMATIC", trigger: "open", now });
  } catch {
    return null;
  }
}

/** Mon to Sat, 7:00 AM to 7:00 PM, Philippine time; holidays skipped. */
export function isBusinessHours(now: Date, holidays: ReadonlySet<string>): boolean {
  const ymd = businessDate(now);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short", hour: "numeric", hour12: false }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24;
  if (wd === "Sun" || holidays.has(ymd)) return false;
  if (wd !== "Sat" && !isBusinessDay(ymd, holidays)) return false;
  return hour >= 7 && hour < 19;
}

export interface SyncOptions {
  now?: Date; trigger: "cron" | "run_now" | "script"; force?: boolean; actor?: Actor;
  sleep?: (ms: number) => Promise<void>;
  /** Tests: another source (for example 25,000 loans), and a fixed random for the jitter. */
  adapter?: MyLoansAdapter; rnd?: () => number;
}

export interface RunStat {
  at: string; trigger: string; mode: "feed" | "poll"; status: "healthy" | "slowed" | "paused";
  due: number; checked: number; calls: number; saved: number; avgMs: number; maxMs: number; errors: number; ms: number;
  updated: number; changes: number; cap: number; hourCalls: number; ceiling: number;
  /** Kept for the old status lines. */
  ok: boolean; failed: number; error: string | null;
}

const LOCK_KEY = 7_120_001; // pg advisory lock: one MyLoans sync at a time (cron, Run now, a second server)
const OVERLAP_MS = 5 * 60_000;
const SYNC_KEYS = [
  "myloans.backgroundMinutes", "myloans.businessHoursOnly", "myloans.maxPerRun", "myloans.pauseMs", "myloans.lastRun",
  "myloans.tierMinutes", "myloans.hourlyCeiling", "myloans.slowMs", "myloans.state",
] as const;

/** All the sync settings in one query (defaults for missing ones). */
async function syncSettings() {
  const rows = await prisma.setting.findMany({ where: { key: { in: [...SYNC_KEYS] } } });
  const get = <K extends (typeof SYNC_KEYS)[number]>(k: K): SettingValue<K> => (rows.find((r) => r.key === k)?.value as SettingValue<K> | undefined) ?? SETTING_DEFAULTS[k];
  return {
    every: get("myloans.backgroundMinutes"), hoursOnly: get("myloans.businessHoursOnly"), max: get("myloans.maxPerRun"), pause: get("myloans.pauseMs"),
    last: get("myloans.lastRun"), tiers: get("myloans.tierMinutes"), ceiling: get("myloans.hourlyCeiling"), slowMs: get("myloans.slowMs"), state: get("myloans.state"),
  };
}

/** The latest copy's hash of each loan (one query). */
async function latestHashes(ids: string[]): Promise<Map<string, string | null>> {
  if (!ids.length) return new Map();
  const rows = await prisma.$queryRaw<{ loanId: string; hash: string | null }[]>`
    SELECT DISTINCT ON ("loanId") "loanId", "hash" FROM "LoanSourceSnapshot" WHERE "loanId" = ANY(${ids}::text[]) ORDER BY "loanId", "retrievedAt" DESC`;
  return new Map(rows.map((r) => [r.loanId, r.hash]));
}

/** One statement for the whole run: last checked, next check, answered or not. */
async function batchChecked(now: Date, rows: { id: string; next: Date | null; ok: boolean; err: string | null }[]) {
  if (!rows.length) return;
  await prisma.$executeRaw`
    UPDATE "Loan" AS l SET "lastCheckedAt" = ${now}, "nextCheckAt" = v.next, "sourceCurrent" = v.ok, "lastRefreshError" = v.err,
      "retrievedAt" = CASE WHEN v.ok THEN ${now} ELSE l."retrievedAt" END
    FROM unnest(${rows.map((r) => r.id)}::text[], ${rows.map((r) => r.next?.toISOString() ?? null)}::timestamp(3)[], ${rows.map((r) => r.ok)}::boolean[], ${rows.map((r) => r.err)}::text[]) AS v(id, next, ok, err)
    WHERE l.id = v.id`;
}

/** Due loans (partial index "Loan_due_idx"): active ones whose next check has come, oldest first. */
export const dueQuery = (now: Date, cap: number) => Prisma.sql`
  SELECT id, pn, "syncTier" FROM "Loan" WHERE "syncTier" IS NOT NULL AND "nextCheckAt" <= ${now} ORDER BY "nextCheckAt" LIMIT ${cap}`;

/**
 * Background refresh with a bounded load on MyLoans and on our database:
 *  - one runner at a time (advisory lock); business hours (Manila, holidays); every N minutes;
 *  - the changed-since feed first (one call; only PNs open and active here; a cursor with 5 minutes of overlap);
 *  - otherwise the due loans by tier, capped (adaptive cap, hourly ceiling), with a jittered pause;
 *  - unchanged loans cost no write but one batched update for the whole run; only changes are written.
 */
export async function runMyLoansSync(o: SyncOptions) {
  const now = o.now ?? new Date();
  const s = await syncSettings();
  if (!o.force) {
    const holidays = await getHolidaySet();
    if (s.hoursOnly && !isBusinessHours(now, holidays)) return { ran: false as const, reason: "Outside business hours." };
    if (s.last && now.getTime() - new Date(s.last.at).getTime() < s.every * 60_000 - 30_000) return { ran: false as const, reason: `Ran less than ${s.every} minutes ago.` };
  }
  const result = await prisma.$transaction(async (lockTx) => {
    const got = await lockTx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
    if (!got[0]?.ok) return null;
    return runLocked(o, s, now);
  }, { timeout: 30 * 60_000, maxWait: 10_000 });
  return result ?? { ran: false as const, reason: "Another MyLoans sync is running." };
}

async function runLocked(o: SyncOptions, s: Awaited<ReturnType<typeof syncSettings>>, now: Date) {
  const t0 = Date.now();
  const adapter = o.adapter ?? getMyLoansAdapter();
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const rnd = o.rnd ?? Math.random;
  beginStats();
  const cap = Math.max(1, Math.min(s.state.cap ?? s.max, s.max));
  const rows: { id: string; next: Date | null; ok: boolean; err: string | null }[] = [];
  let due = 0, updated = 0, changes = 0, paused = false, lastErr: string | null = null;
  let cursor = s.state.cursor;
  const nextFor = (tier: string | null, ok: boolean) => {
    const t = (tier === "A" || tier === "B" || tier === "C") ? tier : null;
    if (!t) return null;
    const minutes = ok ? s.tiers[t] : Math.min(s.tiers[t], 30); // not answered: ask again sooner
    return new Date(now.getTime() + minutes * 60_000);
  };
  const apply = async (loanId: string, lookup: MyLoansLookup) => {
    const r = await refreshLoan(loanId, { actor: SYSTEM_ACTOR, mode: "AUTOMATIC", trigger: "background", now, lookup });
    if (r.ok && r.outcome !== "none") changes++;
    updated++;
  };
  const mode: "feed" | "poll" = adapter.capabilities.changedSince && cursor ? "feed" : "poll";

  if (callsThisHour() >= s.ceiling) {
    paused = true;
  } else if (mode === "feed") {
    // One call: what changed since the cursor (minus an overlap, so nothing is missed)?
    const since = new Date(new Date(cursor!).getTime() - OVERLAP_MS);
    const started = Date.now();
    const feed = await adapter.getChangedSince(since, 1_000);
    noteCall(Date.now() - started, feed.ok ? { ok: true } : { ok: false, retryAfterMs: feed.retryAfterMs });
    if (feed.ok) {
      const pns = [...new Set(feed.records.map((r) => r.pn))];
      const local = pns.length ? await prisma.loan.findMany({ where: { pn: { in: pns }, syncTier: { not: null } }, select: { id: true, pn: true, syncTier: true } }) : [];
      due = local.length;
      const hashes = await latestHashes(local.map((l) => l.id));
      for (const l of local) {
        const record = feed.records.find((r) => r.pn === l.pn)!;
        if (hashTracked(trackedOf(record)) !== hashes.get(l.id)) {
          await apply(l.id, { ok: true, record, raw: { source: "MyLoansFeed", loan: record }, adapter: adapter.name, retrievedAt: now });
        }
        rows.push({ id: l.id, next: nextFor(l.syncTier, true), ok: true, err: null });
      }
      cursor = feed.until.toISOString();
    } else {
      lastErr = feed.message;
    }
  } else {
    const budget = Math.max(0, Math.min(cap, s.ceiling - callsThisHour()));
    const list = budget ? await prisma.$queryRaw<{ id: string; pn: string; syncTier: string | null }[]>(dueQuery(now, budget)) : [];
    due = list.length;
    const hashes = await latestHashes(list.map((l) => l.id));
    for (const [i, l] of list.entries()) {
      if (i > 0 && s.pause > 0) await sleep(jitteredPause(s.pause, rnd()));
      if (callsThisHour() >= s.ceiling) { paused = true; break; }
      const r = await lookupPn(adapter, l.pn);
      if (r.ok) {
        if (hashTracked(trackedOf(r.record)) !== hashes.get(l.id)) await apply(l.id, r);
        rows.push({ id: l.id, next: nextFor(l.syncTier, true), ok: true, err: null });
      } else if (r.reason === "NOT_FOUND") {
        rows.push({ id: l.id, next: nextFor(l.syncTier, true), ok: true, err: null });
      } else {
        lastErr = r.message;
        rows.push({ id: l.id, next: nextFor(l.syncTier, false), ok: false, err: r.message });
      }
    }
    // With a feed: start its cursor now; the next runs ask only for what changed.
    if (adapter.capabilities.changedSince && !cursor) cursor = now.toISOString();
  }
  await batchChecked(now, rows);

  const st = readStats();
  const avgMs = st.ms.length ? Math.round(st.ms.reduce((a, b) => a + b, 0) / st.ms.length) : 0;
  const maxMs = st.ms.length ? Math.max(...st.ms) : 0;
  const trouble = st.rateLimited > 0 || st.failed > 0 || avgMs > s.slowMs;
  const run: RunStat = {
    at: now.toISOString(), trigger: o.trigger, mode, status: paused ? "paused" : trouble ? "slowed" : "healthy",
    due, checked: rows.length, calls: st.calls, saved: st.saved, avgMs, maxMs, errors: st.failed, ms: Date.now() - t0,
    updated, changes, cap, hourCalls: callsThisHour(), ceiling: s.ceiling,
    ok: st.failed === 0, failed: rows.filter((r) => !r.ok).length, error: lastErr,
  };
  const state = { cursor, cap: paused ? cap : nextCap(cap, s.max, trouble), runs: [run, ...s.state.runs].slice(0, 10) };
  await prisma.setting.upsert({ where: { key: "myloans.state" }, create: { key: "myloans.state", value: state as unknown as Prisma.InputJsonValue }, update: { value: state as unknown as Prisma.InputJsonValue } });
  await prisma.setting.upsert({ where: { key: "myloans.lastRun" }, create: { key: "myloans.lastRun", value: run as unknown as Prisma.InputJsonValue }, update: { value: run as unknown as Prisma.InputJsonValue } });
  if (o.trigger === "run_now" && o.actor) {
    await writeAudit(prisma as unknown as Tx, { actor: o.actor, mode: "MANUAL", action: "myloans_sync_run", entityType: "Setting", entityId: "myloans.lastRun", summary: `${o.actor.label} ran the MyLoans sync: ${run.checked} checked, ${run.changes} with changes, ${run.calls} calls${run.failed ? `, ${run.failed} not answered` : ""}` });
  }
  return { ran: true as const, ...run };
}

export async function runSyncNow(u: CurrentUser) {
  if (!can(u, PERMISSIONS.MYLOANS_SYNC)) throw new UserError("Ask an Admin to turn on \"Run the MyLoans sync now\" for your role.");
  return runMyLoansSync({ trigger: "run_now", force: true, actor: actorOf(u) });
}

const minutes = (label: string, min: number, max: number) => z.coerce.number({ message: `Enter ${label}.` }).int("Whole minutes.").min(min, `At least ${min}.`).max(max, `At most ${max.toLocaleString("en-PH")}.`);
export const syncSettingsSchema = z.object({
  refreshOnOpenMinutes: z.coerce.number({ message: "Enter minutes (0 means always)." }).int("Whole minutes.").min(0, "0 or more.").max(1440, "At most 1,440 (a day)."),
  refreshOnFindHours: z.coerce.number({ message: "Enter hours (0 means never)." }).int("Whole hours.").min(0, "0 or more.").max(720, "At most 720 (30 days).").default(4),
  backgroundMinutes: z.coerce.number({ message: "Enter minutes." }).int("Whole minutes.").min(5, "At least 5 minutes.").max(1440, "At most 1,440 (a day)."),
  businessHoursOnly: z.boolean(),
  maxPerRun: z.coerce.number({ message: "Enter a number." }).int("A whole number.").min(1, "At least 1.").max(500, "At most 500 a run."),
  pauseMs: z.coerce.number({ message: "Enter milliseconds." }).int("Whole milliseconds.").min(0, "0 or more.").max(10_000, "At most 10,000 (10 seconds)."),
  tierA: minutes("minutes", 5, 1440).default(60),
  tierB: minutes("minutes", 15, 2880).default(240),
  tierC: minutes("minutes", 60, 10080).default(1440),
  hourlyCeiling: z.coerce.number({ message: "Enter a number." }).int("A whole number.").min(10, "At least 10.").max(100_000, "At most 100,000.").default(600),
  replacementWindowDays: z.coerce.number({ message: "Enter days." }).int("Whole days.").min(1, "At least 1 day.").max(365, "At most 365 days.").default(30),
});

export async function saveSyncSettings(u: CurrentUser, raw: unknown) {
  if (!can(u, PERMISSIONS.SOURCE_MANAGE)) throw new UserError("Ask an Admin to turn on \"Change MyLoans sync settings\" for your role.");
  const p = syncSettingsSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const d = p.data;
  await prisma.$transaction(async (tx) => {
    const before = {
      refreshOnOpenMinutes: await getSetting("myloans.refreshOnOpenMinutes", tx), refreshOnFindHours: await getSetting("myloans.refreshOnFindHours", tx), backgroundMinutes: await getSetting("myloans.backgroundMinutes", tx),
      businessHoursOnly: await getSetting("myloans.businessHoursOnly", tx), maxPerRun: await getSetting("myloans.maxPerRun", tx), pauseMs: await getSetting("myloans.pauseMs", tx),
      tierMinutes: await getSetting("myloans.tierMinutes", tx), hourlyCeiling: await getSetting("myloans.hourlyCeiling", tx), replacementWindowDays: await getSetting("myloans.replacementWindowDays", tx),
    };
    await setSetting("myloans.refreshOnOpenMinutes", d.refreshOnOpenMinutes, tx);
    await setSetting("myloans.refreshOnFindHours", d.refreshOnFindHours, tx);
    await setSetting("myloans.backgroundMinutes", d.backgroundMinutes, tx);
    await setSetting("myloans.businessHoursOnly", d.businessHoursOnly, tx);
    await setSetting("myloans.maxPerRun", d.maxPerRun, tx);
    await setSetting("myloans.pauseMs", d.pauseMs, tx);
    await setSetting("myloans.tierMinutes", { A: d.tierA, B: d.tierB, C: d.tierC }, tx);
    await setSetting("myloans.hourlyCeiling", d.hourlyCeiling, tx);
    await setSetting("myloans.replacementWindowDays", d.replacementWindowDays, tx);
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "myloans_sync_settings", entityType: "Setting", entityId: "myloans", summary: `${u.name} changed the MyLoans sync settings`, before, after: d });
  });
}

/** For the sync card: mode, health, the last runs, active loans per tier (one grouped query). */
export async function syncStatus() {
  const adapter = getMyLoansAdapter();
  const [state, ceiling, tiers] = await Promise.all([
    getSetting("myloans.state"), getSetting("myloans.hourlyCeiling"),
    prisma.loan.groupBy({ by: ["syncTier"], where: { syncTier: { not: null } }, _count: { _all: true } }),
  ]);
  const last = state.runs[0] ?? null;
  const breaker = adapter.breakerState();
  const hourCalls = callsThisHour();
  const health = hourCalls >= ceiling || last?.status === "paused" ? "Paused: hourly limit reached"
    : breaker.open || last?.status === "slowed" ? "Slowed down: MyLoans is answering slowly" : "Healthy";
  return {
    mode: myLoansMode(), capabilities: adapter.capabilities, breaker, lastRun: last, runs: state.runs, cap: state.cap, cursor: state.cursor,
    hourCalls, ceiling, health, tiers: { A: 0, B: 0, C: 0, ...Object.fromEntries(tiers.map((t) => [t.syncTier!, t._count._all])) } as { A: number; B: number; C: number },
  };
}

// ---------------------------------------------------------------------------
// Simulator (TEST_MODE only, mock MyLoans): "Simulate a MyLoans change"
// ---------------------------------------------------------------------------

export const SIM_SOURCE_KINDS = ["amount", "name", "product", "cancel", "replace", "branch"] as const;
export type SimSourceKind = (typeof SIM_SOURCE_KINDS)[number];

export async function simulateSourceChange(u: CurrentUser, loanId: string, kind: SimSourceKind): Promise<string> {
  refuseInProduction("Simulate a MyLoans change");
  if (!isTestMode() || myLoansMode() !== "mock") throw new UserError("The simulator works only in test mode with the mock MyLoans.");
  if (!can(u, PERMISSIONS.SIMULATOR_USE)) throw new UserError("Your role does not allow the simulator.");
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new UserError("Loan File not found.");
  const lookup = await getMyLoansAdapter().getByPn(loan.pn);
  if (!lookup.ok) throw new UserError(lookup.message);
  const rec = lookup.record;
  const overrides = { ...(await getSetting("myloans.mockOverrides")) };
  const at = new Date().toISOString();
  const over = { ...(overrides[loan.pn] ?? {}), changedAt: at };
  let message: string;
  if (kind === "amount") {
    // Across the Rule 4 threshold, so the transactions would change.
    const limit = MORTGAGE_THRESHOLDS[(rec.loanType === "Renewal" ? "Renewal" : "New")];
    const nowAmount = Number(rec.totalReleasedAmount) || 0;
    over.totalReleasedAmount = nowAmount > limit ? limit - 50_000 : limit + 20_000;
    message = `MyLoans now says the amount is ₱${Number(over.totalReleasedAmount).toLocaleString("en-PH")}.`;
  } else if (kind === "name") {
    over.borrowerName = /Jr\.$/.test(rec.borrowerName) ? rec.borrowerName.replace(/ Jr\.$/, "") : `${rec.borrowerName} Jr.`;
    over.address = `${Math.floor(Math.random() * 900) + 100} Rizal Ave, ${rec.branchName ?? "Antipolo"}`;
    message = "MyLoans now spells the borrower's name differently and has a new address.";
  } else if (kind === "product") {
    over.productName = /refinancing/i.test(rec.productName ?? "") ? "Auto Financing" : "Auto Refinancing";
    message = `MyLoans now says the product is ${over.productName}.`;
  } else if (kind === "cancel") {
    over.status = "CANCELLED";
    message = "MyLoans now says the loan is cancelled.";
  } else if (kind === "branch") {
    // Moved to another active branch of the same area (or any other active one).
    const cur = await prisma.branch.findUniqueOrThrow({ where: { id: loan.branchId } });
    const to = await prisma.branch.findFirst({ where: { active: true, hidden: false, code: { not: null }, id: { not: cur.id }, ...(cur.areaId ? { areaId: cur.areaId } : {}) }, orderBy: { code: "asc" } })
      ?? await prisma.branch.findFirst({ where: { active: true, hidden: false, code: { not: null }, id: { not: cur.id } }, orderBy: { code: "asc" } });
    if (!to) throw new UserError("There is no other active branch to move it to.");
    over.branchName = to.name;
    over.branchCode = to.code;
    message = `MyLoans now says the loan is at ${to.name}.`;
  } else {
    const extra = [...(await getSetting("myloans.mockExtra"))];
    let n = 9100;
    const taken = new Set([...extra.map((r) => r.pn), ...(await prisma.loan.findMany({ select: { pn: true } })).map((l) => l.pn)]);
    // The same branch code and year as the old PN, the first free running number from 09100.
    const fmt = await getPnFormat();
    const old = parsePn(loan.pn, fmt);
    const code = old.ok && old.parts ? old.parts.branchCode : rec.branchCode ?? "101";
    const year = old.ok && old.parts ? old.parts.year : "2026";
    while (taken.has(buildPn(code, year, n, fmt))) n++;
    const newPn = buildPn(code, year, n, fmt);
    extra.push({ ...rec, pn: newPn, sourceLoanId: `ML-SIM-${n}`, releaseDate: businessDate(new Date()), status: "RELEASED", previousPn: loan.pn });
    await setSetting("myloans.mockExtra", extra);
    over.status = "REPLACED";
    message = `MyLoans now has ${newPn} replacing ${loan.pn}. Open ${newPn} from Find loan to link them.`;
  }
  overrides[loan.pn] = over;
  await setSetting("myloans.mockOverrides", overrides);
  await refreshLoan(loan.id, { actor: { id: u.id, label: `${u.name} (Simulated)` }, mode: "SIMULATED", trigger: "simulator" });
  return message;
}

/** For Find loan and the TAT report: loans with an open review item. */
export async function openReviewLoanIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.sourceChange.findMany({ where: { loanId: { in: ids }, state: "OPEN" }, select: { loanId: true } });
  return new Set(rows.map((r) => r.loanId));
}

