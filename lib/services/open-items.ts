import "server-only";
import { Prisma, type Loan } from "@prisma/client";
import { z } from "zod";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { can, inScope, scopeIds, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { andWhere, holdsWhere } from "@/lib/auth/holders";
import { getClassificationRules, getSetting } from "@/lib/settings";
import { businessDate, startOfBusinessDay } from "@/lib/time";
import { loadCalendar } from "@/lib/calendar/load";
import { daysFor, workingDaysBetween } from "@/lib/calendar/core";
import { MINOR_ACCOUNT_COLUMNS } from "@/lib/myloans/account";
import { proposeEffect, type FieldChange, type Proposed, type Tracked } from "@/lib/myloans/changes";
import { classifyProductName, type FinancingType, type OrcrStatus } from "@/lib/rules";
import {
  OI_FIELDS, dmsValue, myloansValue, referenceOf, splitChanges, statusOutcome, waitingTone, STATUS_WORDS,
  type DmsLoan, type FeedStateWord, type OpenItemField,
} from "@/lib/open-items/fields";
import { recheckClassifications } from "./classification";
import { resolveLoanBranch } from "./branches";
import { recomputeStage } from "./stage";
import { closeLoanEnded, outstandingCash, recordFromPayload, txnsNow, applyTransactionChanges } from "./source-sync";
import { recordReferenceChange } from "./reference-changes";
import { closeItem } from "./work-items";
import { getMyLoansAdapter } from "@/lib/myloans";
import { lookupPn } from "@/lib/myloans/client";
import { detectChanges, hashTracked, trackedOfSaved, trackedOfSent } from "@/lib/myloans/changes";
import type { MyLoansLookup } from "@/lib/myloans/types";
import { UserError, NotInScopeError } from "./errors";

/**
 * Piece 8 (D-004, D-010 to D-013, D-053): Open Items. A myloans change to a loan or borrower field waits here, one
 * item per field, until an approver of the loan's branch approves (the DMS takes the myloans value) or rejects it
 * (the DMS keeps its value). Nothing is applied before. A newer myloans value supersedes a pending item; myloans
 * putting the DMS value back closes it as "Reverted in myloans". Renames (area, division, company, branch and
 * product names) are lookup data: applied by themselves and logged in Reference data changes, never an item.
 */

type Mode = "MANUAL" | "AUTOMATIC" | "SIMULATED";
export const REMARKS_MIN = 5;
export const REMARKS_MAX = 500;
export const REVERTED_TEXT = "Reverted in myloans";

/** The tick that decides an item of this audience. */
export const deciderKey = (audience: string): Permission => (audience === "BORROWER" ? PERMISSIONS.SOURCE_REVIEW_BORROWER : PERMISSIONS.SOURCE_REVIEW);
export const mayDecide = (u: CurrentUser, item: { audience: string; branchId: string }) => can(u, deciderKey(item.audience)) && inScope(u, item.branchId);

export function dmsLoanOf(l: Pick<Loan, "borrowerName" | "cif" | "cin" | "loanType" | "totalReleasedAmount" | "productCode" | "productName" | "releasedAt" | "sourceBranchCode" | "sourceBranchName" | "sourceLoanId" | "cancelledAt"> & { sourceHold?: string | null }): DmsLoan {
  return {
    borrowerName: l.borrowerName, cif: l.cif, cin: l.cin, loanType: l.loanType, totalReleasedAmount: l.totalReleasedAmount, productCode: l.productCode, productName: l.productName,
    releasedYmd: l.releasedAt ? businessDate(l.releasedAt) : null, sourceBranchCode: l.sourceBranchCode, sourceBranchName: l.sourceBranchName, sourceLoanId: l.sourceLoanId, cancelledAt: l.cancelledAt, sourceHold: l.sourceHold ?? null,
  };
}

/** The next OI-YYYY-###### (the sequence restarts each Manila year). */
async function nextNumber(tx: Tx, now: Date): Promise<string> {
  const year = Number(businessDate(now).slice(0, 4));
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "OpenItemCounter" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year") DO UPDATE SET "last" = "OpenItemCounter"."last" + 1 RETURNING "last"`;
  return `OI-${year}-${String(rows[0].last).padStart(6, "0")}`;
}

/** Approvers for a branch and audience; none at branch level: the Superadmin and the All-branches approvers (Unassigned). */
export async function approverIds(db: Tx | typeof prisma, branchId: string, audience: string): Promise<{ ids: string[]; unassigned: boolean }> {
  const key = deciderKey(audience);
  const local = await db.user.findMany({ where: andWhere({ allBranches: false, branches: { some: { branchId } } }, holdsWhere(key)), select: { id: true } });
  if (local.length) {
    const all = await db.user.findMany({ where: andWhere({ allBranches: true }, holdsWhere(key)), select: { id: true } });
    return { ids: [...local, ...all].map((u) => u.id), unassigned: false };
  }
  const wide = await db.user.findMany({ where: { OR: [andWhere({ allBranches: true }, holdsWhere(key)), holdsWhere(PERMISSIONS.ROLES_MANAGE)] }, select: { id: true } });
  return { ids: wide.map((u) => u.id), unassigned: true };
}

/** The people holding the loan's open work now (piece 9: the current holder). */
async function holderIds(db: Tx | typeof prisma, loanId: string): Promise<string[]> {
  const txns = await db.loanTransaction.findMany({ where: { loanId }, select: { id: true } });
  const rows = await db.workItem.findMany({ where: { state: { in: ["INBOX", "HELD"] }, holderUserId: { not: null }, subjectId: { in: [loanId, ...txns.map((t) => t.id)] } }, select: { holderUserId: true } });
  return rows.map((r) => r.holderUserId!);
}

// ---------------------------------------------------------------------------
// Raising (from refreshLoan: Refresh, open, Find loan, the sync, the simulator)
// ---------------------------------------------------------------------------

export interface RaiseInput {
  loan: Loan; previous: Tracked | null; current: Tracked; changes: FieldChange[]; now: Date; mode: Mode;
  replacedByPn?: string | null; syncRunId?: string | null; sourceUpdatedAt?: Date | null; source: string;
}
export interface RaiseResult { raised: number; superseded: number; reverted: number; lookup: number }

/** Lookup data: applied by itself (the loan's copy) and each rename logged once in Reference data changes. */
async function applyLookup(tx: Tx, a: RaiseInput, lookup: FieldChange[]) {
  if (!lookup.length) return;
  const data: Prisma.LoanUpdateInput = {};
  for (const c of lookup) {
    const v = c.now === null ? null : String(c.now);
    if (c.field in MINOR_ACCOUNT_COLUMNS) data[MINOR_ACCOUNT_COLUMNS[c.field as keyof typeof MINOR_ACCOUNT_COLUMNS]] = v;
    if (c.field === "branchName") data.sourceBranchName = v;
    if (c.field === "productName" && v) data.productName = v;
  }
  if (Object.keys(data).length) await tx.loan.update({ where: { id: a.loan.id }, data });
  for (const c of lookup) {
    const ref = referenceOf(c, a.current);
    if (ref) await recordReferenceChange(tx, { ...ref, oldValue: c.was === null ? null : String(c.was), newValue: c.now === null ? null : String(c.now), source: a.source, at: a.now });
  }
  // A product renamed: its classification may move (flagged "Classification changed since accepted", never applied).
  if (lookup.some((c) => c.field === "productName")) await recheckClassifications(tx);
  await writeAudit(tx, {
    actor: SYSTEM_ACTOR, mode: a.mode === "SIMULATED" ? "SIMULATED" : "AUTOMATIC", action: "reference_data_updated", entityType: "Loan", entityId: a.loan.id, loanId: a.loan.id, pn: a.loan.pn,
    summary: `myloans renamed ${lookup.map((c) => c.label.toLowerCase()).join(", ")}: updated by itself (reference data, D-053)`, details: { changes: lookup },
  });
}

export async function raiseOpenItems(tx: Tx, a: RaiseInput): Promise<RaiseResult> {
  const out: RaiseResult = { raised: 0, superseded: 0, reverted: 0, lookup: 0 };
  const split = splitChanges(a.changes);
  await applyLookup(tx, a, split.lookup);
  out.lookup = split.lookup.length;
  const monitored = new Set<string>([...(await getSetting("openItems.monitoredFields", tx)), "status"]);
  const fields = split.fields.filter((f) => monitored.has(f));
  if (!fields.length) return out;
  const loan = await tx.loan.findUniqueOrThrow({ where: { id: a.loan.id } });
  const dms = dmsLoanOf(loan);
  const told: string[] = [];
  for (const f of fields) {
    const my = myloansValue(f, a.current, { replacedByPn: a.replacedByPn });
    const was = dmsValue(f, dms);
    const pending = await tx.openItem.findFirst({ where: { loanId: loan.id, field: f, status: "PENDING" } });
    const def = OI_FIELDS[f];
    if (f === "status" && loan.sourceHold && my.key === "Released") {
      // D-053: on hold (not released / inactive) and now released again: the hold ends by itself.
      await tx.loan.update({ where: { id: loan.id }, data: { sourceHold: null, sourceHoldSince: null } });
      await writeAudit(tx, { actor: SYSTEM_ACTOR, mode: a.mode, action: "loan_hold_reverted", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn: loan.pn, summary: `${REVERTED_TEXT}: released again. The hold ended by itself; Send, Forward and new cash work again.` });
      const who = await approverIds(tx, loan.branchId, "LOAN");
      await notify(tx, { userIds: [...who.ids, ...(await holderIds(tx, loan.id))], loanId: loan.id, title: `${loan.pn}: released again in myloans`, body: `${REVERTED_TEXT}. The hold ended by itself.`, link: `/loans/${loan.pn}` });
      out.reverted++;
      if (pending) await tx.openItem.update({ where: { id: pending.id }, data: { status: "REVERTED", decidedAt: a.now, decidedByLabel: "myloans", remarks: REVERTED_TEXT } });
      continue;
    }
    if (my.key === was.key) {
      // myloans has the DMS value again: nothing to decide (D-053).
      if (pending) {
        await tx.openItem.update({ where: { id: pending.id }, data: { status: "REVERTED", decidedAt: a.now, decidedByLabel: "myloans", remarks: REVERTED_TEXT } });
        await writeAudit(tx, { actor: SYSTEM_ACTOR, mode: a.mode, action: "open_item_reverted", entityType: "OpenItem", entityId: pending.id, loanId: loan.id, pn: loan.pn, summary: `${pending.number} ${def.label}: ${REVERTED_TEXT} (back to ${was.text ?? "blank"}); closed by itself` });
        const who = await approverIds(tx, loan.branchId, pending.audience);
        await notify(tx, { userIds: who.ids, loanId: loan.id, title: `${loan.pn}: ${pending.number} closed`, body: `${def.label}: ${REVERTED_TEXT}. Nothing to decide.`, link: `/open-items?tab=decided&pn=${loan.pn}` });
        out.reverted++;
      }
      continue;
    }
    if (pending && JSON.stringify(pending.newRaw) === JSON.stringify(my.raw)) continue; // the same value again
    const number = await nextNumber(tx, a.now);
    // A newer value while pending: the old item is superseded first (one pending per field), then linked (D-053; Q-N10).
    if (pending) await tx.openItem.update({ where: { id: pending.id }, data: { status: "SUPERSEDED", decidedAt: a.now, decidedByLabel: "myloans", remarks: `Superseded by ${number}` } });
    const item = await tx.openItem.create({
      data: {
        number, loanId: loan.id, branchId: loan.branchId, field: f, fieldLabel: def.label, groupKey: def.group ?? null, audience: def.audience,
        oldValue: was.text, newValue: my.text, oldRaw: was.raw as Prisma.InputJsonValue, newRaw: my.raw as Prisma.InputJsonValue,
        sourceUpdatedAt: a.sourceUpdatedAt ?? null, syncRunId: a.syncRunId ?? null, raisedAt: a.now, simulated: a.mode === "SIMULATED",
      },
    });
    if (pending) {
      await tx.openItem.update({ where: { id: pending.id }, data: { supersededById: item.id } });
      out.superseded++;
    }
    await writeAudit(tx, {
      actor: SYSTEM_ACTOR, mode: a.mode, action: "open_item_raised", entityType: "OpenItem", entityId: item.id, loanId: loan.id, pn: loan.pn,
      summary: `${number} raised: myloans changed ${def.label.toLowerCase()}${pending ? ` again (supersedes ${pending.number})` : ""}. An approver decides.`,
      details: { field: f, group: def.group ?? null, ...(f === "amount" ? {} : { was: was.text, now: my.text }) },
    });
    told.push(def.label);
    out.raised++;
  }
  if (told.length) {
    const audiences = [...new Set(fields.map((f) => OI_FIELDS[f].audience))];
    const ids = (await Promise.all(audiences.map((au) => approverIds(tx, loan.branchId, au)))).flatMap((x) => x.ids);
    // Field names only: amounts are never in a notification or an email.
    await notify(tx, {
      userIds: [...ids, ...(await holderIds(tx, loan.id))], loanId: loan.id, title: `${loan.pn}: myloans changed this loan`,
      body: `Open Items for ${told.join(", ").toLowerCase()}. An approver of the branch decides; nothing changes until then.`, link: `/open-items?pn=${loan.pn}`,
      email: { event: "source_changed", vars: { pn: loan.pn, transaction: "the loan file", reason: `myloans changed ${told.join(", ").toLowerCase()}.`, status: fields.includes("status") ? "no longer released" : "changed" } },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The rule group (loan type, amount, product, release date): the effect of the pending values
// ---------------------------------------------------------------------------

async function groupEffect(db: Tx | typeof prisma, loan: Loan, items: { field: string; newRaw: Prisma.JsonValue }[], picks?: { financingType?: FinancingType | null; orcrStatus?: OrcrStatus | null }) {
  const raw = (f: OpenItemField) => items.find((i) => i.field === f)?.newRaw;
  const product = raw("productCode") as { code: string | null; name: string | null } | undefined;
  const amount = raw("amount");
  const next = {
    loanType: (raw("loanType") as string | undefined) ?? loan.loanType,
    productName: product?.name ?? loan.productName,
    productCode: product ? product.code : loan.productCode,
    amount: typeof amount === "number" ? amount : amount !== undefined ? String(amount) : Math.round(Number(loan.totalReleasedAmount) * 100),
    releaseDate: (raw("releaseDate") as string | undefined) ?? null,
  };
  const proposed = proposeEffect({
    category: "MATERIAL", loan: { ...loan, financingType: loan.financingType as FinancingType | null, orcrStatus: loan.orcrStatus as OrcrStatus | null },
    txns: await txnsNow(db, loan.id), next: next as unknown as Tracked, picks, rules: await getClassificationRules(db),
  });
  return { next, proposed };
}

/** For the Open Items page: what approving a loan's rule group would do (nothing saved). */
export async function ruleGroupEffect(loanId: string): Promise<Proposed | null> {
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan) return null;
  const items = await prisma.openItem.findMany({ where: { loanId, groupKey: "rules", status: "PENDING" } });
  return items.length ? (await groupEffect(prisma, loan, items)).proposed : null;
}

// ---------------------------------------------------------------------------
// Decisions: Approve (the DMS takes the myloans value) and Reject (the DMS keeps its value), remarks 5 to 500
// ---------------------------------------------------------------------------

const decideSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"], { message: "Choose Approve or Reject." }),
  remarks: z.string({ message: `Write remarks (${REMARKS_MIN} to ${REMARKS_MAX} characters).` }).trim()
    .min(REMARKS_MIN, `Write remarks (at least ${REMARKS_MIN} characters).`).max(REMARKS_MAX, `Keep the remarks under ${REMARKS_MAX} characters.`),
  financingType: z.enum(["UNDERTAKING", "NON_UNDERTAKING"]).nullish(),
  orcrStatus: z.enum(["TRANSFERRED", "UNTRANSFERRED"]).nullish(),
});
export type DecideInput = z.input<typeof decideSchema>;
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export async function decideOpenItem(u: CurrentUser, id: string, raw: DecideInput): Promise<string> {
  const p = decideSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const d = p.data;
  const first = await prisma.openItem.findUnique({ where: { id }, select: { loanId: true, branchId: true, audience: true, field: true, newRaw: true } });
  if (!first || !inScope(u, first.branchId)) throw new NotInScopeError();
  if (!can(u, deciderKey(first.audience))) {
    throw new UserError(first.audience === "BORROWER" ? "Only people with \"Review borrower detail corrections\" decide this. Your view is read-only." : "Only approvers decide Open Items. Your view is read-only. Ask a Superadmin for the approver tick if you should decide these.");
  }
  // A redo: myloans' answer for the replacement PN, asked before the lock (D-053: the loan file moves to it).
  let replacement: MyLoansLookup | null = null;
  if (d.decision === "APPROVE" && first.field === "status") {
    const raw = (first.newRaw ?? {}) as { state?: FeedStateWord; replacedByPn?: string | null };
    if (raw.state === "Superseded" && raw.replacedByPn) replacement = await lookupPn(getMyLoansAdapter(), raw.replacedByPn, { fresh: true });
  }
  return withLoanLock(first.loanId, async (tx) => {
    const item = await tx.openItem.findUniqueOrThrow({ where: { id } });
    if (item.status !== "PENDING") throw new UserError(item.status === "REVERTED" ? `${item.number} closed by itself: ${REVERTED_TEXT}.` : `${item.number} was already decided.`);
    const loan = await tx.loan.findUniqueOrThrow({ where: { id: item.loanId } });
    // The rule fields are decided together: their effect is one set of transactions.
    const items = item.groupKey === "rules" ? await tx.openItem.findMany({ where: { loanId: loan.id, groupKey: "rules", status: "PENDING" }, orderBy: { raisedAt: "asc" } }) : [item];
    const now = new Date();
    const actor: Actor = { id: u.id, label: u.name };
    let effect = "";
    if (d.decision === "APPROVE") effect = await approve(tx, u, loan, items, d, now, replacement);
    await tx.openItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { status: d.decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedById: u.id, decidedByLabel: u.name, decidedAt: now, remarks: d.remarks } });
    const names = listWords(items.map((i) => i.fieldLabel.toLowerCase()));
    const numbers = items.map((i) => i.number).join(", ");
    const summary = d.decision === "APPROVE"
      ? `${u.name} approved ${numbers} (${names}): the DMS takes the myloans value. ${effect}Remarks: ${d.remarks}`
      : `${u.name} rejected ${numbers} (${names}): the DMS keeps its value. Remarks: ${d.remarks}`;
    for (const i of items) {
      await writeAudit(tx, { actor, mode: "MANUAL", action: d.decision === "APPROVE" ? "open_item_approved" : "open_item_rejected", entityType: "OpenItem", entityId: i.id, loanId: loan.id, pn: loan.pn, summary, details: { field: i.field, remarks: d.remarks } });
    }
    const pn = (await tx.loan.findUniqueOrThrow({ where: { id: loan.id }, select: { pn: true } })).pn; // a redo moves it to the new PN
    await notify(tx, { userIds: (await holderIds(tx, loan.id)).filter((x) => x !== u.id), loanId: loan.id, title: `${pn}: ${numbers} ${d.decision === "APPROVE" ? "approved" : "rejected"}`, body: summary, link: `/loans/${pn}` });
    return d.decision === "APPROVE" ? `Approved ${numbers}.${effect ? ` ${effect}` : ""}` : `Rejected ${numbers}: the DMS keeps its value.`;
  });
}

