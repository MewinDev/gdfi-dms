/**
 * Piece 7 (D-052): the one myloans sync on API 2. Change runs from the checkpoint, the daily catch-up, the first load
 * (pool mode), the lock, the run log, failure simulation (the checkpoint is kept), released loans not yet in the DMS
 * from the cutoff, and strict v2: nothing is applied automatically. Test database, the myloans mock in-process.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { openLoanFile } from "@/lib/services/loan-file";
import { decideOpenItem } from "@/lib/services/open-items";
import { cutoffOf, runMyLoansSync, runScheduled, runSyncNow, saveSyncSettings, type SyncConfig } from "@/lib/services/myloans-sync";
import { myLoansClientV1 } from "@/lib/myloans/v1";
import { addMockScenario, MOCK_SCENARIOS, type MockScenario } from "@/lib/myloans/v1/mock-scenarios";
import type { MockFailure } from "@/lib/myloans/v1/failures";
import { resetClient } from "@/lib/myloans/client";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, admin: CurrentUser;
const PN = "GD1652026901003"; // Angono, Renewal, Auto Financing
const CONFIG: SyncConfig = { intervalMinutes: 30, catchUpTime: "02:00", catchUpHours: 26, alertAfterFailedRuns: 3, goLiveDate: null, cutoffDate: null };
/** No retries and a short timeout: a failure shows at once. */
const quick = () => myLoansClientV1({ ceiling: false, retries: 0, timeoutMs: 400, sleep: async () => {} });
const run = (mode: "CHANGE" | "CATCHUP" | "FIRST_LOAD" = "CHANGE", extra: { pageSize?: number } = {}) => runMyLoansSync({ mode, trigger: "test", client: quick(), ...extra });

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  process.env.MYLOANS_TIMEOUT_MS = "300";
  await cleanLoans();
  await setSetting("myloans.sync", CONFIG);
  await setSetting("myloans.mockFailures", []);
  await setSetting("myloans.paused", false);
  resetClient();
});
afterAll(async () => {
  delete process.env.MYLOANS_TIMEOUT_MS;
  await setSetting("myloans.mockFailures", []);
  await setSetting("myloans.sync", { ...CONFIG, intervalMinutes: 30 });
  await cleanLoans();
  await prisma.$disconnect();
});

