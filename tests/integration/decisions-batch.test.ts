/**
 * Decisions batch (10 November 2026): Approve is idempotent, "Print liquidation report" gates the report,
 * request numbers by type (CA-, FT-) safe under concurrency, the renumbering of fund transfers numbered
 * CA- (the migration's function), and the Branch Supervisor role made only when absent. TEST database only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS, ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob } from "@/lib/services/jobs";
import { decideAdvance, liquidationReportAccess, nextNumber, requestAdvance } from "@/lib/services/funds";
import { setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser, fin: CurrentUser;
const PN = "GD1652026901003";
const YEAR = () => businessDate(new Date()).slice(0, 4);
const type = (code: string) => prisma.fundsType.findUniqueOrThrow({ where: { code } });

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
});
afterAll(async () => {
  await cleanLoans();
  await prisma.$disconnect();
});

/** The sample loan's Mortgage (needs funds, LTO fee), sent to and accepted by the test DP. */
async function acceptedMortgage() {
  await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "MORTGAGE" } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  const lto = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto.id, fundsNeeded: "YES", fundsKinds: ["LTO_FEE"], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
  await acceptJob(dp, job.id);
  return { loan, txn };
}
const request = async (fundsTypeCode = "CA") => {
  const { txn } = await acceptedMortgage();
  return requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 350_000 }], fundsTypeId: (await type(fundsTypeCode)).id });
};
const approvedRows = (id: string) => prisma.auditLog.count({ where: { entityId: id, action: "advance_approved" } });

describe("A1. Approve is idempotent", () => {
  it("a second approve of an approved request does nothing and returns the same result (no second history row or notice)", async () => {
    const r = await request();
    expect(await decideAdvance(fin, r.id, { approve: true })).toEqual({ status: "APPROVED", approvedCents: 350_000, already: false });
    expect(await decideAdvance(fin, r.id, { approve: true })).toEqual({ status: "APPROVED", approvedCents: 350_000, already: true });
    expect(await approvedRows(r.id)).toBe(1);
    expect(await prisma.notification.count({ where: { userId: dp.id, title: `${r.number} (Cash advance) approved` } })).toBe(1);
    const a = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } });
    expect(a).toMatchObject({ status: "APPROVED", approvedCents: 350_000, approvedById: fin.id });
    // Deny after Approve is still refused, as before.
    await expect(decideAdvance(fin, r.id, { approve: false, note: "No budget" })).rejects.toThrow("This request was already decided.");
  });

  it("two approvals at the same moment (a double tap) approve once", async () => {
    const r = await request();
    const results = await Promise.all([decideAdvance(fin, r.id, { approve: true }), decideAdvance(fin, r.id, { approve: true }), decideAdvance(fin, r.id, { approve: true })]);
    expect(results.filter((x) => !x.already)).toHaveLength(1);
    expect(results.every((x) => x.status === "APPROVED" && x.approvedCents === 350_000)).toBe(true);
    expect(await approvedRows(r.id)).toBe(1);
    expect(await prisma.notification.count({ where: { userId: dp.id, title: `${r.number} (Cash advance) approved` } })).toBe(1);
  });
});

describe("A2. Print liquidation report (funds:print)", () => {
  it("allowed with the tick and the request's usual visibility; refused without the tick; not found outside scope or before liquidation", async () => {
    const branchId = (await prisma.branch.findFirstOrThrow({ where: { name: "Angono" } })).id;
    const done = { branchId, status: "LIQUIDATED" };
    expect(fin.permissions.has(PERMISSIONS.FUNDS_CA_PRINT)).toBe(true);
    expect(liquidationReportAccess(fin, done)).toBe("ok");
    expect(liquidationReportAccess(fin, { branchId, status: "CLOSED" })).toBe("ok");
    const noPrint: CurrentUser = { ...fin, permissions: new Set([...fin.permissions].filter((k) => k !== PERMISSIONS.FUNDS_CA_PRINT && k !== PERMISSIONS.FUNDS_FT_PRINT)) };
    expect(liquidationReportAccess(noPrint, done)).toBe("refused");
    expect(liquidationReportAccess(dp, done)).toBe("not-found");
    expect(liquidationReportAccess(fin, { branchId, status: "RELEASED" })).toBe("not-found");
    const elsewhere: CurrentUser = { ...fin, scopeBranchIds: [(await prisma.branch.findFirstOrThrow({ where: { name: "Antipolo" } })).id] };
    expect(liquidationReportAccess(elsewhere, done)).toBe("not-found");
  });
});