async function approve(tx: Tx, u: CurrentUser, loan: Loan, items: { field: string; newRaw: Prisma.JsonValue; newValue: string | null }[], d: z.infer<typeof decideSchema>, now: Date, replacement: MyLoansLookup | null): Promise<string> {
  const f = items[0].field as OpenItemField;
  if (OI_FIELDS[f].group === "rules") {
    const { next, proposed } = await groupEffect(tx, loan, items, { financingType: d.financingType ?? null, orcrStatus: d.orcrStatus ?? null });
    if (proposed.needsPicks) throw new UserError("Pick Undertaking or Non-Undertaking and the ORCR status to approve it (the product now means Financing).", "financingType");
    if (!proposed.ruleNext) throw new UserError(proposed.sentences[0] ?? "The rules cannot run on the new values. Reject it instead.");
    const locked = proposed.affected.filter((x) => x.locked);
    if (locked.length) throw new UserError(`${listWords(locked.map((x) => x.stateLine))}. Approving never changes work that was sent. Ask the LA to pull it back or the processor to return it, or reject it.`);
    const data: Prisma.LoanUpdateInput = {
      loanType: next.loanType, productName: next.productName, productCode: next.productCode,
      totalReleasedAmount: typeof next.amount === "number" ? new Prisma.Decimal(next.amount / 100) : loan.totalReleasedAmount,
      classification: proposed.classificationNext!, mortgageResult: proposed.mortgageNext as never, ruleFired: proposed.ruleNext,
      classifiedByDefault: classifyProductName(next.productName ?? "", await getClassificationRules(tx)).byDefault, classificationNow: null,
      financingType: proposed.classificationNext === "FINANCING" ? (d.financingType ?? loan.financingType) : null,
      orcrStatus: proposed.classificationNext === "FINANCING" ? (d.orcrStatus ?? loan.orcrStatus) : null,
    };
    if (next.releaseDate && next.releaseDate !== businessDate(loan.releasedAt)) data.releasedAt = startOfBusinessDay(next.releaseDate);
    await tx.loan.update({ where: { id: loan.id }, data });
    await applyTransactionChanges(tx, loan.id, proposed, now);
    await recomputeStage(tx, loan.id);
    return `${proposed.sentences.join(" ")} `;
  }
  if (f === "status") {
    const raw = (items[0].newRaw ?? {}) as { state?: FeedStateWord; replacedByPn?: string | null };
    const outcome = statusOutcome(raw.state ?? "NotReleased", raw.replacedByPn ?? null);
    if (outcome.kind === "relink") return relink(tx, u, loan, raw.replacedByPn ?? null, replacement, d.remarks, now);
    if (outcome.kind === "hold") {
      // D-053: not closed; blocked until myloans shows it released again (then it continues by itself).
      await tx.loan.update({ where: { id: loan.id }, data: { sourceHold: raw.state ?? "NotReleased", sourceHoldSince: now } });
      return `The loan is on hold: ${STATUS_WORDS[raw.state ?? "NotReleased"].toLowerCase()}. It continues by itself when myloans shows it released. `;
    }
    const cash = await outstandingCash(tx, loan.id);
    if (cash.length) throw new UserError(`Cash is still out: ${cash.map((c) => `${c.number} (${c.dp.name}${c.notReleased ? ", not released yet" : ""})`).join(", ")}. Ask for the cash back (or deny the request) before approving.`);
    const reason = raw.replacedByPn || loan.replacedByPn ? `Replaced by ${raw.replacedByPn ?? loan.replacedByPn}` : raw.state === "Cancelled" || !raw.state ? "Cancelled in MyLoans" : STATUS_WORDS[raw.state];
    await closeLoanEnded(tx, { id: u.id, label: u.name }, loan, reason, d.remarks, now);
    return `The loan is closed: ${reason}. `;
  }
  const v = items[0].newRaw;
  if (f === "branchCode") {
    const b = (v ?? {}) as { code: string | null; name: string | null };
    const br = await resolveLoanBranch(tx, { branchCode: b.code, branchName: b.name });
    if (!br) throw new UserError(`myloans moved the loan to ${b.name ?? "a branch"}${b.code ? ` (${b.code})` : ""}, which is not a branch here. Accept it in Settings, Branches (Branch review) first, or reject it.`);
    await tx.loan.update({ where: { id: loan.id }, data: { sourceBranchCode: b.code, sourceBranchName: b.name, ...(br.id !== loan.branchId ? { branch: { connect: { id: br.id } } } : {}) } });
    // The loan's other pending items follow it to the new branch (its approvers decide them now).
    if (br.id !== loan.branchId) await tx.openItem.updateMany({ where: { loanId: loan.id, status: "PENDING" }, data: { branchId: br.id } });
    return br.id !== loan.branchId ? `The loan's branch is now ${br.name}. ` : "";
  }
  const text = v === null || v === undefined ? null : String(v);
  if (f === "borrowerName") {
    if (!text) throw new UserError("myloans has no borrower name now. Reject it, or ask the myloans team to complete it.");
    await tx.loan.update({ where: { id: loan.id }, data: { borrowerName: text } });
  } else if (f === "cif" || f === "cin" || f === "sourceLoanId") {
    await tx.loan.update({ where: { id: loan.id }, data: { [f]: text } });
  }
  return "";
}

