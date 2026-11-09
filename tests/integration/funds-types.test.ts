/**
 * Funds types (Cash advance CA, Fund transfer FT) on the same funds flow, through the same functions
 * the screens use. TEST database only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, logAttempt } from "@/lib/services/jobs";
import {
  addReceipt, advanceHistory, changeFundsType, closeAdvance, decideAdvance, decideTopUp, notifyOverdue, releaseAdvance, releaseTopUp, requestAdvance, requestTopUp,
} from "@/lib/services/funds";
import { returnToLa } from "@/lib/services/return-to-la";
import { saveSettingsRow } from "@/lib/services/admin";
import { setRowActive } from "@/lib/services/settings-status";
import { checkImport, currentDataCsv, runImport } from "@/lib/import/importer";
import { toCsv } from "@/lib/import/csv";
import { tatReport } from "@/lib/services/tat-report";
import { setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { allPapers, asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser, fin: CurrentUser, admin: CurrentUser;
const today = () => businessDate(new Date());
const type = (code: string) => prisma.fundsType.findUniqueOrThrow({ where: { code } });
const FT_RELEASE = { ref: "FT-889101", transferDate: businessDate(new Date()), accountProvider: "BPI", accountName: "Test Document Processor", accountLast4: "4821" };

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
  // The seeded types as seeded (tests below rename and switch them).
  await prisma.fundsType.deleteMany({ where: { code: { notIn: ["CA", "FT"] } } });
  await prisma.fundsType.update({ where: { code: "CA" }, data: { name: "Cash advance", active: true, deactivatedAt: null, needsReference: false, needsAccount: false, mustLiquidate: true } });
  await prisma.fundsType.update({ where: { code: "FT" }, data: { name: "Fund transfer", active: true, deactivatedAt: null, needsReference: true, needsAccount: true, mustLiquidate: true } });
});
afterAll(async () => {
  await cleanLoans();
  await prisma.fundsType.deleteMany({ where: { code: { notIn: ["CA", "FT"] } } });
  await prisma.fundsType.update({ where: { code: "CA" }, data: { name: "Cash advance", mustLiquidate: true } });
  await prisma.fundsType.update({ where: { code: "FT" }, data: { name: "Fund transfer", mustLiquidate: true } });
  await prisma.$disconnect();
});

/** GD1652026901003 Mortgage (needs funds, LTO fee), sent to and accepted by the test DP. */
async function acceptedMortgage(code = "MORTGAGE") {
  await openLoanFile(la, { pn: "GD1652026901003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  const lto = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto.id, fundsNeeded: "YES", fundsKinds: [code === "PPSR" ? "PPSR_FEE" : "LTO_FEE"], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
  await acceptJob(dp, job.id, true);
  return { loan, txn, job };
}
const request = (transactionId: string, fundsTypeId?: string, kind = "LTO_FEE") => requestAdvance(dp, { lines: [{ transactionId, kind, cents: 250_000 }], fundsTypeId });

describe("Funds types list (Settings)", () => {
  it("seeds Cash advance and Fund transfer as Proposed; Admin saving one confirms it; a rename never changes old records", async () => {
    const [ca, ft] = await Promise.all([type("CA"), type("FT")]);
    expect(ca).toMatchObject({ name: "Cash advance", needsReference: false, needsAccount: false, mustLiquidate: true, active: true });
    expect(ft).toMatchObject({ name: "Fund transfer", needsReference: true, needsAccount: true, mustLiquidate: true, active: true });
    const { txn } = await acceptedMortgage();
    const r = await request(txn.id, ft.id);
    expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ fundsTypeId: ft.id, fundsTypeCode: "FT", fundsTypeName: "Fund transfer" });

    await saveSettingsRow(admin, "fundsType", ft.id, { code: "FT", name: "Bank transfer", sortOrder: "2", needsReference: "on", needsAccount: "on", mustLiquidate: "on" });
    expect(await type("FT")).toMatchObject({ name: "Bank transfer", proposed: false });
    // The old record keeps the name it had.
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).fundsTypeName).toBe("Fund transfer");
    expect(await prisma.auditLog.count({ where: { entityType: "fundsType", entityId: ft.id } })).toBeGreaterThan(0);
  });

  it("only fundtypes:manage changes the list (Admin by default); a switched-off type is not offered but stays on old records", async () => {
    await expect(saveSettingsRow(la, "fundsType", null, { code: "CHK", name: "Check", sortOrder: "3" })).rejects.toThrow(/does not allow/);
    await expect(saveSettingsRow(fin, "fundsType", null, { code: "CHK", name: "Check", sortOrder: "3" })).rejects.toThrow(/does not allow/);
    expect(admin.permissions.has("fundtypes:manage")).toBe(true);
    expect(fin.permissions.has("fundtypes:manage")).toBe(false);
    const { txn } = await acceptedMortgage();
    const ft = await type("FT");
    const r = await request(txn.id, ft.id);
    await setRowActive(admin, "fundsType", ft.id, false);
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).fundsTypeCode).toBe("FT");
    await prisma.cashAdvance.update({ where: { id: r.id }, data: { status: "DENIED" } }); // free the job for a new request
    await expect(request(txn.id, ft.id)).rejects.toThrow("Pick an active funds type.");
    await setRowActive(admin, "fundsType", ft.id, true);
  });

  it("Import and Export: a new type, switches as Yes or No", async () => {
    const file = toCsv(["code", "name", "order", "needs_reference", "needs_account", "must_liquidate", "status"], [{ code: "CHK", name: "Check", order: "3", needs_reference: "Yes", needs_account: "No", must_liquidate: "Yes", status: "Active" }]);
    const plan = await checkImport(admin, "funds-types", "f.csv", file);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.counts).toMatchObject({ new: 1, problem: 0 });
    const run = await runImport(admin, "funds-types", "f.csv", file);
    if (!run.ok) throw new Error(run.error);
    expect(await type("CHK")).toMatchObject({ name: "Check", needsReference: true, needsAccount: false, mustLiquidate: true });
    const csv = await currentDataCsv("funds-types");
    expect(csv).toContain("FT,Fund transfer,2,Yes,Yes,Yes,Active");
    expect(csv).toContain("CHK,Check,3,Yes,No,Yes,Active");
  });
});

