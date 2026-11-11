/**
 * Monitoring: the DP monitor, the LTO monitor, availability and leave, the Send panel's numbers, LTO
 * advisories and who may do what. Known data made through the same functions the screens use, then
 * the times moved into the past (as the Manual Test Kit does) so each count and average is known.
 * LOCAL test database only; removes all loan files first.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, recommendDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, completeJob, declineJob, forwardJob, receivePackage } from "@/lib/services/jobs";
import { raiseHold } from "@/lib/services/holds";
import { returnToLa } from "@/lib/services/return-to-la";
import { dpByDay, dpDrill, dpMonitor, ltoByDay, ltoDrill, ltoMonitor, openJobCounts, parseMonitorQuery, processors } from "@/lib/services/monitoring";
import { activeAdvisories, advisoryWarnings, editAdvisory, fileAdvisory, resolveAdvisory } from "@/lib/services/lto-advisories";
import { saveDefaultCapacity, saveDpCapacity } from "@/lib/services/dp-capacity";
import { setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { shiftBusinessDays } from "@/lib/kit/rebase";
import { asUser, cleanLoans, workStages, allPapers } from "./helpers";

let la: CurrentUser, dp: CurrentUser, paolo: CurrentUser, admin: CurrentUser, monitor: CurrentUser, fin: CurrentUser;
let holidays: Set<string>;
const today = businessDate(new Date());
const ago = (n: number, hhmm = "10:00") => (n === 0 ? new Date(Date.now() - 5 * 60_000) : new Date(`${shiftBusinessDays(today, -n, holidays)}T${hhmm}:00+08:00`));
const at = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+08:00`);
const ids: Record<string, string> = {};
let qcOffice: string, cebOffice: string;

async function openTxn(pn: string, code: string) {
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  return { loan, txn };
}
async function send(pn: string, code: string, to: CurrentUser, office: string) {
  const { loan, txn } = await openTxn(pn, code);
  await assignToDp(la, { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: to.id, ltoOfficeId: office, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
  return prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
}
/** Moves a job's times into the past: sent, accepted and stage finish times. */
async function move(jobId: string, sent: Date, accepted: Date | null, stages: Partial<Record<"OWN" | "LTO_DROP" | "LTO_PICKUP" | "VERIFY", Date>> = {}) {
  const a = await prisma.dpAssignment.update({ where: { id: jobId }, data: { endorsedAt: sent, ...(accepted ? { decidedAt: accepted } : {}) }, include: { transaction: true } });
  if (a.transaction.status === "ASSIGNED") await prisma.loanTransaction.update({ where: { id: a.transactionId }, data: { statusSince: sent } });
  if (a.transaction.status === "IN_PROCESS" && accepted) await prisma.loanTransaction.update({ where: { id: a.transactionId }, data: { statusSince: accepted } });
  for (const [kind, t] of Object.entries(stages)) await prisma.jobStage.updateMany({ where: { assignmentId: jobId, kind: kind as "OWN" }, data: { startedAt: t, finishedAt: t } });
}
async function finish(jobId: string, by: CurrentUser) {
  await acceptJob(by, jobId);
  await workStages(by, jobId);
  await completeJob(by, jobId, {});
  const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: jobId }, include: { loan: true } });
  await forwardJob(by, jobId, { branchId: a.loan.branchId, receivingLaId: la.id });
  await receivePackage(la, jobId, { result: "complete", note: "" });
}
const q30 = (u: CurrentUser, extra: Record<string, string> = {}) => parseMonitorQuery({ tab: "dp", ...extra }, u, today);