/**
 * D-053: a redo in myloans (the same CIN, a new PN): Approve moves the SAME loan file to the replacement. The new PN #
 * and ExternalLoanId; the old ones stay in its history (its identities and the audit). Papers, jobs and work items
 * stay with the loan file. myloans' new copy becomes the baseline; a field it changed is its own Open Item.
 */
async function relink(tx: Tx, u: CurrentUser, loan: Loan, newPn: string | null, answer: MyLoansLookup | null, remarks: string, now: Date): Promise<string> {
  if (!newPn) throw new UserError("myloans has not named the replacement PN yet. Wait for the next sync, or link it from Related loans if you are sure.");
  // The unclear case (D-053): both loan files exist and a person linked them on Related loans. Approve closes the
  // old one as replaced (cash must be back or moved first), as before.
  if (loan.replacedByPn === newPn) {
    const cash = await outstandingCash(tx, loan.id);
    if (cash.length) throw new UserError(`Cash is still out: ${cash.map((c) => `${c.number} (${c.dp.name}${c.notReleased ? ", not released yet" : ""})`).join(", ")}. Ask for the cash back or move it to ${newPn} before approving.`);
    await closeLoanEnded(tx, { id: u.id, label: u.name }, loan, `Replaced by ${newPn}`, remarks, now);
    return `The loan is closed: replaced by ${newPn} (linked on Related loans). `;
  }
  if (!answer || !answer.ok) throw new UserError(`myloans does not show ${newPn} as a released loan now${answer && !answer.ok ? ` (${answer.message.replace(/\.$/, "")})` : ""}. Try again after the next sync.`);
  const rec = answer.record;
  const taken = await tx.loan.findUnique({ where: { pn: newPn }, select: { id: true } });
  if (taken && taken.id !== loan.id) throw new UserError(`${newPn} is already a loan file here. Link the two from Related loans instead.`);
  if (rec.externalLoanId && (await tx.loan.findFirst({ where: { externalLoanId: rec.externalLoanId, id: { not: loan.id } }, select: { id: true } }))) throw new UserError(`${newPn} is already a loan file here. Link the two from Related loans instead.`);
  const prev = await tx.loanSourceSnapshot.findFirst({ where: { loanId: loan.id }, orderBy: { retrievedAt: "desc" } });
  const prevRecord = prev ? recordFromPayload(prev.payload) : null;
  const previous = (prev?.tracked as Tracked | null) ?? (prevRecord ? trackedOfSaved(prevRecord) : null);
  const current = trackedOfSent(rec);
  const det = detectChanges(previous, current);
  const oldPn = loan.pn;
  await tx.loan.update({
    where: { id: loan.id },
    data: {
      pn: newPn, externalLoanId: rec.externalLoanId ?? null, contentHash: rec.contentHash ?? null, retrievedAt: answer.retrievedAt, lastCheckedAt: now, sourceCurrent: true,
      sourceIdentities: { create: { externalLoanId: rec.externalLoanId ?? 0, cin: rec.cin, pnNo: newPn, contentHash: rec.contentHash ?? null, feedState: rec.feedState ?? null } },
    },
  });
  await tx.workItem.updateMany({ where: { loanId: loan.id }, data: { pn: newPn } });
  await tx.loanSourceSnapshot.create({ data: { loanId: loan.id, retrievedAt: answer.retrievedAt, adapter: answer.adapter, payload: answer.raw as Prisma.InputJsonValue, tracked: current as unknown as Prisma.InputJsonValue, hash: hashTracked(current), kind: "BASE" } });
  // The new PN was waiting in the branch pool as "Released, not yet in the DMS" (10b): it is this loan file now.
  await tx.sourceLoanCandidate.deleteMany({ where: { pn: newPn } });
  if (await tx.workItem.findFirst({ where: { kind: "LOAN_CANDIDATE", subjectId: newPn, state: { not: "DONE" } } })) await closeItem(tx, "LOAN_CANDIDATE", newPn, "DONE", { at: now, by: { id: u.id, label: u.name }, reason: `Became ${oldPn} (a redo in myloans)` });
  await writeAudit(tx, {
    actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "loan_relinked", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn: newPn,
    summary: `${u.name} moved the loan file from PN ${oldPn} to PN ${newPn} (redone in myloans). Papers, jobs and work stay with it. Remarks: ${remarks}`,
    before: { pn: oldPn, externalLoanId: loan.externalLoanId }, after: { pn: newPn, externalLoanId: rec.externalLoanId ?? null },
  });
  // Fields the new copy changed (other than the status): their own Open Items, as for any change.
  const changes = det.changes.filter((c) => !["status", "statusId", "statusName", "isActive"].includes(c.field));
  if (changes.length) {
    const fresh = await tx.loan.findUniqueOrThrow({ where: { id: loan.id } });
    await raiseOpenItems(tx, { loan: fresh, previous, current, changes, now, mode: "AUTOMATIC", source: "myloans API 1" });
  }
  return `The loan file is now PN ${newPn} (was ${oldPn}). `;
}

