import "server-only";
import { OPEN_ADVANCE } from "@/lib/funds/rules";
import { z } from "zod";
import { ltoEstimate } from "@/lib/ui/lto";
import { prisma, type Tx } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHolidaySet, getSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import {
  EXPENSE_KINDS, EXPENSE_LABEL, advanceBalance, bandFor, decimalToCents, isOverdue, liquidationDue, liquidationStatus, peso, type ExpenseKindKey,
} from "@/lib/funds/rules";
import { bandApprovers, fundsApprovers } from "./jobs";
import { cashBlockReason } from "./source-blocks";
import { recomputeStage } from "./stage";
import { UserError } from "./errors";
import { assertFundsNotHeld } from "./locks";

/**
 * Funds: the DP requests one cash advance for several flagged jobs; an approver (per the approval
 * bands) approves; Finance releases; the DP liquidates with receipts and returns the rest. Money in
 * integer centavos. Released amounts, receipts and returns are append-only.
 */

export interface FundsActor { id: string; name: string; roleId?: string }
const actorOf = (u: { id: string; name: string }): Actor => ({ id: u.id, label: u.name });

function need(u: CurrentUser, p: (typeof PERMISSIONS)[keyof typeof PERMISSIONS], msg: string) {
  if (!can(u, p)) throw new UserError(msg);
}

export async function nextNumber(tx: Tx, now: Date) {
  const year = businessDate(now).slice(0, 4);
  const count = await tx.cashAdvance.count({ where: { number: { startsWith: `CA-${year}-` } } });
  return `CA-${year}-${String(count + 1).padStart(4, "0")}`;
}

/** What the DP can ask funds for: accepted jobs flagged "needs funds" without an open request. With prefilled amounts. */
export async function requestableJobs(u: CurrentUser) {
  const jobs = await prisma.dpAssignment.findMany({
    where: { OR: [{ dpUserId: u.id }, { secondaryDpUserId: u.id }], status: "ACCEPTED", transaction: { status: "IN_PROCESS", fundsNeeded: "YES" } },
    include: { transaction: { include: { type: { include: { caRules: { where: { active: true } } } }, advanceLines: { include: { advance: true } } } }, loan: true, ltoOffice: true },
    orderBy: { endorsedAt: "asc" },
  });
  return jobs
    .filter((j) => !j.transaction.advanceLines.some((l) => !l.denied && !["DENIED", "CANCELLED"].includes(l.advance.status)))
    .map((j) => ({
      transactionId: j.transactionId, loanId: j.loanId, loanPn: j.loan.pn, borrower: j.loan.borrowerName, typeName: j.transaction.type.name,
      // Where the processor takes it: the approver judges transport and time from it.
      lto: j.ltoOffice ? { id: j.ltoOffice.id, name: j.ltoOffice.name, estimate: ltoEstimate(j.ltoOffice) } : null,
      kinds: (j.transaction.fundsKinds as ExpenseKindKey[]).map((k) => {
        const rule = j.transaction.type.caRules.find((r) => r.kind === k);
        // Transport: the office's suggested amount first (the DP can change it).
        const fromOffice = k === "TRANSPORT" ? j.ltoOffice?.suggestedTransportCents ?? null : null;
        return {
          kind: k, label: EXPENSE_LABEL[k], suggestedCents: fromOffice ?? decimalToCents(rule?.suggestedAmount ?? null), maxCents: decimalToCents(rule?.maxAmount ?? null),
          suggestedFrom: (fromOffice !== null ? "office" : rule?.suggestedAmount != null ? "rule" : null) as "office" | "rule" | null,
        };
      }),
    }));
}

export const requestSchema = z.object({
  lines: z.array(z.object({
    transactionId: z.string().min(1),
    kind: z.enum(EXPENSE_KINDS),
    cents: z.number().int().positive("Each amount must be above zero."),
    overMaxReason: z.string().trim().max(300).default(""),
  })).default([]),
  others: z.array(z.object({
    kind: z.enum(["TRANSPORT", "OTHER"]),
    cents: z.number().int().positive("Each amount must be above zero."),
    note: z.string().trim().min(3, "Say what the other expense is for.").max(300),
  })).default([]),
}).refine((r) => r.lines.length + r.others.length > 0, { message: "Tick at least one job or add an expense.", path: ["lines"] });

