import "server-only";
import { arriveItem, closeItem, openItem, takeItem } from "./work-items";
import { Prisma } from "@prisma/client";
import { prisma, withLoanLock, type Tx } from "@/lib/db";
import { writeAudit, SYSTEM_ACTOR, type Actor } from "@/lib/audit";
import { can, hasAllBranches, inScope, type CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logPnSearch, type PnOutcome } from "./pn-search-log";
import { getMyLoansAdapter, myLoansMode, type MyLoansRecord } from "@/lib/myloans";
import { getPnFormat, parsePn, pnHeadline } from "@/lib/pn";
import { reportUnknownBranchCode, resolveLoanBranch } from "./branches";
import { inBranches, runDataCheck, type DataCheckField } from "@/lib/myloans/data-check";
import { hasCached, lookupPn as cachedLookup } from "@/lib/myloans/client";
import { recordStatusKind, statusFromId, statusLabel, type StatusKind } from "@/lib/myloans/status";
import { accountColumns } from "@/lib/myloans/account";
import {
  classifyProductName,
  evaluateLoanRules,
  RuleInputError,
  TRANSACTION_ORDER,
  type FinancingType,
  type LoanTypeValue,
  type OrcrStatus,
  type RuleOutcome,
  type TransactionCode,
  determineMortgage,
} from "@/lib/rules";
import { businessDate, startOfBusinessDay } from "@/lib/time";
import { recomputeStage } from "./stage";
import { getClassificationRules, getSetting, setSetting } from "@/lib/settings";
import { refreshLoan } from "./source-sync";
import { hashTracked, trackedOf } from "@/lib/myloans/changes";
import { UserError } from "./errors";

// ---------------------------------------------------------------------------
// PN search (step 1.1 - 1.3). Nothing is saved for a new PN.
// ---------------------------------------------------------------------------