const change = async (pn: string, over: Partial<MyLoansRecord>, changedAt = new Date()) => {
  const all = { ...(await getSetting("myloans.mockOverrides")) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: changedAt.toISOString() };
  await setSetting("myloans.mockOverrides", all);
};
async function open(pn = PN) {
  await openLoanFile(la, { pn, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
  return prisma.loan.findUniqueOrThrow({ where: { pn } });
}
const fail = (f: Partial<MockFailure> & Pick<MockFailure, "kind">) => setSetting("myloans.mockFailures", [{ endpoint: "changes", once: false, ...f } as MockFailure]);

describe("change runs and the checkpoint", () => {
  it("the first run reads the last 26 hours; the checkpoint is page 1's RunStartedAt minus 5 minutes; each run is logged and audited", async () => {
    const t0 = Date.now();
    const r = await run();
    expect(r).toMatchObject({ ran: true, ok: true, mode: "CHANGE" });
    const st = await getSetting("myloans.syncState");
    expect(new Date(st.checkpoint!).getTime()).toBeGreaterThanOrEqual(t0 - 5 * 60_000 - 2000);
    expect(new Date(st.checkpoint!).getTime()).toBeLessThanOrEqual(Date.now() - 5 * 60_000 + 1000);
    const logged = await prisma.syncRun.findUniqueOrThrow({ where: { id: r.runId! } });
    expect(logged).toMatchObject({ ok: true, mode: "CHANGE", trigger: "test", checkpointBefore: null });
    expect(logged.since!.getTime()).toBeLessThanOrEqual(t0 - 26 * 3_600_000 + 1000);
    expect(await prisma.auditLog.count({ where: { action: "myloans_sync_run", entityId: r.runId } })).toBe(1);
    // The next run starts from the checkpoint.
    const r2 = await run();
    expect((await prisma.syncRun.findUniqueOrThrow({ where: { id: r2.runId! } })).since!.toISOString()).toBe(st.checkpoint);
  });

  it("strict v2 (D-052 (a), D-053): a change to a loan field is an Open Item, nothing applied; a rename in the same change is lookup data, applied and logged; only an approver of the branch decides", async () => {
    const loan = await open();
    await run();
    await change(PN, { totalReleasedAmount: 1_020_000, areaName: "LUZON 1 (corrected)" });
    const r = await run();
    expect(r).toMatchObject({ ok: true, reviews: 1 });
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.totalReleasedAmount.toString()).toBe(loan.totalReleasedAmount.toString());
    expect(after.sourceAreaName).toBe("LUZON 1 (corrected)"); // a rename (D-053): applied by itself
    expect(await prisma.referenceChange.count({ where: { entity: "AREA", newValue: "LUZON 1 (corrected)", source: "myloans API 2" } })).toBe(1);
    const items = await prisma.openItem.findMany({ where: { loanId: loan.id } });
    expect(items.map((i) => [i.field, i.status, i.syncRunId])).toEqual([["amount", "PENDING", r.runId]]);
    // A second value while it is pending supersedes it (one pending per field).
    await change(PN, { totalReleasedAmount: 1_030_000 });
    await run();
    expect(await prisma.openItem.count({ where: { loanId: loan.id, status: "PENDING" } })).toBe(1);
    expect(await prisma.openItem.count({ where: { loanId: loan.id, status: "SUPERSEDED" } })).toBe(1);
    const item = await prisma.openItem.findFirstOrThrow({ where: { loanId: loan.id, status: "PENDING" } });
    await expect(decideOpenItem(la, item.id, { decision: "APPROVE", remarks: "Checked with the branch" })).rejects.toThrow(/Only approvers decide Open Items/);
    await decideOpenItem(admin, item.id, { decision: "APPROVE", remarks: "Checked with the branch" });
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).totalReleasedAmount.toString()).toBe("1030000");
  });

  it("an unchanged hash is skipped (a timestamp-only change); a status change is a review item", async () => {
    const loan = await open();
    await run();
    await prisma.mockMyLoansTxn.updateMany({ where: { pnNo: PN }, data: { updatedAt: new Date() } });
    expect(await run()).toMatchObject({ ok: true, reviews: 0, unchanged: 1 });
    await change(PN, { status: "CANCELLED" });
    expect(await run()).toMatchObject({ ok: true, reviews: 1 });
    expect(await prisma.openItem.findFirstOrThrow({ where: { loanId: loan.id } })).toMatchObject({ status: "PENDING", field: "status" });
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).cancelledAt).toBeNull();
  });
});

describe("the daily catch-up", () => {
  it("finds a change the change runs missed, and never moves the checkpoint back", async () => {
    const loan = await open();
    await run();
    const checkpoint = (await getSetting("myloans.syncState")).checkpoint!;
    // A change myloans stamped before the checkpoint (a late commit): the change run does not see it.
    await change(PN, { totalReleasedAmount: 1_050_000 }, new Date(new Date(checkpoint).getTime() - 2 * 3_600_000));
    expect(await run()).toMatchObject({ ok: true, reviews: 0 });
    expect(await prisma.openItem.count({ where: { loanId: loan.id } })).toBe(0);
    const before = (await getSetting("myloans.syncState")).checkpoint!;
    const c = await run("CATCHUP");
    expect(c).toMatchObject({ ok: true, mode: "CATCHUP", reviews: 1 });
    expect(await prisma.openItem.count({ where: { loanId: loan.id, status: "PENDING" } })).toBe(1);
    const st = await getSetting("myloans.syncState");
    expect(st.checkpoint! >= before).toBe(true);
    expect(st.lastCatchUpDate).toBeTruthy();
  });

  it("the schedule runs the catch-up once a day at its time (Manila), else a change run when the interval passed", async () => {
    await setSetting("myloans.sync", { ...CONFIG, catchUpTime: "00:00" });
    const now = new Date();
    expect(await runScheduled("test", now)).toMatchObject({ ran: true, mode: "CATCHUP" });
    // Ran a moment ago, the catch-up done today: nothing is due.
    expect(await runScheduled("test", new Date(now.getTime() + 60_000))).toMatchObject({ ran: false, skipped: "Ran less than 30 minutes ago." });
    const later = await runScheduled("test", new Date(now.getTime() + 31 * 60_000));
    expect(later.mode).toBe("CHANGE");
    // Before the catch-up time nothing but change runs.
    await setSetting("myloans.syncState", { checkpoint: null, failedRuns: 0, lastCatchUpDate: null, lastRunAt: null });
    await setSetting("myloans.sync", { ...CONFIG, catchUpTime: "23:59" });
    const manila = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    if (manila < "23:59") expect((await runScheduled("test", now)).mode).toBe("CHANGE");
  });
});