describe("C. Request numbers: CA for cash advances, FT for fund transfers", () => {
  it("a new request of each type takes its own prefix and running number", async () => {
    const ft = await request("FT");
    expect(ft.number).toBe(`FT-${YEAR()}-0001`);
    const ca = await request("CA").catch(async () => {
      // The Mortgage already has an open request: a second one goes on a fresh loan file.
      await cleanLoans();
      return request("CA");
    });
    expect(ca.number).toBe(`CA-${YEAR()}-0001`);
  });

  it("per prefix and year; a number used before (a former number) is never given again", async () => {
    const branchId = (await prisma.branch.findFirstOrThrow({ where: { name: "Angono" } })).id;
    const make = (code: "CA" | "FT", when: Date, former: string[] = []) => prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, when, code);
      await tx.cashAdvance.create({ data: { number, formerNumbers: former, requestedById: dp.id, branchId, requestedCents: 100, fundsTypeId: code === "FT" ? "fundstype_ft" : "fundstype_ca", fundsTypeCode: code, fundsTypeName: code === "FT" ? "Fund transfer" : "Cash advance" } });
      return number;
    });
    const now = new Date(`${YEAR()}-11-10T09:00:00+08:00`);
    const next = new Date(`${Number(YEAR()) + 1}-01-05T09:00:00+08:00`);
    expect(await make("CA", now, [`CA-${YEAR()}-0007`])).toBe(`CA-${YEAR()}-0001`);
    expect(await make("CA", now)).toBe(`CA-${YEAR()}-0008`);
    expect(await make("FT", now)).toBe(`FT-${YEAR()}-0001`);
    expect(await make("CA", next)).toBe(`CA-${Number(YEAR()) + 1}-0001`);
    expect(await make("FT", next)).toBe(`FT-${Number(YEAR()) + 1}-0001`);
  });

  it("two requests at the same time never get the same number (8 at once, both types)", async () => {
    const branchId = (await prisma.branch.findFirstOrThrow({ where: { name: "Angono" } })).id;
    const now = new Date();
    const one = (code: "CA" | "FT") => prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, now, code);
      await new Promise((r) => setTimeout(r, 20)); // hold the lock a moment, as a real request does
      await tx.cashAdvance.create({ data: { number, requestedById: dp.id, branchId, requestedCents: 100, fundsTypeId: code === "FT" ? "fundstype_ft" : "fundstype_ca", fundsTypeCode: code, fundsTypeName: code } });
      return number;
    }, { timeout: 30_000 });
    const numbers = await Promise.all(["CA", "FT", "CA", "FT", "CA", "FT", "CA", "FT"].map((c) => one(c as "CA" | "FT")));
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.filter((n) => n.startsWith("CA-")).sort()).toEqual([1, 2, 3, 4].map((i) => `CA-${YEAR()}-000${i}`));
    expect(numbers.filter((n) => n.startsWith("FT-")).sort()).toEqual([1, 2, 3, 4].map((i) => `FT-${YEAR()}-000${i}`));
  });
});

