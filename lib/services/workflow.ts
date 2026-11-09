import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { notify, branchLaUserIds, supervisorUserIds } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { getHolidaySet, getTatMap } from "@/lib/settings";
import { assignDeadline } from "@/lib/workflow/tat";
import { businessDate, fmtDate } from "@/lib/time";
import { leaveText, onLeaveToday } from "@/lib/monitoring/rules";
import { transactionsFor, TRANSACTION_LABEL, TRANSACTION_ORDER, type TransactionCode } from "@/lib/rules";
import { recomputeStage } from "./stage";
import { sendBlockReason } from "./source-blocks";
import { createTransactionOfType, createTransactions } from "./loan-file";
import { MissingPapersError, NotInScopeError, UserError } from "./errors";
import { endHoldsOnCompletion } from "./holds";
import { EXPENSE_KINDS } from "@/lib/funds/rules";
import { checklistStatus, type CheckLine, type ChecklistStatus } from "@/lib/workflow/checklist";
import { assertNotHeld } from "./locks";
import { moveDocs } from "./custody";
import { worksAtWhere } from "@/lib/branches/access";

const actorOf = (u: CurrentUser): Actor => ({ id: u.id, label: u.name });

/** Workflow steps belong to the roles whose permissions allow them (Admin's lock does not include them). */
function requireAllowed(user: CurrentUser, p: Permission) {
  if (!can(user, p)) throw new UserError("Your role does not allow this step.");
}

/** Who can be a processor: active people whose role is active and has "Receive and process transactions". */
const PROCESSOR_ROLE = { active: true, permissions: { has: PERMISSIONS.DP_RECEIVE } };

async function loadTxnInScope(user: CurrentUser, transactionId: string) {
  const txn = await prisma.loanTransaction.findUnique({
    where: { id: transactionId },
    include: { loan: { include: { branch: true } }, type: true },
  });
  if (!txn || !inScope(user, txn.loan.branchId)) throw new NotInScopeError();
  return txn;
}

// ---------------------------------------------------------------------------
// Checklist (3.1) and Document IDs (3.2)
// ---------------------------------------------------------------------------

export interface ChecklistCompleteness {
  complete: boolean;
  missing: string[];
}

export type CheckRow = {
  id?: string;
  checked: boolean;
  /** Copied from the rule when the loan file was opened. */
  required: boolean;
  otherLabel?: string | null;
  rule: { kind: "REQUIRED" | "ONE_OF" | "OPTIONAL"; label: string; oneOfGroup: string | null; active: boolean } | null;
};

/** Loan-file checklist rows as pure lines (see lib/workflow/checklist.ts for the rule). */
export function toCheckLines(checks: CheckRow[]): CheckLine[] {
  return checks.map((c, i) => ({
    id: c.id ?? String(i),
    label: c.rule?.label ?? c.otherLabel ?? "Other paper",
    checked: c.checked,
    required: c.required,
    group: c.rule?.kind === "ONE_OF" ? c.rule.oneOfGroup ?? c.rule.label : null,
    active: c.rule ? c.rule.active : true,
  }));
}

export function checklistStatusOf(checks: CheckRow[]): ChecklistStatus {
  return checklistStatus(toCheckLines(checks));
}

/** Required papers only; optional lines never block. `missing` holds the plain names. */
export function evaluateChecklist(checks: CheckRow[]): ChecklistCompleteness {
  const s = checklistStatusOf(checks);
  return { complete: s.complete, missing: s.missing.map((m) => m.name) };
}

