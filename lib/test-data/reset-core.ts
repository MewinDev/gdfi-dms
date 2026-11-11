import type { Prisma } from "@prisma/client";

/**
 * Removes every Loan File and all rows that belong to it, in an order that respects the foreign
 * keys (some are RESTRICT, e.g. DpAssignment -> LoanTransaction). Users, roles, branches,
 * settings, checklist rules, TATs, holidays, vault locations and audit rows are kept.
 *
 * Plain function on a transaction client: no auth here. Callers check TEST_MODE and Admin.
 */
export interface ResetCounts {
  loanFiles: number;
  transactions: number;
  checklistTicks: number;
  documents: number;
  movements: number;
  edstRecords: number;
  assignments: number;
  cashAdvances: number;
  problems: number;
  notifications: number;
  transmittals: number;
  snapshots: number;
}

export async function resetLoanData(tx: Prisma.TransactionClient): Promise<ResetCounts> {
  const [edstRecords, checklistTicks, movements, snapshots] = await Promise.all([
    tx.loanTransaction.count({ where: { edstReference: { not: null } } }),
    tx.checklistCheck.count({ where: { checked: true } }),
    tx.documentMovement.count(),
    tx.loanSourceSnapshot.count(),
  ]);

  // Rows with RESTRICT links to Loan / LoanTransaction / DocumentItem go first.
  await tx.transmittalItem.deleteMany({});
  const transmittals = (await tx.transmittal.deleteMany({})).count;
  await tx.pullOutRequest.deleteMany({});
  await tx.thirdParty.deleteMany({ where: { requests: { none: {} } } });
  await tx.digitalRecord.deleteMany({});
  await tx.qaFinding.deleteMany({});
  const assignments = (await tx.dpAssignment.deleteMany({})).count;
  await tx.attachment.deleteMany({ where: { loanId: { not: null } } });

  // Notifications are all about loan files.
  const notifications = (await tx.notification.deleteMany({})).count;
  const problems = (await tx.loanException.deleteMany({})).count;
  // Funds (all of it is about loan files): receipts, attempts' spends, carry-overs, returns, top-ups, lines, advances.
  await tx.receipt.deleteMany({});
  await tx.attemptSpend.deleteMany({});
  await tx.carryOver.deleteMany({});
  await tx.cashReturn.deleteMany({});
  await tx.cashAdvanceTopUp.deleteMany({});
  await tx.cashAdvanceLine.deleteMany({});
  const cashAdvances = (await tx.cashAdvance.deleteMany({})).count;
  await tx.fundsException.deleteMany({});
  await tx.transactionAttempt.deleteMany({});
  await tx.problem.deleteMany({});
  await tx.hold.deleteMany({});
  await tx.documentMovement.deleteMany({});
  const documents = (await tx.documentItem.deleteMany({})).count;
  await tx.checklistCheck.deleteMany({});
  const transactions = (await tx.loanTransaction.deleteMany({})).count;
  await tx.loanSourceSnapshot.deleteMany({});
  await tx.sourceChange.deleteMany({});
  // Simulated MyLoans changes (mock source) go with the sample loans.
  await tx.setting.deleteMany({ where: { key: { in: ["myloans.mockOverrides", "myloans.mockExtra"] } } });
  const loanFiles = (await tx.loan.deleteMany({})).count;

  // Vault slots are reference data; free the ones that held test papers.
  await tx.vaultLocation.updateMany({ where: { occupied: true }, data: { occupied: false } });

  return {
    loanFiles, transactions, checklistTicks, documents, movements, edstRecords,
    assignments, cashAdvances, problems, notifications, transmittals, snapshots,
  };
}