/** The DP submits one advance covering several jobs. */
export async function requestAdvance(u: CurrentUser, raw: unknown, now: Date = new Date()) {
  need(u, PERMISSIONS.FUNDS_REQUEST, "Your role does not allow requesting cash advances.");
  const p = requestSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const d = p.data;
  const allowed = await requestableJobs(u);
  for (const l of d.lines) {
    const job = allowed.find((j) => j.transactionId === l.transactionId);
    if (!job) throw new UserError("One of the jobs cannot be funded now (not yours, not accepted, not flagged, or already requested).");
    const blocked = await cashBlockReason(prisma, job.loanId);
    if (blocked) throw new UserError(`${job.loanPn}: ${blocked}`);
    const k = job.kinds.find((x) => x.kind === l.kind);
    if (k?.maxCents && l.cents > k.maxCents && !l.overMaxReason) {
      throw new UserError(`${job.loanPn} ${job.typeName}: ${EXPENSE_LABEL[l.kind]} is above the maximum of ${peso(k.maxCents)}. Type a reason.`, "overMaxReason");
    }
  }
  const branchId = (await prisma.userBranch.findFirst({ where: { userId: u.id }, orderBy: { branch: { name: "asc" } } }))?.branchId;
  if (!branchId) throw new UserError("You are not assigned to a branch.");

  return prisma.$transaction(async (tx) => {
    // Held transactions: no new cash goes out for them.
    await assertFundsNotHeld(tx, d.lines.map((l) => l.transactionId));
    // Block: an overdue, unliquidated advance stops new requests, unless Finance granted a one-time exception.
    const open = await tx.cashAdvance.findMany({ where: { requestedById: u.id, status: { in: ["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"] } } });
    const overdue = open.find((a) => isOverdue(a, now));
    let exceptionId: string | null = null;
    if (overdue) {
      const ex = await tx.fundsException.findFirst({ where: { dpUserId: u.id, usedBy: null }, orderBy: { grantedAt: "asc" } });
      if (!ex) throw new UserError(`${overdue.number} is overdue and not yet liquidated. Liquidate it first, or ask Finance for an exception.`);
      exceptionId = ex.id;
    }
    const total = [...d.lines, ...d.others].reduce((s, l) => s + l.cents, 0);
    const number = await nextNumber(tx, now);
    const adv = await tx.cashAdvance.create({
      data: {
        number, requestedById: u.id, branchId, requestedCents: total, exceptionId,
        lines: {
          create: [
            // Each job line keeps the office it had when the cash was asked for ("Office changed from X to Y").
            ...d.lines.map((l) => ({ transactionId: l.transactionId, kind: l.kind, requestedCents: l.cents, overMaxReason: l.overMaxReason, ltoOfficeId: allowed.find((j) => j.transactionId === l.transactionId)?.lto?.id ?? null })),
            ...d.others.map((l) => ({ kind: l.kind, requestedCents: l.cents, note: l.note })),
          ],
        },
      },
    });
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "advance_requested", entityType: "CashAdvance", entityId: adv.id, summary: `${number} requested by ${u.name}: ${peso(total)} for ${d.lines.length} job line(s)${d.others.length ? ` and ${d.others.length} other expense(s)` : ""}${exceptionId ? " (with a one-time exception)" : ""}`, after: { total, lines: d.lines, others: d.others } });
    await notify(tx, { email: { event: "advance_requested", to: await bandApprovers(tx, total), amountCents: total, vars: { number, who: u.name } }, userIds: await fundsApprovers(tx), title: `${number}: cash advance to approve`, body: `${u.name} asked for ${peso(total)}.`, link: "/funds?tab=approve" });
    const loanIds = await tx.loanTransaction.findMany({ where: { id: { in: d.lines.map((l) => l.transactionId) } }, select: { loanId: true } });
    for (const l of new Set(loanIds.map((x) => x.loanId))) await recomputeStage(tx, l);
    return { id: adv.id, number, total };
  });
}

/** Can this person approve this amount (approval bands)? Never their own request. */
async function requireApprover(tx: Tx, u: CurrentUser, amountCents: number, requesterId: string) {
  need(u, PERMISSIONS.FUNDS_APPROVE, "Your role does not allow approving cash advances.");
  if (requesterId === u.id) throw new UserError("You cannot approve your own request.");
  const bands = await tx.approvalBand.findMany();
  const band = bandFor(amountCents, bands);
  const me = await tx.user.findUniqueOrThrow({ where: { id: u.id } });
  if (!band || band.roleId !== me.roleId) throw new UserError(`This amount (${peso(amountCents)}) is approved by another role (approval bands).`);
}

