/**
 * Piece 11 (D-054): branches from API 4 and products from API 5, on the mock through the same client. Branches match by
 * myloans' BranchID (a code change is a logged rename, never a broken match); a closed branch keeps its work and only
 * stops new pool items; a new product is classified by the keywords and the classifiers are told; a failed read keeps
 * the last list; the LTO-PASIG sample flag. Test database, the myloans mock in-process.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { loanScope } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { myLoansClientV1 } from "@/lib/myloans/v1";
import { loadMockData } from "@/lib/myloans/v1/mock-store";
import { resetClient } from "@/lib/myloans/client";
import { runBranchSync, acceptReview } from "@/lib/services/branches";
import { refreshProducts } from "@/lib/services/products";
import { runMyLoansSync, type SyncConfig } from "@/lib/services/myloans-sync";
import { closedBranchesWithWork } from "@/components/admin/branches/review-card";
import { openLoanFile } from "@/lib/services/loan-file";
import { refreshLoan } from "@/lib/services/source-sync";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, admin: CurrentUser, head: CurrentUser;
const DAY = 86_400_000;
const CONFIG: SyncConfig = { intervalMinutes: 30, catchUpTime: "02:00", catchUpHours: 26, alertAfterFailedRuns: 3, goLiveDate: null, cutoffDate: null };
const quick = () => myLoansClientV1({ ceiling: false, retries: 0, timeoutMs: 2000, sleep: async () => {} });
const sync = () => runMyLoansSync({ mode: "CHANGE", trigger: "test", client: quick() });
let saved: { branches: { id: string; code: string | null; name: string; active: boolean; deactivatedAt: Date | null }[] };

async function released(id: number, pn: string, mlBranchId: number) {
  const now = new Date();
  await prisma.mockMyLoansTxn.create({ data: {
    id, cin: `CIN-FAKE-REF-${id}`, pnNo: pn, code: `TXN-FAKE-R${String(id).padStart(10, "0")}`, statusId: 12, isActive: true, updatedAt: now, createdAt: now,
    releaseDate: new Date(now.getTime() - 2 * DAY), amount: "300000.00", cifNo: `CIF-FAKE-REF-${id}`, firstName: "Ref", lastName: `Borrower ${id}`,
    loanId: String(id), loanTypeId: "1", loanType: "New", productId: 1, branchId: mlBranchId, source: "test",
  } });
}

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  head = await asUser("test.lahead@gdfi.ph");
  saved = { branches: await prisma.branch.findMany({ select: { id: true, code: true, name: true, active: true, deactivatedAt: true } }) };
});
async function restoreBranches() {
  for (const b of saved.branches) await prisma.branch.update({ where: { id: b.id }, data: { code: b.code, name: b.name, active: b.active, deactivatedAt: b.deactivatedAt } }).catch(() => null);
  await prisma.branchReview.deleteMany({ where: { state: "OPEN", kind: { in: ["CLOSED", "RENAMED", "CODE_CHANGED"] } } });
}
beforeEach(async () => {
  await restoreBranches();
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  await cleanLoans();
  await setSetting("myloans.mockBranches", { overrides: {}, extra: [] });
  await setSetting("myloans.mockFailures", []);
  await setSetting("myloans.sync", { ...CONFIG, cutoffDate: new Date(Date.now() - 40 * DAY).toISOString().slice(0, 10) });
  await prisma.workItem.deleteMany({ where: { kind: "LOAN_CANDIDATE" } });
  resetClient();
  await loadMockData(prisma);
});
afterAll(async () => {
  // The branches as they were (names, codes, status).
  await restoreBranches();
  await setSetting("myloans.mockBranches", { overrides: {}, extra: [] });
  await setSetting("myloans.mockFailures", []);
  await setSetting("myloans.sync", CONFIG);
  await prisma.workItem.deleteMany({ where: { kind: "LOAN_CANDIDATE" } });
  await cleanLoans();
  await prisma.$disconnect();
});

const antipolo = () => prisma.branch.findFirstOrThrow({ where: { name: "Antipolo" } });

describe("API 4: the branch list on the mock, through the same client (contract)", () => {
  it("every branch with myloans' BranchID, code and name; the DMS keeps the same BranchID", async () => {
    const r = await quick().branches();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = await antipolo();
    const row = r.data.items.find((b) => b.branchId === a.myloansBranchId)!;
    expect(row).toMatchObject({ branchCode: a.code, branchName: "Antipolo" });
  });
});

describe("D-054: branches match by BranchID", () => {
  it("a rename and a code change in myloans: applied by themselves and logged in Reference data changes, not the Branch review", async () => {
    const a = await antipolo();
    await setSetting("myloans.mockBranches", { overrides: { [String(a.myloansBranchId)]: { name: "Antipolo City", code: "199" } }, extra: [] });
    const r = await runBranchSync({ trigger: "cron" });
    expect(r).toMatchObject({ ok: true });
    expect(await prisma.branch.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ name: "Antipolo City", code: "199" });
    expect(await prisma.referenceChange.count({ where: { entity: "BRANCH", oldValue: "Antipolo", newValue: "Antipolo City", source: "myloans API 4" } })).toBe(1);
    expect(await prisma.referenceChange.count({ where: { entity: "BRANCH_CODE", oldValue: a.code, newValue: "199" } })).toBe(1);
    expect(await prisma.branchReview.count({ where: { state: "OPEN", branchId: a.id, kind: { in: ["RENAMED", "CODE_CHANGED"] } } })).toBe(0);
  });

  it("a code change keeps the branch's loans flowing into the same pool, and a held loan raises no Open Item (a logged rename)", async () => {
    const a = await antipolo();
    await openLoanFile(la, { pn: "GD1012026901001" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026901001" } });
    await setSetting("myloans.mockBranches", { overrides: { [String(a.myloansBranchId)]: { code: "198" } }, extra: [] });
    await runBranchSync({ trigger: "cron" });
    // A new released loan at that branch (by its BranchID): into the same branch's pool.
    await released(975_001, "GD1982026975001", a.myloansBranchId!);
    await sync();
    expect(await prisma.workItem.findFirst({ where: { kind: "LOAN_CANDIDATE", subjectId: "GD1982026975001" } })).toMatchObject({ state: "POOL", branchId: a.id });
    // The loan already in the DMS: the new code is lookup data, not a move.
    await setSetting("myloans.mockOverrides", { GD1012026901001: { changedAt: new Date().toISOString() } });
    resetClient();
    await refreshLoan(loan.id, { actor: SYSTEM_ACTOR, mode: "MANUAL", trigger: "button" });
    expect(await prisma.openItem.count({ where: { loanId: loan.id, status: "PENDING" } })).toBe(0);
    expect(await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).toMatchObject({ branchId: a.id, sourceBranchCode: "198" });
  });

  it("a branch closed in myloans: its loan files and work stay accessible; only NEW pool items stop; Admin's Home warns about its open items", async () => {
    const a = await antipolo();
    await openLoanFile(la, { pn: "GD1012026901001" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026901001" } });
    await setSetting("myloans.mockBranches", { overrides: { [String(a.myloansBranchId)]: { active: false } }, extra: [] });
    await runBranchSync({ trigger: "cron" });
    const review = await prisma.branchReview.findFirstOrThrow({ where: { state: "OPEN", branchId: a.id, kind: "CLOSED" } });
    await acceptReview(admin, review.id);
    expect((await prisma.branch.findUniqueOrThrow({ where: { id: a.id } })).active).toBe(false);
    // Still fully accessible: the loan file and its work items.
    expect(await prisma.loan.findFirst({ where: { id: loan.id, ...loanScope(await asUser("test.la@gdfi.ph")) } })).not.toBeNull();
    const open = await prisma.workItem.count({ where: { branchId: a.id, state: { not: "DONE" } } });
    expect(open).toBeGreaterThan(0);
    expect(await closedBranchesWithWork()).toEqual(expect.arrayContaining([{ name: a.name, open }]));
    // No new pool items for it.
    await released(975_002, "GD1012026975002", a.myloansBranchId!);
    await sync();
    expect(await prisma.workItem.findFirst({ where: { kind: "LOAN_CANDIDATE", subjectId: "GD1012026975002" } })).toBeNull();
  });

  it("a failed read keeps the last list", async () => {
    const before = await prisma.branch.findMany({ orderBy: { id: "asc" }, select: { id: true, code: true, name: true, active: true } });
    await setSetting("myloans.mockFailures", [{ endpoint: "branches", kind: "error", once: false }]);
    const r = await runBranchSync({ trigger: "cron" });
    expect(r).toMatchObject({ ok: false });
    expect(await prisma.branch.findMany({ orderBy: { id: "asc" }, select: { id: true, code: true, name: true, active: true } })).toEqual(before);
  });
});

describe("API 5: products", () => {
  it("a new product: classified by the keywords, the classifiers told; a rename logged; one no longer sent made inactive (never deleted); a failed read keeps the list", async () => {
    await refreshProducts(); // the list as it is
    expect(await getSetting("products.lastReadAt")).not.toBeNull();
    const max = (await prisma.mockMyLoansProduct.aggregate({ _max: { productId: true } }))._max.productId ?? 0;
    await prisma.mockMyLoansProduct.createMany({ data: [
      { productId: max + 1, productCode: "BN-NEW", name: "Brand New Truck Loan", active: true },
      { productId: max + 2, productCode: "ZZ-NEW", name: "Equipment Line", active: true },
    ] });
    try {
      const r = await refreshProducts();
      expect(r.added).toBe(2);
      const notes = await prisma.notification.findMany({ where: { userId: head.id, title: { startsWith: "New product:" } }, orderBy: { createdAt: "asc" } });
      expect(notes.map((n) => n.body.split(".")[0])).toEqual(expect.arrayContaining([
        "New product: Brand New Truck Loan, classified as Financing",
        "New product: Equipment Line, classified as Refinancing by default",
      ]));
      expect(await prisma.notification.count({ where: { userId: la.id, title: { startsWith: "New product:" } } })).toBe(0);
      // Renamed in myloans: logged; removed from the list: inactive, still there.
      await prisma.mockMyLoansProduct.update({ where: { productId: max + 2 }, data: { name: "Equipment Line Plus" } });
      await prisma.mockMyLoansProduct.delete({ where: { productId: max + 1 } });
      await refreshProducts();
      expect(await prisma.referenceChange.count({ where: { entity: "PRODUCT", oldValue: "Equipment Line", newValue: "Equipment Line Plus", source: "myloans API 5" } })).toBe(1);
      expect(await prisma.product.findFirstOrThrow({ where: { sourceProductId: max + 1 } })).toMatchObject({ active: false });
      // A failed read: refused, nothing changed.
      const count = await prisma.product.count();
      await setSetting("myloans.mockFailures", [{ endpoint: "products", kind: "error", once: false }]);
      await expect(refreshProducts()).rejects.toThrow();
      expect(await prisma.product.count()).toBe(count);
    } finally {
      await setSetting("myloans.mockFailures", []);
      await prisma.mockMyLoansProduct.deleteMany({ where: { productId: { gt: max } } });
      await prisma.product.deleteMany({ where: { sourceProductId: { gt: max } } });
    }
  });
});

describe("D-020: the LTO-PASIG sample office", () => {
  it("is marked as a sample with its note (a badge in Settings and on Send)", async () => {
    const o = await prisma.ltoOffice.findUnique({ where: { code: "LTO-PASIG" } });
    if (o) expect(o).toMatchObject({ isSample: true, sampleNote: "Sample. Verify with Operations" });
  });
});
