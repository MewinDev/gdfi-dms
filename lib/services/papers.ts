import "server-only";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { businessDate } from "@/lib/time";
import { REMARKS_MAX, REMARKS_MIN, isIncluded } from "@/lib/workflow/checklist";
import { recomputeStage } from "./stage";
import { assertNotHeld } from "./locks";
import { NotInScopeError, UserError } from "./errors";

/**
 * Missing papers with reasons (confirmed rule). A missing paper no longer blocks the file: the LA marks
 * it Missing and saves a reason and remarks for THAT paper; the file can go on once every missing paper
 * has its remarks (lib/workflow/checklist.ts is the gate). Optional papers count only when "Include in
 * this file" is ticked. A file with missing papers goes through the vault gate as "Complete with
 * exceptions" until each one is Received. Nothing here pauses a clock, raises an alert or sends an email.
 *
 * History: every marking, remarks save or edit (old and new text), un-marking and Received is one
 * PaperEvent row (append-only) and one audit row (the Journey). Once the transaction was sent, a missing
 * paper can no longer be un-marked or have its remarks removed: it ends only when it is Received.
 */

const actorOf = (u: CurrentUser): Actor => ({ id: u.id, label: u.name });
function requireAllowed(user: CurrentUser, p: Permission, words: string) {
  if (!can(user, p)) throw new UserError(`Your role does not allow ${words}.`);
}

/** In the LA's hands: the papers can be answered (Present, Missing, Include). */
const PRE_SEND = ["FOR_CHECKLIST", "READY", "RETURNED"];

const labelOf = (c: { otherLabel: string | null; rule: { label: string } | null }) => c.rule?.label ?? c.otherLabel ?? "Other paper";

/** Was this transaction ever sent to a processor? Then a missing paper can only end by being Received. */
async function everSent(tx: Tx, transactionId: string) {
  return (await tx.dpAssignment.count({ where: { transactionId } })) > 0;
}

async function loadCheck(user: CurrentUser, checkId: string) {
  const c = await prisma.checklistCheck.findUnique({ where: { id: checkId }, include: { transaction: { include: { loan: true, type: true } } } });
  if (!c || !inScope(user, c.transaction.loan.branchId)) throw new NotInScopeError();
  return c;
}

async function lockedCheck(tx: Tx, checkId: string) {
  return tx.checklistCheck.findUniqueOrThrow({ where: { id: checkId }, include: { rule: true, documentItem: true, missingReason: true, transaction: { include: { loan: { include: { branch: true } }, type: true } } } });
}
type LockedCheck = Awaited<ReturnType<typeof lockedCheck>>;

/** For checklist ↔ Ready follows the gate after every change of a paper (as when the ticks are saved). */
export async function syncReady(tx: Tx, transactionId: string, now: Date = new Date()) {
  const { evaluateChecklist } = await import("./workflow");
  const txn = await tx.loanTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { checks: { include: { rule: true } } } });
  const result = evaluateChecklist(txn.checks);
  let status = txn.status;
  if (txn.status === "FOR_CHECKLIST" && result.complete) status = "READY";
  if (txn.status === "READY" && !result.complete) status = "FOR_CHECKLIST";
  await tx.loanTransaction.update({ where: { id: txn.id }, data: { checklistSavedAt: now, ...(status !== txn.status ? { status, statusSince: now } : {}) } });
  return result;
}

/** The paper is no longer in hand: its Document ID is kept (never reused); the item is expected again. */
async function notInHand(tx: Tx, c: LockedCheck, by: CurrentUser, remarks: string, now: Date) {
  const doc = c.documentItem;
  if (!doc || doc.stage === "EXPECTED") return;
  await tx.documentItem.update({ where: { id: doc.id }, data: { stage: "EXPECTED", custodianLabel: "Not yet received", custodianRole: null, custodianUserId: null, location: "", since: now } });
  await tx.documentMovement.create({ data: { documentItemId: doc.id, action: "MARKED_NOT_PRESENT", fromCustodian: doc.custodianLabel, toCustodian: null, remarks, actorId: by.id, actorLabel: by.name } });
}