const decideSchema = z.object({
  approve: z.boolean(),
  /** Approved amount per line (missing: as requested; 0: that line is rejected). */
  lines: z.array(z.object({ lineId: z.string(), cents: z.number().int().min(0) })).default([]),
  note: z.string().trim().max(500).default(""),
});

/** Approve the full amount or less (less needs a note), or deny with a reason. */
export async function decideAdvance(u: CurrentUser, advanceId: string, raw: unknown) {
  const p = decideSchema.safeParse(raw);
  if (!p.success) throw new UserError(p.error.issues[0].message);
  const d = p.data;
  return prisma.$transaction(async (tx) => {
    const a = await tx.cashAdvance.findUnique({ where: { id: advanceId }, include: { lines: { include: { transaction: { include: { loan: true, type: true } } } }, requestedBy: true } });
    if (!a) throw new UserError("Cash advance not found.");
    if (a.status !== "REQUESTED") throw new UserError("This request was already decided.");
    await requireApprover(tx, u, a.requestedCents, a.requestedById);
    if (d.approve) await assertFundsNotHeld(tx, a.lines.map((l) => l.transactionId)); // denying puts no cash out
    const now = new Date();
    if (!d.approve) {
      if (d.note.length < 3) throw new UserError("Say why it is denied.", "note");
      await tx.cashAdvance.update({ where: { id: a.id }, data: { status: "DENIED", deniedReason: d.note, approvedById: u.id, approvedAt: now } });
      await tx.cashAdvanceLine.updateMany({ where: { advanceId: a.id }, data: { denied: true, approvedCents: 0 } });
      await afterDenied(tx, a.lines, `${a.number} was denied: ${d.note}`);
      await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "advance_denied", entityType: "CashAdvance", entityId: a.id, summary: `${a.number} denied by ${u.name}: ${d.note}` });
      await notify(tx, { email: { event: "advance_decided", vars: { number: a.number, status: "denied", who: u.name, reason: d.note ? `Note: ${d.note}` : "" } }, userIds: [a.requestedById], title: `${a.number} denied`, body: d.note, link: "/my-funds?tab=advances" });
      return;
    }
    let approved = 0;
    const rejected: typeof a.lines = [];
    for (const l of a.lines) {
      const c = d.lines.find((x) => x.lineId === l.id)?.cents ?? l.requestedCents;
      if (c > l.requestedCents) throw new UserError("An approved amount cannot be more than requested.");
      approved += c;
      await tx.cashAdvanceLine.update({ where: { id: l.id }, data: { approvedCents: c, denied: c === 0 } });
      if (c === 0) rejected.push(l);
    }
    if (approved < a.requestedCents && d.note.length < 3) throw new UserError("Approving less needs a short note.", "note");
    if (approved === 0) throw new UserError("Nothing is approved. Deny it instead.");
    await tx.cashAdvance.update({ where: { id: a.id }, data: { status: "APPROVED", approvedCents: approved, approvedById: u.id, approvedAt: now, approvalNote: d.note } });
    if (a.movedFromLineId) {
      await completeMove(tx, a.id, a.movedFromLineId, u, now);
      return;
    }
    if (rejected.length) await afterDenied(tx, rejected, `${a.number}: some lines were not approved. ${d.note}`);
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "advance_approved", entityType: "CashAdvance", entityId: a.id, summary: `${a.number} approved by ${u.name}: ${peso(approved)} of ${peso(a.requestedCents)}${d.note ? ` (${d.note})` : ""}`, after: { approved, lines: d.lines } });
    await notify(tx, { email: { event: "advance_decided", to: [a.requestedById, ...(await financeIds(tx))], vars: { number: a.number, status: "approved", who: u.name, reason: "Finance will release it." } }, userIds: [a.requestedById], title: `${a.number} approved`, body: `${peso(approved)} approved. Finance will release it.`, link: "/my-funds?tab=advances" });
  });
}

/**
 * Move to the new PN, approved: no new cash. The new advance is released for what was approved (same
 * due date as the old one) and the old line shows that amount handed over to it.
 */