// ---------------------------------------------------------------------------
// Queues (D-010, D-011): Mine, Unassigned, Decided; oldest first, waiting time in working days (D-053)
// ---------------------------------------------------------------------------

export type Tab = "mine" | "unassigned" | "decided";
export interface Filter { branchId?: string; field?: string; pn?: string }

/** Branches with at least one branch-level approver (All-branches approvers do not count: they see Unassigned). */
async function coveredBranches(audience: string): Promise<Set<string>> {
  const rows = await prisma.userBranch.findMany({ where: { user: andWhere({ allBranches: false }, holdsWhere(deciderKey(audience))) }, select: { branchId: true } });
  return new Set(rows.map((r) => r.branchId));
}
export const seesUnassigned = (u: CurrentUser) => can(u, PERMISSIONS.ROLES_MANAGE) || (scopeIds(u) === null && (can(u, PERMISSIONS.SOURCE_REVIEW) || can(u, PERMISSIONS.SOURCE_REVIEW_BORROWER)));

export async function openItemsFor(u: CurrentUser, tab: Tab, f: Filter = {}, now: Date = new Date()) {
  const where: Prisma.OpenItemWhereInput = {
    ...(f.branchId ? { branchId: f.branchId } : {}), ...(f.field ? { field: f.field } : {}), ...(f.pn ? { loan: { pn: f.pn.trim().toUpperCase() } } : {}),
    ...(() => { const ids = scopeIds(u); return ids === null ? {} : { branchId: f.branchId && ids.includes(f.branchId) ? f.branchId : { in: ids } }; })(),
  };
  let rows;
  if (tab === "decided") {
    rows = await prisma.openItem.findMany({ where: { ...where, status: { not: "PENDING" } }, include: { loan: { select: { pn: true, borrowerName: true } } }, orderBy: { decidedAt: "desc" }, take: 100 });
  } else {
    const all = await prisma.openItem.findMany({ where: { ...where, status: "PENDING" }, include: { loan: { select: { pn: true, borrowerName: true } } }, orderBy: { raisedAt: "asc" }, take: 500 });
    const [loanCov, borCov] = await Promise.all([coveredBranches("LOAN"), coveredBranches("BORROWER")]);
    const unassigned = (i: { audience: string; branchId: string }) => !(i.audience === "BORROWER" ? borCov : loanCov).has(i.branchId);
    rows = tab === "unassigned" ? (seesUnassigned(u) ? all.filter(unassigned) : []) : all.filter((i) => can(u, deciderKey(i.audience)));
  }
  const cal = await loadCalendar();
  const t = await colours();
  const today = businessDate(now);
  const branches = new Map((await prisma.branch.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.branchId))] } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));
  return rows.map((r) => {
    const days = Math.max(0, workingDaysBetween(businessDate(r.raisedAt), today, daysFor(cal, r.branchId)));
    return { ...r, branchName: branches.get(r.branchId) ?? "", waitingDays: days, tone: waitingTone(days, t), canDecide: r.status === "PENDING" && mayDecide(u, r) };
  });
}