export type PnLookupResult =
  /** Saved in the DMS and in the person's branches: Find a loan shows "Already in the DMS" (no MyLoans call here). */
  | { kind: "existing"; pn: string }
  | { kind: "invalid"; message: string; part?: string }
  | { kind: "not_found"; pn: string; message: string }
  /**
   * In MyLoans and in the person's branches, but not the one accepted status (lib/myloans/status.ts):
   * a card with the real status name, never a loan file and never a saved copy.
   */
  | { kind: "status"; pn: string; statusKind: Exclude<StatusKind, "released" | "not_a_loan">; statusName: string; borrowerName: string; branchName: string | null; /** The MyLoans record (in the person's branches only): the same eight details as a released loan. */ record: MyLoansRecord }
  /**
   * D-050: in myloans but not a released loan (API 1 422): why, in myloans' words (FeedState), and after a redo the PN
   * that replaced it (with a link when that PN is already in the DMS). No borrower details: API 1 sends none for it.
   */
  | { kind: "not_selectable"; pn: string; message: string; feedState: string; statusName: string | null; replacedByPn: string | null; replacedInDms: boolean }
  /** D-050: several records for one PN and none released (API 1 409): Admin is told. */
  | { kind: "multiple"; pn: string; message: string }
  /** busy: the hourly limit or the circuit breaker stopped the call ("MyLoans is busy..."). */
  | { kind: "unavailable"; pn: string; message: string; busy?: boolean }
  | { kind: "refused"; pn: string; field: DataCheckField; fieldLabel: string; message: string; record: MyLoansRecord }
  | {
      kind: "preview";
      pn: string;
      record: MyLoansRecord;
      /** The released amount; null without "See loan amounts" (D-062: then it is not sent to the browser). */
      amount: number | null;
      /** Rule 4 worked out on the server (at or under the threshold): what the page needs instead of the amount. */
      mortgageMet: boolean;
      /** The checked loan type and product name: what the rules read (the card shows what will be set up). */
      loanType: LoanTypeValue;
      productName: string | null;
      classification: "FINANCING" | "REFINANCING";
      classificationRule: string;
      /** No keyword matched: the default decided it (D-031: a small label, never a block). */
      classifiedByDefault: boolean;
      /** Outcome for Refinancing (no LA picks needed). Null for Financing until the LA picks. */
      outcome: RuleOutcome | null;
      canOpen: boolean;
      /** Same borrower (CIN or CIF), any loan file: "This borrower has another loan: PN-...". Others outside the user's branches are only counted. */
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
  return hasAllBranches(user) ? null : user.branchNames.map((name, i) => ({ name, code: user.branchCodes[i] ?? null }));
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

/** Find loan (D-050): the lookup, and one line in the PN search log for what happened. */
export async function lookupPn(user: CurrentUser, input: string): Promise<PnLookupResult> {
  const r = await lookupPnInner(user, input);
  const pn = "pn" in r ? r.pn : input.trim().toUpperCase();
  const rec = "record" in r ? r.record : null;
  const outcome: PnOutcome = r.kind === "invalid" ? "INVALID" : r.kind === "existing" ? "FOUND_IN_DMS" : r.kind === "not_found" ? "NOT_FOUND"
    : r.kind === "status" || r.kind === "not_selectable" ? "NOT_SELECTABLE" : r.kind === "multiple" ? "MULTIPLE"
    : r.kind === "unavailable" ? (r.busy ? "BUSY" : "UNAVAILABLE") : r.kind === "refused" ? "REFUSED" : "PREVIEW";
  const loanBranchId = r.kind === "existing" || (r.kind === "refused" && r.field === "branch")
    ? (await prisma.loan.findUnique({ where: { pn }, select: { branchId: true } }))?.branchId ?? null
    : rec?.branchCode ? (await prisma.branch.findUnique({ where: { code: rec.branchCode }, select: { id: true } }))?.id ?? null : null;
  await logPnSearch(user, pn, outcome, { statusId: rec?.statusId ?? null, feedState: r.kind === "not_selectable" ? r.feedState : rec?.feedState ?? null, loanBranchId });
  return can(user, PERMISSIONS.LOANS_VIEW_AMOUNTS) ? r : withoutAmount(r);
}

/** D-062: without "See loan amounts" the lookup carries no amount (the preview, the search card, the status cards). */
function withoutAmount(r: PnLookupResult): PnLookupResult {
  const out = "record" in r && r.record ? { ...r, record: { ...r.record, totalReleasedAmount: null } } : r;
  return out.kind === "preview" ? { ...out, amount: null } : out;
}

async function lookupPnInner(user: CurrentUser, input: string): Promise<PnLookupResult> {
  if (!can(user, PERMISSIONS.LOANS_SEARCH)) throw new UserError("You do not have permission to search MyLoans.");
  const checked = await pnOf(input);
  if (!checked.ok) return { kind: "invalid", message: checked.message, part: checked.part };
  const pn = checked.pn;

  // The DMS first: a saved loan file is handled from the DMS, with no MyLoans call (the stale refresh
  // runs later, in the background, from the "Already in the DMS" card). Rules never run again.
  const existing = await prisma.loan.findUnique({ where: { pn }, select: { id: true, branchId: true, branch: { select: { name: true } } } });
  if (existing) {
    if (!inScope(user, existing.branchId)) {
      // Another branch's Loan File: the branch only (already in the PN), so the person knows which access to ask for.
      return { kind: "refused", pn, field: "branch", fieldLabel: "Branch", message: "Outside your branch access.", record: outsideRecord(pn, existing.branch.name) };
    }
    return { kind: "existing", pn };
  }

  // The one MyLoans call for an unsaved PN, through the shared client: a second look within its short
  // cache time (a reload of the status card) reuses this answer instead of asking again. It counts toward
  // the hourly limit; when the limit or the circuit breaker stops it, the person is told MyLoans is busy
  // (never "not found").
  // The count is shared by every instance and reserved in one atomic step (lib/myloans/client.ts).
  const adapter = getMyLoansAdapter();
  const ceiling = await getSetting("myloans.hourlyCeiling");
  const stopped = (await adapter.breakerState()).open;
  // The sample MyLoans: a simulated change to this PN is a new answer (not hidden by the cache).
  const variant = myLoansMode() === "mock"
    // The mock's rows and any simulated change for this PN (the overlay): a change is a new answer, not hidden by the cache.
    ? `find:${JSON.stringify([
        await prisma.mockMyLoansTxn.findMany({ where: { pnNo: pn }, select: { id: true, updatedAt: true, statusId: true, replacedById: true, amount: true, firstName: true, lastName: true, branchId: true, productId: true } }),
        (await getSetting("myloans.mockOverrides"))[pn] ?? null,
        (await getSetting("myloans.mockExtra")).find((r) => r.pn === pn) ?? null,
      ])}`
    : undefined;
  const lookup = stopped && !hasCached(pn, Date.now(), variant) ? null : await cachedLookup(adapter, pn, { variant, ceiling });
  if (!lookup || (!lookup.ok && (lookup.limited || (lookup.reason === "UNAVAILABLE" && (await adapter.breakerState()).open)))) {
    return { kind: "unavailable", pn, message: MYLOANS_BUSY, busy: true };
  }
  if (!lookup.ok) {
    if (lookup.reason === "NOT_FOUND") return { kind: "not_found", pn, message: NOT_IN_MYLOANS };
    if (lookup.reason === "NOT_SELECTABLE") {
      const rep = lookup.replacedByPnNo ?? null;
      const inDms = rep ? !!(await prisma.loan.findUnique({ where: { pn: rep }, select: { id: true } })) : false;
      return { kind: "not_selectable", pn, message: lookup.message, feedState: lookup.feedState ?? "NotReleased", statusName: lookup.statusId === undefined || recordStatusKind({ statusId: String(lookup.statusId) }) === "not_a_loan" ? null : statusFromId(lookup.statusId).statusName, replacedByPn: rep, replacedInDms: inDms };
    }
    if (lookup.reason === "MULTIPLE") return { kind: "multiple", pn, message: lookup.message };
    return { kind: "unavailable", pn, message: lookup.message };
  }
  // Statuses 15 to 19 are not loans (the adapter already answers "not found"; this is the second guard).
  const sk = recordStatusKind(lookup.record);
  if (sk === "not_a_loan") return { kind: "not_found", pn, message: NOT_IN_MYLOANS };
  await noteUnknownCodes(lookup.record);
  const mine = allowedBranches(user);
  if (sk !== "released") {
    // The branch check first: a loan outside the person's branches shows only its PN and branch.
    if (mine !== null && !inBranches(lookup.record, mine)) {
      return { kind: "refused", pn, field: "branch", fieldLabel: "Branch", message: "Outside your branch access.", record: outsideRecord(pn, lookup.record.branchName) };
    }
    return { kind: "status", pn, statusKind: sk, statusName: statusLabel(lookup.record), borrowerName: lookup.record.borrowerName, branchName: lookup.record.branchName, record: lookup.record };
  }
  const check = runDataCheck(lookup.record, { allowedBranches: allowedBranches(user), today: businessDate(new Date()) });
  if (!check.ok) {
    if (check.field === "borrowerName") await noteNoName(lookup.record);
    // Outside the person's branches: the branch only, like the other refusals above.
    const record = check.field === "branch" ? outsideRecord(pn, lookup.record.branchName) : lookup.record;
    return { kind: "refused", pn, field: check.field, fieldLabel: check.fieldLabel, message: check.message, record };
  }
  const off = await inactiveRefusal(lookup.record);
  if (off) return { kind: "refused", pn, ...off, record: lookup.record };
  // The keyword lists and default saved in Settings, Product classification (D-031).
  const classificationRules = await getClassificationRules();
  const cls = classifyProductName(check.normalized.productName, classificationRules, lookup.record.productCode);
  const outcome =
    cls.classification === "REFINANCING"
      ? evaluateLoanRules({ productName: check.normalized.productName, loanType: check.normalized.loanType, totalReleasedAmount: check.normalized.totalReleasedAmount, classificationRules, productCode: lookup.record.productCode })
      : null;
  return {
    kind: "preview",
    pn,
    record: lookup.record,
    amount: check.normalized.totalReleasedAmount,
    mortgageMet: determineMortgage(check.normalized.loanType, check.normalized.totalReleasedAmount).result === "MORTGAGE",
    loanType: check.normalized.loanType,
    productName: check.normalized.productName,
    classification: cls.classification,
    classificationRule: cls.rule,
    classifiedByDefault: cls.byDefault,
    outcome,
    canOpen: can(user, PERMISSIONS.LOANS_OPEN),
    replacesPn: lookup.record.previousPn ?? (await redoneFrom(lookup.record)),
  };
}

/**
 * D-050: a redo in myloans keeps the CIN on a new PN. The PN this one replaces: another DMS loan file with the same CIN
 * that myloans no longer has as a released loan (cancelled or redone: its saved status or an open status review says
 * so). Two released loans that share a CIN are not treated as a replacement.
 */
async function redoneFrom(rec: { pn: string; cin: string | null }): Promise<string | null> {
  if (!rec.cin) return null;
  const other = await prisma.loan.findFirst({
    where: {
      cin: rec.cin, pn: { not: rec.pn },
      OR: [{ sourceStatus: { not: "RELEASED" } }, { openItems: { some: { status: "PENDING", field: "status" } } }],
    },
    select: { pn: true },
  });
  return other?.pn ?? null;
}


/** Admin data check (Settings, MyLoans sync): the loans refused because MyLoans has no borrower name. */
async function noteNoName(rec: MyLoansRecord) {
  const list = (await getSetting("myloans.noNameLoans")).filter((x) => x.pn !== rec.pn);
  await setSetting("myloans.noNameLoans", [{ pn: rec.pn, branch: rec.branchName, at: new Date().toISOString() }, ...list].slice(0, 50)).catch(() => null);
}

/** The hourly limit or the circuit breaker stopped the lookup. */
export const MYLOANS_BUSY = "MyLoans is busy, please try again in a few minutes.";

/** The one sentence for a PN MyLoans has no loan for. */
export const NOT_IN_MYLOANS = "No loan with this PN was found in MyLoans.";

/**
 * A loan outside the person's branches: the PN and the branch only (decided 12 November 2026; the branch is
 * already in the PN, and it tells the person which access to ask for). Never the borrower's name: PNs are
 * easy to guess. Nothing else of the loan leaves the server.
 */
function outsideRecord(pn: string, branchName: string | null | undefined): MyLoansRecord {
  return { ...emptyRecord(pn), branchName: branchName?.trim() || null };
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

/**
 * One loan file per PN (Loan.pn is unique). alreadyOpen: the file exists; byOther: someone else opened it
 * (for example two Loan Associates pressing Open loan file on the same new PN at the same moment).
 */
export async function openLoanFile(user: CurrentUser, input: OpenLoanInput): Promise<{ pn: string; alreadyOpen: boolean; byOther?: boolean }> {
  if (!can(user, PERMISSIONS.LOANS_OPEN)) throw new UserError("Your role does not allow opening loan files.");
  const checked = await pnOf(input.pn);
  if (!checked.ok) throw new UserError(checked.message, "pn");
  const pn = checked.pn;

  const already = await prisma.loan.findUnique({ where: { pn }, select: { branchId: true, openedById: true } });
  if (already) {
    if (!inScope(user, already.branchId)) throw new UserError("Outside your branch access.", "branch");
    return { pn, alreadyOpen: true, byOther: already.openedById !== user.id };
  }

  // Never trust the preview: call MyLoans again and re-run the Data Check on the server.
  const lookup = await getMyLoansAdapter().getByPn(pn);
  if (!lookup.ok) throw new UserError(lookup.message, "pn");
  const check = runDataCheck(lookup.record, { allowedBranches: allowedBranches(user), today: businessDate(new Date()) });
  if (!check.ok) {
    if (check.field === "borrowerName") await noteNoName(lookup.record);
    throw new UserError(check.message, check.field);
  }
  const off = await inactiveRefusal(lookup.record);
  if (off) throw new UserError(off.message, off.field);
  const branch = await resolveLoanBranch(prisma, lookup.record);
  if (!branch) {
    await noteUnknownCodes(lookup.record);
    throw new UserError(`MyLoans puts this loan at ${lookup.record.branchName ?? "a branch"}${lookup.record.branchCode ? ` (${lookup.record.branchCode})` : ""}, which is not a branch here yet. Admin was told (Branch review).`, "branch");
  }
  if (!inScope(user, branch.id)) throw new UserError("Outside your branch access.", "branch");

  let outcome: RuleOutcome;
  const classificationRules = await getClassificationRules();
  try {
    outcome = evaluateLoanRules({
      productName: check.normalized.productName,
      loanType: check.normalized.loanType,
      totalReleasedAmount: check.normalized.totalReleasedAmount,
      financingType: input.financingType ?? null,
      orcrStatus: input.orcrStatus ?? null,
      classificationRules,
      productCode: lookup.record.productCode,
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
          // D-050: myloans' identity of this copy (API 1), and the first row of its identity history.
          externalLoanId: rec.externalLoanId ?? null,
          contentHash: rec.contentHash ?? null,
          ...(rec.externalLoanId ? { sourceIdentities: { create: { externalLoanId: rec.externalLoanId, cin: rec.cin, pnNo: pn, contentHash: rec.contentHash ?? null, feedState: rec.feedState ?? null } } } : {}),
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
          // Saved when the LA opens (accepts) it (D-031); a later keyword change only flags it.
          classifiedByDefault: classifyProductName(check.normalized.productName, classificationRules, lookup.record.productCode).byDefault,
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
      await tx.loan.update({ where: { id: loan.id }, data: { lastCheckedAt: lookup.retrievedAt } });
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
      // Find loan (D-046 item 4): the LA's items arrive and are accepted at the same moment (waiting 0).
      await createTransactions(tx, { loanId: loan.id, pn, codes: outcome.transactions, origin: "AUTOMATIC", holderUserId: user.id });
      const candidate = await openItem(tx, "LOAN_CANDIDATE", pn);
      if (candidate) { await takeItem(tx, "LOAN_CANDIDATE", pn, user); await closeItem(tx, "LOAN_CANDIDATE", pn, "DONE", { by: { id: user.id, label: user.name } }); }
      // 10b: no longer "Released, not yet in the DMS".
      await tx.sourceLoanCandidate.deleteMany({ where: { pn } });
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
      // Someone else opened it a moment ago: land on that file.
      const won = await prisma.loan.findUnique({ where: { pn }, select: { openedById: true } });
      return { pn, alreadyOpen: true, byOther: won?.openedById !== user.id };
    }
    throw e;
  }
  // A redo of a loan we hold (myloans' own link): the old loan's status Open Item says "replaced by"; nothing is
  // linked here (Link as replacement on Related loans, D-051).
  await logPnSearch(user, pn, "OPENED", { statusId: rec.statusId ?? null, feedState: rec.feedState ?? null, loanBranchId: branch.id });
  return { pn, alreadyOpen: false };
}

/** Creates transactions with their checklist rows and expected document items. */
export async function createTransactions(
  tx: Tx,
  args: { loanId: string; pn: string; codes: TransactionCode[]; origin: "AUTOMATIC" | "OVERRIDE"; holderUserId?: string | null },
) {
  const types = await tx.transactionType.findMany({
    where: { code: { in: args.codes } },
    include: { rules: { where: { active: true }, include: { documentType: true }, orderBy: { sortOrder: "asc" } } },
  });
  const ordered = TRANSACTION_ORDER.filter((c) => args.codes.includes(c)).map((c) => types.find((t) => t.code === c)!);
  for (const type of ordered) {
    if (!type) throw new Error("Transaction type missing from Settings");
    await createTransactionOfType(tx, { loanId: args.loanId, type, origin: args.origin, holderUserId: args.holderUserId });
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
    /** D-046: the LA who opened the loan (or added it) has the work at once; null or missing: the branch LA pool. */
    holderUserId?: string | null;
  },
) {
  const txn = await tx.loanTransaction.create({ data: { loanId: args.loanId, typeId: args.type.id, origin: args.origin } });
  const [loan, type] = await Promise.all([
    tx.loan.findUniqueOrThrow({ where: { id: args.loanId }, select: { pn: true, branchId: true } }),
    tx.transactionType.findUniqueOrThrow({ where: { id: args.type.id }, select: { name: true, code: true, requiresDp: true } }),
  ]);
  // The LA's work on it (check the papers, then send or complete): an inbox item (D-046).
  await arriveItem(tx, {
    kind: "TRANSACTION", subjectId: txn.id, role: "LA", branchId: loan.branchId, loanId: args.loanId, pn: loan.pn, label: `${loan.pn}: ${type.name}`,
    holderUserId: args.holderUserId ?? null, accepted: !!args.holderUserId, targetKey: type.requiresDp ? "P3_ASSIGN" : type.code === "EDST" ? "P3_EDST" : "P3_ASSIGN",
  });
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
export const NO_REFRESH = "Ask a Superadmin to turn on \"Refresh a loan from MyLoans\" for your role.";
// ---------------------------------------------------------------------------

export async function refreshFromMyLoans(user: CurrentUser, loanId: string): Promise<{ ok: true; changed: boolean; minor: boolean } | { ok: false; message: string }> {
  if (!can(user, PERMISSIONS.LOANS_REFRESH)) throw new UserError(NO_REFRESH);
  const loan = await prisma.loan.findUnique({ where: { id: loanId } });
  if (!loan || !inScope(user, loan.branchId)) throw new UserError("Loan File not found.");
  const r = await refreshLoan(loan.id, { actor: { id: user.id, label: user.name }, mode: "MANUAL", trigger: "button" });
  return r.ok ? { ok: true, changed: r.outcome === "review", minor: r.outcome === "minor" } : { ok: false, message: r.message };
}