export async function nextDocumentId(tx: Tx, pn: string, code: string): Promise<string> {
  const prefix = `${pn}-${code}-`;
  const rows = await tx.documentItem.findMany({ where: { documentId: { startsWith: prefix } }, select: { documentId: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.documentId!.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

const EDITABLE_CHECKLIST: string[] = ["FOR_CHECKLIST", "READY", "RETURNED"];

/** Refused once the processor accepted: "Joy Navarro already accepted this. Ask them to return it if something is missing." */
export const acceptedMessage = (dpName: string) => `${dpName} already accepted this. Ask them to return it if something is missing.`;

/**
 * Sent, not accepted yet: the job the LA may still change (inside the loan lock, so a simultaneous
 * accept cannot be overwritten). Throws the plain refusal once the processor accepted.
 */
export async function pendingJobInLock(tx: Tx, transactionId: string) {
  const a = await tx.dpAssignment.findFirst({
    where: { transactionId, status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } }, orderBy: { createdAt: "desc" }, include: { dpUser: true, secondaryDpUser: true },
  });
  if (!a) throw new UserError("This job is no longer with a processor.");
  if (a.status === "ACCEPTED") throw new UserError(acceptedMessage(a.dpUser.name));
  return a;
}

export async function saveChecklist(
  user: CurrentUser,
  input: { transactionId: string; checkedIds: string[]; newOthers: string[] },
) {
  requireAllowed(user, PERMISSIONS.CHECKLIST_TICK);
  const t0 = await loadTxnInScope(user, input.transactionId);
  const actor = actorOf(user);
  return withLoanLock(t0.loanId, async (tx) => {
    await assertNotHeld(tx, t0.id);
    const txn = await tx.loanTransaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      include: { loan: { include: { branch: true } }, type: true, checks: { include: { rule: true, documentItem: true } } },
    });
    // Sent, not accepted yet: the LA (who may send) can still update the papers.
    const sent = txn.status === "ASSIGNED" || txn.status === "IN_PROCESS";
    const job = sent ? await pendingJobInLock(tx, txn.id) : null;
    if (job) requireAllowed(user, PERMISSIONS.DP_SEND);
    if (!EDITABLE_CHECKLIST.includes(txn.status) && !job) {
      throw new UserError(`The ${txn.type.name} checklist can no longer be changed (status: ${txn.status.replace(/_/g, " ").toLowerCase()}).`);
    }
    const wanted = new Set(input.checkedIds);
    const now = new Date();
    const custodian = `${user.name} (LA, ${txn.loan.branch.name})`;
    const location = `${txn.loan.branch.name} branch`;
    const before = txn.checks.filter((c) => c.checked).map((c) => c.rule?.label ?? c.otherLabel);
    const generated: string[] = [];

    for (const c of txn.checks) {
      const should = wanted.has(c.id);
      if (should === c.checked) continue;
      await tx.checklistCheck.update({
        where: { id: c.id },
        data: { checked: should, checkedAt: should ? now : null, checkedById: should ? user.id : null },
      });
      const doc = c.documentItem;
      if (!doc) continue;
      if (should) {
        const documentId = doc.documentId ?? (await nextDocumentId(tx, txn.loan.pn, doc.docTypeCode));
        if (!doc.documentId) generated.push(documentId);
        await tx.documentItem.update({
          where: { id: doc.id },
          data: { documentId, stage: "AT_BRANCH", custodianLabel: custodian, custodianRole: "LA", custodianUserId: user.id, location, since: now },
        });
        await tx.documentMovement.create({
          data: { documentItemId: doc.id, action: "RECEIVED_AT_BRANCH", fromCustodian: null, toCustodian: custodian, purpose: "Checklist confirmed physically present", actorId: user.id, actorLabel: user.name, location, acknowledgedAt: now, acknowledgedById: user.id },
        });
        if (job) {
          // Added after sending: it goes to the processor with the rest (in transit until they accept).
          await tx.documentItem.update({ where: { id: doc.id }, data: { stage: "IN_TRANSIT", location: `In transit to DP ${job.dpUser.name}`, since: now } });
          await tx.documentMovement.create({
            data: { documentItemId: doc.id, action: "DISPATCHED_TO_DP", fromCustodian: custodian, toCustodian: `${job.dpUser.name} (DP)`, purpose: txn.type.name, actorId: user.id, actorLabel: user.name, location: `In transit to DP ${job.dpUser.name}`, remarks: "Added after sending, before the processor accepted" },
          });
        }
      } else {
        // Un-ticked: the Document ID is kept (never reused); the item is expected again.
        await tx.documentItem.update({
          where: { id: doc.id },
          data: { stage: "EXPECTED", custodianLabel: "Not yet received", custodianRole: null, custodianUserId: null, location: "", since: now },
        });
        await tx.documentMovement.create({
          data: { documentItemId: doc.id, action: "MARKED_NOT_PRESENT", fromCustodian: custodian, toCustodian: null, remarks: "Un-ticked on the checklist", actorId: user.id, actorLabel: user.name },
        });
      }
    }

    // "Others" free-text items: present when added; each gets a Document ID.
    for (const raw of input.newOthers) {
      const label = raw.trim();
      if (!label) continue;
      if (label.length > 120) throw new UserError("Others: keep the description under 120 characters.", "others");
      const check = await tx.checklistCheck.create({ data: { transactionId: txn.id, otherLabel: label, required: false, checked: true, checkedAt: now, checkedById: user.id } });
      const documentId = await nextDocumentId(tx, txn.loan.pn, "OTH");
      generated.push(documentId);
      const doc = await tx.documentItem.create({
        data: { loanId: txn.loanId, transactionId: txn.id, checkId: check.id, docTypeCode: "OTH", label, originality: "ORIGINAL", documentId, stage: "AT_BRANCH", custodianLabel: custodian, custodianRole: "LA", custodianUserId: user.id, location, since: now },
      });
      await tx.documentMovement.create({
        data: { documentItemId: doc.id, action: "RECEIVED_AT_BRANCH", toCustodian: custodian, purpose: "Other document added to checklist", actorId: user.id, actorLabel: user.name, location, acknowledgedAt: now, acknowledgedById: user.id },
      });
    }

    const fresh = await tx.checklistCheck.findMany({ where: { transactionId: txn.id }, include: { rule: true } });
    const result = evaluateChecklist(fresh);
    const after = fresh.filter((c) => c.checked).map((c) => c.rule?.label ?? c.otherLabel);
    if (job) {
      // While it is with the processor every required paper stays ticked (the same rule as Send).
      if (!result.complete) throw new UserError("Every required paper must stay ticked while it is with the processor. Pull it back instead.");
      const added = after.filter((x) => !before.includes(x));
      const removed = before.filter((x) => !after.includes(x));
      await tx.loanTransaction.update({ where: { id: txn.id }, data: { checklistSavedAt: now } });
      if (added.length || removed.length) {
        const changes = [...added.map((x) => `Added ${x}`), ...removed.map((x) => `Removed ${x}`)];
        await writeAudit(tx, {
          actor, mode: "MANUAL", action: "sent_job_updated", entityType: "DpAssignment", entityId: job.id, loanId: txn.loanId, pn: txn.loan.pn,
          summary: `${changes.join("; ")} before the processor accepted`, details: { change: "papers", changes },
          before: { ticked: before }, after: { ticked: after },
        });
        await notify(tx, { email: { event: "job_changed", transactionId: txn.id, vars: { pn: txn.loan.pn, transaction: txn.type.name, who: user.name, reason: changes.join(", ") } }, userIds: [job.dpUserId, ...(job.secondaryDpUserId ? [job.secondaryDpUserId] : [])], loanId: txn.loanId, title: `${txn.loan.pn}: ${txn.type.name} updated before you accept`, body: `${user.name}: ${changes.join(", ")}.`, link: `/jobs/${job.id}` });
      }
      return { complete: true, missing: [], generated };
    }
    let status = txn.status;
    if (txn.status === "FOR_CHECKLIST" && result.complete) status = "READY";
    if (txn.status === "READY" && !result.complete) status = "FOR_CHECKLIST";
    await tx.loanTransaction.update({
      where: { id: txn.id },
      data: { checklistSavedAt: now, ...(status !== txn.status ? { status, statusSince: now } : {}) },
    });

    await writeAudit(tx, {
      actor, mode: "MANUAL", action: "checklist_saved", entityType: "LoanTransaction", entityId: txn.id, loanId: txn.loanId, pn: txn.loan.pn,
      journeyStep: result.complete ? "3.1" : null,
      summary: `Saved ${txn.type.name} checklist: ${after.length} item(s) ticked${result.complete ? ", complete" : `, ${result.missing.length} missing`}`,
      before: { ticked: before, status: txn.status },
      after: { ticked: after, status },
      details: { missing: result.missing },
    });
    if (generated.length) {
      await writeAudit(tx, {
        actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "document_ids_generated", entityType: "LoanTransaction", entityId: txn.id, loanId: txn.loanId, pn: txn.loan.pn,
        journeyStep: "3.2", summary: `Generated ${generated.length} Document ID(s) for ${txn.type.name}`, after: { documentIds: generated },
      });
    }
    // A missing-paper request closes by itself when the papers it asked for are ticked (older
    // requests that named no rows: when the checklist is complete). Unticking later opens nothing new.
    const openRequests = await tx.loanException.findMany({ where: { transactionId: txn.id, type: "LEGAL_DOCS_COMPLETION", status: "OPEN" } });
    const tickedNow = new Set(fresh.filter((c) => c.checked).map((c) => c.id));
    for (const ex of openRequests) {
      const ids = requestedCheckIds(ex.details);
      const done = ids ? ids.every((id) => tickedNow.has(id)) : result.complete;
      if (!done) continue;
      await tx.loanException.update({
        where: { id: ex.id },
        data: { status: "RESOLVED", resolvedAt: now, resolvedByLabel: "System", resolution: ids ? "The requested paper was ticked." : "Checklist completed; missing documents received." },
      });
      await writeAudit(tx, {
        actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "exception_resolved", entityType: "LoanException", entityId: ex.id, loanId: txn.loanId, pn: txn.loan.pn,
        summary: ids ? "Missing paper closed automatically: the requested paper was ticked" : "Legal Docs Completion resolved automatically: checklist complete",
        before: { status: "OPEN" }, after: { status: "RESOLVED" },
      });
    }
    await recomputeStage(tx, txn.loanId);
    return { complete: result.complete, missing: result.missing, generated };
  });
}

export const ASKED_FROM = { BORROWER: "Borrower", BRANCH: "Branch", OTHER: "Other" } as const;
export type AskedFrom = keyof typeof ASKED_FROM;

/**
 * Missing paper: a reminder that specific papers were asked for and have not arrived. It does not stop
 * the work and does not pause the turnaround time; it closes by itself when those papers are ticked.
 * The papers are the transaction's checklist rows (stored by id on the request; their names as shown).
 */
export const missingSchema = z.object({
  transactionId: z.string().trim().min(1),
  checkIds: z.array(z.string().trim().min(1)).min(1, "Pick at least one paper."),
  askedFrom: z.enum(["BORROWER", "BRANCH", "OTHER"]).nullable().default(null),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").default(""),
});

/** The checklist rows a missing-paper request asked for (null for older requests that named none). */
export function requestedCheckIds(details: unknown): string[] | null {
  const ids = (details as { checkIds?: unknown } | null)?.checkIds;
  return Array.isArray(ids) && ids.length ? ids.map(String) : null;
}

export async function requestMissingDocuments(user: CurrentUser, raw: z.input<typeof missingSchema>) {
  requireAllowed(user, PERMISSIONS.CHECKLIST_TICK);
  const parsed = missingSchema.safeParse(raw);
  if (!parsed.success) { const i = parsed.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const input = parsed.data;
  const t0 = await loadTxnInScope(user, input.transactionId);
  return withLoanLock(t0.loanId, async (tx) => {
    await assertNotHeld(tx, t0.id);
    const checks = await tx.checklistCheck.findMany({ where: { transactionId: t0.id }, include: { rule: true } });
    const wanted = [...new Set(input.checkIds)];
    const rows = wanted.map((id) => checks.find((c) => c.id === id));
    if (rows.some((c) => !c)) throw new UserError("Pick papers of this transaction only.", "checkIds");
    if (rows.some((c) => c!.checked)) throw new UserError("That paper is already ticked. Pick papers that have not arrived.", "checkIds");
    const open = await tx.loanException.findFirst({ where: { transactionId: t0.id, type: "LEGAL_DOCS_COMPLETION", status: "OPEN" } });
    if (open) throw new UserError("A missing paper is already asked for on this transaction. It closes when the paper is ticked.");
    const papers = rows.map((c) => c!.rule?.label ?? c!.otherLabel ?? "Other paper");
    const from = input.askedFrom ? ASKED_FROM[input.askedFrom] : null;
    const ex = await tx.loanException.create({
      data: {
        loanId: t0.loanId, transactionId: t0.id, type: "LEGAL_DOCS_COMPLETION",
        reason: `Missing for ${t0.type.name}: ${papers.join("; ")}.${from ? ` Asked from: ${from}.` : ""}${input.note ? ` ${input.note}` : ""}`,
        details: { checkIds: wanted, missing: papers, askedFrom: input.askedFrom, note: input.note } as Prisma.InputJsonValue,
        raisedById: user.id, raisedByLabel: user.name,
      },
    });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "exception_raised", entityType: "LoanException", entityId: ex.id, loanId: t0.loanId, pn: t0.loan.pn,
      summary: `Missing paper asked for ${t0.type.name}: ${papers.join(", ")}${from ? ` (from ${from})` : ""}`, details: { missing: papers, askedFrom: input.askedFrom },
    });
    // The other party: the processor working on it, if it is with one.
    const job = await tx.dpAssignment.findFirst({ where: { transactionId: t0.id, status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } } });
    if (job) {
      await notify(tx, {
        userIds: [job.dpUserId, ...(job.secondaryDpUserId ? [job.secondaryDpUserId] : [])], loanId: t0.loanId, title: `${t0.loan.pn}: missing paper for ${t0.type.name}`, body: `${user.name} asked for: ${papers.join(", ")}.`, link: `/jobs/${job.id}`,
        email: { event: "missing_paper", transactionId: t0.id, vars: { pn: t0.loan.pn, transaction: t0.type.name, who: user.name, reason: `Missing: ${papers.join(", ")}.${from ? ` Asked from: ${from}.` : ""}` } },
      });
    }
    return papers;
  });
}

