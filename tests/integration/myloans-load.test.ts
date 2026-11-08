/**
 * Light load on MyLoans and on our database: 25,000 loans, the due query on its partial index, one
 * batched update, the changed-since feed, tiers, the adaptive cap, the hourly ceiling, the advisory
 * lock and snapshot retention. LOCAL database only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma, queryCounter } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { setSetting, getSetting } from "@/lib/settings";
import { openLoanFile } from "@/lib/services/loan-file";
import { dueQuery, refreshLoan, runMyLoansSync } from "@/lib/services/source-sync";
import { MockMyLoansAdapter, type MockOverride } from "@/lib/myloans/mock-adapter";
import { callsThisHour, noteCall, resetClient } from "@/lib/myloans/client";
import { hashTracked, trackedOf } from "@/lib/myloans/changes";
import type { MyLoansAdapter, MyLoansRecord } from "@/lib/myloans/types";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, admin: CurrentUser;
const rec = (i: number): MyLoansRecord => ({
  pn: `PN-${5_000_000 + i}`, cin: `CIN-L${i}`, cif: null, sourceLoanId: `ML-L${i}`, borrowerName: `Load Borrower ${i}`, branchName: "Quezon City", branchCode: "QC",
  status: "RELEASED", loanType: "New", productName: "Auto Refinancing", totalReleasedAmount: 450_000, releaseDate: "2026-11-02",
});

/** n active loan files (tier B, due) with their first MyLoans copy, written in chunks; the matching mock source. */
async function seed(n: number, opts: { tier?: (i: number) => string | null; nextCheck?: (i: number) => Date | null } = {}) {
  const qc = await prisma.branch.findUniqueOrThrow({ where: { code: "QC" } });
  const past = new Date(Date.now() - 60_000);
  for (let i = 0; i < n; i += 5_000) {
    await prisma.loan.createMany({
      data: Array.from({ length: Math.min(5_000, n - i) }, (_, k) => {
        const j = i + k;
        const r = rec(j);
        return {
          pn: r.pn, cin: r.cin, borrowerName: r.borrowerName, branchId: qc.id, loanType: "New", productName: "Auto Refinancing", totalReleasedAmount: 450_000,
          releasedAt: new Date("2026-11-02T00:00:00+08:00"), sourceStatus: "RELEASED", retrievedAt: past, openedById: admin.id, classification: "REFINANCING" as const,
          mortgageResult: "MORTGAGE" as const, ruleFired: "load test", stage: "For checklist", syncTier: opts.tier ? opts.tier(j) : "B", nextCheckAt: opts.nextCheck ? opts.nextCheck(j) : past,
        };
      }),
    });
  }
  const ids = await prisma.loan.findMany({ where: { pn: { startsWith: "PN-50" } }, select: { id: true, pn: true } });
  for (let i = 0; i < ids.length; i += 5_000) {
    await prisma.loanSourceSnapshot.createMany({
      data: ids.slice(i, i + 5_000).map((l) => {
        const r = rec(Number(l.pn.slice(3)) - 5_000_000);
        const t = trackedOf(r);
        return { loanId: l.id, adapter: "mock", payload: { source: "MockMyLoans", loan: r } as unknown as Prisma.InputJsonValue, tracked: t as unknown as Prisma.InputJsonValue, hash: hashTracked(t), kind: "BASE" };
      }),
    });
  }
  return ids;
}
const source = (n: number, o: { feed?: boolean; overrides?: Record<string, MockOverride> } = {}) =>
  new MockMyLoansAdapter({ records: Array.from({ length: n }, (_, i) => rec(i)), capabilities: { search: true, changedSince: !!o.feed }, overrides: () => o.overrides ?? {} });

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  await cleanLoans();
  resetClient();
  await setSetting("myloans.state", { cursor: null, cap: null, runs: [] });
  await setSetting("myloans.maxPerRun", 50);
  await setSetting("myloans.pauseMs", 0);
  await setSetting("myloans.hourlyCeiling", 600);
  await setSetting("myloans.slowMs", 2000);
  await setSetting("myloans.lastRun", null);
});
afterAll(async () => {
  await cleanLoans();
  await setSetting("myloans.state", { cursor: null, cap: null, runs: [] });
  await setSetting("myloans.hourlyCeiling", 600);
  await setSetting("myloans.slowMs", 2000);
  await prisma.$disconnect();
});