async function completeMove(tx: Tx, advanceId: string, fromLineId: string, u: CurrentUser, now: Date) {
  const a = await tx.cashAdvance.findUniqueOrThrow({ where: { id: advanceId }, include: { lines: { include: { transaction: { include: { loan: true } } } } } });
  const from = await tx.cashAdvanceLine.findUniqueOrThrow({ where: { id: fromLineId }, include: { advance: true, transaction: { include: { loan: true } } } });
  const line = a.lines[0];
  const cents = line.approvedCents ?? 0;
  await tx.cashAdvanceLine.update({ where: { id: line.id }, data: { releasedCents: cents } });
  await tx.cashAdvance.update({ where: { id: a.id }, data: { status: "RELEASED", releasedCents: cents, releasedById: u.id, releasedAt: now, releaseRef: `Moved from ${from.advance.number}`, liquidationDueAt: from.advance.liquidationDueAt } });
  await tx.cashReturn.create({ data: { advanceId: from.advanceId, lineId: from.id, cents, date: businessDate(now), recordedById: u.id, kind: "HANDOVER", toLineId: line.id, confirmedById: u.id, confirmedAt: now } });
  await tx.cashAdvance.update({ where: { id: from.advanceId }, data: { note: `${from.advance.note ? `${from.advance.note} ` : ""}${peso(cents)} moved to ${a.number} (${line.transaction?.loan.pn ?? "new PN"}).` } });
  await refreshAdvance(tx, from.advanceId);
  for (const l of [from.transaction?.loan, line.transaction?.loan]) {
    if (!l) continue;
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "cash_moved", entityType: "CashAdvance", entityId: a.id, loanId: l.id, pn: l.pn, summary: `${a.number}: ${u.name} approved moving ${peso(cents)} from ${from.advance.number} (${from.transaction?.loan.pn}) to ${line.transaction?.loan.pn}; no new cash` });
    await recomputeStage(tx, l.id);
  }
  await notify(tx, { userIds: [a.requestedById, ...(await financeIds(tx))], title: `${a.number}: cash moved`, body: `The balance of ${from.advance.number} now belongs to ${line.transaction?.loan.pn}. No new cash.`, link: "/my-funds?tab=advances" });
}

/** Denied lines: the transaction shows "No funds"; the LA and DP resolve or reschedule (No Funds exception). */
async function afterDenied(tx: Tx, lines: { transactionId: string | null; transaction: { loanId: string; loan: { pn: string; branchId: string }; type: { name: string } } | null }[], why: string) {
  for (const l of lines) {
    if (!l.transaction || !l.transactionId) continue;
    await tx.loanException.create({ data: { loanId: l.transaction.loanId, transactionId: l.transactionId, type: "NO_FUNDS", reason: `No funds for ${l.transaction.type.name}. ${why} Resolve or reschedule.`, raisedByLabel: "Finance" } });
    await notify(tx, { userIds: await branchLaUserIds(tx, l.transaction.loan.branchId), loanId: l.transaction.loanId, title: `${l.transaction.loan.pn}: no funds for ${l.transaction.type.name}`, body: why, link: `/loans/${l.transaction.loan.pn}` });
    await recomputeStage(tx, l.transaction.loanId);
  }
}

/** Finance releases the approved money. The jobs become Funded; the DP and LAs are told. */
export async function releaseAdvance(u: CurrentUser, advanceId: string, raw: { ref: string; date?: string }, now: Date = new Date()) {
  need(u, PERMISSIONS.FUNDS_RELEASE, "Your role does not allow releasing funds.");
  const ref = (raw.ref ?? "").trim();
  if (ref.length < 2) throw new UserError("Add a reference note (voucher or transfer number).", "ref");
  return prisma.$transaction(async (tx) => {
    const a = await tx.cashAdvance.findUnique({ where: { id: advanceId }, include: { lines: { include: { transaction: { include: { loan: true, type: true } } } } } });
    if (!a) throw new UserError("Cash advance not found.");
    if (a.status !== "APPROVED") throw new UserError("Only an approved advance can be released.");
    if (a.requestedById === u.id) throw new UserError("You cannot release your own request.");
    await assertFundsNotHeld(tx, a.lines.map((l) => l.transactionId));
    const holidays = await getHolidaySet(tx);
    const dueDays = await getSetting("funds.liquidationDueDays", tx);
    let total = 0;
    for (const l of a.lines) {
      if (l.denied || !l.approvedCents) continue;
      await tx.cashAdvanceLine.update({ where: { id: l.id }, data: { releasedCents: l.approvedCents } });
      total += l.approvedCents;
    }
    await tx.cashAdvance.update({ where: { id: a.id }, data: { status: "RELEASED", releasedCents: total, releasedById: u.id, releasedAt: now, releaseRef: ref, liquidationDueAt: liquidationDue(now, dueDays, holidays) } });
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "advance_released", entityType: "CashAdvance", entityId: a.id, summary: `${a.number} released by ${u.name}: ${peso(total)} (ref ${ref}); jobs Funded`, after: { released: total, ref } });
    const loans = new Map<string, { pn: string; branchId: string }>();
    for (const l of a.lines) if (l.transaction) loans.set(l.transaction.loanId, l.transaction.loan);
    await notify(tx, { email: { event: "advance_released", amountCents: total, vars: { number: a.number, who: u.name } }, userIds: [a.requestedById], title: `${a.number} released`, body: `${peso(total)} released. Liquidate with receipts.`, link: "/my-funds?tab=advances" });
    for (const [loanId, loan] of loans) {
      await notify(tx, { userIds: await branchLaUserIds(tx, loan.branchId), loanId, title: `${loan.pn}: funds released`, body: `${a.number}: the processor has the funds.`, link: `/loans/${loan.pn}` });
      await recomputeStage(tx, loanId);
    }
  });
}