describe("the lock and the pause", () => {
  it("runs never overlap: a held lease skips the run (logged); an expired one is taken over", async () => {
    await prisma.syncLease.create({ data: { id: "myloans-sync", holder: "another-run", expiresAt: new Date(Date.now() + 10 * 60_000) } });
    expect(await run()).toMatchObject({ ran: false, skipped: "Another MyLoans sync is running." });
    expect(await prisma.syncRun.count({ where: { skipped: "Another MyLoans sync is running." } })).toBe(1);
    // Two at once: one runs, the other is skipped.
    await prisma.syncLease.deleteMany({});
    const [a, b] = await Promise.all([run(), run()]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    // A lease left behind by a crashed run expires.
    await prisma.syncLease.create({ data: { id: "myloans-sync", holder: "crashed", expiresAt: new Date(Date.now() - 1000) } });
    expect(await run()).toMatchObject({ ran: true, ok: true });
    expect(await prisma.syncLease.count()).toBe(0);
  });

  it("paused by Admin: no call, the run log says why", async () => {
    await setSetting("myloans.paused", true);
    expect(await run()).toMatchObject({ ran: false, skipped: "MyLoans calls are paused by Admin." });
    expect(await getSetting("myloans.syncState")).toMatchObject({ checkpoint: null });
  });
});

describe("failure simulation: the checkpoint is kept, nothing is lost", () => {
  for (const kind of ["error", "unavailable", "slow", "malformed"] as const) {
    it(`${kind}: the run fails, the checkpoint stays, the next good run catches up`, async () => {
      const loan = await open();
      await run();
      const kept = (await getSetting("myloans.syncState")).checkpoint;
      await change(PN, { totalReleasedAmount: 1_060_000 });
      await fail({ kind });
      const r = await run();
      expect(r).toMatchObject({ ran: true, ok: false });
      expect(await getSetting("myloans.syncState")).toMatchObject({ checkpoint: kept, failedRuns: 1 });
      expect(await prisma.openItem.count({ where: { loanId: loan.id } })).toBe(0);
      expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: r.runId! } })).toMatchObject({ ok: false });
      await setSetting("myloans.mockFailures", []);
      expect(await run()).toMatchObject({ ok: true, reviews: 1 });
      expect(await getSetting("myloans.syncState")).toMatchObject({ failedRuns: 0 });
    }, 20_000);
  }

  it("page N fails: pages before it answered, but nothing is planned and the checkpoint is kept", async () => {
    const loan = await open();
    await run();
    const kept = (await getSetting("myloans.syncState")).checkpoint;
    const pool = await prisma.sourceLoanCandidate.count();
    await change(PN, { totalReleasedAmount: 1_070_000 });
    await addMockScenario("cancelRedo");
    await fail({ kind: "pageFails", page: 2 });
    const r = await run("CHANGE", { pageSize: 1 });
    expect(r).toMatchObject({ ok: false });
    expect(await getSetting("myloans.syncState")).toMatchObject({ checkpoint: kept });
    expect(await prisma.openItem.count({ where: { loanId: loan.id } })).toBe(0);
    expect(await prisma.sourceLoanCandidate.count()).toBe(pool);
    await setSetting("myloans.mockFailures", []);
    expect(await run("CHANGE", { pageSize: 1 })).toMatchObject({ ok: true, reviews: 1 });
  });

  it("Admin is alerted after 3 failed runs in a row", async () => {
    await fail({ kind: "error" });
    const before = await prisma.notification.count({ where: { title: { contains: "failed 3 times in a row" } } });
    await run(); await run();
    expect(await prisma.notification.count({ where: { title: { contains: "failed 3 times in a row" } } })).toBe(before);
    await run();
    expect(await prisma.notification.count({ where: { title: { contains: "failed 3 times in a row" } } })).toBeGreaterThan(before);
  });
});