describe("25,000 loans in MyLoans and in the DMS", () => {
  it("one run: at most the cap in calls, inside its time budget, a bounded number of statements, the due query on the partial index", async () => {
    await seed(25_000);
    await prisma.$executeRawUnsafe(`ANALYZE "Loan"`);
    const adapter = source(25_000);
    const getByPn = vi.spyOn(adapter, "getByPn");
    const snapshotsBefore = await prisma.loanSourceSnapshot.count();
    const before = queryCounter.count;
    const t0 = Date.now();
    const r = await runMyLoansSync({ trigger: "cron", force: true, adapter });
    const ms = Date.now() - t0;
    const statements = queryCounter.count - before;
    console.info(`[load] 25,000 loans: due ${r.ran && r.due}, calls ${r.ran && r.calls}, ${ms} ms, ${statements} database statements`);
    expect(r).toMatchObject({ ran: true, mode: "poll", due: 50, checked: 50, calls: 50, changes: 0, updated: 0 });
    expect(getByPn).toHaveBeenCalledTimes(50);
    expect(ms).toBeLessThan(10_000);
    expect(statements).toBeLessThanOrEqual(12);
    expect(await prisma.loanSourceSnapshot.count()).toBe(snapshotsBefore); // nothing changed: nothing written but the batch
    expect(await prisma.loan.count({ where: { lastCheckedAt: { not: null } } })).toBe(50);
    const plan = (await prisma.$queryRaw<Record<string, string>[]>(Prisma.sql`EXPLAIN ${dueQuery(new Date(), 50)}`)).map((x) => Object.values(x)[0]).join("\n");
    console.info(`[load] due query plan:\n${plan}`);
    expect(plan).toContain("Loan_due_idx");
    expect(plan).not.toMatch(/Seq Scan on "Loan"/);
  }, 180_000);
});

describe("Changed-since feed", () => {
  it("one call; only PNs open and active here; the cursor with 5 minutes of overlap; no per-loan calls", async () => {
    await seed(20);
    const cursor = new Date(Date.now() - 30 * 60_000);
    await setSetting("myloans.state", { cursor: cursor.toISOString(), cap: null, runs: [] });
    const at = new Date().toISOString();
    const adapter = source(30, { feed: true, overrides: { "PN-5000003": { address: "New St", changedAt: at }, "PN-5000025": { address: "Not here", changedAt: at } } });
    const feed = vi.spyOn(adapter, "getChangedSince");
    const getByPn = vi.spyOn(adapter, "getByPn");
    const r = await runMyLoansSync({ trigger: "cron", force: true, adapter });
    expect(r).toMatchObject({ mode: "feed", due: 1, checked: 1, calls: 1, changes: 1 });
    expect(feed).toHaveBeenCalledTimes(1);
    expect((feed.mock.calls[0][0] as Date).getTime()).toBe(cursor.getTime() - 5 * 60_000);
    expect(getByPn).not.toHaveBeenCalled();
    expect(new Date((await getSetting("myloans.state")).cursor!).getTime()).toBeGreaterThan(cursor.getTime());
  });
});

