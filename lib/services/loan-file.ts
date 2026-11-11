import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { can, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getMyLoansAdapter, type MyLoansRecord } from "@/lib/myloans";
import { getPnFormat, parsePn, pnHeadline } from "@/lib/pn";
import { reportUnknownBranchCode, resolveLoanBranch } from "./branches";
import { runDataCheck, type DataCheckField } from "@/lib/myloans/data-check";
import { accountColumns } from "@/lib/myloans/account";
import {
  classifyProductName,
  evaluateLoanRules,
  RuleInputError,
  TRANSACTION_ORDER,
  type FinancingType,
  type OrcrStatus,
  type RuleOutcome,
  type TransactionCode,
} from "@/lib/rules";
import { businessDate, startOfBusinessDay } from "@/lib/time";
import { recomputeStage } from "./stage";
import { getSetting } from "@/lib/settings";
import { linkOnOpen, refreshLoan, refreshOnOpen, sameBorrowerLoans, suggestOnOpen } from "./source-sync";
import { hashTracked, trackedOf } from "@/lib/myloans/changes";
import { UserError } from "./errors";

// ---------------------------------------------------------------------------
// PN search (step 1.1 - 1.3). Nothing is saved for a new PN.
// ---------------------------------------------------------------------------

export type PnLookupResult =
  | { kind: "existing"; pn: string; refreshed: boolean; refreshMessage?: string }
  | { kind: "invalid"; message: string; part?: string }
  | { kind: "not_found"; pn: string; message: string }
  | { kind: "unavailable"; pn: string; message: string }
  | { kind: "refused"; pn: string; field: DataCheckField; fieldLabel: string; message: string; record: MyLoansRecord }
  | {
      kind: "preview";
      pn: string;
      record: MyLoansRecord;
      amount: number;
      classification: "FINANCING" | "REFINANCING";
      classificationRule: string;
      /** Outcome for Refinancing (no LA picks needed). Null for Financing until the LA picks. */
      outcome: RuleOutcome | null;
      canOpen: boolean;
      /** Same borrower (CIN or CIF), any loan file: "This borrower has another loan: PN-...". Others outside the user's branches are only counted. */
      otherLoans: string[];
      otherHidden: number;
      /** MyLoans says this PN replaces another one. */
      replacesPn: string | null;
    };

/** Inactive branch or loan type (Settings): no NEW loan files. Existing loan files are not affected. */
async function inactiveRefusal(record: MyLoansRecord): Promise<{ field: DataCheckField; fieldLabel: string; message: string } | null> {
  const branch = await resolveLoanBranch(prisma, record);
  if (branch && (!branch.active || branch.hidden)) {
    return { field: "branch", fieldLabel: "Inactive branch", message: `${branch.name} is ${branch.hidden ? "hidden" : "inactive"} in Settings, so no new loan files can be opened for it.` };
  }
  const lt = record.loanType ? await prisma.loanType.findUnique({ where: { code: record.loanType } }) : null;
  if (lt && !lt.active) {
    return { field: "loanType", fieldLabel: "Inactive loan type", message: `The loan type ${lt.name} is inactive in Settings, so no new loan files can be opened with it.` };
  }
  return null;
}

function allowedBranches(user: CurrentUser): { code: string | null; name: string }[] | null {
  return user.scopeBranchIds === null ? null : user.branchNames.map((name, i) => ({ name, code: user.branchCodes[i] ?? null }));
}

/**
 * The shared PN check (Settings, System, PN format): a wrong PN never reaches MyLoans. Returns the PN as
 * it will be stored, or the message naming the wrong part.
 */
async function pnOf(input: string): Promise<{ ok: true; pn: string } | { ok: false; message: string; part: string }> {
  const f = await getPnFormat();
  const r = parsePn(input, f);
  return r.ok ? { ok: true, pn: r.pn } : { ok: false, message: `${pnHeadline(f)}. ${r.message}`, part: r.part };
}

/**
 * Codes MyLoans uses that no DMS branch has (the PN's "opened at" code, the loan's branch code): the
 * Branch review is told; the lookup is never blocked by it.
 */
async function noteUnknownCodes(rec: MyLoansRecord) {
  const f = await getPnFormat();
  const p = parsePn(rec.pn, f);
  const codes = new Map<string, string | null>();
  if (p.ok && p.parts) codes.set(p.parts.branchCode, null);
  if (rec.branchCode && /^\d{3}$/.test(rec.branchCode)) codes.set(rec.branchCode, rec.branchName);
  for (const [code, name] of codes) await reportUnknownBranchCode(code, rec.pn, name).catch(() => null);
}