/** The paper is in the LA's hands now (ticked, or received late): it gets its Document ID. */
async function inHand(tx: Tx, c: LockedCheck, by: CurrentUser, purpose: string, now: Date) {
  const { nextDocumentId } = await import("./workflow");
  const doc = c.documentItem;
  if (!doc) return null;
  const custodian = `${by.name} (LA, ${c.transaction.loan.branch.name})`;
  const location = `${c.transaction.loan.branch.name} branch`;
  const documentId = doc.documentId ?? (await nextDocumentId(tx, c.transaction.loan.pn, doc.docTypeCode));
  await tx.documentItem.update({ where: { id: doc.id }, data: { documentId, stage: "AT_BRANCH", custodianLabel: custodian, custodianRole: "LA", custodianUserId: by.id, location, since: now } });
  await tx.documentMovement.create({ data: { documentItemId: doc.id, action: "RECEIVED_AT_BRANCH", toCustodian: custodian, purpose, actorId: by.id, actorLabel: by.name, location, acknowledgedAt: now, acknowledgedById: by.id } });
  return doc.documentId ? null : documentId;
}

const audit = (tx: Tx, user: CurrentUser, c: LockedCheck, action: string, summary: string, extra: { before?: unknown; after?: unknown; details?: unknown } = {}) =>
  writeAudit(tx, {
    actor: actorOf(user), mode: "MANUAL", action, entityType: "LoanTransaction", entityId: c.transactionId, loanId: c.transaction.loanId, pn: c.transaction.loan.pn,
    summary, details: { checkId: c.id, paper: labelOf(c), ...((extra.details as object) ?? {}) }, ...(extra.before ? { before: extra.before } : {}), ...(extra.after ? { after: extra.after } : {}),
  });

// ---------------------------------------------------------------------------
// Mark Missing / not missing (Check papers, LA)
// ---------------------------------------------------------------------------

/**
 * Marks a paper Missing (it opens the reason and remarks box under the row; Send stays blocked until
 * they are saved). Only while the transaction is in the LA's hands. An optional paper is included in the
 * file by this. A paper ticked Present is unticked (its Document ID is kept).
 */
export async function markPaperMissing(user: CurrentUser, input: { checkId: string }, now: Date = new Date()) {
  requireAllowed(user, PERMISSIONS.PAPERS_MARK_MISSING, "marking a paper Missing");
  const c0 = await loadCheck(user, input.checkId);
  return withLoanLock(c0.transaction.loanId, async (tx) => {
    await assertNotHeld(tx, c0.transactionId);
    const c = await lockedCheck(tx, c0.id);
    if (!PRE_SEND.includes(c.transaction.status)) throw new UserError(`${c.transaction.type.name} is no longer with you: a paper can be marked Missing only before it is sent.`);
    if (c.rule && !c.rule.active && !c.checked) throw new UserError("This paper is no longer on the checklist.");
    if (c.missingState === "MISSING") return { state: "MISSING" as const };
    if (c.missingState === "RECEIVED_LATE") throw new UserError(`${labelOf(c)} was already received late. It stays received.`);
    await tx.checklistCheck.update({
      where: { id: c.id },
      data: {
        checked: false, checkedAt: null, checkedById: null, includedInFile: c.required ? c.includedInFile : true,
        missingState: "MISSING", missingAt: now, missingById: user.id, missingByLabel: user.name,
        missingReasonId: null, missingRemarks: null, remarksAt: null,
      },
    });
    if (c.checked) await notInHand(tx, c, user, "Marked Missing on the checklist", now);
    await tx.paperEvent.create({ data: { checkId: c.id, loanId: c.transaction.loanId, kind: "MARKED_MISSING", byId: user.id, byLabel: user.name, at: now } });
    await audit(tx, user, c, "paper_marked_missing", `${labelOf(c)} marked Missing on ${c.transaction.type.name}`, { before: { state: c.checked ? "PRESENT" : "NOT_ANSWERED" }, after: { state: "MISSING" } });
    await syncReady(tx, c.transactionId, now);
    await recomputeStage(tx, c.transaction.loanId);
    return { state: "MISSING" as const };
  });
}

/**
 * Takes a Missing mark back (it was there after all, or it was a mistake): the paper is Present
 * (`present`) or not answered again. Only before the transaction was ever sent; after that a missing
 * paper ends only when it is Received, and its remarks stay.
 */