describe("Tiers, adaptive cap, hourly ceiling, one runner", () => {
  it("only active loans that are due; closed and cancelled never", async () => {
    const future = new Date(Date.now() + 3_600_000);
    await seed(6, { tier: (i) => (["A", "B", "C", null, "A", "C"] as (string | null)[])[i], nextCheck: (i) => (i === 4 ? future : i === 3 ? null : new Date(Date.now() - 60_000)) });
    const r = await runMyLoansSync({ trigger: "cron", force: true, adapter: source(6) });
    expect(r).toMatchObject({ due: 4, checked: 4 });
    const after = await prisma.loan.findMany({ where: { pn: { startsWith: "PN-50" } }, orderBy: { pn: "asc" }, select: { pn: true, syncTier: true, nextCheckAt: true, lastCheckedAt: true } });
    const gap = (i: number) => (after[i].nextCheckAt!.getTime() - after[i].lastCheckedAt!.getTime()) / 60_000;
    expect([gap(0), gap(1), gap(2), gap(5)]).toEqual([60, 240, 1440, 1440]);
    expect(after[3]).toMatchObject({ syncTier: null, nextCheckAt: null, lastCheckedAt: null });
    expect(after[4].lastCheckedAt).toBeNull();
  });

  it("429 and slow answers halve the cap; healthy runs raise it again", async () => {
    await seed(40);
    await setSetting("myloans.maxPerRun", 8);
    const ok = source(40);
    const limited: MyLoansAdapter = { ...ok, name: "mock", capabilities: ok.capabilities, getByPn: async () => ({ ok: false, reason: "UNAVAILABLE", message: "MyLoans asked us to slow down.", retryAfterMs: 1000 }), search: ok.search.bind(ok), getChangedSince: ok.getChangedSince.bind(ok) };
    expect(await runMyLoansSync({ trigger: "cron", force: true, adapter: limited })).toMatchObject({ status: "slowed", cap: 8, errors: 8 });
    expect((await getSetting("myloans.state")).cap).toBe(4);
    resetClient();
    expect(await runMyLoansSync({ trigger: "cron", force: true, adapter: ok })).toMatchObject({ status: "healthy", cap: 4, calls: 4 });
    expect((await getSetting("myloans.state")).cap).toBe(6);
    await setSetting("myloans.slowMs", 5);
    const slowOk: MyLoansAdapter = { ...limited, getByPn: async (pn) => { await new Promise((r) => setTimeout(r, 25)); return ok.getByPn(pn); } };
    resetClient();
    expect(await runMyLoansSync({ trigger: "cron", force: true, adapter: slowOk })).toMatchObject({ status: "slowed" });
    expect((await getSetting("myloans.state")).cap).toBe(3);
  });

  it("hourly ceiling: the background run pauses; opening a loan still asks MyLoans", async () => {
    await setSetting("myloans.hourlyCeiling", 10);
    await openLoanFile(la, { pn: "PN-0001003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    await seed(5);
    for (let i = 0; i < 10; i++) noteCall(5, { ok: true });
    const r = await runMyLoansSync({ trigger: "cron", force: true, adapter: source(5) });
    expect(r).toMatchObject({ ran: true, status: "paused", calls: 0, checked: 0 });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
    const before = callsThisHour();
    expect(await refreshLoan(loan.id, { actor: SYSTEM_ACTOR, mode: "AUTOMATIC", trigger: "open" })).toMatchObject({ ok: true });
    expect(callsThisHour()).toBe(before + 1);
  });

  it("advisory lock: two overlapping runs, only one proceeds", async () => {
    await seed(3);
    const ok = source(3);
    const slow: MyLoansAdapter = { name: "mock", capabilities: ok.capabilities, getByPn: async (pn) => { await new Promise((r) => setTimeout(r, 150)); return ok.getByPn(pn); }, search: ok.search.bind(ok), getChangedSince: ok.getChangedSince.bind(ok) };
    const [a, b] = await Promise.all([runMyLoansSync({ trigger: "cron", force: true, adapter: slow }), runMyLoansSync({ trigger: "run_now", force: true, adapter: slow })]);
    const results = [a, b];
    expect(results.filter((x) => x.ran).length).toBe(1);
    expect(results.find((x) => !x.ran)).toMatchObject({ reason: "Another MyLoans sync is running." });
  });
});

describe("Snapshot retention", () => {
  it("unchanged copies are not stored; minor-only collapse to the latest; material and status kept", async () => {
    await openLoanFile(la, { pn: "PN-0001003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
    const kinds = async () => (await prisma.loanSourceSnapshot.findMany({ where: { loanId: loan.id }, orderBy: { retrievedAt: "asc" } })).map((s) => s.kind);
    const change = async (over: Partial<MyLoansRecord>) => {
      const all = { ...(await getSetting("myloans.mockOverrides")) };
      all["PN-0001003"] = { ...(all["PN-0001003"] ?? {}), ...over, changedAt: new Date().toISOString() };
      await setSetting("myloans.mockOverrides", all);
      return refreshLoan(loan.id, { actor: SYSTEM_ACTOR, mode: "MANUAL", trigger: "button" });
    };
    expect(await kinds()).toEqual(["BASE"]);
    await refreshLoan(loan.id, { actor: SYSTEM_ACTOR, mode: "MANUAL", trigger: "button" });
    expect(await kinds()).toEqual(["BASE"]); // unchanged: not stored
    await change({ address: "1 First St" });
    await change({ address: "2 Second St" });
    expect(await kinds()).toEqual(["BASE", "MINOR"]);
    await change({ totalReleasedAmount: 1_020_000 });
    await change({ address: "3 Third St" });
    await change({ status: "CANCELLED" });
    await change({ address: "4 Fourth St" });
    expect(await kinds()).toEqual(["BASE", "MATERIAL", "STATUS", "MINOR"]);
  });
});