export async function lookupPn(user: CurrentUser, input: string): Promise<PnLookupResult> {
  if (!can(user, PERMISSIONS.LOANS_SEARCH)) throw new UserError("You do not have permission to search MyLoans.");
  const checked = await pnOf(input);
  if (!checked.ok) return { kind: "invalid", message: checked.message, part: checked.part };
  const pn = checked.pn;

  // Existing Loan File: open it and refresh from MyLoans. Rules never run again.
  const existing = await prisma.loan.findUnique({ where: { pn }, select: { id: true, branchId: true } });
  if (existing) {
    if (!inScope(user, existing.branchId)) {
      // Do not reveal another branch's Loan File.
      return { kind: "refused", pn, field: "branch", fieldLabel: "Branch", message: "Outside your branch access.", record: emptyRecord(pn) };
    }
    // Refreshed only when the copy is older than the setting (Settings > MyLoans sync).
    const loan = await prisma.loan.findUniqueOrThrow({ where: { id: existing.id }, select: { id: true, lastCheckedAt: true, retrievedAt: true } });
    const r = await refreshOnOpen(loan);
    return { kind: "existing", pn, refreshed: !r || r.ok, refreshMessage: r && !r.ok ? r.message : undefined };
  }

  const lookup = await getMyLoansAdapter().getByPn(pn);
  if (!lookup.ok) {
    return lookup.reason === "NOT_FOUND"
      ? { kind: "not_found", pn, message: lookup.message }
      : { kind: "unavailable", pn, message: lookup.message };
  }
  await noteUnknownCodes(lookup.record);
  const check = runDataCheck(lookup.record, { allowedBranches: allowedBranches(user), today: businessDate(new Date()) });
  if (!check.ok) {
    return { kind: "refused", pn, field: check.field, fieldLabel: check.fieldLabel, message: check.message, record: lookup.record };
  }
  const off = await inactiveRefusal(lookup.record);
  if (off) return { kind: "refused", pn, ...off, record: lookup.record };
  const cls = classifyProductName(check.normalized.productName);
  const outcome =
    cls.classification === "REFINANCING"
      ? evaluateLoanRules({ productName: check.normalized.productName, loanType: check.normalized.loanType, totalReleasedAmount: check.normalized.totalReleasedAmount })
      : null;
  return {
    kind: "preview",
    pn,
    record: lookup.record,
    amount: check.normalized.totalReleasedAmount,
    classification: cls.classification,
    classificationRule: cls.rule,
    outcome,
    canOpen: can(user, PERMISSIONS.LOANS_OPEN),
    ...(await otherLoansOf(user, lookup.record)),
    replacesPn: lookup.record.previousPn ?? null,
  };
}

async function otherLoansOf(user: CurrentUser, rec: { cin: string | null; cif: string | null }) {
  const all = await sameBorrowerLoans(prisma, { cin: rec.cin, cif: rec.cif });
  const branches = await prisma.loan.findMany({ where: { id: { in: all.map((l) => l.id) } }, select: { id: true, branchId: true } });
  const mine = all.filter((l) => inScope(user, branches.find((b) => b.id === l.id)?.branchId ?? ""));
  return { otherLoans: mine.map((l) => l.pn), otherHidden: all.length - mine.length };
}

function emptyRecord(pn: string): MyLoansRecord {
  return { pn, cin: null, cif: null, sourceLoanId: null, borrowerName: "", branchName: null, branchCode: null, status: null, loanType: null, productName: null, totalReleasedAmount: null, releaseDate: null };
}

// ---------------------------------------------------------------------------
// Open Loan File (step 1.4) + automatic engine (Phase 2)
// ---------------------------------------------------------------------------

export interface OpenLoanInput {
  pn: string;
  financingType?: FinancingType | null;
  orcrStatus?: OrcrStatus | null;
}