// ---------------------------------------------------------------------------
// Top-ups and carry-overs
// ---------------------------------------------------------------------------

export async function requestTopUp(u: CurrentUser, lineId: string, extraCents: number, reason: string) {
  need(u, PERMISSIONS.FUNDS_REQUEST, "Your role does not allow requesting funds.");
  if (!Number.isInteger(extraCents) || extraCents <= 0) throw new UserError("Enter the extra amount.", "extra");
  if (reason.trim().length < 3) throw new UserError("Say why more is needed.", "reason");
  const line = await prisma.cashAdvanceLine.findUnique({ where: { id: lineId }, include: { advance: true } });
  if (!line || line.advance.requestedById !== u.id) throw new UserError("That line is not on your advance.");
  if (!["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"].includes(line.advance.status)) throw new UserError("Ask for more only on a released advance.");
  return prisma.$transaction(async (tx) => {
    await assertFundsNotHeld(tx, [line.transactionId]);
    const t = await tx.cashAdvanceTopUp.create({ data: { lineId, extraCents, reason: reason.trim(), requestedById: u.id } });
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "topup_requested", entityType: "CashAdvance", entityId: line.advanceId, summary: `${line.advance.number}: ${u.name} asked for ${peso(extraCents)} more (${reason.trim()})` });
    await notify(tx, { email: { event: "advance_requested", to: await bandApprovers(tx, extraCents), amountCents: extraCents, vars: { number: line.advance.number, who: u.name, reason: "Top-up: more for the same job." } }, userIds: await fundsApprovers(tx), title: `${line.advance.number}: top-up to approve`, body: `${u.name} asked for ${peso(extraCents)} more.`, link: "/funds?tab=approve" });
    return t.id;
  });
}

/** The approver sees only the extra: the band is checked against the extra amount. Approved top-ups are released by Finance. */
export async function decideTopUp(u: CurrentUser, topUpId: string, approve: boolean, cents: number | null, note: string) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.cashAdvanceTopUp.findUnique({ where: { id: topUpId }, include: { line: { include: { advance: true } } } });
    if (!t || t.status !== "REQUESTED") throw new UserError("This top-up was already decided.");
    await requireApprover(tx, u, t.extraCents, t.requestedById);
    if (approve) await assertFundsNotHeld(tx, [t.line.transactionId]);
    const amount = approve ? cents ?? t.extraCents : 0;
    if (approve && (amount <= 0 || amount > t.extraCents)) throw new UserError("Approve up to the extra asked.");
    if ((!approve || amount < t.extraCents) && note.trim().length < 3) throw new UserError("Add a short note.", "note");
    await tx.cashAdvanceTopUp.update({ where: { id: t.id }, data: { status: approve ? "APPROVED" : "DENIED", approvedCents: amount, approverId: u.id, decidedAt: new Date(), decisionNote: note.trim() } });
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: approve ? "topup_approved" : "topup_denied", entityType: "CashAdvance", entityId: t.line.advanceId, summary: `${t.line.advance.number}: top-up ${approve ? `approved ${peso(amount)}` : "denied"} by ${u.name}` });
    await notify(tx, { email: { event: "advance_decided", to: approve ? [t.requestedById, ...(await financeIds(tx))] : undefined, vars: { number: t.line.advance.number, status: approve ? "top-up approved" : "top-up denied", who: u.name, reason: approve ? "Finance will release it." : note.trim() } }, userIds: [t.requestedById], title: `${t.line.advance.number}: top-up ${approve ? "approved" : "denied"}`, body: approve ? `${peso(amount)} more. Finance will release it.` : note.trim(), link: "/my-funds?tab=advances" });
  });
}

