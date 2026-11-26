/**
 * Piece 10b (D-046, D-053): released loans not yet in the DMS wait in the branch's LA pool. One item per PN; the
 * waiting time starts when it entered the pool (the sync), not at the release date; an unknown branch goes to the
 * Branch review (Admin's Home warning) and enters the pool once the branch exists; taking an item leads to the Loans search for the PN (D-060: no Accept button; View details opens the preview);
 * opening it closes the item; leaving the pool for each reason; the amount only for people allowed to see amounts;
 * branch scope. Test database, the myloans mock in-process.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { setSetting } from "@/lib/settings";
import { runMyLoansSync, type SyncConfig } from "@/lib/services/myloans-sync";
import { poolItems, receiveReleasedLoan } from "@/lib/services/work-items";
import { acceptWork } from "@/lib/services/inbox";
import { openLoanFile } from "@/lib/services/loan-file";
import { unmatchedCandidates } from "@/components/admin/branches/review-card";
import { myLoansClientV1 } from "@/lib/myloans/v1";
import { resetClient } from "@/lib/myloans/client";
import { loadMockData } from "@/lib/myloans/v1/mock-store";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser;
const DAY = 86_400_000;
const CONFIG: SyncConfig = { intervalMinutes: 30, catchUpTime: "02:00", catchUpHours: 26, alertAfterFailedRuns: 3, goLiveDate: null, cutoffDate: null };
const quick = () => myLoansClientV1({ ceiling: false, retries: 0, timeoutMs: 2000, sleep: async () => {} });
const sync = () => runMyLoansSync({ mode: "CHANGE", trigger: "test", client: quick() });
const PN_A = "GD1012026970001", PN_B = "GD1012026970002", PN_X = "GD7772026970003", PN_C = "GD3902026970004";

/** myloans' BranchID of a DMS branch (D-054: every match uses it). */
const mlId = async (code: string) => (await prisma.branch.findUniqueOrThrow({ where: { code } })).myloansBranchId!;
async function released(id: number, pn: string, branchCode: string | number, releasedDaysAgo: number, extra: Record<string, unknown> = {}) {
  const branchId = typeof branchCode === "number" ? branchCode : await mlId(branchCode);
  const now = new Date();
  await prisma.mockMyLoansTxn.create({ data: {
    id, cin: `CIN-FAKE-POOL-${id}`, pnNo: pn, code: `TXN-FAKE-P${String(id).padStart(10, "0")}`, statusId: 12, isActive: true, updatedAt: now, createdAt: now,
    releaseDate: new Date(now.getTime() - releasedDaysAgo * DAY), amount: "350000.00", cifNo: `CIF-FAKE-POOL-${id}`, firstName: "Pool", lastName: `Borrower ${id}`,
    loanId: String(id), loanTypeId: "1", loanType: "New", productId: 1, branchId, source: "test", ...extra,
  } });
}
const item = (pn: string) => prisma.workItem.findFirst({ where: { kind: "LOAN_CANDIDATE", subjectId: pn }, orderBy: { arrivedAt: "desc" } });

beforeAll(async () => { la = await asUser("test.la@gdfi.ph"); });
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  await cleanLoans();
  await prisma.workItem.deleteMany({ where: { kind: "LOAN_CANDIDATE" } });
  await prisma.branchReview.deleteMany({ where: { kind: "UNKNOWN_CODE", code: "777" } });
  await prisma.userPermissionOverride.deleteMany({ where: { note: "branch-pool test" } });
  await setSetting("myloans.sync", { ...CONFIG, cutoffDate: new Date(Date.now() - 40 * DAY).toISOString().slice(0, 10) });
  resetClient();
  await loadMockData(prisma); // the mock fills itself from the samples first (its branches and products)
});
afterAll(async () => {
  await prisma.workItem.deleteMany({ where: { kind: "LOAN_CANDIDATE" } });
  await prisma.userPermissionOverride.deleteMany({ where: { note: "branch-pool test" } });
  await prisma.mockMyLoansBranch.deleteMany({ where: { branchId: 777 } });
  await prisma.branchReview.deleteMany({ where: { kind: "UNKNOWN_CODE", code: "777" } });
  await setSetting("myloans.sync", CONFIG);
  await cleanLoans();
  await prisma.$disconnect();
});