export async function unmarkPaperMissing(user: CurrentUser, input: { checkId: string; present: boolean }, now: Date = new Date()) {
  requireAllowed(user, PERMISSIONS.PAPERS_MARK_MISSING, "changing a missing paper");
  const c0 = await loadCheck(user, input.checkId);
  return withLoanLock(c0.transaction.loanId, async (tx) => {
    await assertNotHeld(tx, c0.transactionId);
    const c = await lockedCheck(tx, c0.id);
    if (c.missingState !== "MISSING") return { state: c.checked ? "PRESENT" : "NOT_ANSWERED" };
    if (!PRE_SEND.includes(c.transaction.status) || (await everSent(tx, c.transactionId))) {
      throw new UserError(`${labelOf(c)} was sent as Missing. Its remarks stay; mark it Received when it arrives.`);
    }
    await clearMissingCore(tx, user, c, input.present, now);
    await syncReady(tx, c.transactionId, now);
    await recomputeStage(tx, c.transaction.loanId);
    return { state: input.present ? "PRESENT" : "NOT_ANSWERED" };
  });
}

/** Clears a Missing mark before the first send (used by Present ticks too). One history row. */
export async function clearMissingCore(tx: Tx, user: CurrentUser, c: LockedCheck | (Omit<LockedCheck, "documentItem"> & { documentItem: LockedCheck["documentItem"] }), present: boolean, now: Date) {
  await tx.checklistCheck.update({
    where: { id: c.id },
    data: {
      missingState: null, missingReasonId: null, missingRemarks: null, missingAt: null, missingById: null, missingByLabel: null, remarksAt: null,
      ...(present ? { checked: true, checkedAt: now, checkedById: user.id } : {}),
    },
  });
  if (present) await inHand(tx, c as LockedCheck, user, "Checklist confirmed physically present", now);
  await tx.paperEvent.create({ data: { checkId: c.id, loanId: c.transaction.loanId, kind: "CLEARED", oldText: c.missingRemarks, reasonName: c.missingReason?.name ?? null, newText: present ? "Marked Present" : "Not answered", byId: user.id, byLabel: user.name, at: now } });
  await audit(tx, user, c as LockedCheck, "paper_missing_cleared", `${labelOf(c)}: Missing mark taken back on ${c.transaction.type.name} (${present ? "Present" : "not answered"})`, { before: { state: "MISSING" }, after: { state: present ? "PRESENT" : "NOT_ANSWERED" } });
}

// ---------------------------------------------------------------------------
// Reason and remarks
// ---------------------------------------------------------------------------

export const remarksInputSchema = z.object({
  checkId: z.string().trim().min(1),
  reasonId: z.string({ message: "Pick a reason." }).trim().min(1, "Pick a reason."),
  remarks: z.string({ message: "Write the remarks." }).trim()
    .min(REMARKS_MIN, `Write the remarks (at least ${REMARKS_MIN} characters).`)
    .max(REMARKS_MAX, `Keep the remarks to ${REMARKS_MAX} characters or fewer.`),
});

/**
 * Saves the reason and remarks of a missing paper (5 to 500 characters; remarks are always required,
 * whatever the reason). The first save and every edit are kept in the history with the old and new
 * text; remarks are never removed. Allowed while the paper is Missing, before or after sending.
 */
export async function saveMissingRemarks(user: CurrentUser, raw: z.input<typeof remarksInputSchema>, now: Date = new Date()) {
  requireAllowed(user, PERMISSIONS.PAPERS_MARK_MISSING, "writing remarks for a missing paper");
  const p = remarksInputSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const d = p.data;
  const c0 = await loadCheck(user, d.checkId);
  return withLoanLock(c0.transaction.loanId, async (tx) => {
    const c = await lockedCheck(tx, c0.id);
    if (c.missingState !== "MISSING") throw new UserError(`${labelOf(c)} is not marked Missing.`);
    if (c.transaction.status === "CANCELLED") throw new UserError(`${c.transaction.type.name} is cancelled.`);
    // Remarks before sending follow the hold lock like every other change on the checklist.
    if (PRE_SEND.includes(c.transaction.status)) await assertNotHeld(tx, c.transactionId);
    const reason = await tx.missingPaperReason.findUnique({ where: { id: d.reasonId } });
    // An inactive reason stays on the papers that already have it, but is not offered for new ones.
    if (!reason || (!reason.active && reason.id !== c.missingReasonId)) throw new UserError("Pick a reason.", "reasonId");
    const first = c.missingRemarks === null;
    if (!first && c.missingRemarks === d.remarks && c.missingReasonId === reason.id) return { saved: false };
    await tx.checklistCheck.update({ where: { id: c.id }, data: { missingReasonId: reason.id, missingRemarks: d.remarks, remarksAt: now } });
    await tx.paperEvent.create({
      data: { checkId: c.id, loanId: c.transaction.loanId, kind: first ? "REMARKS_SAVED" : "REMARKS_EDITED", reasonName: reason.name, oldText: first ? null : `${c.missingReason?.name ?? "No reason"}: ${c.missingRemarks}`, newText: d.remarks, byId: user.id, byLabel: user.name, at: now },
    });
    await audit(tx, user, c, first ? "paper_missing_remarks" : "paper_missing_remarks_edited",
      first ? `${labelOf(c)} missing on ${c.transaction.type.name}: ${reason.name}. ${d.remarks}` : `Remarks of the missing ${labelOf(c)} edited on ${c.transaction.type.name}`,
      { before: first ? undefined : { reason: c.missingReason?.name ?? null, remarks: c.missingRemarks }, after: { reason: reason.name, remarks: d.remarks } });
    if (PRE_SEND.includes(c.transaction.status)) await syncReady(tx, c.transactionId, now);
    return { saved: true };
  });
}

