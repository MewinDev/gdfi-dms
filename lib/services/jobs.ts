import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, type Actor } from "@/lib/audit";
import { notify, branchLaUserIds } from "@/lib/notify";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getHolidaySet, getSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { bandFor, carryOverDecision, fundsStatus, lineBalance, liquidationDue } from "@/lib/funds/rules";
import { recomputeStage } from "./stage";
import { moveDocs, noteDocs } from "./custody";
import { NotInScopeError, UserError } from "./errors";
import { endHoldsOnCompletion } from "./holds";
import { currentStageIdFor, finishStageCore, requireVerified, somethingMissingCore, stagesForCompletion, startStageCore, verifyPaperCore } from "./job-stages";

/**
 * The processor (DP) side: accept, decline, return, attempts, complete, forward, and the receiving
 * LA's acceptance. Each step has one core function (inside the loan lock) used by the real screens
 * (with permission and ownership checks) and by the Admin test simulator (with a Simulated actor).
 */

export interface Who {
  actor: Actor;
  userId: string | null;
  mode: "MANUAL" | "SIMULATED";
}
export const whoOf = (u: CurrentUser): Who => ({ actor: { id: u.id, label: u.name }, userId: u.id, mode: "MANUAL" });

const assignmentInclude = {
  transaction: { include: { type: true, documents: true, advanceLines: { include: { advance: true } }, attempts: true, problems: true, holds: true } },
  dpUser: true, secondaryDpUser: true, ltoOffice: true, loan: { include: { branch: true } }, assignedBy: { select: { name: true } }, receivingBranch: true, receivingLa: { select: { name: true } },
} satisfies Prisma.DpAssignmentInclude;
export type AssignmentFull = Prisma.DpAssignmentGetPayload<{ include: typeof assignmentInclude }>;

async function loadAssignment(db: Tx | typeof prisma, id: string): Promise<AssignmentFull> {
  const a = await db.dpAssignment.findUnique({ where: { id }, include: assignmentInclude });
  if (!a) throw new UserError("Job not found.");
  return a;
}

const audit = (tx: Tx, who: Who, a: { id: string; loanId: string; loan: { pn: string } }, action: string, journeyStep: string | null, summary: string, extra: Partial<{ before: unknown; after: unknown; details: unknown }> = {}) =>
  writeAudit(tx, {
    actor: who.actor, mode: who.mode, action, entityType: "DpAssignment", entityId: a.id, loanId: a.loanId, pn: a.loan.pn, journeyStep,
    summary: who.mode === "SIMULATED" ? `Simulated: ${summary}` : summary, ...extra,
  });

/**
 * The DP may work only on their own jobs: the processor it was sent to, or the second processor
 * (Pasuyo) who works it for them. They may see their branches' jobs.
 */
function requireOwnJob(user: CurrentUser, a: { dpUserId: string; secondaryDpUserId?: string | null }) {
  if (!can(user, PERMISSIONS.JOBS_WORK)) throw new UserError("Your role does not allow working on jobs.");
  if (a.dpUserId !== user.id && a.secondaryDpUserId !== user.id) throw new UserError("This job is assigned to someone else.");
}

/** Jobs a person may see: their own, or in their branches when they can work jobs; Admin-like roles by loan scope. */
export function canSeeJob(user: CurrentUser, a: { dpUserId: string; secondaryDpUserId?: string | null; dpBranchId: string; loan: { branchId: string } }) {
  if (a.dpUserId === user.id || a.secondaryDpUserId === user.id) return true;
  if (can(user, PERMISSIONS.JOBS_WORK)) return user.scopeBranchIds === null || user.scopeBranchIds.includes(a.dpBranchId);
  return inScope(user, a.loan.branchId);
}

// ---------------------------------------------------------------------------
// Accept / decline / return
// ---------------------------------------------------------------------------

export async function acceptCore(tx: Tx, a: AssignmentFull, who: Who, labelsConfirmed: boolean) {
  if (a.status !== "PENDING_ACCEPTANCE") throw new UserError("This job is not waiting for acceptance.");
  if (!labelsConfirmed) throw new UserError("Tick \"Labels are on all papers\" to accept.", "labels");
  const now = new Date();
  await tx.dpAssignment.update({ where: { id: a.id }, data: { status: "ACCEPTED", decidedAt: now, labelsConfirmedAt: now } });
  await tx.loanTransaction.update({ where: { id: a.transactionId }, data: { status: "IN_PROCESS", statusSince: now } });
  await moveDocs(tx, a.transaction.documents.filter((d) => d.stage === "IN_TRANSIT"), { stage: "WITH_DP", custodian: `${a.dpUser.name} (DP)`, role: "DP", userId: a.dpUserId, location: `With DP ${a.dpUser.name}`, action: "ACKNOWLEDGED_BY_DP" }, { simulated: who.mode === "SIMULATED", by: who.actor });
  await audit(tx, who, a, "dp_assignment_accepted", "4.1", `${a.dpUser.name} accepted ${a.transaction.type.name} (labels confirmed on all papers); custody moved to the DP`);
  await notify(tx, { email: { event: "job_accepted", transactionId: a.transactionId, vars: { pn: a.loan.pn, transaction: a.transaction.type.name, who: a.dpUser.name } }, userIds: [a.assignedById], loanId: a.loanId, title: `${a.loan.pn}: ${a.transaction.type.name} accepted`, body: `${a.dpUser.name} accepted the job.`, link: `/loans/${a.loan.pn}` });
  await recomputeStage(tx, a.loanId, { simulated: who.mode === "SIMULATED" });
}

