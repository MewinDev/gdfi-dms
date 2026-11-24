/**
 * D-056, the Phase A go-live gaps, through the same functions the screens use. TEST database only, fake data.
 * - The FT receiving account: typed by the processor at request, checked by Finance at release, then cleared.
 * - Receipt confirmation: a match is confirmed; a mismatch is flagged to Finance, who clears it with remarks.
 * - Cancel transaction: its own tick (LA Supervisor/Head, Admin), a reason, the job stops, released cash stays owed.
 * - The four optional transactions are seeded with their papers; the TAT defaults.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { addCustomTransaction, assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, ltoBlockReason, loadAssignment } from "@/lib/services/jobs";
import { confirmReceipt, decideAdvance, releaseAdvance, requestAdvance, resolveReceiptMismatch } from "@/lib/services/funds";
import { cancelPreview, cancelTransaction } from "@/lib/services/cancel-transaction";
import { setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser, fin: CurrentUser, admin: CurrentUser, head: CurrentUser;
const PN = "GD1652026901003";
const ACCOUNT = { provider: "BPI", name: "Test Document Processor", number: "1234-5678-4821" };

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  head = await asUser("test.lahead@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
  await setSetting("funds.blockLtoUntilReceiptConfirmed", false);
  await prisma.fundsType.update({ where: { code: "FT" }, data: { active: true, deactivatedAt: null, needsReference: true, needsAccount: true, mustLiquidate: true } });
});
afterAll(async () => {
  await cleanLoans();
  await setSetting("funds.blockLtoUntilReceiptConfirmed", false);
  await prisma.$disconnect();
});

/** The Mortgage of PN, sent to and accepted by the test processor, flagged for an LTO fee. */
async function acceptedMortgage() {
  await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "MORTGAGE" } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  const lto = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto.id, fundsNeeded: "YES", fundsKinds: ["LTO_FEE"], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
  await acceptJob(dp, job.id);
  return { loan, txn, job };
}

/** A fund transfer of ₱2,500 for the job: requested with the account, approved and sent. */
async function sentTransfer(transactionId: string) {
  const ft = await prisma.fundsType.findUniqueOrThrow({ where: { code: "FT" } });
  const r = await requestAdvance(dp, { lines: [{ transactionId, kind: "LTO_FEE", cents: 250_000 }], fundsTypeId: ft.id, account: ACCOUNT });
  await decideAdvance(fin, r.id, { approve: true });
  return r;
}

describe("FT receiving account (D-056 item 5)", () => {
  it("is required at request for a type that sends to an account; Finance must tick that they checked it; the full number is cleared at release", async () => {
    const { txn } = await acceptedMortgage();
    const ft = await prisma.fundsType.findUniqueOrThrow({ where: { code: "FT" } });
    await expect(requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 250_000 }], fundsTypeId: ft.id })).rejects.toThrow("Enter the bank or e-wallet");
    await expect(requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 250_000 }], fundsTypeId: ft.id, account: { ...ACCOUNT, number: "12" } })).rejects.toThrow("6 to 30 digits");
    const r = await sentTransfer(txn.id);
    const asked = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } });
    expect(asked).toMatchObject({ accountProvider: "BPI", accountName: "Test Document Processor", accountNumber: "123456784821", accountLast4: "4821", status: "APPROVED" });
    const release = { ref: "FT-889101", transferDate: businessDate(new Date()) };
    await expect(releaseAdvance(fin, r.id, release)).rejects.toThrow("I checked the receiving account");
    await releaseAdvance(fin, r.id, { ...release, accountChecked: "on" });
    const sent = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } });
    expect(sent).toMatchObject({ status: "RELEASED", accountNumber: "", accountLast4: "4821", accountProvider: "BPI", releaseRef: "FT-889101" });
    // The full number is in no audit row.
    const audits = await prisma.auditLog.findMany({ where: { entityId: r.id } });
    expect(JSON.stringify(audits)).not.toContain("123456784821");
  });
});