beforeAll(async () => {
  process.env.TEST_MODE = "true";
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  paolo = await asUser("dp.paolo@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  monitor = await asUser("test.monitor@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  holidays = new Set((await prisma.holidayCalendar.findMany({ where: { active: true } })).map((h) => h.date));
  await cleanLoans();
  await prisma.ltoAdvisory.deleteMany();
  await prisma.user.updateMany({ data: { dpCapacity: null, dpOnLeave: false, dpLeaveUntil: null } });
  await setSetting("dp.defaultCapacity", 10);
  await setSetting("funds.blockLtoUntilFunded", true);
  await prisma.transactionType.updateMany({ where: { code: { in: ["NOTARY", "PPSR", "MORTGAGE"] } }, data: { needsLto: true } });
  await prisma.processingStage.updateMany({ data: { active: true, deactivatedAt: null, deactivatedById: null } });
  await prisma.holdReason.updateMany({ where: { code: "CLIENT-PAPERS" }, data: { active: true } });
  await prisma.returnReason.updateMany({ where: { code: "OTHER" }, data: { active: true } });
  qcOffice = (await prisma.ltoOffice.findUniqueOrThrow({ where: { code: "LTO-QC" } })).id;
  cebOffice = (await prisma.ltoOffice.findUniqueOrThrow({ where: { code: "LTO-CEB" } })).id;
  await prisma.ltoOffice.update({ where: { id: qcOffice }, data: { suggestedTransportCents: 50_000, distanceKm: 8 } });

  await openLoanFile(la, { pn: "GD1012026901001" }); // Antipolo, 4 transactions
  await openLoanFile(la, { pn: "GD1012026901006" }); // Antipolo, 4 transactions
  await openLoanFile(la, { pn: "GD1652026901003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }); // Angono

  // GD1012026901001: two jobs finished by the test DP in the period, and one in June (outside it).
  ids.aNotary = (await send("GD1012026901001", "NOTARY", dp, qcOffice)).id;
  await finish(ids.aNotary, dp);
  await move(ids.aNotary, ago(6, "09:00"), ago(5, "09:30"), { OWN: ago(5, "11:00"), LTO_DROP: ago(4, "11:00"), LTO_PICKUP: ago(2, "14:00"), VERIFY: ago(1, "16:00") });
  ids.aPpsr = (await send("GD1012026901001", "PPSR", dp, qcOffice)).id;
  await finish(ids.aPpsr, dp);
  await move(ids.aPpsr, ago(3, "09:00"), ago(3, "09:30"), { OWN: ago(3, "11:00"), LTO_DROP: ago(2, "11:00"), LTO_PICKUP: ago(1, "14:00"), VERIFY: ago(0) });
  // June: Thursday 11 Jun, accepted Monday 15 Jun (Friday 12 Jun is Independence Day), finished Wednesday 17 Jun.
  ids.aMortgage = (await send("GD1012026901001", "MORTGAGE", dp, qcOffice)).id;
  await finish(ids.aMortgage, dp);
  await move(ids.aMortgage, at("2026-06-11", "09:00"), at("2026-06-15", "09:00"), { LTO_DROP: at("2026-06-15", "11:00"), LTO_PICKUP: at("2026-06-16", "14:00"), VERIFY: at("2026-06-17", "16:00") });

  // GD1012026901006: open jobs of the test DP: assigned 2 business days ago (overdue), on hold, at the LTO now.
  ids.bNotary = (await send("GD1012026901006", "NOTARY", dp, qcOffice)).id;
  await move(ids.bNotary, ago(2, "09:00"), null);
  ids.bPpsr = (await send("GD1012026901006", "PPSR", dp, qcOffice)).id;
  await acceptJob(dp, ids.bPpsr);
  await raiseHold(dp, { transactionId: (await prisma.dpAssignment.findUniqueOrThrow({ where: { id: ids.bPpsr } })).transactionId, reasonId: (await prisma.holdReason.findUniqueOrThrow({ where: { code: "CLIENT-PAPERS" } })).id, note: "Waiting for the borrower's signature." });
  ids.bMortgage = (await send("GD1012026901006", "MORTGAGE", dp, qcOffice)).id;
  await acceptJob(dp, ids.bMortgage);
  await workStagesUpTo(ids.bMortgage, dp, 1); // LTO drop off done: at the LTO now
  await move(ids.bMortgage, ago(1, "09:00"), ago(1, "09:30"), { LTO_DROP: ago(1, "11:00") });

  // GD1652026901003 (Angono): Paolo declines one, returns one, has one waiting.
  ids.cNotary = (await send("GD1652026901003", "NOTARY", paolo, cebOffice)).id;
  await declineJob(paolo, ids.cNotary, { reasons: ["No capacity"], remarks: "Too many jobs this week." });
  ids.cPpsr = (await send("GD1652026901003", "PPSR", paolo, cebOffice)).id;
  await acceptJob(paolo, ids.cPpsr);
  const cPpsr = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: ids.cPpsr } });
  await returnToLa(paolo, ids.cPpsr, { reasonId: (await prisma.returnReason.findUniqueOrThrow({ where: { code: "OTHER" } })).id, note: "The ID copy is unreadable.", handedOver: await allPapers(cPpsr.transactionId) });
  ids.cMortgage = (await send("GD1652026901003", "MORTGAGE", paolo, cebOffice)).id;
}, 300_000);