describe("released loans not yet in the DMS (D-052 (c))", () => {
  it("kept only from the cutoff, with only what the pool card needs; dropped when no longer released", async () => {
    const now = new Date();
    const day = 86_400_000;
    const base = { cin: "CIN-FAKE-POOL", statusId: 12, isActive: true, updatedAt: now, createdAt: now, amount: "300000.00", cifNo: "CIF-FAKE-POOL", firstName: "Fake", loanTypeId: "1", loanType: "New", productId: 1, branchId: 165, source: "test" };
    await prisma.mockMyLoansTxn.createMany({ data: [
      { ...base, id: 950_001, cin: "CIN-FAKE-P1", pnNo: "GD9992026950001", code: "TXN-FAKE-P1", lastName: "Recent", loanId: "950001", releaseDate: new Date(now.getTime() - 10 * day) },
      { ...base, id: 950_002, cin: "CIN-FAKE-P2", pnNo: "GD9992026950002", code: "TXN-FAKE-P2", lastName: "Old", loanId: "950002", releaseDate: new Date(now.getTime() - 60 * day) },
    ] });
    await setSetting("myloans.sync", { ...CONFIG, cutoffDate: new Date(now.getTime() - 30 * day).toISOString().slice(0, 10) });
    await run();
    const kept = await prisma.sourceLoanCandidate.findMany({ where: { externalLoanId: { in: [950_001, 950_002] } } });
    expect(kept.map((k) => k.pn)).toEqual(["GD9992026950001"]);
    expect(kept[0]).toMatchObject({ borrowerName: expect.stringContaining("Recent"), amount: "300000.00" });
    // No longer released: dropped.
    await prisma.mockMyLoansTxn.update({ where: { id: 950_001 }, data: { statusId: 14, updatedAt: new Date() } });
    await run();
    expect(await prisma.sourceLoanCandidate.count({ where: { externalLoanId: 950_001 } })).toBe(0);
  });

  it("the cutoff: the setting, else go-live minus 30 days, else 30 days ago", () => {
    const now = new Date("2026-11-18T10:00:00+08:00");
    expect(cutoffOf({ ...CONFIG, cutoffDate: "2026-10-01" }, now)).toBe("2026-10-01");
    expect(cutoffOf({ ...CONFIG, goLiveDate: "2027-01-15" }, now)).toBe("2026-12-16");
    expect(cutoffOf(CONFIG, now)).toBe("2026-10-19");
  });

  it("the first load (pool mode) reads released loans from the cutoff over pages", async () => {
    await addMockScenario("pool501");
    const r = await run("FIRST_LOAD");
    expect(r).toMatchObject({ ok: true, mode: "FIRST_LOAD" });
    expect(r.pages).toBeGreaterThanOrEqual(2);
    expect(r.candidates).toBeGreaterThanOrEqual(501);
    expect((await getSetting("myloans.syncState")).checkpoint).not.toBeNull();
  }, 60_000);
});