export async function markLabelsPrinted(user: CurrentUser, documentItemIds: string[]) {
  requireAllowed(user, PERMISSIONS.LABELS_PRINT);
  const docs = await prisma.documentItem.findMany({ where: { id: { in: documentItemIds }, documentId: { not: null } }, include: { loan: true } });
  if (docs.length === 0) return;
  for (const d of docs) if (!inScope(user, d.loan.branchId)) throw new NotInScopeError();
  const loanId = docs[0].loanId;
  await withLoanLock(loanId, async (tx) => {
    const now = new Date();
    for (const d of docs) {
      await tx.documentItem.update({ where: { id: d.id }, data: { labelPrintedAt: now } });
      await tx.documentMovement.create({ data: { documentItemId: d.id, action: "LABEL_PRINTED", fromCustodian: d.custodianLabel, toCustodian: d.custodianLabel, actorId: user.id, actorLabel: user.name, location: d.location || null, remarks: "QR label printed and attached" } });
    }
    // Labels printed per transaction (shown as a chip; it does not block Send).
    const txnIds = [...new Set(docs.map((d) => d.transactionId).filter((x): x is string => !!x))];
    await tx.loanTransaction.updateMany({ where: { id: { in: txnIds }, labelsPrintedAt: null }, data: { labelsPrintedAt: now } });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "labels_printed", entityType: "Loan", entityId: loanId, loanId, pn: docs[0].loan.pn,
      journeyStep: "3.2", summary: `Printed ${docs.length} QR label(s)`, after: { documentIds: docs.map((d) => d.documentId) },
    });
  });
}