describe("C. Renumbering fund transfers numbered CA- (the migration's dms_renumber_advances)", () => {
  it("renumbers in order of creation, changes every stored copy, keeps 'Formerly'; skips and lists what cannot be changed safely", async () => {
    const branchId = (await prisma.branch.findFirstOrThrow({ where: { name: "Angono" } })).id;
    const ft = { fundsTypeId: "fundstype_ft", fundsTypeCode: "FT", fundsTypeName: "Fund transfer" };
    const base = { requestedById: dp.id, branchId, requestedCents: 100 };
    const t0 = new Date(Date.now() - 3 * 3600_000);
    // An old audit row about another request that had the same number before a "Reset test data": left as it is.
    const stale = await prisma.auditLog.create({ data: { at: new Date(t0.getTime() - 3600_000), actorLabel: "Test", mode: "MANUAL", action: "advance_requested", entityType: "CashAdvance", entityId: "gone", summary: "CA-2026-0901 requested by someone (deleted since)" } });
    const a = await prisma.cashAdvance.create({ data: { ...base, ...ft, number: "CA-2026-0901", createdAt: t0 } });
    const b = await prisma.cashAdvance.create({ data: { ...base, ...ft, number: "CA-2026-0902", createdAt: new Date(t0.getTime() + 60_000) } });
    const c = await prisma.cashAdvance.create({ data: { ...base, ...ft, number: "CA-2026-0903", createdAt: new Date(t0.getTime() + 120_000) } });
    const cashOk = await prisma.cashAdvance.create({ data: { ...base, number: "CA-2026-0904", note: "Handed over from CA-2026-0901 (Pasuyo)", createdAt: new Date(t0.getTime() + 180_000) } });
    // Stored copies of A's number: an audit row, a notification, an email not sent, another request's note.
    const auditA = await prisma.auditLog.create({ data: { actorLabel: "Test", mode: "MANUAL", action: "advance_requested", entityType: "CashAdvance", entityId: a.id, summary: "CA-2026-0901 (Fund transfer) requested by Test Document Processor", after: { number: "CA-2026-0901" } } });
    const noteA = await prisma.notification.create({ data: { userId: fin.id, title: "CA-2026-0901: Fund transfer to approve", body: "Approve CA-2026-0901 please.", link: "/funds/CA-2026-0901/print" } });
    const mailA = await prisma.emailOutbox.create({ data: { event: "advance_requested", toName: "Test Finance", intendedAddress: "test.finance@gdfi.ph", subject: "CA-2026-0901 to approve", html: "<p>CA-2026-0901</p>", text: "CA-2026-0901", headline: "CA-2026-0901", status: "SKIPPED" } });
    // B: an email with its number already went out. C: its number also sits somewhere the renumbering does not change.
    const mailB = await prisma.emailOutbox.create({ data: { event: "advance_requested", toName: "Test Finance", intendedAddress: "test.finance@gdfi.ph", subject: "CA-2026-0902 to approve", html: "<p>CA-2026-0902</p>", text: "CA-2026-0902", headline: "CA-2026-0902", status: "SENT", sentAt: new Date() } });
    await prisma.setting.upsert({ where: { key: "zz.renumber.test" }, create: { key: "zz.renumber.test", value: { remember: "CA-2026-0903" } }, update: { value: { remember: "CA-2026-0903" } } });
    const noteC = await prisma.notification.create({ data: { userId: fin.id, title: "CA-2026-0903: Fund transfer to approve", body: "" } });
    try {
      const rows = await prisma.$queryRaw<{ old_number: string; new_number: string | null; outcome: string; reason: string | null }[]>`SELECT * FROM dms_renumber_advances()`;
      expect(rows.map((r) => [r.old_number, r.outcome])).toEqual([["CA-2026-0901", "renumbered"], ["CA-2026-0902", "skipped"], ["CA-2026-0903", "skipped"]]);
      expect(rows[0].new_number).toBe("FT-2026-0001");
      expect(rows[1].reason).toBe("An email with this number was already sent; it cannot be changed.");
      expect(rows[2].reason).toMatch(/Setting\.value/);

      expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ number: "FT-2026-0001", formerNumbers: ["CA-2026-0901"] });
      expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: auditA.id } }))).toMatchObject({ summary: "FT-2026-0001 (Fund transfer) requested by Test Document Processor", after: { number: "FT-2026-0001" } });
      expect(await prisma.notification.findUniqueOrThrow({ where: { id: noteA.id } })).toMatchObject({ title: "FT-2026-0001: Fund transfer to approve", body: "Approve FT-2026-0001 please.", link: "/funds/FT-2026-0001/print" });
      expect(await prisma.emailOutbox.findUniqueOrThrow({ where: { id: mailA.id } })).toMatchObject({ subject: "FT-2026-0001 to approve", text: "FT-2026-0001", headline: "FT-2026-0001" });
      expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: cashOk.id } })).note).toBe("Handed over from FT-2026-0001 (Pasuyo)");
      expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: stale.id } })).summary).toBe("CA-2026-0901 requested by someone (deleted since)");
      expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: a.id, action: "advance_renumbered" } })).summary).toBe("FT-2026-0001: numbered as a Fund transfer (formerly CA-2026-0901)");
      // Skipped: nothing changed for B and C (C's notification was put back with the rest).
      expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: b.id } })).number).toBe("CA-2026-0902");
      expect((await prisma.emailOutbox.findUniqueOrThrow({ where: { id: mailB.id } })).subject).toBe("CA-2026-0902 to approve");
      expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ number: "CA-2026-0903", formerNumbers: [] });
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: noteC.id } })).title).toBe("CA-2026-0903: Fund transfer to approve");
      // Re-runnable without harm: A is not touched again; B and C are listed again.
      const again = await prisma.$queryRaw<{ old_number: string; outcome: string }[]>`SELECT * FROM dms_renumber_advances()`;
      expect(again.map((r) => r.old_number)).toEqual(["CA-2026-0902", "CA-2026-0903"]);
      expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: a.id } })).number).toBe("FT-2026-0001");
      expect(await prisma.auditLog.count({ where: { entityId: a.id, action: "advance_renumbered" } })).toBe(1);
    } finally {
      await prisma.setting.deleteMany({ where: { key: "zz.renumber.test" } });
      await prisma.emailOutbox.deleteMany({ where: { id: { in: [mailA.id, mailB.id] } } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ id: { in: [stale.id, auditA.id] } }, { entityId: a.id }] } });
    }
  });
});