const reasonsSchema = z.object({
  reasons: z.array(z.string().trim().min(1)).min(1, "Pick at least one reason."),
  remarks: z.string().trim().min(3, "Add a short remark.").max(500),
});

async function backToLa(tx: Tx, a: AssignmentFull, who: Who, kind: "declined" | "returned", reasons: string[], remarks: string) {
  const now = new Date();
  const text = `${reasons.join(", ")}: ${remarks}`;
  await tx.dpAssignment.update({
    where: { id: a.id },
    data: kind === "declined"
      ? { status: "DECLINED", decidedAt: now, declineReasons: text, closedAt: now }
      : { status: "WITHDRAWN", returnedAt: now, returnReasons: text, closedAt: now },
  });
  await tx.loanTransaction.update({ where: { id: a.transactionId }, data: { status: "RETURNED", statusSince: now } });
  await moveDocs(tx, a.transaction.documents.filter((d) => d.stage === "IN_TRANSIT" || d.stage === "WITH_DP"), { stage: "AT_BRANCH", custodian: null, role: "LA", userId: null, location: `${a.loan.branch.name} branch`, action: kind === "declined" ? "RETURNED_UNACKNOWLEDGED" : "RETURNED_BY_DP" }, { simulated: who.mode === "SIMULATED", by: who.actor });
  await tx.loanException.create({ data: { loanId: a.loanId, transactionId: a.transactionId, type: "DP_DECLINED", reason: `${a.dpUser.name} ${kind} ${a.transaction.type.name}: ${text}. Correct and send again.`, raisedByLabel: who.actor.label, simulated: who.mode === "SIMULATED" } });
  await audit(tx, who, a, kind === "declined" ? "dp_assignment_declined" : "dp_assignment_returned", "4.1", `${a.dpUser.name} ${kind} ${a.transaction.type.name}; sent back to the LA`, { details: { reasons, remarks } });
  await notify(tx, { userIds: [a.assignedById], loanId: a.loanId, title: `${a.loan.pn}: ${a.transaction.type.name} ${kind}`, body: text, link: `/loans/${a.loan.pn}?tab=todo&tx=${a.transaction.type.code}`, email: { event: "job_declined", transactionId: a.transactionId, vars: { pn: a.loan.pn, transaction: a.transaction.type.name, who: a.dpUser.name, reason: text } } });
  await recomputeStage(tx, a.loanId, { simulated: who.mode === "SIMULATED" });
}

export async function declineCore(tx: Tx, a: AssignmentFull, who: Who, reasons: string[], remarks: string) {
  if (a.status !== "PENDING_ACCEPTANCE") throw new UserError("This job is not waiting for acceptance.");
  await backToLa(tx, a, who, "declined", reasons, remarks);
}

/** Return to the LA: only before the first attempt. */
export async function returnCore(tx: Tx, a: AssignmentFull, who: Who, reasons: string[], remarks: string) {
  if (a.status !== "ACCEPTED" || a.transaction.status !== "IN_PROCESS") throw new UserError("Only a job in process can be returned.");
  if (a.transaction.attempts.length > 0) throw new UserError("You already logged an attempt. Raise a problem instead of returning it.");
  await backToLa(tx, a, who, "returned", reasons, remarks);
}

// ---------------------------------------------------------------------------
// Attempts (a day of work). Append-only.
// ---------------------------------------------------------------------------

export const attemptSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date."),
  result: z.enum(["DONE", "NOT_PROCESSED"], { message: "Pick Done or Not processed." }),
  reasonId: z.string().optional().nullable(),
  note: z.string().trim().max(500).default(""),
  rest: z.enum(["CARRY_OVER", "RETURN", "NONE"]).default("NONE"),
  spends: z.array(z.object({ lineId: z.string(), cents: z.number().int().min(0) })).default([]),
}).refine((a) => a.result === "DONE" || !!a.reasonId, { message: "Pick the reason it was not processed.", path: ["reasonId"] });
export type AttemptInput = z.infer<typeof attemptSchema>;

/** Spent, returned and released per line (append-only sums). */
export async function lineTotals(db: Tx | typeof prisma, lineId: string) {
  const line = await db.cashAdvanceLine.findUniqueOrThrow({ where: { id: lineId }, include: { spends: true, returns: true, advance: true } });
  const spentCents = line.spends.reduce((s, x) => s + x.cents, 0);
  const returnedCents = line.returns.reduce((s, x) => s + x.cents, 0);
  return { line, spentCents, returnedCents, balance: lineBalance({ releasedCents: line.releasedCents, spentCents, returnedCents }) };
}

/** "At the LTO" needs funds first when the setting is on (types that need LTO processing, or any job flagged for an LTO fee). */
export async function ltoBlocked(db: Tx | typeof prisma, a: AssignmentFull): Promise<boolean> {
  if (!(await getSetting("funds.blockLtoUntilFunded", db))) return false;
  const t = a.transaction;
  const atLto = t.type.needsLto || t.fundsKinds.includes("LTO_FEE");
  if (!atLto || t.fundsNeeded !== "YES") return false;
  const st = fundsStatus(t.fundsNeeded, t.advanceLines.map((l) => ({ denied: l.denied, releasedCents: l.releasedCents, advanceStatus: l.advance.status })));
  return st !== "FUNDED" && st !== "SETTLED";
}
export const LTO_BLOCK_MESSAGE = "This job needs funds. Request a cash advance first.";