// ---------------------------------------------------------------------------
// EDST (3.3)
// ---------------------------------------------------------------------------

export async function recordEdst(user: CurrentUser, input: { transactionId: string; reference: string }) {
  requireAllowed(user, PERMISSIONS.TXN_COMPLETE);
  const ref = input.reference.trim();
  if (!ref) throw new UserError("Enter the EDST reference.", "reference");
  if (ref.length > 60) throw new UserError("EDST reference: keep it under 60 characters.", "reference");
  const t0 = await loadTxnInScope(user, input.transactionId);
  if (t0.type.code !== "EDST") throw new UserError("This is not a For EDST transaction.");
  await withLoanLock(t0.loanId, async (tx) => {
    await assertNotHeld(tx, t0.id);
    const txn = await tx.loanTransaction.findUniqueOrThrow({ where: { id: t0.id } });
    if (txn.status !== "READY") {
      throw new UserError(txn.status === "COMPLETED" ? "EDST is already completed." : "Complete and save the For EDST checklist first.");
    }
    const now = new Date();
    await tx.loanTransaction.update({ where: { id: txn.id }, data: { status: "COMPLETED", statusSince: now, completedAt: now, edstReference: ref } });
    await endHoldsOnCompletion(tx, { id: txn.id, loanId: t0.loanId, pn: t0.loan.pn, name: t0.type.name }, false, now);
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "edst_completed", entityType: "LoanTransaction", entityId: txn.id, loanId: t0.loanId, pn: t0.loan.pn,
      journeyStep: "3.3", summary: `Entered the account in EDST (reference ${ref}). For EDST completed`,
      before: { status: txn.status }, after: { status: "COMPLETED", edstReference: ref },
    });
    await recomputeStage(tx, t0.loanId);
  });
}

// ---------------------------------------------------------------------------
// Add a transaction (custom types, added by the Loan Associate on Check documents).
// The automation rules never create custom types. The checklist is copied from the type's
// checklist items, like the automatic ones.
// ---------------------------------------------------------------------------

/** Stages after which no transaction can be added (the papers are on their way to the Vault). */
const NO_ADD_STAGES = ["For Vault Transmittal", "In transit to Vault", "In Safekeeping", "Closed", "Archived", "Disposed"];

export async function addCustomTransaction(user: CurrentUser, input: { loanId: string; typeId: string }) {
  requireAllowed(user, PERMISSIONS.TXN_ADD);
  const loan = await prisma.loan.findUnique({ where: { id: input.loanId } });
  if (!loan || !inScope(user, loan.branchId)) throw new NotInScopeError();
  const type = await prisma.transactionType.findUnique({
    where: { id: input.typeId },
    include: { rules: { where: { active: true }, include: { documentType: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!type || type.builtIn) throw new UserError("Pick a transaction from the list.", "typeId");
  if (!type.active) throw new UserError(`${type.name} is inactive in Settings and can no longer be added.`, "typeId");
  return withLoanLock(loan.id, async (tx) => {
    const fresh = await tx.loan.findUniqueOrThrow({ where: { id: loan.id } });
    if (NO_ADD_STAGES.includes(fresh.stage)) throw new UserError("Transactions can only be added before the papers go to the Vault.");
    const dup = await tx.loanTransaction.findFirst({ where: { loanId: loan.id, typeId: type.id, status: { not: "CANCELLED" } } });
    if (dup) throw new UserError(`${type.name} is already on this loan file.`, "typeId");
    const txn = await createTransactionOfType(tx, { loanId: loan.id, type, origin: "ADDED" });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "transaction_added", entityType: "LoanTransaction", entityId: txn.id, loanId: loan.id, pn: loan.pn,
      summary: `Added the transaction ${type.name} (${type.rules.length} paper${type.rules.length === 1 ? "" : "s"} on its checklist)`,
      after: { type: type.code, papers: type.rules.map((r) => r.label) },
    });
    await recomputeStage(tx, loan.id);
    return txn.id;
  });
}

/** Custom transaction done by the LA (no processor): mark it done once its required papers are ticked. */
export async function completeLaTransaction(user: CurrentUser, input: { transactionId: string }) {
  requireAllowed(user, PERMISSIONS.TXN_COMPLETE);
  const t0 = await loadTxnInScope(user, input.transactionId);
  if (t0.type.builtIn || t0.type.requiresDp) throw new UserError("This transaction is finished another way.");
  await withLoanLock(t0.loanId, async (tx) => {
    await assertNotHeld(tx, t0.id);
    const txn = await tx.loanTransaction.findUniqueOrThrow({ where: { id: t0.id }, include: { checks: { include: { rule: true } } } });
    if (txn.status === "COMPLETED") throw new UserError(`${t0.type.name} is already done.`);
    if (!["FOR_CHECKLIST", "READY", "RETURNED"].includes(txn.status)) throw new UserError(`${t0.type.name} cannot be marked done now.`);
    const status = evaluateChecklist(txn.checks);
    if (!status.complete) throw new MissingPapersError(status.missing);
    const now = new Date();
    await tx.loanTransaction.update({ where: { id: txn.id }, data: { status: "COMPLETED", statusSince: now, completedAt: now } });
    await endHoldsOnCompletion(tx, { id: txn.id, loanId: t0.loanId, pn: t0.loan.pn, name: t0.type.name }, false, now);
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "transaction_completed", entityType: "LoanTransaction", entityId: txn.id, loanId: t0.loanId, pn: t0.loan.pn,
      summary: `Marked ${t0.type.name} as done`, before: { status: txn.status }, after: { status: "COMPLETED" },
    });
    await recomputeStage(tx, t0.loanId);
  });
}

// ---------------------------------------------------------------------------
// Cash advance request (3.4)
// ---------------------------------------------------------------------------

/**
 * Funds flag (LA). The LA only says whether a transaction needs funds and for what; the processor asks
 * Finance for the amount. The LA may change it until the processor accepts the job; after that only
 * the processor can (lib/services/jobs.ts changeFundsFlag). One audit row per change.
 */