// ---------------------------------------------------------------------------
// Include in this file (optional papers)
// ---------------------------------------------------------------------------

/**
 * Optional papers: "Include in this file". Off, the paper is ignored (a Present tick is taken off, a
 * Missing mark taken back: only before the first send). On, it is expected like a required paper.
 */
export async function setPaperIncluded(user: CurrentUser, input: { checkId: string; included: boolean }, now: Date = new Date()) {
  requireAllowed(user, PERMISSIONS.CHECKLIST_TICK, "changing the papers");
  const c0 = await loadCheck(user, input.checkId);
  return withLoanLock(c0.transaction.loanId, async (tx) => {
    await assertNotHeld(tx, c0.transactionId);
    const c = await lockedCheck(tx, c0.id);
    if (c.required) throw new UserError(`${labelOf(c)} is required: it is always part of the file.`);
    if (!PRE_SEND.includes(c.transaction.status)) throw new UserError(`${c.transaction.type.name} is no longer with you.`);
    if (isIncluded({ ...c, missing: c.missingState, included: c.includedInFile }) === input.included && c.includedInFile === input.included) return { included: input.included };
    if (!input.included) {
      if (c.missingState === "RECEIVED_LATE") throw new UserError(`${labelOf(c)} was received late. It stays part of the file.`);
      if (c.missingState === "MISSING") {
        if (await everSent(tx, c.transactionId)) throw new UserError(`${labelOf(c)} was sent as Missing. Its remarks stay; mark it Received when it arrives.`);
        await clearMissingCore(tx, user, c, false, now);
      }
      if (c.checked) {
        await tx.checklistCheck.update({ where: { id: c.id }, data: { checked: false, checkedAt: null, checkedById: null } });
        await notInHand(tx, c, user, "Not included in this file", now);
      }
    }
    await tx.checklistCheck.update({ where: { id: c.id }, data: { includedInFile: input.included } });
    await audit(tx, user, c, "paper_included_changed", `${labelOf(c)} ${input.included ? "included in" : "left out of"} this file (${c.transaction.type.name})`, { before: { included: c.includedInFile }, after: { included: input.included } });
    await syncReady(tx, c.transactionId, now);
    await recomputeStage(tx, c.transaction.loanId);
    return { included: input.included };
  });
}

// ---------------------------------------------------------------------------
// Received late
// ---------------------------------------------------------------------------

export const receiveSchema = z.object({
  checkId: z.string().trim().min(1),
  receivedOn: z.string({ message: "Enter the date it arrived." }).trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it arrived."),
});

/**
 * A missing paper arrived: Received, with the date it arrived (Philippine date, not in the future, not
 * before it was marked missing). It is in the LA's hands with its Document ID. The original reason and
 * remarks stay (on the paper and in the history). The file's exception flag clears with the last one.
 */