export async function attemptCore(tx: Tx, a: AssignmentFull, who: Who, input: AttemptInput, now: Date = new Date()) {
  if (a.status !== "ACCEPTED" || a.transaction.status !== "IN_PROCESS") throw new UserError("Accept the job first.");
  if (await ltoBlocked(tx, a)) throw new UserError(LTO_BLOCK_MESSAGE);
  const lines = a.transaction.advanceLines.filter((l) => !l.denied);
  for (const s of input.spends) {
    if (!lines.some((l) => l.id === s.lineId)) throw new UserError("That cash advance line is not for this job.");
    const { balance } = await lineTotals(tx, s.lineId);
    if (s.cents > balance) throw new UserError("You spent more than is left on that line. Ask for more (top-up) first.");
  }
  const reason = input.reasonId ? await tx.problemReason.findUnique({ where: { id: input.reasonId } }) : null;
  if (input.result === "NOT_PROCESSED" && !reason) throw new UserError("Pick the reason it was not processed.", "reasonId");
  // Attempts (and the problem a Not processed opens) belong to the stage that is current.
  const jobStageId = await currentStageIdFor(tx, a.transactionId);
  const attempt = await tx.transactionAttempt.create({
    data: {
      jobStageId,
      transactionId: a.transactionId, dpUserId: who.userId ?? a.dpUserId, date: input.date, result: input.result, reasonId: reason?.id ?? null,
      note: input.note, restDecision: input.rest, simulated: who.mode === "SIMULATED",
      spends: { create: input.spends.filter((s) => s.cents > 0).map((s) => ({ lineId: s.lineId, cents: s.cents })) },
    },
  });
  const n = await tx.transactionAttempt.count({ where: { transactionId: a.transactionId } });

  // Not processed opens a problem with that reason (if none is open); Done resolves open problems.
  const open = a.transaction.problems.filter((p) => !p.resolvedAt);
  if (input.result === "NOT_PROCESSED" && open.length === 0) {
    await tx.problem.create({ data: { jobStageId, loanId: a.loanId, transactionId: a.transactionId, reasonId: reason!.id, note: input.note, raisedById: who.userId, raisedByLabel: who.actor.label, simulated: who.mode === "SIMULATED" } });
    await notifyProblem(tx, a, `${reason!.name}`, "opened");
  }
  if (input.result === "DONE") {
    for (const p of open) await tx.problem.update({ where: { id: p.id }, data: { resolvedAt: now, resolvedById: who.userId, resolvedByLabel: who.actor.label, resolutionNote: `Done on attempt ${n}` } });
    if (open.length) await notifyProblem(tx, a, "", "resolved");
  }

  // The rest of the money: carry over (auto within the limit, else Finance approves) or return.
  if (input.rest !== "NONE") {
    const holidays = await getHolidaySet(tx);
    const limit = await getSetting("funds.carryOverLimitDays", tx);
    const dueDays = await getSetting("funds.liquidationDueDays", tx);
    for (const l of lines) {
      const { balance } = await lineTotals(tx, l.id);
      if (balance <= 0) continue;
      if (input.rest === "RETURN") {
        await tx.cashReturn.create({ data: { advanceId: l.advanceId, lineId: l.id, cents: balance, date: input.date, recordedById: who.userId ?? "simulated" } });
        continue;
      }
      const first = await tx.carryOver.findFirst({ where: { lineId: l.id }, orderBy: { createdAt: "asc" } });
      const d = carryOverDecision({ balanceCents: balance, firstCarryOver: first?.createdAt ?? null, now, limitDays: limit, holidays });
      await tx.carryOver.create({ data: { lineId: l.id, attemptId: attempt.id, cents: balance, status: d.status, businessDays: d.businessDays, ...(d.status === "AUTO" ? { decidedAt: now } : {}) } });
      if (d.status === "AUTO") {
        // Each carry-over decision restarts the liquidation due date.
        await tx.cashAdvance.update({ where: { id: l.advanceId }, data: { overdueNotifiedAt: null, liquidationDueAt: liquidationDue(now, dueDays, holidays) } });
      } else {
        await notify(tx, { email: { event: "advance_requested", to: await bandApprovers(tx, balance), amountCents: balance, vars: { number: l.advance.number, who: a.dpUser.name, reason: `Carry-over: keep the balance for ${a.transaction.type.name} beyond the carry-over limit.` } }, userIds: await fundsApprovers(tx), loanId: a.loanId, title: `${l.advance.number}: carry-over needs approval`, body: `${a.dpUser.name} wants to keep ${(balance / 100).toFixed(2)} for ${a.transaction.type.name} beyond the carry-over limit.`, link: "/funds?tab=approve" });
      }
    }
  }
  await audit(tx, who, a, "attempt_logged", "4.4", `Attempt ${n} on ${a.transaction.type.name}: ${input.result === "DONE" ? "Done" : `Not processed (${reason!.name})`}${input.rest !== "NONE" ? `; balance ${input.rest === "RETURN" ? "returned" : "carried over"}` : ""}`, {
    after: { attempt: n, result: input.result, reason: reason?.code ?? null, rest: input.rest, spends: input.spends },
  });
  return attempt;
}

