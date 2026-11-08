/**
 * Integration tests against the LOCAL database (refuses any non-localhost DATABASE_URL).
 * They remove all loan files, like "Reset test data" does.
 */
import { execSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { resetTestData } from "@/lib/services/test-data";
import { openLoanFile } from "@/lib/services/loan-file";
import { effectivePermissions } from "@/lib/auth/access";
import { setSetting } from "@/lib/settings";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Integration tests only run against a local database.");

async function asUser(email: string): Promise<CurrentUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true, branches: { include: { branch: true } } } });
  const permissions = effectivePermissions(u.role) as Set<string>; // same rule as the app
  const branchIds = u.branches.map((b) => b.branchId);
  return {
    id: u.id, email: u.email, name: u.name, roleKey: u.role.key, roleName: u.role.name, permissions, branchIds,
    branchNames: u.branches.map((b) => b.branch.name), scopeBranchIds: u.role.branchAccess === "ALL" ? null : branchIds,
  };
}

let admin: CurrentUser;
let la: CurrentUser;
const savedTestMode = process.env.TEST_MODE;

beforeAll(async () => {
  admin = await asUser("test.admin@gdfi.ph");
  la = await asUser("test.la@gdfi.ph");
  await setSetting("myloans.simulateUnavailable", false);
});
beforeEach(() => {
  process.env.TEST_MODE = "true";
});
afterAll(async () => {
  process.env.TEST_MODE = savedTestMode;
  await prisma.$disconnect();
});

describe("Reset test data", () => {
  it("is refused when TEST_MODE is not true", async () => {
    process.env.TEST_MODE = "false";
    await expect(resetTestData(admin)).rejects.toThrow(/only available in test mode/);
    delete process.env.TEST_MODE;
    await expect(resetTestData(admin)).rejects.toThrow(/only available in test mode/);
  });

  it("is refused for a non-Admin", async () => {
    await expect(resetTestData(la)).rejects.toThrow(/does not allow resetting test data/);
  });

  it("removes loan files, keeps users and writes exactly one audit row", async () => {
    // Each test opens its own loan file.
    await openLoanFile(la, { pn: "PN-0001001" });
    await openLoanFile(la, { pn: "PN-0001004", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const usersBefore = await prisma.user.count();
    const branchesBefore = await prisma.branch.count();
    const rulesBefore = await prisma.checklistRule.count();
    const auditBefore = await prisma.auditLog.count({ where: { action: "test_data_reset" } });
    const auditAllBefore = await prisma.auditLog.count();

    const counts = await resetTestData(admin);

    expect(counts.loanFiles).toBeGreaterThanOrEqual(2);
    expect(counts.transactions).toBeGreaterThanOrEqual(6); // 4 + 2
    expect(await prisma.loan.count()).toBe(0);
    expect(await prisma.loanTransaction.count()).toBe(0);
    expect(await prisma.documentItem.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.branch.count()).toBe(branchesBefore);
    expect(await prisma.checklistRule.count()).toBe(rulesBefore);
    // Audit rows are kept, plus one new "Test data reset" row.
    expect(await prisma.auditLog.count({ where: { action: "test_data_reset" } })).toBe(auditBefore + 1);
    expect(await prisma.auditLog.count()).toBe(auditAllBefore + 1);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "test_data_reset" }, orderBy: { at: "desc" } });
    expect(row.summary).toMatch(/^Test data reset/);
    expect((row.details as { loanFiles: number }).loanFiles).toBe(counts.loanFiles);
  });

  it("a fresh seed creates no loan files", async () => {
    await resetTestData(admin);
    execSync("npm run db:seed", { stdio: "pipe", env: process.env });
    expect(await prisma.loan.count()).toBe(0);
    expect(await prisma.user.count({ where: { email: "test.la@gdfi.ph" } })).toBe(1);
  });
});
