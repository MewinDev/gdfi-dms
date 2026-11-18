import { statusFromId } from "@/lib/myloans/status";
import { refuseInProduction } from "@/lib/env";
import { closeItem } from "./work-items";
import { refreshLiquidationForTransaction } from "./liquidation";
import "server-only";
import { buildPn, getPnFormat, parsePn } from "@/lib/pn";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { andWhere, holdsWhere } from "@/lib/auth/holders";
import { worksAtWhere } from "@/lib/branches/access";
import { getMyLoansAdapter, myLoansMode, type MyLoansRecord } from "@/lib/myloans";
import { mapLoan } from "@/lib/myloans/live-mapping";
import { sourceTime } from "@/lib/myloans/account";
import {
  detectChanges, hashTracked, trackedOf, trackedOfSaved, trackedOfSent, UNSENT,
  type ChangeCategory, type Proposed, type Tracked, type TxnNow,
} from "@/lib/myloans/changes";
import { isTestMode } from "@/lib/test-mode";
import { getSetting, setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { advanceBalance, peso } from "@/lib/funds/rules";
import { MORTGAGE_THRESHOLDS } from "@/lib/rules";
import { recomputeStage } from "./stage";
import { callsThisHour, lookupPn } from "@/lib/myloans/client";
import type { MyLoansLookup } from "@/lib/myloans/types";
import { RELATED_SELECT, relatedLoans } from "./related-loans";
import { paymentEvidence } from "@/lib/myloans/relation";
export { cashBlockReason, sendBlockReason, CANCELLED_REASON, CHANGED_REASON } from "./source-blocks";
import { UserError, NotInScopeError } from "./errors";
import { createTransactionOfType } from "./loan-file";
import { raiseOpenItems } from "./open-items";
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
export type Trigger = "open" | "button" | "background" | "simulator" | "find" | "sync";
export type RefreshResult =
  /** review: Open Items raised (or superseded); minor: only renames applied or items reverted (piece 8). */
  | { ok: true; outcome: "none" | "minor" | "review"; category: ChangeCategory; checkedAt: Date; raised?: number; reverted?: number; lookup?: number }
  /** limited: no call was made (hourly limit, breaker, or the shared count could not be written); the loan is left as it is. */
  | { ok: false; message: string; checkedAt: Date; limited?: boolean };

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

export async function txnsNow(db: Tx | typeof prisma, loanId: string): Promise<TxnNow[]> {
  const rows = await db.loanTransaction.findMany({
    where: { loanId }, include: { type: true, dpAssignments: { include: { dpUser: { select: { name: true } } }, orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "asc" },
  });
  return rows.map((t) => ({ id: t.id, code: t.type.code, name: t.type.name, status: t.status, stateLine: `${t.type.name}: ${stateLine(t)}` }));
}

/**
 * People who review MyLoans changes for a loan's branch: "Review MyLoans changes", and the branch in their
 * access (D-011: approvers handle their assigned branches; All branches covers every branch).
 */
export async function reviewerIds(db: Tx | typeof prisma, branchId: string): Promise<string[]> {
  const rows = await db.user.findMany({
    where: andWhere(holdsWhere(PERMISSIONS.SOURCE_REVIEW), worksAtWhere(branchId)), select: { id: true },
  });
  return rows.map((r) => r.id);
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

/**
 * Asks myloans for one loan and records what changed (piece 8, D-053). Renames (area, division, company, branch and
 * product names) are lookup data: applied by themselves and logged in Reference data changes. A change to a loan or
 * borrower field raises an Open Item, one per field, decided by an approver of the branch; nothing else changes.
 */
export async function refreshLoan(loanId: string, opts: { actor: Actor; mode: Mode; trigger: Trigger; now?: Date; lookup?: MyLoansLookup; ceiling?: number; syncRunId?: string | null }): Promise<RefreshResult> {
  const now = opts.now ?? new Date();
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) throw new UserError("Loan File not found.");
  // The background run passes what it already got; otherwise one shared call (coalesced; the button asks fresh).
  let lookup = opts.lookup ?? await lookupPn(getMyLoansAdapter(), loan.pn, { fresh: opts.trigger === "button" || opts.trigger === "simulator", ceiling: opts.ceiling });
  // A redo names the copy that replaced it (the status Open Item says "replaced by").
  const replacedByPn = !lookup.ok && lookup.reason === "NOT_SELECTABLE" ? lookup.replacedByPnNo ?? null : null;
  // D-050: API 1 says this copy is no longer a released loan (cancelled, redone, not released, inactive). That is a
  // status change on the copy we hold: the last copy with the status myloans gives, in its words, for the usual review.
  if (!lookup.ok && lookup.reason === "NOT_SELECTABLE") {
    const prev = await prisma.loanSourceSnapshot.findFirst({ where: { loanId: loan.id }, orderBy: { retrievedAt: "desc" } });
    const base = prev ? recordFromPayload(prev.payload) : null;
    if (base) {
      // Cancelled keeps the DMS word (the review says "MyLoans now says the loan is cancelled.").
      const st = lookup.feedState === "Cancelled" ? { status: "CANCELLED", statusId: String(lookup.statusId ?? 14), statusName: statusFromId(lookup.statusId ?? 14).statusName }
        : { status: `STATUS_${(lookup.feedState ?? "NOT_SELECTABLE").toUpperCase()}`, statusId: lookup.statusId === undefined ? base.statusId ?? null : String(lookup.statusId), statusName: lookup.message.replace(/\.$/, "") };
      lookup = { ok: true, record: { ...base, ...st, feedState: lookup.feedState ?? null, notSent: base.notSent }, raw: { status: 422, feedState: lookup.feedState, replacedByPnNo: lookup.replacedByPnNo ?? null, statusId: lookup.statusId ?? null }, adapter: getMyLoansAdapter().name, retrievedAt: now };
    }
  }
  // No call was made (the shared count said no): nothing about the loan changes.
  if (!lookup.ok && lookup.limited) return { ok: false, message: lookup.message, checkedAt: now, limited: true };
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

  const current = trackedOfSent(lookup.record);
  const hash = hashTracked(current);
  let result: RefreshResult = { ok: true, outcome: "none", category: "NONE", checkedAt: now };
  await withLoanLock(loan.id, async (tx) => {
    const prev = await tx.loanSourceSnapshot.findFirst({ where: { loanId: loan.id }, orderBy: { retrievedAt: "desc" } });
    const prevRecord = prev ? recordFromPayload(prev.payload) : null;
    const previous: Tracked | null = (prev?.tracked as Tracked | null) ?? (prevRecord ? trackedOfSaved(prevRecord) : null);
    const det = detectChanges(previous, current);
    await tx.loan.update({ where: { id: loan.id }, data: { lastCheckedAt: now, retrievedAt: lookup.retrievedAt, sourceCurrent: true, lastRefreshError: null, ...(lookup.record.sourceUpdatedAt ? { sourceUpdatedAt: sourceTime(lookup.record.sourceUpdatedAt) } : {}) } });
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
    const r = await raiseOpenItems(tx, {
      loan, previous, current, changes: det.changes, now, mode, replacedByPn, syncRunId: opts.syncRunId ?? null,
      sourceUpdatedAt: lookup.record.sourceUpdatedAt ? sourceTime(lookup.record.sourceUpdatedAt) : null, source: opts.trigger === "sync" ? "myloans API 2" : "myloans API 1",
    });
    result = { ok: true, outcome: r.raised || r.superseded ? "review" : r.lookup || r.reverted ? "minor" : "none", category: det.category, checkedAt: now, raised: r.raised, reverted: r.reverted, lookup: r.lookup };
  });
  return result;
}

// ---------------------------------------------------------------------------
// While a review item is open: what is blocked (never because of an outage)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Admin decisions (source:review)
// ---------------------------------------------------------------------------

function needReview(u: CurrentUser) {
  if (!can(u, PERMISSIONS.SOURCE_REVIEW)) throw new UserError("Only approvers review MyLoans changes. Your view is read-only. Ask a Superadmin for the approver tick if you should decide these.");
}
/** Every review decision: a note of 5 to 500 characters (the same rule as the borrower details review). */
export const REVIEW_NOTE_MIN = 5;
const noteSchema = z.string().trim().min(REVIEW_NOTE_MIN, "Write a short note (at least 5 characters).").max(500, "Keep the note under 500 characters.");
function noteOf(raw: unknown) {
  const p = noteSchema.safeParse(raw ?? "");
  if (!p.success) throw new UserError(p.error.issues[0].message, "note");
  return p.data;
}
const actorOf = (u: CurrentUser): Actor => ({ id: u.id, label: u.name });
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/**
 * The transactions a re-run of the rules adds or removes (Apply of a MyLoans change, and Reclassify, D-031).
 * Only unsent transactions change; the callers refuse first when sent work would.
 */
export async function applyTransactionChanges(tx: Tx, loanId: string, p: Pick<Proposed, "added" | "removed">, now: Date = new Date()) {
  const txns = await tx.loanTransaction.findMany({ where: { loanId }, include: { type: true } });
  for (const code of p.removed) {
    const t = txns.find((x) => x.type.code === code && x.status !== "CANCELLED");
    if (t && UNSENT.includes(t.status)) {
      await tx.loanTransaction.update({ where: { id: t.id }, data: { status: "CANCELLED", statusSince: now, cancelledAt: now } });
      await refreshLiquidationForTransaction(tx, t.id, now);
      await closeItem(tx, "TRANSACTION", t.id, "CANCELLED", { at: now });
    }
  }
  for (const code of p.added) {
    const back = txns.find((x) => x.type.code === code && x.status === "CANCELLED");
    if (back) {
      // Added back: the same checklist rows, so ticked papers stay ticked.
      const done = await tx.checklistCheck.count({ where: { transactionId: back.id, required: true, checked: false } });
      await tx.loanTransaction.update({ where: { id: back.id }, data: { status: done === 0 ? "READY" : "FOR_CHECKLIST", statusSince: now } });
    } else {
      const type = await tx.transactionType.findFirstOrThrow({ where: { code }, include: { rules: { where: { active: true }, include: { documentType: true }, orderBy: { sortOrder: "asc" } } } });
      await createTransactionOfType(tx, { loanId, type, origin: "AUTOMATIC" });
    }
  }
}

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

/**
 * A loan that left Released in myloans, its status Open Item approved (piece 8, D-053): the loan is closed with the
 * reason. Unsent work is cancelled, processor jobs are stopped. The caller refused it while cash is out. Nothing is
 * deleted.
 */
export async function closeLoanEnded(tx: Tx, actor: Actor, loan: { id: string; pn: string; branchId: string }, reason: string, note: string, now: Date = new Date()) {
  {
    const jobs = await tx.dpAssignment.findMany({ where: { loanId: loan.id, status: { in: [...OPEN_JOB] } }, include: { transaction: { include: { type: true } } } });
    for (const j of jobs) await tx.dpAssignment.update({ where: { id: j.id }, data: { status: "PULLED_BACK", closedAt: now } });
    const open = await tx.loanTransaction.findMany({ where: { loanId: loan.id, status: { notIn: ["COMPLETED", "CANCELLED"] } }, include: { type: true } });
    for (const t of open) {
      await tx.loanTransaction.update({ where: { id: t.id }, data: { status: "CANCELLED", statusSince: now, cancelledAt: now } });
      await refreshLiquidationForTransaction(tx, t.id, now); // cancelled before its LTO (D-044 item 2)
      for (const k of ["TRANSACTION", "DP_JOB"] as const) await closeItem(tx, k, t.id, "CANCELLED", { at: now, by: actor });
    }
    await tx.loan.update({ where: { id: loan.id }, data: { cancelledAt: now, cancelReason: reason } });
    await writeAudit(tx, {
      actor, mode: "MANUAL", action: "loan_closed_ended", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn: loan.pn,
      summary: `${actor.label} closed the loan as "${reason}": ${note}${open.length ? `. Closed: ${listWords(open.map((t) => t.type.name))}` : ""}${jobs.length ? `. Processor jobs stopped: ${listWords(jobs.map((j) => j.transaction.type.name))}` : ""}`,
    });
    for (const j of jobs) {
      await notify(tx, {
        userIds: [j.dpUserId, ...(j.secondaryDpUserId ? [j.secondaryDpUserId] : [])], loanId: loan.id, title: `${loan.pn}: ${j.transaction.type.name} stopped`,
        body: `${reason}. Stop work on it and keep the papers safe; the Loan Associate will collect them.`, link: "/jobs",
        email: { event: "job_changed", transactionId: j.transactionId, vars: { pn: loan.pn, transaction: j.transaction.type.name, who: actor.label, reason: `${reason}. Stop work on it.` } },
      });
    }
    await recomputeStage(tx, loan.id);
    await notify(tx, { userIds: await branchLaUserIds(tx, loan.branchId), loanId: loan.id, title: `${loan.pn}: closed`, body: `${reason}. ${note}`, link: `/loans/${loan.pn}` });
  }
}

/** Return the cash: asks the processor for a normal cash return that Finance confirms. Nothing moves by itself. A note is required, like every review decision. */
export async function askCashBack(u: CurrentUser, loanId: string, rawNote?: unknown) {
  needReview(u);
  const note = noteOf(rawNote);
  return withLoanLock(loanId, async (tx) => {
    const loan = await tx.loan.findUnique({ where: { id: loanId }, select: { id: true, pn: true, branchId: true } });
    if (!loan || !inScope(u, loan.branchId)) throw new NotInScopeError();
    const item = { loanId: loan.id, loan };
    const cash = await outstandingCash(tx, item.loanId);
    if (!cash.length) throw new UserError("No cash is out on this loan.");
    for (const c of cash) {
      await notify(tx, {
        userIds: [c.dp.id, ...(await financeIds(tx, c, c.notReleased ? "approve" : "settle"))], loanId: item.loanId, title: `${c.number}: return the cash for ${item.loan.pn}`,
        body: `${item.loan.pn} is no longer released in myloans. ${c.notReleased ? "This request is not released yet: Finance, deny it." : `Return the balance for ${c.txnName} (My funds > Return cash); Finance confirms it.`}`,
        link: c.notReleased ? "/funds?tab=approve" : "/my-funds?tab=liquidation",
        email: { event: "cash_returned", amountCents: c.cents, vars: { number: c.number, who: u.name, status: "cash back asked", reason: `${item.loan.pn} is no longer released in myloans. Return {amount}`.replace("{amount}", "the balance") } },
      });
    }
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "source_cash_back_asked", entityType: "Loan", entityId: loan.id, loanId: item.loanId, pn: item.loan.pn, summary: `${u.name} asked for the cash back on ${listWords(cash.map((c) => c.number))} before closing. Note: ${note}`, details: { note, advances: cash.map((c) => ({ number: c.number, released: !c.notReleased })) } });
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
/** MyLoans itself says the new PN replaces the old one (the new loan's latest copy names it). */
async function namedByMyLoans(db: Tx | typeof prisma, oldPn: string, newPn: string) {
  const snap = await db.loanSourceSnapshot.findFirst({ where: { loan: { pn: newPn } }, orderBy: { retrievedAt: "desc" }, select: { tracked: true, payload: true } });
  const t = (snap?.tracked as Tracked | null) ?? (snap ? trackedOf(recordFromPayload(snap.payload) ?? ({} as MyLoansRecord)) : null);
  return (t?.previousPn ?? null) === oldPn;
}

async function linkCore(tx: Tx, u: CurrentUser, oldPn: string, newPn: string, raw: LinkInput, manual: boolean) {
  const note = noteOf(raw.note);
  const [old, nw] = await Promise.all([tx.loan.findUnique({ where: { pn: oldPn }, select: RELATED_SELECT }), tx.loan.findUnique({ where: { pn: newPn }, select: RELATED_SELECT })]);
  if (!old || !nw || !inScope(u, old.branchId) || !inScope(u, nw.branchId)) throw new UserError("Pick one of the loans of the same borrower (same CIN or CIF).", "newPn");
  const found = (await relatedLoans(tx, old)).find((r) => r.loan.pn === nw.pn);
  // MyLoans named the old PN on the new one: a suggestion a person may confirm even without the same CIF.
  const named = !found && !manual && await namedByMyLoans(tx, old.pn, nw.pn);
  if (!found && !named) throw new UserError("Pick one of the loans of the same borrower (same CIN or CIF).", "newPn");
  const rel = found ?? { tag: "SAME_BORROWER" as const, relation: null, paymentRecorded: (await tx.loanSourceSnapshot.findFirst({ where: { loanId: old.id }, orderBy: { retrievedAt: "desc" }, select: { payload: true } }).then((s) => (s ? recordFromPayload(s.payload)?.paymentRecorded : undefined))) };
  if (old.replacedByPn && old.replacedByPn !== nw.pn) throw new UserError(`${old.pn} is already replaced by ${old.replacedByPn}.`, "newPn");
  if (nw.replacesPn && nw.replacesPn !== old.pn) throw new UserError(`${nw.pn} already replaces ${nw.replacesPn}.`, "newPn");
  // D-051: no guessed tags; a review item offers the PN myloans named, and Related loans links by hand.
  if (!manual && rel.tag !== "SAME_BORROWER") throw new UserError("This is not a replacement. Link it from Related loans only if you are sure.", "newPn");
  const pay = paymentEvidence(rel.paymentRecorded);
  const override = String(raw.overrideNote ?? "").trim();
  const confirmed = raw.confirmNoPayment === true || raw.confirmNoPayment === "on";
  if (pay.known && pay.recorded && override.length < REVIEW_NOTE_MIN) throw new UserError(`Payment recorded in MyLoans on ${old.pn}. A replacement needs no payment on the old PN: write an override note to link anyway.`, "overrideNote");
  if (!pay.known && !confirmed) throw new UserError("Tick \"I confirmed no payment was made on the old PN\".", "confirmNoPayment");
  const evidence = pay.known
    ? (pay.recorded ? `Payment recorded in MyLoans; linked by ${u.name} with an override: ${override}` : `No payment recorded in MyLoans (checked by ${u.name})`)
    : `${u.name} confirmed no payment was made on ${old.pn}`;
  await tx.loan.update({ where: { id: old.id }, data: { replacedByPn: nw.pn } });
  await tx.loan.update({ where: { id: nw.id }, data: { replacesPn: old.pn, replacementEvidence: `${evidence}. Note: ${note}` } });
  const text = `Admin ${u.name} linked ${nw.pn} as the replacement of ${old.pn}${manual ? " (from Related loans)" : ""}. ${evidence}. Note: ${note}`;
  const details = { manual, matched: rel.relation?.matched ?? [], payment: pay.known ? (pay.recorded ? "recorded" : "none") : "no payments field", confirmedNoPayment: confirmed, overrideNote: override || null, note };
  for (const l of [old, nw]) {
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "replacement_linked", entityType: "Loan", entityId: l.id, loanId: l.id, pn: l.pn, summary: text, details });
  }
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
export async function moveCashToNewPn(u: CurrentUser, loanId: string, lineId: string) {
  needReview(u);
  return withLoanLock(loanId, async (tx) => {
    const old = await tx.loan.findUnique({ where: { id: loanId } });
    if (!old || !inScope(u, old.branchId)) throw new NotInScopeError();
    if (!old.replacedByPn) throw new UserError("Link the replacement PN first.");
    const nw = await tx.loan.findUnique({ where: { pn: old.replacedByPn }, include: { transactions: { include: { type: true } } } });
    if (!nw) throw new UserError(`${old.replacedByPn} is not opened yet. Ask the LA to open it first.`);
    if (!inScope(u, nw.branchId)) throw new NotInScopeError(); // the new loan may have moved branch since the link
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
      await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "cash_move_requested", entityType: "CashAdvance", entityId: adv.id, loanId: l.id, pn: l.pn, summary: `${u.name} asked to move the cash on ${cash.number} (${old.pn}) to ${nw.pn} as ${number}; it waits for approval` });
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
export async function reusablePapers(db: Tx | typeof prisma, newLoanId: string, user?: CurrentUser): Promise<ReusableOption[]> {
  const nw = await db.loan.findUnique({ where: { id: newLoanId }, select: RELATED_SELECT });
  if (!nw) return [];
  // Never copy back onto the old loan; and only loans in the person's branches (D-019).
  const related = (await relatedLoans(db, nw)).filter((r) => r.tag !== "REPLACES" && (!user || inScope(user, r.loan.branchId)));
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
    const options = await reusablePapers(tx, newLoanId, u);
    const picked = options.filter((o) => fromCheckIds.includes(o.fromCheckId));
    if (picked.length !== new Set(fromCheckIds).size) {
      // A paper of a loan outside the person's branches is not offered: "not found" (D-019), without saying
      // what it is. A paper of an in-scope loan that is not reusable gets the plain reason.
      const rest = fromCheckIds.filter((id) => !picked.some((o) => o.fromCheckId === id));
      const loans = await tx.checklistCheck.findMany({ where: { id: { in: rest } }, select: { transaction: { select: { loan: { select: { branchId: true } } } } } });
      if (loans.length !== new Set(rest).size || loans.some((c) => !inScope(u, c.transaction.loan.branchId))) throw new NotInScopeError();
      throw new UserError("Only ticked papers that belong to the borrower can be copied.");
    }
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

/**
 * Refresh a loan being opened when its copy is older than the setting (0 = always). Never throws.
 * Automatic, so it obeys the shared hourly limit (MyLoansCallHour) and fails closed while the circuit
 * breaker is open, like the stale refresh in Find a loan: no call, the loan file opens from the DMS copy,
 * the "last checked" line stays as it was, no error is shown, and the server logs one line. The Refresh
 * button (refreshFromMyLoans) is a person asking: counted, never limited.
 */
export async function refreshOnOpen(loan: { id: string; lastCheckedAt: Date | null; retrievedAt: Date; cancelledAt?: Date | null; closedAt?: Date | null; archivedAt?: Date | null }, now: Date = new Date()): Promise<RefreshResult | null> {
  // Paused by Admin, or a closed or cancelled loan: no call.
  if (await getSetting("myloans.paused")) return null;
  if (loan.cancelledAt || loan.closedAt || loan.archivedAt) return null;
  const minutes = await getSetting("myloans.refreshOnOpenMinutes");
  const last = loan.lastCheckedAt ?? loan.retrievedAt;
  if (minutes > 0 && now.getTime() - last.getTime() < minutes * 60_000) return null;
  try {
    const ceiling = await getSetting("myloans.hourlyCeiling");
    // The breaker store fails safe: if it cannot be read, it counts as open.
    if ((await getMyLoansAdapter().breakerState()).open) return skippedOnOpen(loan.id, "the circuit breaker is open");
    if ((await callsThisHour()) >= ceiling) return skippedOnOpen(loan.id, "the hourly limit is reached");
    // The ceiling is reserved again atomically in the call itself: two instances cannot both slip past it.
    const r = await refreshLoan(loan.id, { actor: SYSTEM_ACTOR, mode: "AUTOMATIC", trigger: "open", now, ceiling });
    return !r.ok && r.limited ? skippedOnOpen(loan.id, "the hourly limit is reached") : r;
  } catch {
    return null;
  }
}

/** Refresh on open stopped before any call: one server log line; the loan file opens as it is. */
function skippedOnOpen(loanId: string, why: string): null {
  console.warn(`[myloans] refresh on open skipped for loan ${loanId}: ${why}; opened from the DMS copy.`);
  return null;
}

/** Admin: "Pause MyLoans calls" on or off (myloans:manage). Audited. */
export async function setMyLoansPaused(u: CurrentUser, on: boolean) {
  if (!can(u, PERMISSIONS.SOURCE_MANAGE)) throw new UserError("Ask a Superadmin to turn on \"Change MyLoans sync settings\" for your role.");
  await prisma.$transaction(async (tx) => {
    const was = await getSetting("myloans.paused", tx);
    if (was === on) return;
    await setSetting("myloans.paused", on, tx);
    await writeAudit(tx, {
      actor: actorOf(u), mode: "MANUAL", action: "myloans_paused", entityType: "Setting", entityId: "myloans.paused",
      summary: on ? `${u.name} paused MyLoans calls: the sync, the stale refresh and refresh on open make no call` : `${u.name} turned MyLoans calls back on`,
      before: { paused: was }, after: { paused: on },
    });
  });
}

// ---------------------------------------------------------------------------
// Simulator (TEST_MODE only, mock MyLoans): "Simulate a MyLoans change"
// ---------------------------------------------------------------------------

export const SIM_SOURCE_KINDS = ["amount", "name", "cif", "area", "product", "cancel", "notreleased", "released", "replace", "branch"] as const;
export type SimSourceKind = (typeof SIM_SOURCE_KINDS)[number];

export async function simulateSourceChange(u: CurrentUser, loanId: string, kind: SimSourceKind): Promise<string> {
  refuseInProduction("Simulate a MyLoans change");
  if (!isTestMode() || myLoansMode() !== "mock") throw new UserError("The simulator works only in test mode with the mock MyLoans.");
  if (!can(u, PERMISSIONS.SIMULATOR_USE)) throw new UserError("Your role does not allow the simulator.");
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan || !inScope(u, loan.branchId)) throw new NotInScopeError();
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
    // D-051: no address or contact number in the DMS; only the name changes.
    message = "MyLoans now spells the borrower's name differently (Borrower details: a supervisor reviews it).";
  } else if (kind === "cif") {
    over.cif = `CIF-${String(Math.floor(Math.random() * 900_000) + 100_000)}`;
    message = "MyLoans now has another CIF for the borrower (Borrower details: a supervisor reviews it).";
  } else if (kind === "area") {
    over.areaName = /corrected/i.test(rec.areaName ?? "") ? (rec.areaName ?? "").replace(/ \(corrected\)$/, "") : `${rec.areaName ?? "Area"} (corrected)`;
    message = "MyLoans corrected the area name (minor: the copy updates, no review).";
  } else if (kind === "product") {
    over.productName = /refinancing/i.test(rec.productName ?? "") ? "Auto Financing" : "Auto Refinancing";
    message = `MyLoans now says the product is ${over.productName}.`;
  } else if (kind === "cancel") {
    over.status = "CANCELLED";
    message = "MyLoans now says the loan is cancelled.";
  } else if (kind === "notreleased") {
    over.status = "NOT_RELEASED";
    message = "MyLoans now says the loan is not released.";
  } else if (kind === "released") {
    over.status = "RELEASED";
    message = "MyLoans now says the loan is released again.";
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