/** People who approve funds (for notifications). */
export async function fundsApprovers(db: Tx | typeof prisma): Promise<string[]> {
  const rows = await db.user.findMany({ where: { active: true, role: { active: true, permissions: { has: PERMISSIONS.FUNDS_APPROVE } } }, select: { id: true } });
  return rows.map((r) => r.id);
}
/** Approvers for an amount (approval bands): the band's role, with Approve. Everyone who approves when no band matches. */
export async function bandApprovers(db: Tx | typeof prisma, amountCents: number): Promise<string[]> {
  const band = bandFor(amountCents, await db.approvalBand.findMany());
  const rows = await db.user.findMany({ where: { active: true, ...(band ? { roleId: band.roleId } : {}), role: { active: true, permissions: { has: PERMISSIONS.FUNDS_APPROVE } } }, select: { id: true } });
  return rows.length ? rows.map((r) => r.id) : fundsApprovers(db);
}

export async function adminIds(db: Tx | typeof prisma): Promise<string[]> {
  const rows = await db.user.findMany({ where: { active: true, role: { key: "ADMIN", active: true } }, select: { id: true } });
  return rows.map((r) => r.id);
}
export async function notifyProblem(tx: Tx, a: { loanId: string; transactionId: string; loan: { pn: string; branchId: string }; transaction: { type: { name: string } } }, reason: string, what: "opened" | "resolved") {
  // Email: the branch LAs and the processor working on it.
  const la = await branchLaUserIds(tx, a.loan.branchId);
  const job = await tx.dpAssignment.findFirst({ where: { transactionId: a.transactionId, status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } }, select: { dpUserId: true, secondaryDpUserId: true } });
  await notify(tx, {
    email: {
      event: "problem_changed", transactionId: a.transactionId, to: [...la, ...(job ? [job.dpUserId, ...(job.secondaryDpUserId ? [job.secondaryDpUserId] : [])] : [])],
      vars: { pn: a.loan.pn, transaction: a.transaction.type.name, status: what, reason: what === "opened" ? `Reason: ${reason}.` : "The job is moving again." },
    },
    userIds: [...(await branchLaUserIds(tx, a.loan.branchId)), ...(await adminIds(tx))], loanId: a.loanId,
    title: `${a.loan.pn}: problem ${what} on ${a.transaction.type.name}`, body: what === "opened" ? `Reason: ${reason}. The TAT keeps counting.` : "The job is moving again.",
    link: `/loans/${a.loan.pn}`,
  });
}

// ---------------------------------------------------------------------------
// Complete (stage reference) and forward to a named LA
// ---------------------------------------------------------------------------