describe("Choosing and changing the type", () => {
  it("the DP's request is a Cash advance by default, or the type picked", async () => {
    const a = await acceptedMortgage();
    const r = await request(a.txn.id);
    expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ fundsTypeCode: "CA", fundsTypeName: "Cash advance" });
    // The approvers' notification says which type it is.
    expect(await prisma.notification.count({ where: { userId: fin.id, title: `${r.number}: Cash advance to approve` } })).toBe(1);
  });

  it("Finance changes the type before release, with remarks; audited, in the history; refused after release", async () => {
    const { txn } = await acceptedMortgage();
    const r = await request(txn.id);
    const ft = await type("FT");
    await expect(changeFundsType(fin, r.id, { fundsTypeId: ft.id, remarks: "abc" })).rejects.toThrow("Write 5 to 500 characters.");
    await expect(changeFundsType(dp, r.id, { fundsTypeId: ft.id, remarks: "Bank transfer instead" })).rejects.toThrow(/does not allow/);
    await changeFundsType(fin, r.id, { fundsTypeId: ft.id, remarks: "Bank transfer instead" });
    expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ fundsTypeCode: "FT", fundsTypeName: "Fund transfer" });
    const h = await advanceHistory(r.id);
    expect(h.map((x) => x.summary)).toContain(`${r.number}: Test Finance changed the type from Cash advance to Fund transfer: Bank transfer instead`);
    expect(await prisma.notification.count({ where: { userId: dp.id, title: `${r.number}: now a Fund transfer` } })).toBe(1);
    await decideAdvance(fin, r.id, { approve: true });
    await releaseAdvance(fin, r.id, FT_RELEASE);
    await expect(changeFundsType(fin, r.id, { fundsTypeId: (await type("CA")).id, remarks: "Back to cash please" })).rejects.toThrow("The type can be changed only before the release.");
  });
});