describe("every mock scenario", () => {
  it("each one runs through the sync: duplicates alert and raise nothing, redo copies keep only the live one", async () => {
    await run(); // the checkpoint
    const counts: Partial<Record<MockScenario, unknown>> = {};
    for (const s of Object.keys(MOCK_SCENARIOS) as MockScenario[]) {
      if (s === "pool501" || s === "exactly500") continue;
      await addMockScenario(s);
      const r = await run();
      expect(r, s).toMatchObject({ ran: true, ok: true });
      counts[s] = r;
    }
    expect(counts.duplicate).toMatchObject({ duplicates: 1, candidates: 0 });
    expect(await prisma.notification.count({ where: { title: { contains: "twice in one run" } } })).toBeGreaterThan(0);
    expect(counts.cancelRedo).toMatchObject({ candidates: 1 });
    // Redo without a cancellation: the new copy was made an hour ago (before the checkpoint), so the change run sees
    // only the old copy (its redo suffix is new); the daily catch-up picks the new copy up.
    expect(counts.redoNoCancel).toMatchObject({ candidates: 0 });
    expect(counts.chain3).toMatchObject({ candidates: 1 });
    expect(counts.notReleased).toMatchObject({ candidates: 0 });
    expect(await run("CATCHUP")).toMatchObject({ ok: true, candidates: 1 });
    // Exactly 500: one full page, then an empty one.
    await addMockScenario("exactly500");
    const big = await run();
    expect(big).toMatchObject({ ok: true });
    expect(big.pages).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("a loan we hold, redone in myloans: its review item says Replaced by", async () => {
    const loan = await open();
    await run();
    const t = await prisma.mockMyLoansTxn.findUniqueOrThrow({ where: { id: loan.externalLoanId! } });
    const now = new Date();
    // myloans' redo: the old copy's code gets the time suffix and points at the new copy (same CIN).
    const sfx = `x${new Date(now.getTime() + 8 * 3_600_000).toISOString().replace(/\D/g, "").slice(0, 14)}`;
    await prisma.mockMyLoansTxn.update({ where: { id: t.id }, data: { code: `${t.code}${sfx}`, updatedAt: now } });
    await prisma.mockMyLoansTxn.create({ data: { ...t, id: 960_001, pnNo: "GD9992026960001", loanId: "960001", updatedAt: now, createdAt: now } });
    await prisma.mockMyLoansTxn.update({ where: { id: t.id }, data: { replacedById: 960_001 } });
    expect(await run()).toMatchObject({ ok: true, reviews: 1 });
    const item = await prisma.openItem.findFirstOrThrow({ where: { loanId: loan.id } });
    expect(item).toMatchObject({ status: "PENDING", field: "status", newValue: "Redone in myloans (replaced): replaced by GD9992026960001" });
  });
});

describe("Run now and the settings", () => {
  it("Run now needs the tick; settings need Change MyLoans sync settings and are checked", async () => {
    await expect(runSyncNow(la)).rejects.toThrow('Ask a Superadmin to turn on "Run the MyLoans sync now" for your role.');
    expect(await runSyncNow(admin, "CATCHUP")).toMatchObject({ ran: true, mode: "CATCHUP" });
    const ok = { refreshOnOpenMinutes: "15", refreshOnFindHours: "4", hourlyCeiling: "600", intervalMinutes: "30", catchUpTime: "02:00", catchUpHours: "26", alertAfterFailedRuns: "3", goLiveDate: "", cutoffDate: "" };
    await expect(saveSyncSettings(la, ok)).rejects.toThrow(/Change MyLoans sync settings/);
    await expect(saveSyncSettings(admin, { ...ok, intervalMinutes: "1" })).rejects.toThrow("At least 5.");
    await expect(saveSyncSettings(admin, { ...ok, catchUpTime: "25:00" })).rejects.toThrow("A time like 02:00.");
    await saveSyncSettings(admin, { ...ok, catchUpHours: "30", goLiveDate: "2027-01-15" });
    expect(await getSetting("myloans.sync")).toMatchObject({ catchUpHours: 30, goLiveDate: "2027-01-15", cutoffDate: null });
    expect(await prisma.auditLog.count({ where: { action: "myloans_sync_settings" } })).toBeGreaterThan(0);
  });
});
