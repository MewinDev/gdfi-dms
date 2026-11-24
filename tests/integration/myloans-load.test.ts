/**
 * Light load on myloans and on our database (piece 7, D-052): the sync reads only what changed (API 2 pages), 10,000
 * held loans unchanged cost no write, a few changed ones become review items, and the hourly ceiling is for API 1
 * (Find loan, refreshes) only. Snapshot retention. Test database, the myloans mock in-process.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, queryCounter } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { setSetting, getSetting } from "@/lib/settings";
import { openLoanFile } from "@/lib/services/loan-file";
import { refreshLoan } from "@/lib/services/source-sync";
import { runMyLoansSync } from "@/lib/services/myloans-sync";
import { myLoansClientV1 } from "@/lib/myloans/v1";
import { callsThisHour, resetClient } from "@/lib/myloans/client";
import type { FeedRowV1 } from "@/lib/myloans/v1/schema";
import { recordOfRow } from "@/lib/myloans/v1/adapter";
import { hashTracked, trackedOf } from "@/lib/myloans/changes";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, admin: CurrentUser;
const N = 10_000;
const quick = () => myLoansClientV1({ ceiling: false, retries: 0, sleep: async () => {} });

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  await cleanLoans();
  resetClient();
  await setSetting("myloans.hourlyCeiling", 600);
});
afterAll(async () => {
  await cleanLoans();
  await setSetting("myloans.hourlyCeiling", 600);
  await prisma.$disconnect();
});

describe("10,000 held loans changed in one day", () => {
  it("unchanged ones cost no write; three changed ones become review items; a bounded number of statements", async () => {
    const now = new Date();
    const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
    await prisma.mockMyLoansTxn.count(); // the mock fills itself from the samples first
    await prisma.mockMyLoansTxn.createMany({ data: Array.from({ length: N }, (_, i) => ({
      id: 700_000 + i, cin: `CIN-FAKE-L${i}`, pnNo: `GD1012026${String(700_000 + i)}`, code: `TXN-FAKE-L${String(i).padStart(10, "0")}`, statusId: 12, isActive: true,
      updatedAt: now, createdAt: now, releaseDate: new Date(now.getTime() - 3 * 86_400_000), amount: "450000.00", cifNo: `CIF-FAKE-L${i}`, firstName: "Load", lastName: `Borrower ${i}`,
      loanId: String(700_000 + i), loanTypeId: "1", loanType: "New", productId: 1, branchId: 101, source: "load",
    })) });
    // The DMS holds every one of them, with the hash myloans sends now.
    const rows: FeedRowV1[] = [];
    for (let after = 0; ;) {
      const p = await quick().changesPage({ since: new Date(now.getTime() - 60_000).toISOString(), afterId: after, limit: 500 });
      if (!p.ok) throw new Error(p.message);
      rows.push(...p.data.items);
      if (p.data.nextAfterId === null) break;
      after = p.data.nextAfterId;
    }
    const mine = rows.filter((r) => r.externalLoanId >= 700_000);
    expect(mine).toHaveLength(N);
    for (let i = 0; i < N; i += 5_000) {
      await prisma.loan.createMany({ data: mine.slice(i, i + 5_000).map((r) => ({
        pn: r.pnNo!, cin: r.cin, externalLoanId: r.externalLoanId, contentHash: r.contentHash, borrowerName: `Load Borrower ${r.externalLoanId}`, branchId: branch.id, loanType: "New",
        productName: "Auto Refinancing", totalReleasedAmount: 450_000, releasedAt: new Date(r.releaseDate!), sourceStatus: "RELEASED", retrievedAt: now, openedById: admin.id,
        classification: "REFINANCING" as const, mortgageResult: "MORTGAGE" as const, ruleFired: "load test", stage: "For checklist",
      })) });
    }
    await setSetting("myloans.syncState", { checkpoint: new Date(now.getTime() - 60_000).toISOString(), failedRuns: 0, lastCatchUpDate: null, lastRunAt: null });
    const calls = await callsThisHour();
    const before = queryCounter.count;
    const t0 = Date.now();
    const r = await runMyLoansSync({ mode: "CHANGE", trigger: "test", client: quick() });
    const ms = Date.now() - t0;
    const statements = queryCounter.count - before;
    console.info(`[load] ${N} held loans: ${r.pages} pages, ${r.rows} rows, ${ms} ms, ${statements} database statements (the in-process mock's reads included)`);
    expect(r).toMatchObject({ ran: true, ok: true, reviews: 0 });
    expect(r.unchanged).toBeGreaterThanOrEqual(N);
    expect(r.pages).toBeGreaterThanOrEqual(N / 500);
    // Per page the mock reads its tables (about 8 statements); the sync itself adds a handful for the whole run.
    expect(statements).toBeLessThanOrEqual(r.pages! * 10 + 40);
    expect(ms).toBeLessThan(60_000);
    expect(await callsThisHour()).toBe(calls); // the sync is not counted against the API 1 ceiling
    // Three change: three review items, nothing applied. (Their first copy, as Open loan file keeps it.)
    for (const r of mine.filter((x) => [700_001, 705_000, 709_999].includes(x.externalLoanId))) {
      const loan = await prisma.loan.findUniqueOrThrow({ where: { externalLoanId: r.externalLoanId } });
      const rec = recordOfRow(r), t = trackedOf(rec);
      await prisma.loanSourceSnapshot.create({ data: { loanId: loan.id, adapter: "contract", payload: { loan: rec, contract: r } as never, tracked: t as never, hash: hashTracked(t), kind: "BASE" } });
    }
    await prisma.mockMyLoansTxn.updateMany({ where: { id: { in: [700_001, 705_000, 709_999] } }, data: { amount: "460000.00", updatedAt: new Date() } });
    const r2 = await runMyLoansSync({ mode: "CHANGE", trigger: "test", client: quick() });
    expect(r2).toMatchObject({ ok: true, reviews: 3 });
    expect(await prisma.loan.count({ where: { totalReleasedAmount: 460_000 } })).toBe(0);
  }, 240_000);
});

describe("The hourly ceiling (API 1)", () => {
  it("a refresh of one loan is counted against the hourly ceiling (the sync is not: above)", async () => {
    await setSetting("myloans.hourlyCeiling", 10);
    await openLoanFile(la, { pn: "GD1652026901003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" } });
    const before = await callsThisHour();
    expect(await refreshLoan(loan.id, { actor: SYSTEM_ACTOR, mode: "AUTOMATIC", trigger: "open" })).toMatchObject({ ok: true });
    expect(await callsThisHour()).toBe(before + 1);
  });
});

describe("Snapshot retention", () => {
  it("unchanged copies are not stored; minor-only collapse to the latest; material and status kept", async () => {
    await openLoanFile(la, { pn: "GD1652026901003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" } });
    const kinds = async () => (await prisma.loanSourceSnapshot.findMany({ where: { loanId: loan.id }, orderBy: { retrievedAt: "asc" } })).map((s) => s.kind);
    const change = async (over: Partial<MyLoansRecord>) => {
      const all = { ...(await getSetting("myloans.mockOverrides")) };
      all["GD1652026901003"] = { ...(all["GD1652026901003"] ?? {}), ...over, changedAt: new Date().toISOString() };
      await setSetting("myloans.mockOverrides", all);
      return refreshLoan(loan.id, { actor: SYSTEM_ACTOR, mode: "MANUAL", trigger: "button" });
    };
    expect(await kinds()).toEqual(["BASE"]);
    await refreshLoan(loan.id, { actor: SYSTEM_ACTOR, mode: "MANUAL", trigger: "button" });
    expect(await kinds()).toEqual(["BASE"]); // unchanged: not stored
    await change({ areaName: "Area 1 First St" });
    await change({ areaName: "Area 2 Second St" });
    expect(await kinds()).toEqual(["BASE", "MINOR"]);
    await change({ totalReleasedAmount: 1_020_000 });
    await change({ areaName: "Area 3 Third St" });
    await change({ status: "CANCELLED" });
    // Cancelled in myloans: API 1 answers 422 with no details (D-050), so a later area change cannot be seen.
    await change({ areaName: "Area 4 Fourth St" });
    expect(await kinds()).toEqual(["BASE", "MATERIAL", "MINOR", "STATUS"]);
  });
});