export async function laSetFundsFlag(user: CurrentUser, input: { transactionId: string; needed: boolean; kinds: string[] }) {
  requireAllowed(user, PERMISSIONS.FUNDS_FLAG);
  const t0 = await loadTxnInScope(user, input.transactionId);
  const kinds = [...new Set(input.kinds)].filter((k) => (EXPENSE_KINDS as readonly string[]).includes(k));
  if (input.needed && kinds.length === 0) throw new UserError("Tick what the funds are for.", "fundsKinds");
  await withLoanLock(t0.loanId, async (tx) => {
    await assertNotHeld(tx, t0.id);
    const t = await tx.loanTransaction.findUniqueOrThrow({ where: { id: t0.id }, include: { dpAssignments: { where: { status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } } } } });
    const accepted = t.dpAssignments.find((x) => x.status === "ACCEPTED");
    if (accepted) throw new UserError(acceptedMessage((await tx.user.findUniqueOrThrow({ where: { id: accepted.dpUserId } })).name));
    const after = { fundsNeeded: input.needed ? "YES" : "NO", fundsKinds: input.needed ? kinds : [] } as const;
    await tx.loanTransaction.update({ where: { id: t.id }, data: { fundsNeeded: after.fundsNeeded, fundsKinds: after.fundsKinds as never, fundsFlaggedAt: new Date() } });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "funds_flag_changed", entityType: "LoanTransaction", entityId: t.id, loanId: t0.loanId, pn: t0.loan.pn,
      summary: `${user.name} set ${t0.type.name}: ${input.needed ? `needs funds (${kinds.join(", ")})` : "no funds needed"}`,
      details: { change: "funds", changes: [`Funds: ${input.needed ? `Needs funds (${kinds.map((k) => k.replace(/_/g, " ").toLowerCase()).join(", ")})` : "No funds needed"}`] },
      before: { fundsNeeded: t.fundsNeeded, fundsKinds: t.fundsKinds }, after,
    });
    await recomputeStage(tx, t0.loanId);
  });
}

// ---------------------------------------------------------------------------
// Assign to DP (3.6) and notify (3.7)
// ---------------------------------------------------------------------------

/** Recommends the active DP in the branch with the fewest open assignments. */
export async function recommendDp(dpBranchId: string) {
  // The processor of the branch with the most free places (capacity minus open jobs: assigned + in
  // process + on hold, the Monitoring count); then the fewest open jobs; then the name. Never one on
  // leave. A Full processor is recommended only when everyone in the branch is full.
  const { processors, openJobCounts } = await import("./monitoring");
  const dps = (await processors(businessDate(new Date()))).filter((d) => d.branchIds.includes(dpBranchId) && !d.onLeave);
  if (dps.length === 0) return null;
  const open = await openJobCounts(dps.map((d) => d.id));
  const free = (d: (typeof dps)[number]) => d.capacity - (open.get(d.id) ?? 0);
  const best = [...dps].sort((a, b) => free(b) - free(a) || (open.get(a.id) ?? 0) - (open.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0];
  return { id: best.id, name: best.name, openAssignments: open.get(best.id) ?? 0 };
}

export interface AssignInput {
  transactionId: string;
  dpBranchId: string;
  dpUserId: string;
  ltoOfficeId: string | null;
  /** "Does this transaction need funds?" Required before Send. No amount. */
  fundsNeeded: "YES" | "NO" | null;
  fundsKinds: string[];
  beyondTatReason: string | null;
  pasuyo: boolean;
  secondaryDpUserId: string | null;
  pasuyoReason: string | null;
}

/** Transaction statuses before it is sent to a DP. */
const PRE_SEND: string[] = ["FOR_CHECKLIST", "READY", "RETURNED"];

/**
 * Refuses a send because required papers are not ticked: writes ONE audit row
 * ("Send refused, missing required papers") on its own, changes nothing else, then throws.
 */
export async function refuseMissingPapers(
  actor: CurrentUser | Actor,
  txn: { id: string; loanId: string; type: { name: string }; loan: { pn: string } },
  missing: string[],
  mode: "MANUAL" | "SIMULATED",
): Promise<never> {
  const who: Actor = "permissions" in actor ? actorOf(actor) : actor;
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: who, mode, action: "send_refused_missing_papers", entityType: "LoanTransaction", entityId: txn.id,
      loanId: txn.loanId, pn: txn.loan.pn,
      summary: `Send refused, missing required papers: ${txn.type.name}`,
      details: { transaction: txn.type.name, missing },
    });
  });
  throw new MissingPapersError(missing);
}

/** Papers the processor handed over with a Return to LA, waiting for the LA to confirm them back. */
export async function papersToConfirm(db: Tx | typeof prisma, transactionId: string) {
  const t = await db.loanTransaction.findUnique({ where: { id: transactionId }, select: { status: true } });
  if (t?.status !== "RETURNED") return [];
  return db.documentItem.findMany({ where: { transactionId, stage: "IN_TRANSIT" }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, documentId: true, custodianLabel: true, checkId: true } });
}
export const PAPERS_BACK_FIRST = "Confirm you received the papers the processor handed over first.";

/**
 * The LA confirms the papers handed over by the processor: all received, or some "Not received" (a
 * Problem is raised on the transaction naming those papers; they stay recorded with the processor).
 * Sending again waits for this. Who and when are recorded on the round.
 */