export async function colours() {
  const [amberDays, redDays] = await Promise.all([getSetting("pool.amberAfterDays"), getSetting("pool.redAfterDays")]);
  return { amberDays, redDays };
}

/** Home (approvers): how many wait, and how many waited too long (red). */
export async function openItemCounts(u: CurrentUser, now: Date = new Date()) {
  if (!can(u, PERMISSIONS.SOURCE_REVIEW) && !can(u, PERMISSIONS.SOURCE_REVIEW_BORROWER)) return null;
  const rows = await openItemsFor(u, "mine", {}, now);
  const un = seesUnassigned(u) ? (await openItemsFor(u, "unassigned", {}, now)).length : 0;
  return { waiting: rows.length, tooLong: rows.filter((r) => r.tone === "bad").length, unassigned: un };
}

/** The menu badge: pending items the person decides (their branches, their ticks). One count query per tick. */
export async function pendingOpenItemCount(u: CurrentUser): Promise<number> {
  const ids = scopeIds(u);
  const scope: Prisma.OpenItemWhereInput = ids === null ? {} : { branchId: { in: ids } };
  const audiences = [...(can(u, PERMISSIONS.SOURCE_REVIEW) ? ["LOAN"] : []), ...(can(u, PERMISSIONS.SOURCE_REVIEW_BORROWER) ? ["BORROWER"] : [])];
  if (!audiences.length) return 0;
  return prisma.openItem.count({ where: { ...scope, status: "PENDING", audience: { in: audiences } } });
}

