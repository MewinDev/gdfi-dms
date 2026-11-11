/**
 * The real PN format and the loan's branch: Find loan refuses a wrong PN in plain words without calling
 * MyLoans, a pasted variant works, the PN format setting changes the rules, an unknown branch code in a
 * PN goes to the Branch review without blocking the lookup, and a loan moved to another branch in
 * MyLoans changes only when Admin applies it ("Opened at Antipolo, now at Angono": names only, no codes).
 * Test database (gdfi_dms_test), sample MyLoans.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { lookupPn, openLoanFile } from "@/lib/services/loan-file";
import { applySourceChange, simulateSourceChange } from "@/lib/services/source-sync";
import { reviewFor } from "@/lib/services/source-review";
import { savePnFormat } from "@/lib/services/pn-settings";
import { clearFindCache, findLoans } from "@/lib/myloans/find";
import { resetClient } from "@/lib/myloans/client";
import { openedAt } from "@/lib/pn/opened-at";
import { DEFAULT_PN_FORMAT } from "@/lib/pn/format";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, admin: CurrentUser;
const ANTIPOLO = "GD1012026901001"; // Maria Santos, Antipolo (101)

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  await cleanLoans();
  await setSetting("pn.format", DEFAULT_PN_FORMAT);
  await setSetting("myloans.mockOverrides", {});
  await setSetting("myloans.mockExtra", []);
  await prisma.branchReview.deleteMany({ where: { kind: "UNKNOWN_CODE" } });
  resetClient();
  clearFindCache();
});
afterAll(async () => {
  await cleanLoans();
  await setSetting("pn.format", DEFAULT_PN_FORMAT);
  await setSetting("myloans.mockOverrides", {});
  await setSetting("myloans.mockExtra", []);
  await prisma.branchReview.deleteMany({ where: { kind: "UNKNOWN_CODE" } });
  await prisma.$disconnect();
});

describe("Find loan and the PN check", () => {
  it("a wrong PN is refused in plain words and never reaches MyLoans", async () => {
    const before = (await import("@/lib/myloans/client")).callsThisHour();
    expect(await lookupPn(la, "GD1012027901001")).toEqual({ kind: "invalid", part: "year", message: "This does not look like a PN. Example: GD1012026900001. The year is in the future (2027)." });
    expect(await lookupPn(la, "GD10120269001")).toMatchObject({ kind: "invalid", part: "running", message: expect.stringContaining("The running number must be 5 digits") });
    expect(await lookupPn(la, "GD12026901001")).toMatchObject({ kind: "invalid", part: "branch", message: expect.stringContaining("The branch code must be 3 digits") });
    const live = await findLoans(la, "GD1012027901001");
    expect(live).toEqual({ ok: false, exactOnly: false, message: "This does not look like a PN. Example: GD1012026900001. The year is in the future (2027)." });
    // Still typing part of a PN: searched, not refused.
    expect((await findLoans(la, "GD101202690")).ok).toBe(true);
    expect((await import("@/lib/myloans/client")).callsThisHour()).toBe(before);
    await expect(openLoanFile(la, { pn: "XX1012026901001" })).rejects.toThrow("This does not look like a PN. Example: GD1012026900001. The PN must start with GD, not XX.");
  });

  it("a pasted variant finds and opens the loan, stored as GD1012026901001", async () => {
    expect(await lookupPn(la, "gd 101-2026-9-01001")).toMatchObject({ kind: "preview", pn: ANTIPOLO });
    expect(await openLoanFile(la, { pn: "GD 101 2026 9 01001" })).toEqual({ pn: ANTIPOLO, alreadyOpen: false });
    expect(await prisma.loan.findUnique({ where: { pn: ANTIPOLO }, select: { pn: true } })).toEqual({ pn: ANTIPOLO });
  });

  it("the PN format setting changes the rules; the check can be switched off (Admin, settings:pn_format)", async () => {
    await expect(savePnFormat(la, { enabled: true, prefix: "GD", branchDigits: "3", yearDigits: "4", system: "9", runningDigits: "5" })).rejects.toThrow('Ask an Admin to turn on "Change the PN format" for your role.');
    await expect(savePnFormat(admin, { enabled: true, prefix: "G1", branchDigits: "3", yearDigits: "4", system: "9", runningDigits: "5" })).rejects.toThrow(/Prefix/);
    await savePnFormat(admin, { enabled: true, prefix: "GD", branchDigits: "3", yearDigits: "4", system: "8", runningDigits: "5" });
    expect(await lookupPn(la, ANTIPOLO)).toMatchObject({ kind: "invalid", part: "system" });
    await savePnFormat(admin, { enabled: false, prefix: "GD", branchDigits: "3", yearDigits: "4", system: "9", runningDigits: "5" });
    expect(await lookupPn(la, ANTIPOLO)).toMatchObject({ kind: "preview" });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { entityId: "pn.format" }, orderBy: { at: "desc" } })).summary).toMatch(/check switched off/);
  });

  it("an unknown branch code in the PN goes to the Branch review; the lookup is not blocked", async () => {
    const rec: MyLoansRecord = {
      pn: "GD7772026902070", cin: "CIN-U1", cif: null, sourceLoanId: "ML-U1", borrowerName: "Unknown Code", branchName: "Antipolo", branchCode: "101",
      status: "RELEASED", loanType: "New", productName: "Auto Refinancing", totalReleasedAmount: 600_000, releaseDate: (await getSetting("myloans.mockExtra")).length ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()),
    };
    await setSetting("myloans.mockExtra", [rec]);
    expect(await lookupPn(la, rec.pn)).toMatchObject({ kind: "preview", pn: rec.pn });
    const item = await prisma.branchReview.findFirstOrThrow({ where: { kind: "UNKNOWN_CODE", code: "777", state: "OPEN" } });
    expect(item.pn).toBe(rec.pn);
    await openLoanFile(la, { pn: rec.pn }); // opens at Antipolo, the MyLoans branch
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: rec.pn }, include: { branch: true } });
    expect(loan.branch.code).toBe("101");
    expect((await openedAt(loan.pn, loan.branch))?.text).toBe("Opened at branch code 777 (not a branch here yet), now at Antipolo");
    // Seen again: still one open item.
    await lookupPn(la, rec.pn);
    expect(await prisma.branchReview.count({ where: { kind: "UNKNOWN_CODE", code: "777", state: "OPEN" } })).toBe(1);
  });
});

describe("A loan's branch changes in MyLoans (material change)", () => {
  it("shows old and new branch and the impact; the loan's branch changes only when Admin applies it", async () => {
    await openLoanFile(la, { pn: ANTIPOLO });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: ANTIPOLO }, include: { branch: true } });
    expect((await openedAt(loan.pn, loan.branch))?.text).toBe("Opened at Antipolo");
    await simulateSourceChange(admin, loan.id, "branch");
    const review = await reviewFor(admin, loan.id);
    expect(review).toMatchObject({ category: "MATERIAL" });
    expect(review!.rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Branch", "Branch code"]));
    const to = await prisma.branch.findUniqueOrThrow({ where: { code: String(review!.rows.find((r) => r.label === "Branch code")!.now) } });
    expect(review!.branchMove).toMatchObject({ from: "Antipolo", to: to.name, known: true, openedAt: "Opened at Antipolo" });
    expect(review!.branchMove!.seeBefore).toBeGreaterThan(0);
    // Not applied yet: still Antipolo.
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id }, include: { branch: true } })).branch.code).toBe("101");
    await applySourceChange(admin, review!.id, { note: "MyLoans moved the account to the other branch." });
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id }, include: { branch: true } });
    expect(after.branch.code).toBe(to.code);
    expect(after.pn).toBe(ANTIPOLO); // the PN never changes
    expect((await openedAt(after.pn, after.branch))?.text).toBe(`Opened at Antipolo, now at ${to.name}`);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { loanId: loan.id, action: "source_change_applied" } });
    expect(audit.summary).toContain(`the loan's branch is now ${to.name} (was Antipolo)`);
  });
});