export async function confirmPapersBack(user: CurrentUser, input: { transactionId: string; notReceived: string[] }) {
  requireAllowed(user, PERMISSIONS.CHECKLIST_TICK);
  const t0 = await loadTxnInScope(user, input.transactionId);
  return withLoanLock(t0.loanId, async (tx) => {
    await assertNotHeld(tx, t0.id);
    const docs = await papersToConfirm(tx, t0.id);
    if (!docs.length) throw new UserError("There are no papers to confirm.");
    const missing = new Set(input.notReceived);
    if ([...missing].some((id) => !docs.some((d) => d.id === id))) throw new UserError("Pick papers from the list only.");
    const last = await tx.dpAssignment.findFirst({ where: { transactionId: t0.id, status: "WITHDRAWN", returnedAt: { not: null } }, orderBy: { returnedAt: "desc" }, include: { dpUser: { select: { name: true } } } });
    const dpName = last?.dpUser.name ?? "the processor";
    const by = { id: user.id, label: user.name };
    const got = docs.filter((d) => !missing.has(d.id));
    const lost = docs.filter((d) => missing.has(d.id));
    if (got.length) await moveDocs(tx, got, { stage: "AT_BRANCH", custodian: null, role: "LA", userId: user.id, location: `${t0.loan.branch.name} branch`, action: "RECEIVED_BACK_BY_LA" }, { by });
    if (lost.length) {
      await moveDocs(tx, lost, { stage: "WITH_DP", custodian: `${dpName} (DP)`, role: "DP", userId: last?.dpUserId ?? null, location: `Not received from DP ${dpName}`, action: "NOT_RECEIVED_FROM_DP" }, { by });
      const reason = await tx.problemReason.findFirst({ where: { OR: [{ code: "MISSING_PAPER" }, { code: "OTHER" }], active: true }, orderBy: { code: "asc" } });
      if (!reason) throw new UserError("There is no active problem reason \"Missing paper\".");
      const note = `Not received from ${dpName}: ${lost.map((d) => d.label).join(", ")}`;
      const p = await tx.problem.create({ data: { loanId: t0.loanId, transactionId: t0.id, reasonId: reason.id, note, raisedById: user.id, raisedByLabel: user.name } });
      await writeAudit(tx, { actor: actorOf(user), mode: "MANUAL", action: "problem_raised", entityType: "Problem", entityId: p.id, loanId: t0.loanId, pn: t0.loan.pn, summary: `Problem on ${t0.type.name}: ${reason.name}`, details: { note } });
    }
    if (last) await tx.dpAssignment.update({ where: { id: last.id }, data: { papersReceivedAt: new Date(), papersReceivedBy: user.name } });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "papers_received_back", entityType: "LoanTransaction", entityId: t0.id, loanId: t0.loanId, pn: t0.loan.pn,
      summary: `Papers received by ${user.name} from ${dpName} for ${t0.type.name}: ${got.length} received${lost.length ? `, ${lost.length} not received (${lost.map((d) => d.label).join(", ")})` : ""}`,
      details: { received: got.map((d) => d.label), notReceived: lost.map((d) => d.label) },
    });
    await recomputeStage(tx, t0.loanId);
    return { received: got.length, notReceived: lost.map((d) => d.label) };
  });
}