describe("Release by type", () => {
  it("Fund transfer: reference number, date and account (last 4 digits only); Cash advance unchanged", async () => {
    const { txn } = await acceptedMortgage();
    const r = await request(txn.id, (await type("FT")).id);
    await decideAdvance(fin, r.id, { approve: true });
    await expect(releaseAdvance(fin, r.id, { ref: "V-1" })).rejects.toThrow("Enter the transfer reference number.");
    await expect(releaseAdvance(fin, r.id, { ...FT_RELEASE, transferDate: "" })).rejects.toThrow("Pick the transfer date.");
    await expect(releaseAdvance(fin, r.id, { ...FT_RELEASE, accountProvider: "" })).rejects.toThrow("Enter the bank or e-wallet.");
    await expect(releaseAdvance(fin, r.id, { ...FT_RELEASE, accountLast4: "001234567890" })).rejects.toThrow("Enter only the last 4 digits. The full account number is never stored.");
    await releaseAdvance(fin, r.id, FT_RELEASE);
    const a = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } });
    expect(a).toMatchObject({ status: "RELEASED", releaseRef: "FT-889101", transferDate: today(), accountProvider: "BPI", accountLast4: "4821" });
    expect(JSON.stringify(a)).not.toContain("001234567890");
    expect(await prisma.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "advance_released" } })).toMatchObject({ summary: expect.stringContaining("(Fund transfer) sent by Test Finance") });
    expect(await prisma.notification.count({ where: { userId: dp.id, title: `${r.number} (Fund transfer) sent` } })).toBe(1);
    // The email names the type.
    const mail = await prisma.emailOutbox.findFirst({ where: { event: "advance_released" }, orderBy: { createdAt: "desc" } });
    if (mail) expect(mail.subject.endsWith(`${r.number}: Fund transfer sent`)).toBe(true);

    // A Cash advance (another job) releases as before: the reference note is enough.
    const p = await acceptedMortgage("PPSR");
    const c = await request(p.txn.id, undefined, "PPSR_FEE");
    await decideAdvance(fin, c.id, { approve: true });
    await releaseAdvance(fin, c.id, { ref: "V-1", accountLast4: "9999" });
    expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "RELEASED", releaseRef: "V-1", accountLast4: "", transferDate: "" });
  });
});

describe("Top-up and carry-over follow the record", () => {
  it("a top-up takes the record's type; Finance may change it at release with remarks; the transfer needs its fields", async () => {
    const { txn, job } = await acceptedMortgage();
    const r = await request(txn.id, (await type("FT")).id);
    await decideAdvance(fin, r.id, { approve: true });
    await releaseAdvance(fin, r.id, FT_RELEASE);
    const line = await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } });
    const topId = await requestTopUp(dp, line.id, 20_000, "Extra annotation fee");
    expect(await prisma.cashAdvanceTopUp.findUniqueOrThrow({ where: { id: topId } })).toMatchObject({ fundsTypeCode: "FT", fundsTypeName: "Fund transfer" });
    await decideTopUp(fin, topId, true, null, "");
    await expect(releaseTopUp(fin, topId, {})).rejects.toThrow("Enter the transfer reference number.");
    const ca = await type("CA");
    await expect(releaseTopUp(fin, topId, { fundsTypeId: ca.id, remarks: "no" })).rejects.toThrow("Write 5 to 500 characters.");
    await releaseTopUp(fin, topId, { fundsTypeId: ca.id, remarks: "Small amount: cash from the branch" });
    expect(await prisma.cashAdvanceTopUp.findUniqueOrThrow({ where: { id: topId } })).toMatchObject({ fundsTypeCode: "CA", releasedCents: 20_000 });
    expect((await advanceHistory(r.id)).map((h) => h.summary).join("\n")).toContain("changed the top-up from Fund transfer to Cash advance: Small amount: cash from the branch");

    // Carry-over: on a line of the record, so it is the record's type (no type of its own).
    const reason = await prisma.problemReason.findUniqueOrThrow({ where: { code: "LTO_DOWN" } });
    await logAttempt(dp, job.id, { date: today(), result: "NOT_PROCESSED", reasonId: reason.id, spends: [{ lineId: line.id, cents: 50_000 }], rest: "CARRY_OVER" });
    const carry = await prisma.carryOver.findFirstOrThrow({ where: { lineId: line.id }, include: { line: { include: { advance: true } } } });
    expect(carry.line.advance.fundsTypeCode).toBe("FT");
  });
});