describe("Receipt confirmation (D-056 item 1)", () => {
  it("a match confirms; a mismatch is flagged to Finance with the details; Finance clears it with remarks; the LTO waits only when the setting is on", async () => {
    const { txn, job } = await acceptedMortgage();
    const r = await sentTransfer(txn.id);
    await releaseAdvance(fin, r.id, { ref: "FT-889101", transferDate: businessDate(new Date()), accountChecked: "on" });
    // The gate is off by default; on, "At the LTO" waits for the confirmation.
    const a = await loadAssignment(prisma, job.id);
    expect(await ltoBlockReason(prisma, a)).toBeNull();
    await setSetting("funds.blockLtoUntilReceiptConfirmed", true);
    expect(await ltoBlockReason(prisma, a)).toBe(`Confirm receipt of ${r.number} first (My funds).`);

    const bad = await confirmReceipt(dp, { advanceId: r.id, ref: "FT-889100", amount: "2,400.00", last4: "4821" });
    expect(bad.matched).toBe(false);
    const flagged = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } });
    expect(flagged.receiptMismatchAt).not.toBeNull();
    expect(flagged.receiptMismatchNote).toContain('reference: typed "FT-889100", Finance recorded "FT-889101"');
    expect(flagged.receiptMismatchNote).toContain("amount: typed ₱2,400.00, Finance recorded ₱2,500.00");
    expect(await prisma.notification.count({ where: { userId: fin.id, title: `${r.number}: receipt does not match` } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "funds_receipt_mismatch", entityId: r.id } })).toBe(1);
    // Only the requester confirms; Finance clears with remarks.
    await expect(confirmReceipt(fin, { advanceId: r.id, ref: "FT-889101", amount: "2500", last4: "4821" })).rejects.toThrow();
    await expect(resolveReceiptMismatch(fin, { advanceId: r.id, remarks: "ok" })).rejects.toThrow("5 to 500");
    expect(await resolveReceiptMismatch(fin, { advanceId: r.id, remarks: "Checked the bank: the processor misread the slip." })).toBe("Cleared. The receipt counts as confirmed.");
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).receiptConfirmedAt).not.toBeNull();
    expect(await ltoBlockReason(prisma, a)).toBeNull();
  });

  it("a matching confirmation (spaces, dashes and case in the reference do not matter)", async () => {
    const { txn } = await acceptedMortgage();
    const r = await sentTransfer(txn.id);
    await releaseAdvance(fin, r.id, { ref: "FT-889101", transferDate: businessDate(new Date()), accountChecked: "on" });
    expect(await confirmReceipt(dp, { advanceId: r.id, ref: "ft 889101", amount: "2500", last4: "4821" })).toMatchObject({ matched: true });
    await expect(confirmReceipt(dp, { advanceId: r.id, ref: "FT-889101", amount: "2500", last4: "4821" })).rejects.toThrow("already confirmed");
  });
});

describe("Cancel transaction (D-056 item 2)", () => {
  it("needs its tick (LA Supervisor/Head and Admin, not the LA) and a reason; the job stops; released cash stays owed and its liquidation becomes due", async () => {
    const { txn, job } = await acceptedMortgage();
    const r = await sentTransfer(txn.id);
    await releaseAdvance(fin, r.id, { ref: "FT-889101", transferDate: businessDate(new Date()), accountChecked: "on" });
    await expect(cancelTransaction(la, { transactionId: txn.id, reason: "Wrong transaction" })).rejects.toThrow("does not allow cancelling");
    await expect(cancelTransaction(head, { transactionId: txn.id, reason: "no" })).rejects.toThrow("5 to 500");
    const preview = await cancelPreview(head, txn.id);
    expect(preview.jobs).toEqual(["Test Document Processor"]);
    expect(preview.words[0]).toMatch(new RegExp(`^${r.number}: ₱2,500.00 released to Test Document Processor stays owed. It must be liquidated within 2 working days`));
    const msg = await cancelTransaction(head, { transactionId: txn.id, reason: "The borrower already had the mortgage annotated elsewhere." });
    expect(msg).toMatch(/^Mortgage cancelled\./);
    expect(await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).toMatchObject({ status: "CANCELLED", cancelReason: "The borrower already had the mortgage annotated elsewhere." });
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PULLED_BACK");
    // D-044 item 2: cancelled before its LTO, the liquidation is due N working days after the cancellation.
    const adv = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } });
    expect(adv).toMatchObject({ status: "RELEASED", liquidationBasis: "CANCELLED" });
    expect(adv.liquidationDueAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "transaction_cancelled", entityId: txn.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: dp.id, title: `${PN}: Mortgage cancelled` } })).toBe(1);
    await expect(cancelTransaction(admin, { transactionId: txn.id, reason: "Again, by Admin" })).rejects.toThrow("already cancelled");
  });
});

describe("Seeds (D-056 items 3 and 9)", () => {
  it("the four optional transactions are addable by hand with v2's papers; the TAT defaults are LA 1, DP 5, Finance 1", async () => {
    const types = await prisma.transactionType.findMany({ where: { code: { in: ["CANCEL_MORTGAGE", "TRANSFER_OWNERSHIP", "RENEWAL_OR", "PPSR_TERMINATION"] } }, include: { rules: true }, orderBy: { sortOrder: "asc" } });
    expect(types.map((t) => [t.name, t.builtIn, t.requiresDp, t.rules.length])).toEqual([
      ["Cancellation of Mortgage", false, true, 3], ["Transfer of Ownership", false, true, 6], ["Renewal of OR", false, true, 3], ["PPSR Termination", false, true, 3],
    ]);
    await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
    await addCustomTransaction(la, { loanId: loan.id, typeId: types[1].id });
    const added = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, typeId: types[1].id }, include: { checks: { include: { rule: true } } } });
    expect(added.checks.sort((x, y) => (x.rule?.sortOrder ?? 0) - (y.rule?.sortOrder ?? 0)).map((c) => c.rule?.label)).toEqual(["Deed of Sale", "OR/CR (original)", "Valid IDs of seller and buyer", "PNP-HPG clearance", "Stencil (chassis and engine)", "CTPL insurance"]);
    const tat = Object.fromEntries((await prisma.tatRule.findMany({ where: { key: { in: ["P3_CHECKLIST", "P3_ASSIGN", "P4_NOTARY", "P4_PPSR", "P4_MORTGAGE", "P3_CA_RELEASE"] } } })).map((t) => [t.key, t.businessDays]));
    expect(tat).toEqual({ P3_CHECKLIST: 1, P3_ASSIGN: 1, P4_NOTARY: 5, P4_PPSR: 5, P4_MORTGAGE: 5, P3_CA_RELEASE: 1 });
  });
});
