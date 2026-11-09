/**
 * Monitoring on a large data set: 20,000 loan files with a DP job each (finished, in process, waiting,
 * on hold, declined, returned), their stages and LTO offices, written in chunks like the MyLoans load
 * test. The page's queries (DP monitor, LTO monitor, By day, drill-downs, the Send panel's open counts)
 * must stay well under one second. LOCAL test database only; removes all loan files first and after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { dpByDay, dpDrill, dpMonitor, filterOptions, ltoByDay, ltoDrill, ltoMonitor, openJobCounts, parseMonitorQuery } from "@/lib/services/monitoring";
import { businessDate } from "@/lib/time";
import { asUser, cleanLoans } from "./helpers";

const N = 20_000;
const CHUNK = 5_000;
let monitor: CurrentUser;
const today = businessDate(new Date());
const timings: Record<string, number> = {};

beforeAll(async () => {
  process.env.TEST_MODE = "true";
  monitor = await asUser("test.monitor@gdfi.ph");
  // PERF_KEEP=1 keeps the data between runs (while tuning); a normal run always starts clean.
  if (process.env.PERF_KEEP === "1" && (await prisma.loan.count({ where: { pn: { startsWith: "PN-7" } } })) === N) return;
  await cleanLoans();
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  const branches = await prisma.branch.findMany({ where: { code: { in: ["QC", "CEB", "DVO"] } } });
  const dps = await prisma.user.findMany({ where: { email: { in: ["test.dp@gdfi.ph", "dp.rico@gdfi.ph", "dp.joy@gdfi.ph", "dp.paolo@gdfi.ph", "dp.grace@gdfi.ph", "dp.ben@gdfi.ph"] } } });
  const offices = await prisma.ltoOffice.findMany({ where: { active: true } });
  const notary = await prisma.transactionType.findUniqueOrThrow({ where: { code: "NOTARY" } });
  const reason = await prisma.holdReason.findFirstOrThrow();
  const DAY = 86_400_000;
  const now = Date.now();
  for (let start = 0; start < N; start += CHUNK) {
    const rows = Array.from({ length: Math.min(CHUNK, N - start) }, (_, k) => start + k);
    const plan = rows.map((i) => {
      const b = branches[i % branches.length];
      const dp = dps[i % dps.length];
      const office = offices[i % offices.length];
      const sentAt = new Date(now - ((i % 90) + 1) * DAY);
      const kind = i % 20; // 0-13 finished, 14-15 in process, 16 waiting, 17 on hold, 18 declined, 19 returned
      return { i, b, dp, office, sentAt, kind };
    });
    await prisma.loan.createMany({
      data: plan.map(({ i, b, sentAt }) => ({
        id: `perf-l-${i}`, pn: `PN-${7_000_000 + i}`, borrowerName: `Perf Borrower ${i}`, branchId: b.id, loanType: "New", productName: "Auto Refinancing", totalReleasedAmount: 450_000,
        releasedAt: sentAt, sourceStatus: "RELEASED", retrievedAt: sentAt, openedById: admin.id, classification: "REFINANCING" as const, mortgageResult: "MORTGAGE" as const, ruleFired: "perf test", stage: "In process",
      })),
    });
    await prisma.loanTransaction.createMany({
      data: plan.map(({ i, kind, sentAt }) => ({
        id: `perf-t-${i}`, loanId: `perf-l-${i}`, typeId: notary.id, statusSince: sentAt,
        status: kind < 14 ? ("COMPLETED" as const) : kind <= 15 || kind === 17 ? ("IN_PROCESS" as const) : kind === 16 ? ("ASSIGNED" as const) : ("RETURNED" as const),
      })),
    });
    await prisma.dpAssignment.createMany({
      data: plan.map(({ i, b, dp, office, sentAt, kind }) => ({
        id: `perf-a-${i}`, loanId: `perf-l-${i}`, transactionId: `perf-t-${i}`, dpBranchId: b.id, dpUserId: dp.id, assignedById: admin.id, ltoOfficeId: office.id, endorsedAt: sentAt,
        status: kind < 14 ? ("CLOSED" as const) : kind <= 15 || kind === 17 ? ("ACCEPTED" as const) : kind === 16 ? ("PENDING_ACCEPTANCE" as const) : kind === 18 ? ("DECLINED" as const) : ("WITHDRAWN" as const),
        decidedAt: kind === 16 ? null : new Date(sentAt.getTime() + DAY), returnedAt: kind === 19 ? new Date(sentAt.getTime() + 2 * DAY) : null,
      })),
    });
    const stages = plan.flatMap(({ i, sentAt, kind }) => {
      if (kind >= 16 && kind !== 17) return [];
      const t = (d: number) => new Date(sentAt.getTime() + d * DAY);
      const done = kind < 14;
      return [
        { assignmentId: `perf-a-${i}`, code: "NOTARIZATION", name: "Notarization", kind: "OWN" as const, sortOrder: 1, status: "DONE" as const, startedAt: t(1), finishedAt: t(1.2) },
        { assignmentId: `perf-a-${i}`, code: "LTO_DROP", name: "LTO drop off", kind: "LTO_DROP" as const, sortOrder: 2, status: "DONE" as const, startedAt: t(1.5), finishedAt: t(1.6) },
        { assignmentId: `perf-a-${i}`, code: "LTO_PICKUP", name: "LTO pickup", kind: "LTO_PICKUP" as const, sortOrder: 3, status: done ? ("DONE" as const) : ("LATER" as const), startedAt: done ? t(2.5) : null, finishedAt: done ? t(2.6 + (i % 3)) : null },
        { assignmentId: `perf-a-${i}`, code: "VERIFY", name: "Check and verify", kind: "VERIFY" as const, sortOrder: 4, status: done ? ("DONE" as const) : ("LATER" as const), startedAt: done ? t(3.5 + (i % 3)) : null, finishedAt: done ? t(3.6 + (i % 3)) : null },
      ];
    });
    for (let s = 0; s < stages.length; s += 10_000) await prisma.jobStage.createMany({ data: stages.slice(s, s + 10_000) });
    await prisma.hold.createMany({
      data: plan.filter((p) => p.kind === 17).map(({ i, dp }) => ({ loanId: `perf-l-${i}`, transactionId: `perf-t-${i}`, reasonId: reason.id, reasonName: reason.name, note: "Perf test hold", raisedById: dp.id, raisedByLabel: dp.name, ownerId: dp.id })),
    });
  }
  await prisma.$executeRawUnsafe(`ANALYZE "Loan", "LoanTransaction", "DpAssignment", "JobStage", "Hold"`);
}, 600_000);

afterAll(async () => {
  if (process.env.PERF_KEEP !== "1") await cleanLoans();
  // Make the timings visible in the test output (the report quotes them).
  console.log(`Monitoring on ${N.toLocaleString("en-PH")} loans:`, JSON.stringify(timings));
  await prisma.$disconnect();
}, 300_000);

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const r = await fn();
  timings[name] = Math.round(performance.now() - t);
  return r;
}

describe(`Monitoring with ${N.toLocaleString("en-PH")} loans`, () => {
  it("the DP page (what the page runs) stays under one second", async () => {
    const q = parseMonitorQuery({ tab: "dp" }, monitor, today);
    await dpMonitor(monitor, q); // warm up (connections, plans)
    const m = await timed("dp page", async () => { await filterOptions(monitor); return dpMonitor(monitor, q); });
    expect(m.tiles.assigned + m.tiles.inProcess + m.tiles.onHold).toBe(N / 20 * 4);
    expect(m.rows.reduce((s, r) => s + r.finished, 0)).toBeGreaterThan(0);
    expect(timings["dp page"]).toBeLessThan(1000);
  });

  it("the LTO page stays under one second", async () => {
    const q = parseMonitorQuery({ tab: "lto" }, monitor, today);
    await ltoMonitor(monitor, q);
    const m = await timed("lto page", async () => { await filterOptions(monitor); return ltoMonitor(monitor, q); });
    expect(m.tiles.atNow).toBe(N / 20 * 3);
    expect(timings["lto page"]).toBeLessThan(1000);
  });

  it("By day (days, and weeks over 92 days), drill-downs and the Send panel counts stay under one second", async () => {
    const day = parseMonitorQuery({ tab: "dp", view: "day" }, monitor, today);
    await timed("dp by day (30 days)", () => dpByDay(monitor, day));
    const weeks = parseMonitorQuery({ tab: "dp", view: "day", range: "custom", from: businessDate(new Date(Date.now() - 120 * 86_400_000)), to: today }, monitor, today);
    await timed("dp by week (120 days)", () => dpByDay(monitor, weeks));
    await timed("lto by day", () => ltoByDay(monitor, parseMonitorQuery({ tab: "lto", view: "day" }, monitor, today)));
    const dpId = (await prisma.user.findUniqueOrThrow({ where: { email: "test.dp@gdfi.ph" } })).id;
    await timed("dp drill-down", () => dpDrill(monitor, parseMonitorQuery({ tab: "dp" }, monitor, today), dpId));
    const office = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true } });
    await timed("lto drill-down", () => ltoDrill(monitor, parseMonitorQuery({ tab: "lto" }, monitor, today), office.id));
    await timed("send panel open counts", () => openJobCounts());
    for (const [k, v] of Object.entries(timings)) expect(v, k).toBeLessThan(1000);
  });
});