describe("B. Built-in Branch Supervisor; Finance no longer moves holds (the migration's role steps)", () => {
  const sql = readFileSync(path.join("prisma", "migrations", "20261119090006_decisions_batch", "migration.sql"), "utf8");
  const statements = sql.split(/;\s*\n/).map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim());
  const insertSup = statements.find((s) => s.startsWith('INSERT INTO "Role"'))!;
  const finStep = statements.find((s) => s.startsWith('UPDATE "Role"') && s.includes("array_remove"))!;
  class Rollback extends Error {}

  it("is created only when no role named Branch Supervisor exists; a role of that name made by hand is kept as it is", async () => {
    expect(insertSup).toContain("'Branch Supervisor'");
    await prisma.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { role: { key: "SUP" } }, data: { roleId: (await tx.role.findUniqueOrThrow({ where: { key: "LA" } })).id } });
      await tx.role.delete({ where: { key: "SUP" } });
      const own = await tx.role.create({ data: { key: "C_Z_BRANCH_SUPERVISOR", name: "branch supervisor", permissions: [PERMISSIONS.LOANS_VIEW, PERMISSIONS.HOLDS_TRANSFER] } });
      await tx.$executeRawUnsafe(insertSup);
      expect(await tx.role.findUnique({ where: { key: "SUP" } })).toBeNull();
      expect((await tx.role.findUniqueOrThrow({ where: { id: own.id } })).permissions).toEqual([PERMISSIONS.LOANS_VIEW, PERMISSIONS.HOLDS_TRANSFER]);
      await tx.role.delete({ where: { id: own.id } });
      await tx.$executeRawUnsafe(insertSup);
      const made = await tx.role.findUniqueOrThrow({ where: { key: "SUP" } });
      expect(made).toMatchObject({ name: "Branch Supervisor", builtIn: true, branchAccess: "ASSIGNED", active: true });
      expect([...made.permissions].sort()).toEqual([...ROLE_DEFAULTS.SUP.permissions].sort());
      // A second run adds nothing.
      await tx.$executeRawUnsafe(insertSup);
      expect(await tx.role.count({ where: { name: "Branch Supervisor" } })).toBe(1);
      throw new Rollback();
    }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
    expect(await prisma.role.findUnique({ where: { key: "SUP" } })).not.toBeNull();
  });

  it("removes 'Move a hold to another person' from the built-in Finance role only (custom roles keep it)", async () => {
    await prisma.$transaction(async (tx) => {
      const finRole = await tx.role.findUniqueOrThrow({ where: { key: "FIN" } });
      await tx.role.update({ where: { id: finRole.id }, data: { permissions: [...finRole.permissions, PERMISSIONS.HOLDS_TRANSFER] } });
      const custom = await tx.role.create({ data: { key: "C_Z_FIN_LIKE", name: "Z Finance like", permissions: [PERMISSIONS.LOANS_VIEW, PERMISSIONS.HOLDS_TRANSFER] } });
      await tx.$executeRawUnsafe(finStep);
      expect((await tx.role.findUniqueOrThrow({ where: { key: "FIN" } })).permissions).not.toContain(PERMISSIONS.HOLDS_TRANSFER);
      expect((await tx.role.findUniqueOrThrow({ where: { id: custom.id } })).permissions).toContain(PERMISSIONS.HOLDS_TRANSFER);
      expect((await tx.role.findUniqueOrThrow({ where: { key: "ADMIN" } })).permissions).toContain(PERMISSIONS.HOLDS_TRANSFER);
      throw new Rollback();
    }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
  });
});