/** The loan file: its pending items (everyone who sees the loan sees that they exist). */
export async function loanOpenItems(loanId: string) {
  return prisma.openItem.findMany({ where: { loanId, status: "PENDING" }, orderBy: { raisedAt: "asc" }, select: { id: true, number: true, field: true, fieldLabel: true, raisedAt: true, audience: true } });
}

export { outstandingCash };

// ---------------------------------------------------------------------------
// Branches with no approver of their own (D-029): a warning on Settings, Branches and on the Superadmin's Home, so
// it gets fixed. Approvers with "All branches" do not count here (they see these items under Unassigned).
// ---------------------------------------------------------------------------

export async function branchesWithoutApprover(db: Tx | typeof prisma = prisma): Promise<{ id: string; name: string; code: string | null }[]> {
  const approvers = await db.user.findMany({ where: andWhere({ allBranches: false }, holdsWhere(PERMISSIONS.SOURCE_REVIEW)), select: { branches: { select: { branchId: true } } } });
  const covered = new Set(approvers.flatMap((a) => a.branches.map((b) => b.branchId)));
  const branches = await db.branch.findMany({ where: { active: true, hidden: false }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } });
  return branches.filter((b) => !covered.has(b.id));
}

/** "2 active branches have no approver assigned." (empty at 0: the line is hidden). */
export function noApproverText(n: number): string {
  if (n <= 0) return "";
  return `${n} active branch${n === 1 ? " has" : "es have"} no approver assigned.`;
}