/** Works `count` stages of a job (Start, evidence, Finish). */
async function workStagesUpTo(jobId: string, u: CurrentUser, count: number) {
  const { startStage, finishStage, loadAssignment } = await import("@/lib/services/jobs");
  const { stageRows } = await import("@/lib/services/job-stages");
  for (let i = 0; i < count; i++) {
    const row = (await stageRows(prisma, await loadAssignment(prisma, jobId))).find((r) => r.status !== "DONE")!;
    if (row.status === "LATER") await startStage(u, jobId, row.id ?? row.code);
    const cur = (await stageRows(prisma, await loadAssignment(prisma, jobId))).find((r) => r.code === row.code)!;
    const raw: Record<string, unknown> = {};
    for (const f of cur.fields) raw[f.key] = f.type === "date" ? today : f.type === "tick" ? "on" : f.type === "number" ? "1" : f.type === "file" ? "On file" : `Test ${f.label}`;
    await finishStage(u, jobId, cur.id!, raw);
  }
}

afterAll(async () => {
  await cleanLoans();
  await prisma.ltoAdvisory.deleteMany();
  await prisma.user.updateMany({ data: { dpCapacity: null, dpOnLeave: false, dpLeaveUntil: null } });
  await setSetting("dp.defaultCapacity", 10);
  await prisma.ltoOffice.update({ where: { id: qcOffice }, data: { suggestedTransportCents: null, distanceKm: null } });
  await prisma.$disconnect();
});