describe("Liquidation, overdue and the rest work the same", () => {
  it("a Fund transfer liquidates with receipts, closes, and gets the overdue notice like a Cash advance", async () => {
    const a = await acceptedMortgage();
    const r = await request(a.txn.id, (await type("FT")).id);
    await decideAdvance(fin, r.id, { approve: true });
    await releaseAdvance(fin, r.id, FT_RELEASE);
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).liquidationDueAt).not.toBeNull();
    await prisma.cashAdvance.update({ where: { id: r.id }, data: { liquidationDueAt: new Date(Date.now() - 86_400_000) } });
    await notifyOverdue();
    expect(await prisma.notification.count({ where: { userId: dp.id, title: `${r.number} (Fund transfer): liquidation overdue` } })).toBe(1);
    // Overdue blocks a new request, whatever its type.
    const p = await acceptedMortgage("PPSR");
    await expect(request(p.txn.id, undefined, "PPSR_FEE")).rejects.toThrow(/overdue/);
    const line = await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } });
    await addReceipt(dp, { lineId: line.id, date: today(), cents: 250_000, number: "OR-1" }, null);
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("LIQUIDATED");
    await closeAdvance(fin, r.id);
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CLOSED");
  });

  it("Cash to settle after a return, for a Fund transfer too", async () => {
    const { txn, job } = await acceptedMortgage();
    const r = await request(txn.id, (await type("FT")).id);
    await decideAdvance(fin, r.id, { approve: true });
    await releaseAdvance(fin, r.id, FT_RELEASE);
    const other = await prisma.returnReason.findUniqueOrThrow({ where: { code: "OTHER" } });
    await returnToLa(dp, job.id, { reasonId: other.id, note: "Needs the PPSR first", handedOver: await allPapers(txn.id) });
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("RELEASED");
  });

  it("only the Must be liquidated switch changes liquidation: off, the record is settled at release", async () => {
    await prisma.fundsType.update({ where: { code: "FT" }, data: { mustLiquidate: false } });
    const { txn } = await acceptedMortgage();
    const r = await request(txn.id, (await type("FT")).id);
    await decideAdvance(fin, r.id, { approve: true });
    await releaseAdvance(fin, r.id, FT_RELEASE);
    expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "LIQUIDATED", liquidationDueAt: null });
    await closeAdvance(fin, r.id);
  });
});

describe("Existing records and reports", () => {
  it("a record saved without a type is a Cash advance (the migration's backfill and default)", async () => {
    const r = await prisma.cashAdvance.create({ data: { number: "CA-OLD-0001", requestedById: dp.id, branchId: (await prisma.branch.findFirstOrThrow()).id, requestedCents: 1000 } });
    expect(r).toMatchObject({ fundsTypeId: "fundstype_ca", fundsTypeCode: "CA", fundsTypeName: "Cash advance" });
    expect(await prisma.cashAdvance.count({ where: { fundsTypeId: { notIn: (await prisma.fundsType.findMany()).map((t) => t.id) } } })).toBe(0);
    await prisma.cashAdvance.delete({ where: { id: r.id } });
  });

  it("the TAT report shows and filters by funds type", async () => {
    const { txn } = await acceptedMortgage();
    await request(txn.id, (await type("FT")).id);
    const all = await tatReport(admin, { show: "all" });
    expect(all.rows.find((x) => x.typeCode === "MORTGAGE")?.fundsType).toEqual({ code: "FT", name: "Fund transfer" });
    expect((await tatReport(admin, { show: "all", ftype: "FT" })).rows.map((x) => x.typeCode)).toEqual(["MORTGAGE"]);
    expect((await tatReport(admin, { show: "all", ftype: "CA" })).rows).toHaveLength(0);
  });
});