export async function releaseTopUp(u: CurrentUser, topUpId: string) {
  need(u, PERMISSIONS.FUNDS_RELEASE, "Your role does not allow releasing funds.");
  return prisma.$transaction(async (tx) => {
    const t = await tx.cashAdvanceTopUp.findUnique({ where: { id: topUpId }, include: { line: { include: { advance: true } } } });
    if (!t || t.status !== "APPROVED" || t.releasedAt) throw new UserError("Only an approved top-up can be released.");
    await assertFundsNotHeld(tx, [t.line.transactionId]);
    const c = t.approvedCents ?? 0;
    await tx.cashAdvanceTopUp.update({ where: { id: t.id }, data: { releasedCents: c, releasedAt: new Date() } });
    await tx.cashAdvanceLine.update({ where: { id: t.lineId }, data: { releasedCents: { increment: c } } });
    await tx.cashAdvance.update({ where: { id: t.line.advanceId }, data: { releasedCents: { increment: c } } });
    await refreshAdvance(tx, t.line.advanceId);
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "topup_released", entityType: "CashAdvance", entityId: t.line.advanceId, summary: `${t.line.advance.number}: top-up of ${peso(c)} released by ${u.name}` });
    await notify(tx, { email: { event: "advance_released", amountCents: c, vars: { number: t.line.advance.number, who: u.name } }, userIds: [t.requestedById], title: `${t.line.advance.number}: top-up released`, body: `${peso(c)} more released.`, link: "/my-funds?tab=advances" });
  });
}

/** Carry-overs beyond the limit wait for approval. Approving restarts the liquidation due date. */
export async function decideCarryOver(u: CurrentUser, carryId: string, approve: boolean, now: Date = new Date()) {
  need(u, PERMISSIONS.FUNDS_APPROVE, "Your role does not allow approving carry-overs.");
  return prisma.$transaction(async (tx) => {
    const c = await tx.carryOver.findUnique({ where: { id: carryId }, include: { line: { include: { advance: true } } } });
    if (!c || c.status !== "PENDING") throw new UserError("This carry-over was already decided.");
    if (c.line.advance.requestedById === u.id) throw new UserError("You cannot approve your own carry-over.");
    if (approve) await assertFundsNotHeld(tx, [c.line.transactionId]); // approving puts cash back to work
    await tx.carryOver.update({ where: { id: c.id }, data: { status: approve ? "APPROVED" : "DENIED", decidedById: u.id, decidedAt: now } });
    if (approve) {
      const holidays = await getHolidaySet(tx);
      await tx.cashAdvance.update({ where: { id: c.line.advanceId }, data: { overdueNotifiedAt: null, liquidationDueAt: liquidationDue(now, await getSetting("funds.liquidationDueDays", tx), holidays) } });
    }
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: approve ? "carryover_approved" : "carryover_denied", entityType: "CashAdvance", entityId: c.line.advanceId, summary: `${c.line.advance.number}: carry-over of ${peso(c.cents)} ${approve ? "approved" : "denied (return the cash)"} by ${u.name}` });
    await notify(tx, { email: { event: "advance_decided", vars: { number: c.line.advance.number, status: approve ? "carry-over approved" : "carry-over denied", who: u.name, reason: approve ? "Keep the balance for the next attempt." : "Return the balance to Finance." } }, userIds: [c.line.advance.requestedById], title: `${c.line.advance.number}: carry-over ${approve ? "approved" : "denied"}`, body: approve ? "Keep the balance for the next attempt." : "Return the balance to Finance.", link: "/my-funds?tab=advances" });
  });
}

// ---------------------------------------------------------------------------
// Liquidation: receipts, returns, close
// ---------------------------------------------------------------------------

/** Recomputes Released / Partially liquidated / Liquidated from receipts and returns. */
export async function refreshAdvance(tx: Tx, advanceId: string) {
  const a = await tx.cashAdvance.findUniqueOrThrow({ where: { id: advanceId }, include: { lines: { include: { receipts: true } }, returns: true } });
  const receiptCents = a.lines.flatMap((l) => l.receipts).reduce((s, r) => s + r.cents, 0);
  const returnedCents = a.returns.reduce((s, r) => s + r.cents, 0);
  const status = liquidationStatus({ releasedCents: a.releasedCents, receiptCents, returnedCents, status: a.status });
  if (status !== a.status) await tx.cashAdvance.update({ where: { id: a.id }, data: { status: status as never } });
  // Jobs of a settled advance may now let the loan move on (step 5.3).
  const loanIds = await tx.loanTransaction.findMany({ where: { advanceLines: { some: { advanceId } } }, select: { loanId: true } });
  for (const l of new Set(loanIds.map((x) => x.loanId))) await recomputeStage(tx, l);
  return { status, balance: advanceBalance({ releasedCents: a.releasedCents, receiptCents, returnedCents }) };
}

