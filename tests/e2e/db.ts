import { PrismaClient } from "@prisma/client";
import { resetLoanData } from "../../lib/test-data/reset-core";
import { databaseUrlMismatch, loadEnvFiles } from "../../lib/env/load-files";
import { assertTestDatabase, pointAtTestDatabase } from "../../lib/env/test-db";

/** Test-only database helpers: the local test database (gdfi_dms_test) only, never gdfi_dms. */
loadEnvFiles([".env.local", ".env"]); // the shell wins, then .env.local, then .env
pointAtTestDatabase(); // TEST_DATABASE_URL, or DATABASE_URL with the name swapped for gdfi_dms_test
const mismatch = databaseUrlMismatch();
if (mismatch) throw new Error(mismatch);
assertTestDatabase("The Playwright tests");

export const db = new PrismaClient();

/** Same reset the Admin button runs (no audit row: this is test setup, not a user action). */
export async function resetLoans() {
  await db.$transaction((tx) => resetLoanData(tx), { timeout: 60_000 });
  for (const key of ["myloans.simulateUnavailable", "samples.showDataCheck"]) {
    await db.setting.upsert({ where: { key }, create: { key, value: false }, update: { value: false } });
  }
}

/** A Davao loan file, to prove an LA cannot open another branch's file by URL. */
export async function addDavaoFixture() {
  const davao = await db.branch.findUniqueOrThrow({ where: { code: "DVO" } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  await db.loan.upsert({
    where: { pn: "PN-0009007" },
    update: {},
    create: {
      pn: "PN-0009007", borrowerName: "E2E Davao Fixture", branchId: davao.id, loanType: "New", productName: "Auto Financing",
      totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "E2E fixture", stage: "For checklist",
    },
  });
}

/**
 * Removes the Settings rows the e2e tests add (codes starting with Z, zz.* users, 2099 holidays) and
 * makes the seeded rows active again. Test clean-up only: the app itself never deletes rows.
 */
export async function cleanSettingsTestRows() {
  const tt = await db.transactionType.findMany({ where: { code: { startsWith: "Z" } }, select: { id: true } });
  const dt = await db.documentType.findMany({ where: { code: { startsWith: "Z" } }, select: { id: true } });
  const ttIds = tt.map((t) => t.id);
  await db.loanTransaction.deleteMany({ where: { typeId: { in: ttIds } } });
  await db.checklistRule.deleteMany({ where: { OR: [{ transactionTypeId: { in: ttIds } }, { documentTypeId: { in: dt.map((d) => d.id) } }] } });
  await db.cashAdvanceRule.deleteMany({ where: { transactionTypeId: { in: ttIds } } });
  await db.transactionType.deleteMany({ where: { id: { in: ttIds } } });
  await db.retentionRule.deleteMany({ where: { documentTypeId: { in: dt.map((d) => d.id) } } });
  await db.documentType.deleteMany({ where: { code: { startsWith: "Z" } } });
  await db.userBranch.deleteMany({ where: { branch: { code: { startsWith: "Z" } } } });
  await db.branch.deleteMany({ where: { code: { startsWith: "Z" } } });
  await db.holidayCalendar.deleteMany({ where: { date: { startsWith: "2099-" } } });
  await db.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  const reactivate = { active: true, deactivatedAt: null, deactivatedById: null };
  await db.branch.updateMany({ where: { active: false }, data: reactivate });
  await db.documentType.updateMany({ where: { active: false }, data: reactivate });
  await db.ltoOffice.updateMany({ where: { active: false }, data: reactivate });
  await db.user.updateMany({ where: { email: { in: ["test.admin@gdfi.ph", "test.la@gdfi.ph"] } }, data: reactivate });
  await db.branch.update({ where: { code: "MKT" }, data: { name: "Makati" } });
}

/** Removes custom roles the e2e tests add (names starting with Z or "Copy of") and their zz.* users. Test clean-up only. */
export async function cleanTestRoles() {
  await db.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  await db.role.deleteMany({ where: { builtIn: false, OR: [{ name: { startsWith: "Z" } }, { name: { startsWith: "Copy of" } }] } });
}