export const completeSchemas = {
  NOTARY: z.object({ name: z.string().trim().min(2, "Notary name is required."), docNo: z.string().trim().min(1, "Document number is required."), pageNo: z.string().trim().min(1, "Page is required."), bookNo: z.string().trim().min(1, "Book is required."), series: z.string().trim().min(4, "Series (year) is required.") }),
  PPSR: z.object({ registrationNo: z.string().trim().min(3, "Registration number is required."), registrationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the registration date."), certificate: z.string().trim().min(1, "Certificate reference is required.") }),
  MORTGAGE: z.object({ droppedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the LTO drop date."), pickedUpAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the annotated OR/CR pickup date."), annotatedOrCr: z.literal(true, { message: "Confirm the annotated OR/CR was picked up." }) }),
} as const;

export async function completeCore(tx: Tx, a: AssignmentFull, who: Who, raw: Record<string, unknown>) {
  if (a.status !== "ACCEPTED" || a.transaction.status !== "IN_PROCESS") throw new UserError("Accept the job first.");
  if (a.processing) throw new UserError("The job is already complete.");
  // With processing stages (the usual case): every active stage Done, including Check and verify. The
  // stage evidence becomes the completion record; the LTO custody trail was written at each stage.
  const fromStages = await stagesForCompletion(tx, a);
  if (fromStages) {
    const details = { ...fromStages, ...(a.ltoOffice ? { office: a.ltoOffice.name } : {}) };
    await tx.dpAssignment.update({ where: { id: a.id }, data: { processing: { ...details, processedAt: new Date() } as Prisma.InputJsonValue } });
    await audit(tx, who, a, "dp_processing_recorded", ({ NOTARY: "4.2", PPSR: "4.3" } as Record<string, string>)[a.transaction.type.code] ?? "4.4", `${a.transaction.type.name} completed by ${a.dpUser.name} (every stage done)`, { after: details });
    return;
  }
  const code = a.transaction.type.code as keyof typeof completeSchemas;
  const schema = completeSchemas[code];
  const shape = schema ?? z.object({ note: z.string().trim().min(3, "Describe what was done.") });
  // A missing field reads as blank, so the person gets the plain "... is required." message.
  const filled = Object.fromEntries(Object.keys(shape.shape).map((k) => [k, raw[k] ?? ""]));
  const parsed = shape.safeParse(filled);
  if (!parsed.success) { const i = parsed.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  const key = code === "NOTARY" ? "notary" : code === "PPSR" ? "ppsr" : code === "MORTGAGE" ? "lto" : "done";
  const atLto = a.transaction.type.needsLto || !!a.ltoOffice;
  const details = { [key]: { ...parsed.data, ...(atLto ? { office: a.ltoOffice?.name ?? "LTO" } : {}) } };
  await tx.dpAssignment.update({ where: { id: a.id }, data: { processing: { ...(a.processing as object | null), ...details, processedAt: new Date() } as Prisma.InputJsonValue } });
  if (atLto) {
    // Custody trail: the papers went to the LTO and came back (the holder stays the processor until
    // the existing forward step hands them to the LA of the branch).
    const office = a.ltoOffice?.name ?? "the LTO";
    const withDp = a.transaction.documents.filter((d) => d.stage === "WITH_DP");
    const sim = who.mode === "SIMULATED";
    const m = code === "MORTGAGE" ? (parsed.data as { droppedAt: string; pickedUpAt: string }) : null;
    await noteDocs(tx, withDp, { action: "AT_LTO", location: office, remarks: m ? `Dropped at ${office} on ${m.droppedAt}` : `Processed at ${office}`, by: who.actor, simulated: sim });
    await noteDocs(tx, withDp, { action: "RETURNED_FROM_LTO", location: `With DP ${a.dpUser.name}`, remarks: m ? `Picked up from ${office} on ${m.pickedUpAt} (annotated OR/CR)` : `Back from ${office}`, by: who.actor, simulated: sim });
  }
  await audit(tx, who, a, "dp_processing_recorded", code === "NOTARY" ? "4.2" : code === "PPSR" ? "4.3" : "4.4", `${a.transaction.type.name} completed by ${a.dpUser.name}`, { after: details });
}

export const forwardSchema = z.object({
  branchId: z.string({ message: "Choose the branch." }).trim().min(1, "Choose the branch."),
  receivingLaId: z.string({ message: "Choose the Loan Associate." }).trim().min(1, "Choose the Loan Associate."),
  note: z.string().trim().max(300, "Keep the note under 300 characters.").default(""),
});
export type ForwardInput = z.input<typeof forwardSchema>;

/** People who may receive a forwarded package at a branch: active, may accept returned papers, assigned to that branch. */
export const receiverWhere = (branchId: string) => ({ active: true, role: { active: true, permissions: { has: PERMISSIONS.RETURNS_ACCEPT } }, branches: { some: { branchId } } }) satisfies Prisma.UserWhereInput;

/**
 * Forward to branch: manual, never automatic. The DP chose the branch, then the named LA of that
 * branch. Only after Check and verify (and Complete job). Liquidation does not block it.
 */
export async function forwardCore(tx: Tx, a: AssignmentFull, who: Who, raw: ForwardInput) {
  const p = forwardSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  if (a.status !== "ACCEPTED" || a.transaction.status !== "IN_PROCESS") throw new UserError("Accept the job first.");
  await requireVerified(tx, a);
  if (!a.processing) throw new UserError("Complete the job first.");
  const branch = await tx.branch.findUnique({ where: { id: p.data.branchId } });
  if (!branch || !branch.active) throw new UserError("Choose an active branch.", "branchId");
  const receiving = await tx.user.findFirst({ where: { id: p.data.receivingLaId, ...receiverWhere(branch.id) } });
  if (!receiving) throw new UserError(`Choose a Loan Associate who is active at ${branch.name}.`, "receivingLaId");
  const now = new Date();
  const where = `${receiving.name}, ${branch.name}`;
  const docs = a.transaction.documents.filter((d) => d.stage === "WITH_DP");
  await tx.dpAssignment.update({ where: { id: a.id }, data: { forwardedAt: now, receivingLaId: receiving.id, receivingBranchId: branch.id } });
  const again = await tx.loanException.findMany({ where: { transactionId: a.transactionId, type: "INCOMPLETE_PACKAGE", status: "OPEN" } });
  for (const ex of again) await tx.loanException.update({ where: { id: ex.id }, data: { status: "RESOLVED", resolvedAt: now, resolvedById: who.userId, resolvedByLabel: who.actor.label, resolution: `Corrected and forwarded again to ${receiving.name}, ${branch.name}.` } });
  await tx.loanTransaction.update({ where: { id: a.transactionId }, data: { status: "FORWARDED", statusSince: now } });
  await moveDocs(tx, docs, { stage: "IN_TRANSIT", custodian: null, role: "DP", userId: a.dpUserId, location: `Forwarded to ${where}`, action: "FORWARDED_TO_BRANCH" }, { simulated: who.mode === "SIMULATED", by: who.actor });
  await audit(tx, who, a, "package_forwarded", "4.6", `${a.dpUser.name} forwarded the ${a.transaction.type.name} package (${docs.length} paper${docs.length === 1 ? "" : "s"}) to ${where}; package In transit`, { details: { branchId: branch.id, receivingLaId: receiving.id, note: p.data.note } });
  const body = `${a.dpUser.name} forwarded the ${a.transaction.type.name} package (${docs.length} paper${docs.length === 1 ? "" : "s"}) to you at ${branch.name}. Check each paper and receive it when it arrives.${p.data.note ? ` Note: ${p.data.note}` : ""}`;
  await notify(tx, { email: { event: "package_moved", transactionId: a.transactionId, vars: { pn: a.loan.pn, transaction: a.transaction.type.name, who: a.dpUser.name, status: "forwarded to you", reason: "Check each paper and receive it when it arrives." } }, userIds: [receiving.id], loanId: a.loanId, title: `${a.loan.pn}: package forwarded to you`, body, link: `/receive/${a.id}` });
  await recomputeStage(tx, a.loanId, { simulated: who.mode === "SIMULATED" });
}

export type ReceiveResult = "complete" | "incomplete" | "other";
export interface ReceiveInput { result: ReceiveResult; note: string; /** Other only: it stops the package being received. */ blocking?: boolean }

/**
 * Phase 5: the receiving LA records the package.
 *   Complete: the transaction is done and the DP job closes.
 *   Incomplete, or Other that blocks: an exception with the reason; the package goes back to the DP
 *     ("Package incomplete: ..."), who corrects it and forwards again. The DP (and the person who
 *     forwarded it) are told. The clock keeps counting from acceptance (never reset, never paused).
 *   Other that does not block: received complete, with the remark kept and the DP told.
 */
export async function receiveCore(tx: Tx, a: AssignmentFull, who: Who, input: ReceiveInput | boolean, legacyNote = "") {
  const r: ReceiveInput = typeof input === "boolean" ? { result: input ? "complete" : "incomplete", note: legacyNote } : input;
  if (a.transaction.status !== "FORWARDED" || !a.receivingLaId) throw new UserError("The package has not been forwarded to a branch LA.");
  const receiving = await tx.user.findUniqueOrThrow({ where: { id: a.receivingLaId } });
  const branch = a.receivingBranch ?? a.loan.branch;
  const now = new Date();
  const sim = who.mode === "SIMULATED";
  const blocked = r.result === "incomplete" || (r.result === "other" && !!r.blocking);
  const dpIds = [...new Set([a.dpUserId, ...(a.secondaryDpUserId ? [a.secondaryDpUserId] : [])])];
  if (blocked) {
    const what = r.result === "incomplete" ? "Incomplete" : "Other (blocking)";
    const reason = `${who.actor.label} recorded the ${a.transaction.type.name} package as ${what}: ${r.note || "see remarks"}.`;
    await tx.loanException.create({ data: { loanId: a.loanId, transactionId: a.transactionId, type: "INCOMPLETE_PACKAGE", reason, details: { result: r.result, note: r.note, receivingLaId: receiving.id, branchId: branch.id } as Prisma.InputJsonValue, raisedById: who.userId, raisedByLabel: who.actor.label, simulated: sim } });
    // Back to the DP to correct and forward again. The processing clock continues from acceptance.
    await tx.dpAssignment.update({ where: { id: a.id }, data: { forwardedAt: null, receivingLaId: null, receivingBranchId: null } });
    await tx.loanTransaction.update({ where: { id: a.transactionId }, data: { status: "IN_PROCESS", statusSince: a.decidedAt ?? now } });
    await moveDocs(tx, a.transaction.documents.filter((d) => d.stage === "IN_TRANSIT"), { stage: "WITH_DP", custodian: `${a.dpUser.name} (DP)`, role: "DP", userId: a.dpUserId, location: `With DP ${a.dpUser.name}`, action: "BACK_TO_DP_INCOMPLETE" }, { simulated: sim, by: who.actor });
    await audit(tx, who, a, "package_incomplete", "5.1", `${who.actor.label} recorded the ${a.transaction.type.name} package as ${what}; back to ${a.dpUser.name} to correct and forward again`, { details: { result: r.result, note: r.note } });
    await notify(tx, {
      userIds: dpIds, loanId: a.loanId, title: `${a.loan.pn}: package incomplete`, body: `${who.actor.label} (${branch.name}): ${r.note || what}. Correct it and forward again.`, link: `/jobs/${a.id}`,
      email: { event: "package_moved", transactionId: a.transactionId, to: dpIds, vars: { pn: a.loan.pn, transaction: a.transaction.type.name, who: who.actor.label, status: "recorded as incomplete", reason: `${r.note || what}. Correct it and forward again.` } },
    });
    await recomputeStage(tx, a.loanId, { simulated: sim });
    return;
  }
  await tx.loanTransaction.update({ where: { id: a.transactionId }, data: { status: "COMPLETED", statusSince: now, completedAt: now } });
  await tx.dpAssignment.update({ where: { id: a.id }, data: { status: "CLOSED", closedAt: now } });
  await endHoldsOnCompletion(tx, { id: a.transactionId, loanId: a.loanId, pn: a.loan.pn, name: a.transaction.type.name }, sim, now);
  await moveDocs(tx, a.transaction.documents.filter((d) => d.stage === "IN_TRANSIT"), { stage: "AT_BRANCH", custodian: `${receiving.name} (LA, ${branch.name})`, role: "LA", userId: receiving.id, location: `${branch.name} branch`, action: "ACCEPTED_AT_BRANCH" }, { simulated: sim, by: who.actor });
  const remark = r.result === "other" && r.note ? ` (Other: ${r.note})` : "";
  await audit(tx, who, a, "package_accepted", "5.1", `${who.actor.label} checked the papers and recorded the ${a.transaction.type.name} package Complete${remark}`, r.note ? { details: { result: r.result, note: r.note } } : {});
  // The processor who sent the papers is told they arrived.
  await notify(tx, {
    userIds: dpIds, loanId: a.loanId, title: `${a.loan.pn}: ${a.transaction.type.name} papers received`, body: `${who.actor.label} received the package complete${remark}.`, link: `/jobs/${a.id}`,
    email: { event: "package_moved", transactionId: a.transactionId, vars: { pn: a.loan.pn, transaction: a.transaction.type.name, who: who.actor.label, status: "received complete" } },
  });
  // Any "package incomplete" follow-up on this transaction is done.
  const open = await tx.loanException.findMany({ where: { transactionId: a.transactionId, type: "INCOMPLETE_PACKAGE", status: "OPEN" } });
  for (const ex of open) await tx.loanException.update({ where: { id: ex.id }, data: { status: "RESOLVED", resolvedAt: now, resolvedById: who.userId, resolvedByLabel: who.actor.label, resolution: "Received complete." } });
  await writeAudit(tx, { actor: { id: null, label: "System" }, mode: sim ? "SIMULATED" : "AUTOMATIC", action: "transaction_completed", entityType: "LoanTransaction", entityId: a.transactionId, loanId: a.loanId, pn: a.loan.pn, journeyStep: "5.2", summary: `${a.transaction.type.name} COMPLETED; DP assignment CLOSED` });
  await recomputeStage(tx, a.loanId, { simulated: sim });
}

// ---------------------------------------------------------------------------
// Real-screen wrappers (permission + ownership checks)
// ---------------------------------------------------------------------------

export async function withJob<T>(user: CurrentUser, assignmentId: string, fn: (tx: Tx, a: AssignmentFull) => Promise<T>) {
  const a0 = await loadAssignment(prisma, assignmentId);
  requireOwnJob(user, a0);
  return withLoanLock(a0.loanId, async (tx) => fn(tx, await loadAssignment(tx, assignmentId)));
}

export const acceptJob = (u: CurrentUser, id: string, labels: boolean) => withJob(u, id, (tx, a) => acceptCore(tx, a, whoOf(u), labels));
export function declineJob(u: CurrentUser, id: string, raw: unknown) {
  const p = reasonsSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  return withJob(u, id, (tx, a) => declineCore(tx, a, whoOf(u), p.data.reasons, p.data.remarks));
}
export function returnJob(u: CurrentUser, id: string, raw: unknown) {
  const p = reasonsSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  return withJob(u, id, (tx, a) => returnCore(tx, a, whoOf(u), p.data.reasons, p.data.remarks));
}
export function logAttempt(u: CurrentUser, id: string, raw: unknown, now: Date = new Date()) {
  const p = attemptSchema.safeParse(raw);
  if (!p.success) { const i = p.error.issues[0]; throw new UserError(i.message, String(i.path[0] ?? "")); }
  if (p.data.date > businessDate(now)) throw new UserError("The attempt date cannot be in the future.", "date");
  return withJob(u, id, (tx, a) => attemptCore(tx, a, whoOf(u), p.data, now));
}
export const completeJob = (u: CurrentUser, id: string, raw: Record<string, unknown>) => withJob(u, id, (tx, a) => completeCore(tx, a, whoOf(u), raw));
export const forwardJob = (u: CurrentUser, id: string, input: ForwardInput) => withJob(u, id, (tx, a) => forwardCore(tx, a, whoOf(u), input));
export const startStage = (u: CurrentUser, id: string, stageId: string) => withJob(u, id, (tx, a) => startStageCore(tx, a, whoOf(u), stageId));
export const finishStage = (u: CurrentUser, id: string, stageId: string, raw: Record<string, unknown>) => withJob(u, id, (tx, a) => finishStageCore(tx, a, whoOf(u), stageId, raw));
export const verifyPaper = (u: CurrentUser, id: string, stageId: string, documentItemId: string) => withJob(u, id, (tx, a) => verifyPaperCore(tx, a, whoOf(u), stageId, documentItemId));
export function somethingMissing(u: CurrentUser, id: string, stageId: string, documentItemIds: string[], note: string) {
  if (note.trim().length > 300) throw new UserError("Keep the note under 300 characters.", "note");
  return withJob(u, id, (tx, a) => somethingMissingCore(tx, a, whoOf(u), stageId, documentItemIds, note));
}

/** Who may receive a forwarded package: the named LA, or an LA of the branch the DP chose (with the permission). */
export function mayReceive(u: CurrentUser, a: { receivingLaId: string | null; receivingBranchId: string | null; loan: { branchId: string } }) {
  if (!can(u, PERMISSIONS.RETURNS_ACCEPT)) return false;
  return a.receivingLaId === u.id || inScope(u, a.receivingBranchId ?? a.loan.branchId);
}

/** Phase 5 for real: the named LA (in the branch the DP chose), or an LA of that branch. */
export async function receivePackage(u: CurrentUser, id: string, input: ReceiveInput | boolean, legacyNote = "") {
  const r: ReceiveInput = typeof input === "boolean" ? { result: input ? "complete" : "incomplete", note: legacyNote } : input;
  if (!can(u, PERMISSIONS.RETURNS_ACCEPT)) throw new UserError("Your role does not allow accepting returned papers.");
  const a0 = await loadAssignment(prisma, id);
  if (!mayReceive(u, a0)) throw new NotInScopeError();
  if (!["complete", "incomplete", "other"].includes(r.result)) throw new UserError("Pick Complete, Incomplete or Other.", "result");
  if (r.result !== "complete" && r.note.trim().length < 3) throw new UserError(r.result === "other" ? "Say what it is." : "Say what is missing or wrong.", "note");
  if (r.note.trim().length > 300) throw new UserError("Keep the note under 300 characters.", "note");
  return withLoanLock(a0.loanId, async (tx) => receiveCore(tx, await loadAssignment(tx, id), whoOf(u), { ...r, note: r.note.trim() }));
}

/** The DP changes the funds flag after accepting (audit row). */
export async function changeFundsFlag(u: CurrentUser, id: string, needed: boolean, kinds: string[]) {
  return withJob(u, id, async (tx, a) => {
    if (a.status !== "ACCEPTED") throw new UserError("Accept the job first.");
    if (needed && kinds.length === 0) throw new UserError("Tick what the funds are for.", "fundsKinds");
    const before = { fundsNeeded: a.transaction.fundsNeeded, fundsKinds: a.transaction.fundsKinds };
    const after = { fundsNeeded: needed ? "YES" : "NO", fundsKinds: needed ? kinds : [] } as const;
    await tx.loanTransaction.update({ where: { id: a.transactionId }, data: { fundsNeeded: after.fundsNeeded, fundsKinds: after.fundsKinds as never, fundsFlaggedAt: new Date() } });
    await audit(tx, whoOf(u), a, "funds_flag_changed", null, `${u.name} changed the funds flag on ${a.transaction.type.name}: ${needed ? `needs funds (${kinds.join(", ")})` : "no funds needed"}`, { before, after });
    await recomputeStage(tx, a.loanId);
  });
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

/** Who "owns" a transaction for problems and holds: the DP on an active job, or the LA while it is in the LA's hands (or LA-owned types like EDST). */
export async function ownsTransaction(u: CurrentUser, t: { id: string; status: string; type: { ownerRole: string }; loan: { branchId: string } }) {
  const job = await prisma.dpAssignment.findFirst({ where: { transactionId: t.id, status: { in: ["PENDING_ACCEPTANCE", "ACCEPTED"] } }, orderBy: { createdAt: "desc" } });
  if (job && (job.dpUserId === u.id || job.secondaryDpUserId === u.id) && can(u, PERMISSIONS.JOBS_WORK)) return true;
  if (can(u, PERMISSIONS.CHECKLIST_TICK) && inScope(u, t.loan.branchId)) {
    if (t.type.ownerRole === "LA") return true;
    if (["FOR_CHECKLIST", "READY", "RETURNED", "FORWARDED"].includes(t.status)) return true;
  }
  return false;
}

export async function raiseProblem(u: CurrentUser, input: { transactionId: string; reasonId: string; note: string }) {
  if (!can(u, PERMISSIONS.PROBLEMS_RAISE)) throw new UserError("Your role does not allow raising problems.");
  const t = await prisma.loanTransaction.findUnique({ where: { id: input.transactionId }, include: { type: true, loan: true, problems: true } });
  if (!t || !inScope(u, t.loan.branchId)) throw new NotInScopeError();
  if (!(await ownsTransaction(u, t))) throw new UserError("You can raise a problem only on transactions you work on.");
  const reason = await prisma.problemReason.findUnique({ where: { id: input.reasonId } });
  if (!reason || !reason.active) throw new UserError("Pick a reason.", "reasonId");
  return withLoanLock(t.loanId, async (tx) => {
    const jobStageId = await currentStageIdFor(tx, t.id);
    const p = await tx.problem.create({ data: { jobStageId, loanId: t.loanId, transactionId: t.id, reasonId: reason.id, note: input.note.trim(), raisedById: u.id, raisedByLabel: u.name } });
    await writeAudit(tx, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "problem_raised", entityType: "Problem", entityId: p.id, loanId: t.loanId, pn: t.loan.pn, summary: `Problem on ${t.type.name}: ${reason.name}`, details: { note: input.note } });
    await notifyProblem(tx, { loanId: t.loanId, transactionId: t.id, loan: t.loan, transaction: t }, reason.name, "opened");
    return p.id;
  });
}

export async function resolveProblem(u: CurrentUser, problemId: string, note: string) {
  const p = await prisma.problem.findUnique({ where: { id: problemId }, include: { transaction: { include: { type: true, loan: true } }, reason: true } });
  if (!p || !inScope(u, p.transaction.loan.branchId)) throw new NotInScopeError();
  if (p.resolvedAt) throw new UserError("This problem is already resolved.");
  const any = can(u, PERMISSIONS.PROBLEMS_RESOLVE_ANY);
  if (!any && !(can(u, PERMISSIONS.PROBLEMS_RESOLVE) && (await ownsTransaction(u, p.transaction)))) throw new UserError("You can resolve problems only on transactions you work on.");
  if (note.trim().length < 3) throw new UserError("Say how it was resolved.", "note");
  return withLoanLock(p.loanId, async (tx) => {
    await tx.problem.update({ where: { id: p.id }, data: { resolvedAt: new Date(), resolvedById: u.id, resolvedByLabel: u.name, resolutionNote: note.trim() } });
    await writeAudit(tx, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "problem_resolved", entityType: "Problem", entityId: p.id, loanId: p.loanId, pn: p.transaction.loan.pn, summary: `Problem resolved on ${p.transaction.type.name} (${p.reason.name}): ${note.trim()}` });
    await notifyProblem(tx, { loanId: p.loanId, transactionId: p.transactionId, loan: p.transaction.loan, transaction: p.transaction }, p.reason.name, "resolved");
  });
}

/** Tag a problem "Outside our control" (reports only; the clock is not changed). */
export async function markOutsideControl(u: CurrentUser, problemId: string, on: boolean) {
  if (!can(u, PERMISSIONS.PROBLEMS_OUTSIDE)) throw new UserError("Only an Admin can mark a problem outside our control.");
  const p = await prisma.problem.findUnique({ where: { id: problemId }, include: { transaction: { include: { type: true, loan: true } }, reason: true } });
  if (!p || !inScope(u, p.transaction.loan.branchId)) throw new NotInScopeError();
  await prisma.$transaction(async (tx) => {
    await tx.problem.update({ where: { id: p.id }, data: { outsideControl: on, outsideMarkedById: u.id, outsideMarkedAt: new Date() } });
    await writeAudit(tx, { actor: { id: u.id, label: u.name }, mode: "MANUAL", action: "problem_outside_control", entityType: "Problem", entityId: p.id, loanId: p.loanId, pn: p.transaction.loan.pn, summary: `Problem on ${p.transaction.type.name} (${p.reason.name}) ${on ? "marked" : "no longer marked"} outside our control`, before: { outsideControl: p.outsideControl }, after: { outsideControl: on } });
  });
}

export { loadAssignment };