export async function openLoanFile(user: CurrentUser, input: OpenLoanInput): Promise<{ pn: string; alreadyOpen: boolean }> {
  if (!can(user, PERMISSIONS.LOANS_OPEN)) throw new UserError("Your role does not allow opening loan files.");
  const checked = await pnOf(input.pn);
  if (!checked.ok) throw new UserError(checked.message, "pn");
  const pn = checked.pn;

  const already = await prisma.loan.findUnique({ where: { pn }, select: { branchId: true } });
  if (already) {
    if (!inScope(user, already.branchId)) throw new UserError("Outside your branch access.", "branch");
    return { pn, alreadyOpen: true };
  }

  // Never trust the preview: call MyLoans again and re-run the Data Check on the server.
  const lookup = await getMyLoansAdapter().getByPn(pn);
  if (!lookup.ok) throw new UserError(lookup.message, "pn");
  const check = runDataCheck(lookup.record, { allowedBranches: allowedBranches(user), today: businessDate(new Date()) });
  if (!check.ok) throw new UserError(check.message, check.field);
  const off = await inactiveRefusal(lookup.record);
  if (off) throw new UserError(off.message, off.field);
  const branch = await resolveLoanBranch(prisma, lookup.record);
  if (!branch) {
    await noteUnknownCodes(lookup.record);
    throw new UserError(`MyLoans puts this loan at ${lookup.record.branchName ?? "a branch"}${lookup.record.branchCode ? ` (${lookup.record.branchCode})` : ""}, which is not a branch here yet. Admin was told (Branch review).`, "branch");
  }
  if (!inScope(user, branch.id)) throw new UserError("Outside your branch access.", "branch");

  let outcome: RuleOutcome;
  try {
    outcome = evaluateLoanRules({
      productName: check.normalized.productName,
      loanType: check.normalized.loanType,
      totalReleasedAmount: check.normalized.totalReleasedAmount,
      financingType: input.financingType ?? null,
      orcrStatus: input.orcrStatus ?? null,
    });
  } catch (e) {
    if (e instanceof RuleInputError) throw new UserError(e.message, e.field);
    throw e;
  }

  const actor: Actor = { id: user.id, label: user.name };
  const rec = lookup.record;
  try {
    await withLoanLock(null, async (tx) => {
      const loan = await tx.loan.create({
        data: {
          pn,
          cin: rec.cin,
          cif: rec.cif,
          sourceLoanId: rec.sourceLoanId,
          borrowerName: rec.borrowerName,
          branchId: branch.id,
          loanType: check.normalized.loanType,
          productName: check.normalized.productName,
          totalReleasedAmount: new Prisma.Decimal(check.normalized.totalReleasedAmount),
          releasedAt: startOfBusinessDay(check.normalized.releaseDate),
          sourceStatus: rec.status ?? "",
          // The account details as MyLoans gave them (docs/myloans/field-map.md).
          ...accountColumns(rec),
          retrievedAt: lookup.retrievedAt,
          openedById: user.id,
          classification: outcome.classification,
          financingType: outcome.financingType,
          orcrStatus: outcome.orcrStatus,
          mortgageResult: outcome.mortgage,
          ruleFired: outcome.summary,
          stage: "Opened",
        },
      });
      const tracked = trackedOf(rec);
      await tx.loanSourceSnapshot.create({
        data: { loanId: loan.id, retrievedAt: lookup.retrievedAt, adapter: lookup.adapter, payload: lookup.raw as Prisma.InputJsonValue, tracked: tracked as unknown as Prisma.InputJsonValue, hash: hashTracked(tracked), kind: "BASE" },
      });
      // Not yet sent: tier B, first background check after its interval.
      const tiers = await getSetting("myloans.tierMinutes", tx);
      await tx.loan.update({ where: { id: loan.id }, data: { lastCheckedAt: lookup.retrievedAt, syncTier: "B", nextCheckAt: new Date(lookup.retrievedAt.getTime() + tiers.B * 60_000) } });
      await writeAudit(tx, {
        actor, mode: "MANUAL", action: "loan_file_opened", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn,
        journeyStep: "1.4",
        summary: `Opened Loan File from the MyLoans record (retrieved ${lookup.retrievedAt.toISOString()})`,
        after: { pn, branch: branch.name, branchCode: branch.code, loanType: check.normalized.loanType, amount: check.normalized.totalReleasedAmount, productName: check.normalized.productName },
        details: { dataCheck: "passed", adapter: lookup.adapter },
      });

      // Phase 2: automatic decisions. No confirmation dialog.
      const inputs = {
        productName: check.normalized.productName,
        loanType: check.normalized.loanType,
        totalReleasedAmount: check.normalized.totalReleasedAmount,
        orcrStatus: outcome.orcrStatus,
        financingType: outcome.financingType,
      };
      await writeAudit(tx, {
        actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "classification_applied", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn,
        journeyStep: "2.1",
        summary: `Classified as ${outcome.classification === "FINANCING" ? "Financing" : "Refinancing"}`,
        after: { classification: outcome.classification },
        details: { inputs, rule: outcome.rulesFired[0] },
      });
      if (outcome.classification === "FINANCING") {
        await writeAudit(tx, {
          actor, mode: "MANUAL", action: "financing_choices_recorded", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn,
          journeyStep: "2.3",
          summary: `LA picked ${outcome.financingType === "UNDERTAKING" ? "Undertaking" : "Non-Undertaking"} and ORCR ${outcome.orcrStatus === "TRANSFERRED" ? "Transferred" : "Untransferred"} on the preview card`,
          after: { financingType: outcome.financingType, orcrStatus: outcome.orcrStatus },
        });
      }
      await writeAudit(tx, {
        actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "mortgage_determined", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn,
        journeyStep: "2.4",
        summary: outcome.mortgage === "NOT_EVALUATED" ? "Mortgage not evaluated (Financing + ORCR Untransferred)" : `Mortgage result: ${outcome.mortgage === "MORTGAGE" ? "Mortgage" : "Not Mortgage"}`,
        after: { mortgageResult: outcome.mortgage },
        details: { inputs, rulesFired: outcome.rulesFired },
      });
      await createTransactions(tx, { loanId: loan.id, pn, codes: outcome.transactions, origin: "AUTOMATIC" });
      await writeAudit(tx, {
        actor: SYSTEM_ACTOR, mode: "AUTOMATIC", action: "transactions_generated", entityType: "Loan", entityId: loan.id, loanId: loan.id, pn,
        journeyStep: "2.6",
        summary: `Created ${outcome.transactions.length} transactions, auto-confirmed the selection and created the expected document set`,
        after: { transactions: outcome.transactions },
        details: { inputs, rulesFired: outcome.rulesFired, ruleThatFired: outcome.summary },
      });
      await recomputeStage(tx, loan.id);
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Someone else opened it a moment ago.
      return { pn, alreadyOpen: true };
    }
    throw e;
  }
  // MyLoans says it replaces another PN: link both files and raise the review item on the old one.
  if (rec.previousPn) await linkOnOpen(pn, rec.previousPn);
  else await suggestOnOpen(pn);
  return { pn, alreadyOpen: false };
}

/** Creates transactions with their checklist rows and expected document items. */
export async function createTransactions(
  tx: Tx,
  args: { loanId: string; pn: string; codes: TransactionCode[]; origin: "AUTOMATIC" | "OVERRIDE" },
) {
  const types = await tx.transactionType.findMany({
    where: { code: { in: args.codes } },
    include: { rules: { where: { active: true }, include: { documentType: true }, orderBy: { sortOrder: "asc" } } },
  });
  const ordered = TRANSACTION_ORDER.filter((c) => args.codes.includes(c)).map((c) => types.find((t) => t.code === c)!);
  for (const type of ordered) {
    if (!type) throw new Error("Transaction type missing from Settings");
    await createTransactionOfType(tx, { loanId: args.loanId, type, origin: args.origin });
  }
}

/**
 * One transaction with its checklist copied from the type's active checklist items (and the
 * expected document items). Used by the automation and by "Add a transaction" (custom types).
 */
export async function createTransactionOfType(
  tx: Tx,
  args: {
    loanId: string;
    type: { id: string; rules: { id: string; required: boolean; label: string; originality: "ORIGINAL" | "COPY"; documentType: { code: string } }[] };
    origin: "AUTOMATIC" | "OVERRIDE" | "ADDED";
  },
) {
  const txn = await tx.loanTransaction.create({ data: { loanId: args.loanId, typeId: args.type.id, origin: args.origin } });
  for (const rule of args.type.rules) {
    // Copy the rule's Required flag: later Settings changes do not affect this loan file.
    const check = await tx.checklistCheck.create({ data: { transactionId: txn.id, ruleId: rule.id, required: rule.required } });
    await tx.documentItem.create({
      data: {
        loanId: args.loanId,
        transactionId: txn.id,
        checkId: check.id,
        docTypeCode: rule.documentType.code,
        label: rule.label,
        originality: rule.originality,
      },
    });
  }
  return txn;
}

// ---------------------------------------------------------------------------
// Refresh from MyLoans (the button, loans:refresh): a refresh now, with the result in plain words.
export const NO_REFRESH = "Ask an Admin to turn on \"Refresh a loan from MyLoans\" for your role.";
// ---------------------------------------------------------------------------

export async function refreshFromMyLoans(user: CurrentUser, loanId: string): Promise<{ ok: true; changed: boolean; minor: boolean } | { ok: false; message: string }> {
  if (!can(user, PERMISSIONS.LOANS_REFRESH)) throw new UserError(NO_REFRESH);
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan || !inScope(user, loan.branchId)) throw new UserError("Loan File not found.");
  const r = await refreshLoan(loan.id, { actor: { id: user.id, label: user.name }, mode: "MANUAL", trigger: "button" });
  return r.ok ? { ok: true, changed: r.outcome === "review", minor: r.outcome === "minor" } : { ok: false, message: r.message };
}