describe("DP monitor", () => {
  it("counts each open state as of now, and the period's declines and returns", async () => {
    const m = await dpMonitor(monitor, q30(monitor));
    const me = m.rows.find((r) => r.id === dp.id)!;
    expect(me).toMatchObject({ assigned: 1, inProcess: 1, onHold: 1, overdue: 1, declined: 0, returned: 0, open: 3, finished: 2 });
    const p = m.rows.find((r) => r.id === paolo.id)!;
    expect(p).toMatchObject({ assigned: 1, inProcess: 0, onHold: 0, declined: 1, returned: 1, open: 1, finished: 0 });
    expect(m.tiles).toMatchObject({ assigned: 2, inProcess: 1, onHold: 1, overdue: 1 });
  });

  it("averages the jobs finished in the period, in business days, with the number of jobs", async () => {
    const me = (await dpMonitor(monitor, q30(monitor))).rows.find((r) => r.id === dp.id)!;
    // Notary: sent 6, accepted 5, finished 1 business day ago (1, 4, 5); PPSR: 3, 3, today (0, 3, 3). June is outside.
    expect(me.accept).toEqual({ days: 0.5, n: 2 });
    expect(me.processing).toEqual({ days: 3.5, n: 2 });
    expect(me.total).toEqual({ days: 4, n: 2 });
  });

  it("skips weekends and holidays (June: Thursday to Monday over Independence Day is 1 day)", async () => {
    const q = parseMonitorQuery({ tab: "dp", range: "custom", from: "2026-06-08", to: "2026-06-19" }, monitor, today);
    const me = (await dpMonitor(monitor, q)).rows.find((r) => r.id === dp.id)!;
    expect(me.accept).toEqual({ days: 1, n: 1 });
    expect(me.processing).toEqual({ days: 2, n: 1 });
    expect(me.total).toEqual({ days: 3, n: 1 });
    expect(me.declined).toBe(0);
    // A period with nothing finished: no average, "0 jobs".
    const empty = (await dpMonitor(monitor, parseMonitorQuery({ tab: "dp", range: "custom", from: "2026-05-04", to: "2026-05-08" }, monitor, today))).rows.find((r) => r.id === dp.id)!;
    expect(empty.total).toEqual({ days: null, n: 0 });
  });

  it("follows the branch and transaction type filters", async () => {
    const qc = (await prisma.branch.findUniqueOrThrow({ where: { code: "101" } })).id;
    const m = await dpMonitor(monitor, q30(monitor, { branch: qc }));
    expect(m.rows.find((r) => r.id === paolo.id)?.declined ?? 0).toBe(0); // Paolo's work is in Angono
    const notary = (await dpMonitor(monitor, q30(monitor, { type: "NOTARY" }))).rows.find((r) => r.id === dp.id)!;
    expect(notary).toMatchObject({ assigned: 1, inProcess: 0, onHold: 0, finished: 1 });
  });

  it("groups by Area, then Branch, with subtotals; a processor of two areas is under Several areas, counted once", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "DP" } });
    const [ant, ala] = await Promise.all(["101", "390"].map((code) => prisma.branch.findUniqueOrThrow({ where: { code } })));
    const two = await prisma.user.create({ data: { email: "zz.mon.two.areas@gdfi.ph", name: "Zz Two Areas DP", roleId: role.id, isTestUser: true, branches: { create: [{ branchId: ant.id }, { branchId: ala.id }] } } });
    try {
      const m = await dpMonitor(monitor, q30(monitor));
      const l1 = m.groups.find((g) => g.label === "LUZON 1 (NGMA + RIZAL)")!;
      expect(l1.branches.map((b) => b.label)).toEqual(expect.arrayContaining(["Antipolo", "Angono · Antipolo", "Angono"]));
      const mine = m.rows.find((r) => r.id === dp.id)!;
      expect(mine).toMatchObject({ group: "LUZON 1 (NGMA + RIZAL)", branchGroup: "Angono · Antipolo", branches: ["Angono", "Antipolo"] });
      expect(m.groups.find((g) => g.label === "LUZON 3 NORTH")!.rows.map((r) => r.name)).toContain("Ben Ocampo");
      // Several areas: last, once.
      expect(m.groups.at(-1)!.label).toBe("Several areas");
      expect(m.groups.at(-1)!.rows.map((r) => r.id)).toEqual([two.id]);
      expect(m.rows.filter((r) => r.id === two.id)).toHaveLength(1);
      expect(m.groups.flatMap((g) => g.rows).length).toBe(m.rows.length);
      // Subtotals at both levels add up to the totals; nobody counted twice.
      expect(m.groups.reduce((n, g) => n + g.sub.open, 0)).toBe(m.tiles.assigned + m.tiles.inProcess + m.tiles.onHold);
      for (const g of m.groups) expect(g.branches.reduce((n, b) => n + b.sub.open, 0)).toBe(g.sub.open);
      // The Area filter matches a processor when ANY of their branches is in it.
      const l3 = (await prisma.area.findFirstOrThrow({ where: { name: "LUZON 3 NORTH" } })).id;
      const f = await dpMonitor(monitor, q30(monitor, { area: l3 }));
      expect(f.rows.map((r) => r.id)).toEqual(expect.arrayContaining([two.id]));
      expect(f.rows.find((r) => r.id === dp.id)).toBeUndefined();
      expect(f.tiles.assigned).toBe(0); // no job of a LUZON 3 NORTH loan
      // ... and the Branch filter likewise (Antipolo: the two-area processor and the test DP).
      const b = await dpMonitor(monitor, q30(monitor, { branch: ant.id }));
      expect(b.rows.map((r) => r.id)).toEqual(expect.arrayContaining([two.id, dp.id]));
    } finally {
      await prisma.user.delete({ where: { id: two.id } });
    }
  });

  it("respects a person's branch scope", async () => {
    const supRole = await prisma.role.upsert({ where: { key: "IT-MON-QC" }, create: { key: "IT-MON-QC", name: "IT Monitor QC", permissions: [PERMISSIONS.MONITOR_DP], branchAccess: "ASSIGNED", canSignIn: true }, update: {} });
    const qc = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
    const u = await prisma.user.upsert({ where: { email: "it.monitor.qc@gdfi.ph" }, create: { email: "it.monitor.qc@gdfi.ph", name: "IT QC Monitor", roleId: supRole.id, isTestUser: true, branches: { create: [{ branchId: qc.id }] } }, update: {} });
    const scoped = await asUser(u.email);
    const m = await dpMonitor(scoped, q30(scoped));
    expect(m.rows.find((r) => r.id === paolo.id)).toBeUndefined(); // Angono only
    expect(m.rows.find((r) => r.id === dp.id)).toMatchObject({ assigned: 1, open: 3 });
    await prisma.user.delete({ where: { id: u.id } });
    await prisma.role.delete({ where: { id: supRole.id } });
  });

  it("drill-down: open jobs, declined and returned; the PN is a link only with loan permission", async () => {
    const asMonitor = (await dpDrill(monitor, q30(monitor), dp.id))!;
    expect(asMonitor.open.map((j) => j.status).sort()).toEqual(["Assigned", "In process", "On hold"]);
    const overdue = asMonitor.open.find((j) => j.overdue)!;
    expect(overdue).toMatchObject({ pn: "GD1012026901006", status: "Assigned", age: "2 business days", href: null });
    expect(asMonitor.open.every((j) => j.href === null)).toBe(true);
    const asAdmin = (await dpDrill(admin, q30(admin), dp.id))!;
    expect(asAdmin.open.every((j) => j.href === "/loans/GD1012026901006")).toBe(true);
    const p = (await dpDrill(monitor, q30(monitor), paolo.id))!;
    expect(p.declined).toHaveLength(1);
    expect(p.declined[0]).toMatchObject({ pn: "GD1652026901003", status: "Declined" });
    expect(p.returned[0]).toMatchObject({ pn: "GD1652026901003", status: "Returned to LA" });
  });

  it("by day: assigned, accepted, finished, declined and returned on the day they happened", async () => {
    const d = await dpByDay(monitor, parseMonitorQuery({ tab: "dp", view: "day", range: "7d", dp: dp.id }, monitor, today));
    expect(d.unit).toBe("day");
    expect(d.groups).toHaveLength(1);
    const row = (n: number) => d.groups[0].rows.find((r) => r.key === shiftBusinessDays(today, -n, holidays))!;
    expect(row(1).counts.finished).toBe(1); // the Notary
    expect(row(0).counts.finished).toBe(1); // the PPSR
    expect(d.total.finished).toBe(2);
    const p = await dpByDay(monitor, parseMonitorQuery({ tab: "dp", view: "day", range: "today", dp: paolo.id }, monitor, today));
    expect(p.total).toMatchObject({ assigned: 3, accepted: 1, declined: 1, returned: 1 });
    const weeks = await dpByDay(monitor, parseMonitorQuery({ tab: "dp", view: "day", range: "custom", from: "2026-05-01", to: today }, monitor, today));
    expect(weeks.unit).toBe("week");
  });
});