export async function assignToDp(user: CurrentUser, input: AssignInput) {
  requireAllowed(user, PERMISSIONS.DP_SEND);
  const t0 = await loadTxnInScope(user, input.transactionId);
  if (!t0.type.requiresDp) throw new UserError(`${t0.type.name} does not need a DP.`);
  // A MyLoans change under Admin review holds the work it reaches (never an outage).
  const sourceBlock = await sendBlockReason(prisma, t0.loanId, t0.type.code);
  if (sourceBlock) throw new UserError(sourceBlock);

  // Rule: every required paper must be ticked before the transaction can go to a DP.
  // Checked first, before any other field, so the answer is always the list of missing papers.
  if (PRE_SEND.includes(t0.status)) {
    const checks = await prisma.checklistCheck.findMany({ where: { transactionId: t0.id }, include: { rule: true } });
    const status = evaluateChecklist(checks);
    if (!status.complete) await refuseMissingPapers(user, t0, status.missing, "MANUAL");
  }

  const [tats, holidays] = await Promise.all([getTatMap(), getHolidaySet()]);
  const deadline = assignDeadline(t0.loan.releasedAt, tats, holidays);
  const pastTat = businessDate(new Date()) > deadline;
  const beyond = input.beyondTatReason?.trim() || null;
  if (pastTat && !beyond) throw new UserError(`This is past the Day 2 TAT (${deadline}). Enter a Beyond-TAT reason.`, "beyondTatReason");

  const dpBranch = await prisma.branch.findUnique({ where: { id: input.dpBranchId } });
  if (!dpBranch?.active || dpBranch.hidden) throw new UserError("Pick a DP branch.", "dpBranchId");
  // The processor works at that branch: it is in their branch access (or they have All branches).
  const dp = await prisma.user.findFirst({
    where: { id: input.dpUserId, active: true, role: PROCESSOR_ROLE, ...worksAtWhere(dpBranch.id) },
  });
  if (!dp) throw new UserError("Pick an active DP of the selected DP branch.", "dpUserId");
  // On leave (Settings, Processor capacity): shown disabled in the Send panel, and refused here too.
  if (onLeaveToday(dp, businessDate(new Date()))) throw new UserError(`${dp.name} is ${leaveText(dp.dpLeaveUntil, fmtDate).toLowerCase()}. Pick another processor.`, "dpUserId");
  let secondary: { id: string; name: string } | null = null;
  if (input.pasuyo) {
    secondary = await prisma.user.findFirst({ where: { id: input.secondaryDpUserId ?? "", active: true, role: PROCESSOR_ROLE }, select: { id: true, name: true } });
    if (!secondary) throw new UserError("Pasuyo: pick the secondary DP.", "secondaryDpUserId");
    if (secondary.id === dp.id) throw new UserError("Pasuyo: the secondary DP must be a different person.", "secondaryDpUserId");
    if (!input.pasuyoReason?.trim()) throw new UserError("Pasuyo: enter the reason.", "pasuyoReason");
  }
  // The LTO office: required for types that need LTO processing (Settings, Transaction types); not asked otherwise.
  let lto: { id: string; name: string } | null = null;
  if (t0.type.needsLto) {
    if (!input.ltoOfficeId) throw new UserError("Pick the LTO office.", "ltoOfficeId");
    lto = await prisma.ltoOffice.findFirst({ where: { id: input.ltoOfficeId, active: true }, select: { id: true, name: true } });
    if (!lto) throw new UserError("Pick an active LTO office.", "ltoOfficeId");
  }
  if (input.fundsNeeded !== "YES" && input.fundsNeeded !== "NO") throw new UserError("Does this transaction need funds? Pick Yes or No.", "fundsNeeded");
  const fundsKinds = [...new Set(input.fundsKinds)].filter((k) => (EXPENSE_KINDS as readonly string[]).includes(k));
  if (input.fundsNeeded === "YES" && fundsKinds.length === 0) throw new UserError("Tick what the funds are for.", "fundsKinds");
  if (input.fundsNeeded === "YES" && !can(user, PERMISSIONS.FUNDS_FLAG)) throw new UserError("Your role does not allow flagging funds.", "fundsNeeded");
  const recommended = await recommendDp(dpBranch.id);

  try {
  await withLoanLock(t0.loanId, async (tx) => {
    await assertNotHeld(tx, t0.id);
    const txn = await tx.loanTransaction.findUniqueOrThrow({ where: { id: t0.id }, include: { checks: { include: { rule: true } }, documents: true } });
    if (!PRE_SEND.includes(txn.status)) throw new UserError(`${t0.type.name} is already assigned.`);
    // Returned with papers handed over: the LA confirms them back before sending again.
    if ((await papersToConfirm(tx, txn.id)).length) throw new UserError(PAPERS_BACK_FIRST);
    // Same rule again under the row lock (another tab may have un-ticked a paper meanwhile).
    const completeness = evaluateChecklist(txn.checks);
    if (!completeness.complete) throw new MissingPapersError(completeness.missing);
    if (txn.status === "FOR_CHECKLIST") throw new UserError(`Save the ${t0.type.name} checklist first, then try again.`);
    const now = new Date();
    const assignment = await tx.dpAssignment.create({
      data: {
        loanId: t0.loanId, transactionId: txn.id, dpBranchId: dpBranch.id, dpUserId: dp.id,
        secondaryDpUserId: secondary?.id ?? null, pasuyoReason: input.pasuyo ? input.pasuyoReason!.trim() : null,
        ltoOfficeId: lto?.id ?? null, fundStatus: input.fundsNeeded === "YES" ? "FOR_FUNDING" : "NOT_REQUIRED", beyondTatReason: beyond,
        recommendedDpUserId: recommended?.id ?? null, assignedById: user.id, endorsedAt: now,
      },
    });
    // Second processor (Pasuyo) chosen at Send: one history row (append-only).
    if (secondary) {
      await tx.pasuyoEvent.create({ data: { assignmentId: assignment.id, toUserId: secondary.id, toLabel: secondary.name, byUserId: user.id, byLabel: user.name, reason: input.pasuyoReason!.trim() } });
    }
    await tx.loanTransaction.update({ where: { id: txn.id }, data: { status: "ASSIGNED", statusSince: now, fundsNeeded: input.fundsNeeded!, fundsKinds: (input.fundsNeeded === "YES" ? fundsKinds : []) as never, fundsFlaggedAt: now } });
    // Hand-over: items are In Transit; the LA stays accountable until the DP acknowledges.
    for (const d of txn.documents.filter((d) => d.documentId && d.stage === "AT_BRANCH")) {
      await tx.documentItem.update({ where: { id: d.id }, data: { stage: "IN_TRANSIT", since: now, location: `In transit to DP ${dp.name}` } });
      await tx.documentMovement.create({
        data: { documentItemId: d.id, action: "DISPATCHED_TO_DP", fromCustodian: d.custodianLabel, toCustodian: `${dp.name} (DP)`, purpose: t0.type.name, actorId: user.id, actorLabel: user.name, location: `In transit to DP ${dp.name}`, remarks: "Awaiting DP acknowledgment" },
      });
    }
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "assigned_to_dp", entityType: "DpAssignment", entityId: assignment.id, loanId: t0.loanId, pn: t0.loan.pn,
      journeyStep: "3.6",
      summary: `Assigned ${t0.type.name} to DP ${dp.name}${secondary ? ` (Pasuyo: ${secondary.name})` : ""}${beyond ? " beyond Day 2 TAT" : ""}`,
      before: { status: txn.status },
      after: {
        status: "ASSIGNED", dp: dp.name, dpBranch: dpBranch.name, ltoOffice: lto?.name ?? null, fundsNeeded: input.fundsNeeded, fundsKinds,
        beyondTatReason: beyond, pasuyo: secondary?.name ?? null, recommendedDp: recommended?.name ?? null, endorsedAt: now,
      },
    });
    await notify(tx, {
      userIds: [dp.id, ...(secondary ? [secondary.id] : [])],
      loanId: t0.loanId,
      title: `New assignment: ${t0.type.name} for ${t0.loan.pn}`,
      body: `${user.name} assigned ${t0.type.name} (${t0.loan.borrowerName}, ${t0.loan.branch.name}) to you. Please accept or decline today.`,
      link: `/jobs/${assignment.id}`,
      email: { event: txn.status === "RETURNED" ? "job_resent" : "job_sent", transactionId: txn.id, vars: { pn: t0.loan.pn, transaction: t0.type.name, who: user.name, reason: lto ? `Process at: ${lto.name}.` : "" } },
    });
    await writeAudit(tx, {
      actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "dp_notified", entityType: "DpAssignment", entityId: assignment.id, loanId: t0.loanId, pn: t0.loan.pn,
      journeyStep: "3.7", summary: `Notified ${dp.name}${secondary ? ` and ${secondary.name}` : ""} in-app and by email`,
    });
    await recomputeStage(tx, t0.loanId);
  });
  } catch (e) {
    // The locked transaction rolled back; record the refusal on its own.
    if (e instanceof MissingPapersError) await refuseMissingPapers(user, t0, e.missing, "MANUAL");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export async function resolveException(user: CurrentUser, input: { exceptionId: string; resolution: string }) {
  requireAllowed(user, PERMISSIONS.CHECKLIST_TICK);
  const text = input.resolution.trim();
  if (!text) throw new UserError("Describe how the exception was resolved.", "resolution");
  const ex = await prisma.loanException.findUnique({ where: { id: input.exceptionId }, include: { loan: true } });
  if (!ex || !inScope(user, ex.loan.branchId)) throw new NotInScopeError();
  await withLoanLock(ex.loanId, async (tx) => {
    const cur = await tx.loanException.findUniqueOrThrow({ where: { id: ex.id } });
    if (cur.status !== "OPEN") throw new UserError("This exception is already resolved.");
    if (cur.type === "LEGAL_DOCS_COMPLETION") {
      throw new UserError("Legal Docs Completion closes automatically when the checklist is complete. Tick the received documents and save the checklist.");
    }
    await tx.loanException.update({
      where: { id: ex.id },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: user.id, resolvedByLabel: user.name, resolution: text },
    });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "exception_resolved", entityType: "LoanException", entityId: ex.id, loanId: ex.loanId, pn: ex.loan.pn,
      summary: `Resolved ${ex.type.replace(/_/g, " ").toLowerCase()} exception`, before: { status: "OPEN" }, after: { status: "RESOLVED", resolution: text },
    });
  });
}

// ---------------------------------------------------------------------------
// Supervisor override of an automatic result (2.7). Admin holds this power for now.
// ---------------------------------------------------------------------------

export interface OverrideInput {
  loanId: string;
  classification: "FINANCING" | "REFINANCING";
  financingType: "UNDERTAKING" | "NON_UNDERTAKING" | null;
  orcrStatus: "TRANSFERRED" | "UNTRANSFERRED" | null;
  mortgage: "MORTGAGE" | "NOT_MORTGAGE" | null;
  reason: string;
}