export const receiptSchema = z.object({
  lineId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the receipt date."),
  cents: z.number().int().positive("Enter the receipt amount."),
  number: z.string().trim().min(1, "Enter the receipt or OR number.").max(60),
});

export async function addReceipt(u: CurrentUser, raw: unknown, file: { key: string; name: string; mime: string } | null) {
  need(u, PERMISSIONS.FUNDS_LIQUIDATE, "Your role does not allow liquidating.");
  const p = receiptSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const line = await prisma.cashAdvanceLine.findUnique({ where: { id: p.data.lineId }, include: { advance: true, receipts: true } });
  if (!line || line.advance.requestedById !== u.id) throw new UserError("That line is not on your advance.");
  if (!["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"].includes(line.advance.status)) throw new UserError("Receipts go on a released advance.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.receipt.create({ data: { lineId: line.id, date: p.data.date, cents: p.data.cents, number: p.data.number, fileKey: file?.key ?? "", fileName: file?.name ?? "", mime: file?.mime ?? "", uploadedById: u.id } });
    const after = await refreshAdvance(tx, line.advanceId);
    if (after.status === "LIQUIDATED" && line.advance.status !== "LIQUIDATED") {
      await notify(tx, {
        userIds: await financeIds(tx), title: `${line.advance.number}: liquidation submitted`, body: `${u.name} sent receipts for the whole amount. Check and close it.`, link: "/funds?tab=outstanding",
        email: { event: "cash_returned", vars: { number: line.advance.number, who: u.name, status: "liquidation submitted", reason: "Check the receipts and close it." } },
      });
    }
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "receipt_added", entityType: "CashAdvance", entityId: line.advanceId, summary: `${line.advance.number}: receipt ${p.data.number} for ${peso(p.data.cents)} added by ${u.name}; balance ${peso(after.balance)}`, after: { receiptId: r.id, ...p.data } });
    return { id: r.id, ...after };
  });
}

export async function recordReturn(u: CurrentUser, advanceId: string, cents: number, date: string) {
  need(u, PERMISSIONS.FUNDS_LIQUIDATE, "Your role does not allow liquidating.");
  if (!Number.isInteger(cents) || cents <= 0) throw new UserError("Enter the amount returned.", "cents");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new UserError("Pick the date.", "date");
  const a = await prisma.cashAdvance.findUnique({ where: { id: advanceId } });
  if (!a || a.requestedById !== u.id) throw new UserError("That advance is not yours.");
  return prisma.$transaction(async (tx) => {
    await tx.cashReturn.create({ data: { advanceId, cents, date, recordedById: u.id } });
    const after = await refreshAdvance(tx, advanceId);
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "cash_returned", entityType: "CashAdvance", entityId: advanceId, summary: `${a.number}: ${u.name} returned ${peso(cents)} cash; balance ${peso(after.balance)}` });
    await notify(tx, { email: { event: "cash_returned", vars: { number: a.number, who: u.name, status: "cash returned", reason: "Confirm receipt." } }, userIds: await financeIds(tx), title: `${a.number}: cash returned`, body: `${u.name} returned ${peso(cents)}. Confirm receipt.`, link: "/funds?tab=outstanding" });
  });
}

export async function confirmReturn(u: CurrentUser, returnId: string) {
  need(u, PERMISSIONS.FUNDS_RELEASE, "Your role does not allow confirming returned cash.");
  return prisma.$transaction(async (tx) => {
    const r = await tx.cashReturn.findUnique({ where: { id: returnId }, include: { advance: true } });
    if (!r || r.confirmedAt) throw new UserError("Already confirmed.");
    await tx.cashReturn.update({ where: { id: r.id }, data: { confirmedById: u.id, confirmedAt: new Date() } });
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "cash_return_confirmed", entityType: "CashAdvance", entityId: r.advanceId, summary: `${r.advance.number}: ${u.name} confirmed receipt of ${peso(r.cents)} returned cash` });
  });
}