describe("Availability, capacity and leave", () => {
  it("open jobs = assigned + in process + on hold; default capacity 10; own capacity wins", async () => {
    expect((await openJobCounts()).get(dp.id)).toBe(3);
    let me = (await dpMonitor(monitor, q30(monitor))).rows.find((r) => r.id === dp.id)!;
    expect(me.avail).toMatchObject({ pct: 70, status: "AVAILABLE", text: "70% · 3 of 10 in use" });
    await expect(saveDpCapacity(la, dp.id, { capacity: "3", onLeave: false, leaveUntil: "" })).rejects.toThrow(/does not allow/);
    await saveDpCapacity(admin, dp.id, { capacity: "3", onLeave: false, leaveUntil: "" });
    me = (await dpMonitor(monitor, q30(monitor))).rows.find((r) => r.id === dp.id)!;
    expect(me.avail).toMatchObject({ pct: 0, status: "FULL", capacity: 3 });
    await saveDpCapacity(admin, dp.id, { capacity: "", onLeave: false, leaveUntil: "" });
    await expect(saveDefaultCapacity(monitor, 4)).rejects.toThrow(/does not allow/);
    await expect(saveDefaultCapacity(admin, 0)).rejects.toThrow(/whole number from 1/);
    await saveDefaultCapacity(admin, 4);
    me = (await dpMonitor(monitor, q30(monitor))).rows.find((r) => r.id === dp.id)!;
    expect(me.avail).toMatchObject({ pct: 25, status: "BUSY", text: "25% · 3 of 4 in use" });
    await saveDefaultCapacity(admin, 10);
    expect(await prisma.auditLog.count({ where: { action: { in: ["dp_capacity_changed", "dp_capacity_default_changed"] } } })).toBeGreaterThanOrEqual(4);
  });

  it("on leave: 0%, left out of the average, never recommended, refused at Send", async () => {
    const until = shiftBusinessDays(today, 3, holidays);
    await expect(saveDpCapacity(admin, paolo.id, { capacity: "", onLeave: true, leaveUntil: "2020-01-01" })).rejects.toThrow(/cannot be in the past/);
    await saveDpCapacity(admin, paolo.id, { capacity: "", onLeave: true, leaveUntil: until });
    const m = await dpMonitor(monitor, q30(monitor));
    const p = m.rows.find((r) => r.id === paolo.id)!;
    expect(p.avail).toMatchObject({ pct: 0, status: "ON_LEAVE" });
    expect(p.leaveUntil).toBe(until);
    const others = m.rows.filter((r) => r.avail.status !== "ON_LEAVE");
    expect(m.tiles.avgAvailability).toBe(Math.round(others.reduce((s, r) => s + r.avail.pct, 0) / others.length));
    const ceb = await prisma.branch.findUniqueOrThrow({ where: { code: "165" } });
    expect((await recommendDp(ceb.id))?.id).not.toBe(paolo.id);
    // Send to a processor on leave is refused (the Send panel shows them disabled).
    const l3 = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" } });
    const t = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: l3.id, type: { code: "NOTARY" } } });
    await expect(assignToDp(la, { transactionId: t.id, dpBranchId: ceb.id, dpUserId: paolo.id, ltoOfficeId: cebOffice, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null }))
      .rejects.toThrow(/on leave until/);
    // The Send panel's processors: on leave with the day.
    expect((await processors(today)).find((x) => x.id === paolo.id)).toMatchObject({ onLeave: true, leaveUntil: until });
    await saveDpCapacity(admin, paolo.id, { capacity: "", onLeave: false, leaveUntil: "" });
  });
});