export async function overrideAutomaticResult(user: CurrentUser, input: OverrideInput) {
  if (!can(user, PERMISSIONS.RULES_OVERRIDE)) throw new UserError("Only a Supervisor can override an automatic result.");
  const reason = input.reason.trim();
  if (reason.length < 10) throw new UserError("Enter the reason for the override (at least 10 characters).", "reason");
  const loan = await prisma.loan.findUnique({ where: { id: input.loanId } });
  if (!loan || !inScope(user, loan.branchId)) throw new NotInScopeError();

  let financingType = null as OverrideInput["financingType"];
  let orcrStatus = null as OverrideInput["orcrStatus"];
  let mortgage: "MORTGAGE" | "NOT_MORTGAGE" | "NOT_EVALUATED";
  if (input.classification === "FINANCING") {
    if (!input.financingType) throw new UserError("Financing: pick Undertaking or Non-Undertaking.", "financingType");
    if (!input.orcrStatus) throw new UserError("Financing: pick ORCR Transferred or Untransferred.", "orcrStatus");
    financingType = input.financingType;
    orcrStatus = input.orcrStatus;
  }
  if (input.classification === "FINANCING" && orcrStatus === "UNTRANSFERRED") mortgage = "NOT_EVALUATED";
  else {
    if (!input.mortgage) throw new UserError("Pick the Mortgage result.", "mortgage");
    mortgage = input.mortgage;
  }
  const target = transactionsFor(mortgage);

  await withLoanLock(loan.id, async (tx) => {
    // Only the built-in transactions (created by the rules) are re-decided; custom ones added by the LA stay.
    const live = (await tx.loanTransaction.findMany({ where: { loanId: loan.id, status: { not: "CANCELLED" } }, include: { type: true } })).filter((t) => t.type.builtIn);
    const liveCodes = live.map((t) => t.type.code as TransactionCode);
    const toCancel = live.filter((t) => !target.includes(t.type.code as TransactionCode));
    const toAdd = target.filter((c) => !liveCodes.includes(c));
    const busy = toCancel.filter((t) => !["FOR_CHECKLIST", "READY", "RETURNED"].includes(t.status));
    if (busy.length) {
      throw new UserError(
        `${busy.map((t) => t.type.name).join(", ")} is already in process and cannot be removed by an override. Transactions in process are never changed silently.`,
      );
    }
    const now = new Date();
    for (const t of toCancel) {
      await tx.loanTransaction.update({ where: { id: t.id }, data: { status: "CANCELLED", statusSince: now, cancelledAt: now, cancelReason: `Supervisor override: ${reason}` } });
    }
    if (toAdd.length) await createTransactions(tx, { loanId: loan.id, pn: loan.pn, codes: toAdd, origin: "OVERRIDE" });
    const before = { classification: loan.classification, financingType: loan.financingType, orcrStatus: loan.orcrStatus, mortgageResult: loan.mortgageResult, transactions: TRANSACTION_ORDER.filter((c) => liveCodes.includes(c)) };
    const after = { classification: input.classification, financingType, orcrStatus, mortgageResult: mortgage, transactions: target };
    await tx.loan.update({
      where: { id: loan.id },
      data: { classification: input.classification, financingType, orcrStatus, mortgageResult: mortgage, overridden: true, ruleFired: `Supervisor override by ${user.name}: ${reason}` },
    });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "automatic_result_overridden", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn: loan.pn,
      journeyStep: "2.7",
      summary: `Supervisor override: ${toCancel.length ? `cancelled ${toCancel.map((t) => t.type.name).join(", ")}` : "no transactions cancelled"}${toAdd.length ? `; added ${toAdd.map((c) => TRANSACTION_LABEL[c]).join(", ")}` : ""}`,
      before, after, details: { reason },
    });
    await notify(tx, {
      userIds: await branchLaUserIds(tx, loan.branchId),
      loanId: loan.id,
      title: `${loan.pn}: automatic result overridden`,
      body: `${user.name} changed the classification/transactions. Reason: ${reason}`,
      link: `/loans/${loan.pn}`,
    });
    await recomputeStage(tx, loan.id);
  });
}

// ---------------------------------------------------------------------------
// Report a problem (LA). Same pattern as the other exceptions: audited, Supervisor told.
// "Missing paper" for a transaction uses requestMissingDocuments (Legal Docs Completion).
// ---------------------------------------------------------------------------

export async function reportProblem(user: CurrentUser, input: { loanId: string; kind: "MISSING_PAPER" | "WRONG_DETAILS" | "OTHER"; details: string }) {
  requireAllowed(user, PERMISSIONS.CHECKLIST_TICK);
  const text = input.details.trim();
  if (text.length < 5) throw new UserError("Describe the problem in a few words.", "details");
  if (text.length > 1000) throw new UserError("Keep the description under 1,000 characters.", "details");
  if (!["MISSING_PAPER", "WRONG_DETAILS", "OTHER"].includes(input.kind)) throw new UserError("Pick what kind of problem it is.", "kind");
  const loan = await prisma.loan.findUnique({ where: { id: input.loanId } });
  if (!loan || !inScope(user, loan.branchId)) throw new NotInScopeError();
  const label = input.kind === "MISSING_PAPER" ? "Missing paper" : input.kind === "WRONG_DETAILS" ? "Wrong details" : "Something else";
  await withLoanLock(loan.id, async (tx) => {
    const ex = await tx.loanException.create({
      data: { loanId: loan.id, type: input.kind === "MISSING_PAPER" ? "MISSING_PAPER" : input.kind === "WRONG_DETAILS" ? "WRONG_DETAILS" : "OTHER_PROBLEM", reason: `${label}: ${text}`, raisedById: user.id, raisedByLabel: user.name },
    });
    await writeAudit(tx, {
      actor: actorOf(user), mode: "MANUAL", action: "exception_raised", entityType: "LoanException", entityId: ex.id, loanId: loan.id, pn: loan.pn,
      summary: `Reported a problem (${label.toLowerCase()})`, details: { kind: input.kind, text },
    });
    await notify(tx, {
      userIds: await supervisorUserIds(tx), loanId: loan.id,
      title: `${loan.pn}: problem reported`, body: `${user.name} reported: ${label}. ${text}`, link: `/loans/${loan.pn}`,
      email: { event: input.kind === "MISSING_PAPER" ? "missing_paper" : "problem_changed", vars: { pn: loan.pn, transaction: "the loan file", who: user.name, status: "reported", reason: `${label}: ${text}` } },
    });
  });
}