export async function receiveMissingPaper(user: CurrentUser, raw: z.input<typeof receiveSchema>, now: Date = new Date()) {
  requireAllowed(user, PERMISSIONS.PAPERS_RECEIVE_LATE, "receiving a missing paper");
  const p = receiveSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const d = p.data;
  const c0 = await loadCheck(user, d.checkId);
  return withLoanLock(c0.transaction.loanId, async (tx) => {
    const c = await lockedCheck(tx, c0.id);
    if (c.missingState === "RECEIVED_LATE") throw new UserError(`${labelOf(c)} is already received (${c.receivedLateOn}).`);
    if (c.missingState !== "MISSING") throw new UserError(`${labelOf(c)} is not marked Missing.`);
    if (c.transaction.status === "CANCELLED") throw new UserError(`${c.transaction.type.name} is cancelled.`);
    const today = businessDate(now);
    if (d.receivedOn > today) throw new UserError("The date it arrived cannot be in the future.", "receivedOn");
    if (c.missingAt && d.receivedOn < businessDate(c.missingAt)) throw new UserError("The date it arrived cannot be before it was marked missing.", "receivedOn");
    await tx.checklistCheck.update({
      where: { id: c.id },
      data: { missingState: "RECEIVED_LATE", checked: true, checkedAt: now, checkedById: user.id, receivedLateOn: d.receivedOn, receivedLateAt: now, receivedLateById: user.id, receivedLateBy: user.name },
    });
    const generated = await inHand(tx, c, user, `Missing paper received late (arrived ${d.receivedOn})`, now);
    await tx.paperEvent.create({ data: { checkId: c.id, loanId: c.transaction.loanId, kind: "RECEIVED_LATE", reasonName: c.missingReason?.name ?? null, oldText: c.missingRemarks, receivedOn: d.receivedOn, byId: user.id, byLabel: user.name, at: now } });
    await audit(tx, user, c, "paper_received_late", `${labelOf(c)} received on ${d.receivedOn} (${c.transaction.type.name}); it was missing: ${c.missingReason?.name ?? "no reason"}`,
      { before: { state: "MISSING" }, after: { state: "RECEIVED_LATE", receivedOn: d.receivedOn }, details: { documentId: generated } });
    if (PRE_SEND.includes(c.transaction.status)) await syncReady(tx, c.transactionId, now);
    await recomputeStage(tx, c.transaction.loanId);
    return { receivedOn: d.receivedOn, documentId: generated };
  });
}

// ---------------------------------------------------------------------------
// Reading (loan file, job, monitoring): derived from the paper rows, never a stored copy
// ---------------------------------------------------------------------------

export interface MissingPaperView {
  checkId: string;
  transactionId: string;
  txnName: string;
  label: string;
  state: "MISSING" | "RECEIVED_LATE";
  reason: string | null;
  remarks: string | null;
  by: string | null;
  at: Date | null;
  receivedOn: string | null;
  receivedBy: string | null;
}

type CheckFacts = {
  id: string; transactionId: string; otherLabel: string | null; rule: { label: string } | null;
  missingState: "MISSING" | "RECEIVED_LATE" | null; missingRemarks: string | null; missingByLabel: string | null; missingAt: Date | null;
  missingReason?: { name: string } | null; receivedLateOn: string | null; receivedLateBy: string | null;
};

/** The missing (and received late) papers of loaded transactions, in their order. */
export function missingPapersOf(txns: { id: string; status: string; type: { name: string }; checks: CheckFacts[] }[]): MissingPaperView[] {
  return txns.filter((t) => t.status !== "CANCELLED").flatMap((t) => t.checks.filter((c) => c.missingState).map((c) => ({
    checkId: c.id, transactionId: t.id, txnName: t.type.name, label: labelOf(c), state: c.missingState!,
    reason: c.missingReason?.name ?? null, remarks: c.missingRemarks, by: c.missingByLabel, at: c.missingAt,
    receivedOn: c.receivedLateOn, receivedBy: c.receivedLateBy,
  })));
}

/** True while any expected paper of a live transaction is still Missing (derived; never stored). */
export const hasMissingPapers = (papers: Pick<MissingPaperView, "state">[]) => papers.some((p) => p.state === "MISSING");

/** The same answer from the database, for one loan (the flag is computed from the paper rows). */
export async function loanHasMissingPapers(db: Tx | typeof prisma, loanId: string): Promise<boolean> {
  return (await db.checklistCheck.count({ where: { missingState: "MISSING", transaction: { loanId, status: { not: "CANCELLED" } } } })) > 0;
}

/** Stages from the vault gate on: a file with missing papers there is "Complete with exceptions". */
export const VAULT_STAGES = ["For Vault Transmittal", "In transit to Vault", "In Safekeeping"];
export const COMPLETE_WITH_EXCEPTIONS = "Complete with exceptions";

/** The history of one paper (oldest first). */
export async function paperHistory(db: Tx | typeof prisma, checkId: string) {
  return db.paperEvent.findMany({ where: { checkId }, orderBy: { at: "asc" } });
}