describe("LTO monitor", () => {
  it("transactions, at the LTO now and the average time at the LTO, by office and area", async () => {
    const m = await ltoMonitor(monitor, parseMonitorQuery({ tab: "lto" }, monitor, today));
    const qc = m.rows.find((r) => r.id === qcOffice)!;
    // Dropped off in the period: Notary (4 days ago), PPSR (2), Mortgage (1, still there). June is outside.
    expect(qc).toMatchObject({ used: 3, atNow: 1, area: "Quezon City", distanceKm: 8 });
    expect(qc.avgAt).toEqual({ days: 1.5, n: 2 }); // 2 and 1 business days
    expect(m.rows.find((r) => r.id === cebOffice)).toMatchObject({ used: 0, atNow: 0 });
    expect(m.tiles).toMatchObject({ atNow: 1, busiest: { name: qc.name, used: 3 } });
    expect(m.groups.map((g) => g.label)).toContain("Quezon City"); // LTO offices: grouped by the office's city
  });

  it("amounts only with the amounts permission", async () => {
    const asMonitor = await ltoMonitor(monitor, parseMonitorQuery({ tab: "lto" }, monitor, today));
    expect(asMonitor.showAmounts).toBe(false);
    expect(asMonitor.rows.every((r) => r.money === null)).toBe(true);
    const asFinance = await ltoMonitor(fin, parseMonitorQuery({ tab: "lto" }, fin, today));
    expect(asFinance.rows.find((r) => r.id === qcOffice)!.money).toEqual({ estimateCents: 150_000, spentCents: 0 });
  });

  it("drill-down: at the LTO now and picked up in the period", async () => {
    const d = (await ltoDrill(monitor, parseMonitorQuery({ tab: "lto" }, monitor, today), qcOffice))!;
    expect(d.atNow.map((j) => j.pn)).toEqual(["GD1012026901006"]);
    expect(d.atNow[0]).toMatchObject({ href: null, pickText: "Not yet" });
    expect(d.finished).toHaveLength(2);
    expect(d.finished.map((j) => j.days).sort()).toEqual(["1 business day", "2 business days"]);
  });

  it("by day: drop offs and pickups", async () => {
    const d = await ltoByDay(monitor, parseMonitorQuery({ tab: "lto", view: "day", range: "7d", office: qcOffice }, monitor, today));
    expect(d.total).toMatchObject({ dropped: 3, picked: 2 });
  });
});