describe("the branch pool (10b)", () => {
  it("enters the branch's LA pool once per PN; waiting starts at the sync, not the release date; the release date and amount on the card", async () => {
    await released(970_001, PN_A, "101", 20); // released 20 days ago: still green today (D-053)
    await sync();
    await sync(); // the same loan again: still one item
    expect(await prisma.workItem.count({ where: { kind: "LOAN_CANDIDATE", subjectId: PN_A } })).toBe(1);
    const it = await item(PN_A);
    expect(it).toMatchObject({ state: "POOL", role: "LA" });
    expect(Date.now() - it!.arrivedAt.getTime()).toBeLessThan(60_000);
    const row = (await poolItems(la)).find((r) => r.pn === PN_A)!;
    // The LA does not see cash amounts by default: the release date, no amount.
    expect(row).toMatchObject({ waiting: 0, poolTone: "green", candidate: { releaseDate: expect.any(String), amount: null } });
    // With "See cash amounts in the Journey", the amount shows on the card.
    await prisma.userPermissionOverride.create({ data: { userId: la.id, key: PERMISSIONS.JOURNEY_VIEW_AMOUNTS, effect: "GRANT", note: "branch-pool test" } });
    expect((await poolItems(await asUser("test.la@gdfi.ph"))).find((r) => r.pn === PN_A)!.candidate).toMatchObject({ amount: "₱350,000.00" });
  });

  it("taking the item (the service; D-060 removed the Accept button) leads to the Loans search for the PN; opening the loan file closes the item and the candidate", async () => {
    await released(970_002, PN_B, "101", 3);
    await sync();
    const it = (await item(PN_B))!;
    expect(await acceptWork(la, it.id)).toBe(`/loans?q=${PN_B}`); // D-059: the Loans page is the search
    await openLoanFile(la, { pn: PN_B });
    expect(await item(PN_B)).toMatchObject({ state: "DONE", outcome: "DONE" });
    expect(await prisma.sourceLoanCandidate.count({ where: { pn: PN_B } })).toBe(0);
  });

  it("leaves the pool when myloans says it is no longer released (cancelled), with the reason", async () => {
    await released(970_001, PN_A, "101", 5);
    await sync();
    await prisma.mockMyLoansTxn.update({ where: { id: 970_001 }, data: { statusId: 14, updatedAt: new Date() } });
    await sync();
    expect(await item(PN_A)).toMatchObject({ state: "DONE", outcome: "CANCELLED", returnReason: "Cancelled in myloans" });
    expect(await prisma.sourceLoanCandidate.count({ where: { pn: PN_A } })).toBe(0);
  });

  it("an unknown branch: no pool item, a Branch review item and Admin's Home warning; it enters the pool once the branch exists", async () => {
    await prisma.mockMyLoansBranch.upsert({ where: { branchId: 777 }, create: { branchId: 777, branchCode: "777", branchName: "Newtown" }, update: {} });
    await released(970_003, PN_X, 777, 2);
    await sync();
    expect(await item(PN_X)).toBeNull();
    expect(await prisma.branchReview.count({ where: { kind: "UNKNOWN_CODE", code: "777", state: "OPEN" } })).toBe(1);
    expect(await unmatchedCandidates()).toBe(1);
    // The branch is accepted (here: created directly): the next sync puts the loan in its pool.
    const area = await prisma.branch.findFirstOrThrow({ where: { code: "101" }, select: { areaId: true, divisionId: true } });
    const b = await prisma.branch.create({ data: { code: "777", name: "Newtown", areaId: area.areaId, divisionId: area.divisionId, myloansBranchId: 777 } as never });
    try {
      await sync();
      expect(await item(PN_X)).toMatchObject({ state: "POOL", branchId: b.id });
      expect(await unmatchedCandidates()).toBe(0);
    } finally {
      await prisma.workItem.deleteMany({ where: { branchId: b.id } });
      await prisma.branch.delete({ where: { id: b.id } });
    }
  });

  it("D-060: a pool item never arrives before the loan's release date (the app and the database)", async () => {
    const PN = "GD1012026970005";
    // myloans gives a release date later than the sync (a date ahead of the clock): the item arrives at the release.
    await released(970_005, PN, "101", -2);
    await sync();
    const c = await prisma.sourceLoanCandidate.findFirstOrThrow({ where: { pn: PN } });
    expect((await item(PN))!.arrivedAt.getTime()).toBe(c.releaseDate.getTime());
    // Any writer (the database rule): an earlier arrival is moved up to the release date.
    const it = (await item(PN))!;
    await prisma.workItem.update({ where: { id: it.id }, data: { arrivedAt: new Date(c.releaseDate.getTime() - 10 * DAY) } });
    expect((await item(PN))!.arrivedAt.getTime()).toBe(c.releaseDate.getTime());
    // The release date in the myloans copy moves later: the pool item follows it.
    const later = new Date(c.releaseDate.getTime() + DAY);
    await prisma.sourceLoanCandidate.update({ where: { id: c.id }, data: { releaseDate: later } });
    expect((await item(PN))!.arrivedAt.getTime()).toBe(later.getTime());
    // Earlier than the release is kept as it is when the arrival is later (the normal case).
    await prisma.workItem.update({ where: { id: it.id }, data: { arrivedAt: new Date(later.getTime() + 3 * DAY) } });
    expect((await item(PN))!.arrivedAt.getTime()).toBe(later.getTime() + 3 * DAY);
    // The app's own rule, with no myloans copy to check against (receiveReleasedLoan with the release date).
    const PN2 = "GD1012026970006";
    const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
    const rel = new Date(Date.now() + 5 * DAY);
    const made = await prisma.$transaction((tx) => receiveReleasedLoan(tx, { pn: PN2, branchId: branch.id, borrowerName: "Early Bird", at: new Date(), releasedAt: rel }));
    expect(made.arrivedAt.getTime()).toBe(rel.getTime());
  });

  it("branch scope: an LA of Antipolo and Angono does not see an Alaminos candidate", async () => {
    await released(970_004, PN_C, "390", 1);
    await sync();
    expect(await item(PN_C)).toMatchObject({ state: "POOL" });
    expect((await poolItems(la)).map((r) => r.pn)).not.toContain(PN_C);
  });
});