export async function closeAdvance(u: CurrentUser, advanceId: string) {
  need(u, PERMISSIONS.FUNDS_RELEASE, "Your role does not allow closing advances.");
  return prisma.$transaction(async (tx) => {
    const a = await tx.cashAdvance.findUnique({ where: { id: advanceId }, include: { returns: true } });
    if (!a) throw new UserError("Cash advance not found.");
    if (a.status !== "LIQUIDATED") throw new UserError("Only a liquidated advance (balance zero) can be closed.");
    if (a.returns.some((r) => !r.confirmedAt)) throw new UserError("Confirm the returned cash first.");
    await tx.cashAdvance.update({ where: { id: a.id }, data: { status: "CLOSED", closedById: u.id, closedAt: new Date() } });
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "advance_closed", entityType: "CashAdvance", entityId: a.id, summary: `${a.number} closed by ${u.name}` });
    const loanIds = await tx.loanTransaction.findMany({ where: { advanceLines: { some: { advanceId } } }, select: { loanId: true } });
    for (const l of new Set(loanIds.map((x) => x.loanId))) await recomputeStage(tx, l);
  });
}

/** Finance lets an overdue DP submit one more request (one-time). */
export async function grantException(u: CurrentUser, dpUserId: string, note: string) {
  need(u, PERMISSIONS.FUNDS_EXCEPTION, "Your role does not allow granting exceptions.");
  if (dpUserId === u.id) throw new UserError("You cannot grant yourself an exception.");
  return prisma.$transaction(async (tx) => {
    const dp = await tx.user.findUnique({ where: { id: dpUserId } });
    if (!dp) throw new UserError("Pick a processor.");
    const ex = await tx.fundsException.create({ data: { dpUserId, grantedById: u.id, note: note.trim() } });
    await writeAudit(tx, { actor: actorOf(u), mode: "MANUAL", action: "funds_exception_granted", entityType: "User", entityId: dpUserId, summary: `${u.name} let ${dp.name} submit one more cash advance while overdue${note ? `: ${note.trim()}` : ""}` });
    await notify(tx, { userIds: [dpUserId], title: "You may submit one more cash advance", body: `${u.name} granted a one-time exception.`, link: "/my-funds" });
    return ex.id;
  });
}

/**
 * "Cash to settle": open advances whose job went back to the LA (declined or returned) after the cash
 * was released. The job is no longer the processor's, but the money is: the advance stays in My funds
 * and in Finance's Outstanding list, marked, until it is closed.
 */
export async function cashToSettleIds(advances: { id: string; status: string; requestedById: string; lines: { transactionId: string | null }[] }[]): Promise<Set<string>> {
  const open = advances.filter((a) => OPEN_ADVANCE.includes(a.status));
  const txnIds = [...new Set(open.flatMap((a) => a.lines.map((l) => l.transactionId).filter((x): x is string => !!x)))];
  if (!txnIds.length) return new Set();
  const jobs = await prisma.dpAssignment.findMany({ where: { transactionId: { in: txnIds } }, orderBy: { endorsedAt: "asc" }, select: { transactionId: true, dpUserId: true, secondaryDpUserId: true, status: true, returnedAt: true } });
  const out = new Set<string>();
  for (const a of open) {
    for (const l of a.lines) {
      const mine = jobs.filter((j) => j.transactionId === l.transactionId && (j.dpUserId === a.requestedById || j.secondaryDpUserId === a.requestedById));
      const last = mine.at(-1);
      if (last && (last.status === "DECLINED" || (last.status === "WITHDRAWN" && last.returnedAt))) out.add(a.id);
    }
  }
  return out;
}

export async function financeIds(db: Tx | typeof prisma) {
  const rows = await db.user.findMany({ where: { active: true, role: { active: true, permissions: { has: PERMISSIONS.FUNDS_RELEASE } } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Overdue liquidations: tell the DP and Finance once per advance (called when the funds pages load). */
export async function notifyOverdue(now: Date = new Date()) {
  const open = await prisma.cashAdvance.findMany({ where: { status: { in: ["RELEASED", "FOR_LIQUIDATION", "PARTIALLY_LIQUIDATED"] }, overdueNotifiedAt: null, liquidationDueAt: { lt: now } } });
  for (const a of open) {
    await prisma.$transaction(async (tx) => {
      await tx.cashAdvance.update({ where: { id: a.id }, data: { overdueNotifiedAt: now } });
      await notify(tx, { email: { event: "liquidation_due", dedupeKey: `liq-overdue:${a.id}`, vars: { number: a.number, status: "overdue", reason: "Liquidate with receipts or return the cash." } }, userIds: [a.requestedById, ...(await financeIds(tx))], title: `${a.number}: liquidation overdue`, body: "Liquidate with receipts or return the cash.", link: "/my-funds?tab=liquidation" });
    });
  }
}