describe("LTO advisories", () => {
  it("a processor files from their job at an LTO stage only; Operations from Monitoring", async () => {
    await expect(fileAdvisory(dp, { assignmentId: ids.bPpsr, type: "SYSTEM_DOWN", remarks: "System down all day." })).rejects.toThrow(/at an LTO stage|while you work/);
    await expect(fileAdvisory(paolo, { assignmentId: ids.bMortgage, type: "SYSTEM_DOWN", remarks: "System down all day." })).rejects.toThrow(/someone else/);
    await expect(fileAdvisory(la, { ltoOfficeId: qcOffice, type: "SYSTEM_DOWN", remarks: "System down all day." })).rejects.toThrow(/does not allow/);
    await expect(fileAdvisory(dp, { ltoOfficeId: qcOffice, type: "SYSTEM_DOWN", remarks: "System down all day." })).rejects.toThrow(/does not allow filing LTO advisories here/);
    await expect(fileAdvisory(dp, { assignmentId: ids.bMortgage, type: "SYSTEM_DOWN", remarks: "Down" })).rejects.toThrow(/5 to 500/);
    await expect(fileAdvisory(dp, { assignmentId: ids.bMortgage, type: "BROKEN", remarks: "System down all day." })).rejects.toThrow(/Pick what is wrong/);
    await expect(fileAdvisory(dp, { assignmentId: ids.bMortgage, type: "SYSTEM_DOWN", remarks: "System down all day.", startedAt: "2099-01-01T08:00" })).rejects.toThrow(/future/);
    const notesBefore = await prisma.notification.count({ where: { userId: monitor.id } });
    const a = await fileAdvisory(dp, { assignmentId: ids.bMortgage, type: "SYSTEM_DOWN", remarks: "The LTMS terminals are offline." });
    expect(a).toMatchObject({ ltoOfficeId: qcOffice, filedById: dp.id, filedByLabel: dp.name, assignmentId: ids.bMortgage, resolvedAt: null });
    // The Operations Monitors are told (in-app, and email through the outbox); processors are not.
    expect(await prisma.notification.count({ where: { userId: monitor.id } })).toBe(notesBefore + 1);
    expect(await prisma.emailOutbox.count({ where: { event: "lto_advisory", userId: monitor.id } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { userId: { in: [dp.id, paolo.id] }, title: { startsWith: "LTO advisory" } } })).toBe(0);
    const b = await fileAdvisory(monitor, { ltoOfficeId: cebOffice, type: "LONG_QUEUE", remarks: "Queue past the gate.", startedAt: `${shiftBusinessDays(today, -2, holidays)}T07:30` });
    ids.advA = a.id; ids.advB = b.id;
    // Not in any Journey.
    expect(await prisma.auditLog.count({ where: { action: "lto_advisory_filed", loanId: { not: null } } })).toBe(0);
  });

  it("warnings on the office choice, the 24-hour prompt for people who can resolve", async () => {
    const w = await advisoryWarnings();
    expect(w[qcOffice][0]).toMatch(/^LTO Quezon City District Office: System down, reported by Test Document Processor, \d+ min ago$/);
    expect(w[cebOffice][0]).toMatch(/Long queue, reported by Test Operations Monitor/);
    const forMonitor = await activeAdvisories(monitor);
    expect(forMonitor.find((x) => x.id === ids.advB)!.prompt).toBe("Still active? Please confirm");
    expect(forMonitor.find((x) => x.id === ids.advA)!.prompt).toBeNull(); // newer than 24 hours
    const forPaolo = await activeAdvisories(paolo);
    expect(forPaolo.find((x) => x.id === ids.advB)!).toMatchObject({ prompt: null, mayResolve: false });
    const m = await ltoMonitor(monitor, parseMonitorQuery({ tab: "lto" }, monitor, today));
    expect(m.tiles.withAdvisory).toBe(2);
    expect(m.rows.find((r) => r.id === qcOffice)).toMatchObject({ activeAdvisories: 1 });
  });

  it("who may resolve or edit; remarks required; who and when recorded", async () => {
    await expect(resolveAdvisory(paolo, ids.advA, { remarks: "Working again." })).rejects.toThrow(/Only the person who filed it/);
    await expect(resolveAdvisory(dp, ids.advA, { remarks: "ok" })).rejects.toThrow(/5 to 500/);
    await expect(editAdvisory(paolo, ids.advA, { type: "OTHER", remarks: "Changed by someone else." })).rejects.toThrow(/Only the person/);
    await editAdvisory(monitor, ids.advA, { type: "OFFICE_CLOSED", remarks: "Closed until noon." });
    await resolveAdvisory(dp, ids.advA, { remarks: "Working again since 1 PM." }); // the filer
    const a = await prisma.ltoAdvisory.findUniqueOrThrow({ where: { id: ids.advA } });
    expect(a).toMatchObject({ type: "OFFICE_CLOSED", resolvedById: dp.id, resolvedByLabel: dp.name, resolveRemarks: "Working again since 1 PM.", editedByLabel: monitor.name });
    expect(a.resolvedAt).not.toBeNull();
    await expect(resolveAdvisory(monitor, ids.advA, { remarks: "Again please." })).rejects.toThrow(/already resolved/);
    await resolveAdvisory(admin, ids.advB, { remarks: "Queue is short again." }); // Admin manages
    expect((await advisoryWarnings())[qcOffice]).toBeUndefined();
    const m = await ltoMonitor(monitor, parseMonitorQuery({ tab: "lto" }, monitor, today));
    expect(m.resolved.map((r) => r.id).sort()).toEqual([ids.advA, ids.advB].sort());
  });
});

describe("Permissions", () => {
  it("the Operations Monitor role: read-only, all branches, monitors and advisories only", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "MONITOR" } });
    expect(role).toMatchObject({ name: "Operations Monitor", branchAccess: "ALL", builtIn: true });
    expect([...monitor.permissions].sort()).toEqual([PERMISSIONS.LTO_REPORTS_MANAGE, PERMISSIONS.LTO_REPORTS_NOTIFY, PERMISSIONS.MONITOR_DP, PERMISSIONS.MONITOR_LTO].sort());
    for (const p of [PERMISSIONS.MONITOR_DP, PERMISSIONS.MONITOR_LTO, PERMISSIONS.LTO_REPORTS_CREATE, PERMISSIONS.LTO_REPORTS_MANAGE, PERMISSIONS.DP_CAPACITY_MANAGE]) expect(admin.permissions.has(p), p).toBe(true);
    expect(fin.permissions.has(PERMISSIONS.MONITOR_DP)).toBe(false);
    expect(dp.permissions.has(PERMISSIONS.LTO_REPORTS_CREATE)).toBe(true);
    expect(dp.permissions.has(PERMISSIONS.MONITOR_DP)).toBe(false);
  });

});
