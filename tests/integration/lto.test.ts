/**
 * "Needs LTO processing" per transaction type, and the LTO office everywhere it is needed.
 * LOCAL database only; removes all loan files first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { addCustomTransaction, assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, completeJob, logAttempt, receivePackage } from "@/lib/services/jobs";
import { dpChangeLtoOffice, laChangeLtoOffice } from "@/lib/services/lto";
import { requestAdvance, requestableJobs } from "@/lib/services/funds";
import { saveSettingsRow } from "@/lib/services/admin";
import { setRowActive } from "@/lib/services/settings-status";
import { checkImport, currentDataCsv, runImport } from "@/lib/import/importer";
import { toCsv } from "@/lib/import/csv";
import { businessDate } from "@/lib/time";
import { asUser, cleanLoans, workStages, forwardToLoanBranch } from "./helpers";

let la: CurrentUser, dp: CurrentUser, admin: CurrentUser;
let mandaue: { id: string; name: string }, cebu: { id: string; name: string };

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await prisma.transactionType.deleteMany({ where: { code: { startsWith: "Z" }, txns: { none: {} } } });
  await prisma.ltoOffice.deleteMany({ where: { code: { startsWith: "Z" }, assignments: { none: {} }, advanceLines: { none: {} } } });
  mandaue = await prisma.ltoOffice.upsert({ where: { code: "ZLTO-MAN" }, create: { code: "ZLTO-MAN", name: "Z LTO Mandaue", distanceKm: 25, travelHours: 1, suggestedTransportCents: 60000 }, update: { active: true, distanceKm: 25, travelHours: 1, suggestedTransportCents: 60000 } });
  cebu = await prisma.ltoOffice.upsert({ where: { code: "ZLTO-CEB" }, create: { code: "ZLTO-CEB", name: "Z LTO Cebu City" }, update: { active: true } });
});
afterAll(async () => {
  await cleanLoans();
  await prisma.transactionType.deleteMany({ where: { code: { startsWith: "Z" }, txns: { none: {} } } });
  await prisma.ltoOffice.deleteMany({ where: { code: { startsWith: "Z" } } });
  await prisma.$disconnect();
});

async function ready(code: string) {
  await openLoanFile(la, { pn: "PN-0001003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  return { loan, txn };
}
const send = (loan: { branchId: string }, transactionId: string, ltoOfficeId: string | null, extra: { fundsNeeded?: "YES" | "NO"; fundsKinds?: string[] } = {}) =>
  assignToDp(la, {
    transactionId, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId, fundsNeeded: extra.fundsNeeded ?? "NO", fundsKinds: extra.fundsKinds ?? [],
    beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  });

describe("Needs LTO processing", () => {
  it("migration defaults: Notary, Entry of PPSR and Mortgage on; EDST off", async () => {
    const t = await prisma.transactionType.findMany({ where: { code: { in: ["NOTARY", "EDST", "PPSR", "MORTGAGE"] } } });
    expect(Object.fromEntries(t.map((x) => [x.code, x.needsLto]))).toEqual({ NOTARY: true, EDST: false, PPSR: true, MORTGAGE: true });
  });

  it("send is refused without an office when the type needs it (Notary, PPSR; no Mortgage special case); stored on the assignment", async () => {
    const { loan, txn } = await ready("PPSR");
    await expect(send(loan, txn.id, null)).rejects.toThrow("Pick the LTO office.");
    await send(loan, txn.id, mandaue.id);
    expect((await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } })).ltoOfficeId).toBe(mandaue.id);
  });

  it("a type without the setting does not need (or keep) an office; a custom type with it does", async () => {
    await prisma.transactionType.update({ where: { code: "NOTARY" }, data: { needsLto: false } });
    try {
      const { loan, txn } = await ready("NOTARY");
      await send(loan, txn.id, mandaue.id);
      expect((await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } })).ltoOfficeId).toBeNull();
    } finally {
      await prisma.transactionType.update({ where: { code: "NOTARY" }, data: { needsLto: true } });
    }
    const custom = await prisma.transactionType.create({ data: { code: "ZCOURIER", name: "Z Courier", requiresDp: true, needsLto: true, ownerRole: "DP", sortOrder: 90 } });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
    await addCustomTransaction(la, { loanId: loan.id, typeId: custom.id });
    const ct = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, typeId: custom.id } });
    await saveChecklist(la, { transactionId: ct.id, checkedIds: [], newOthers: [] });
    await expect(send(loan, ct.id, null)).rejects.toThrow("Pick the LTO office.");
  });

  it("the setting needs a processor (Settings); audited; types Import/Export has the column", async () => {
    const custom = await prisma.transactionType.create({ data: { code: "ZSPA", name: "Z SPA", requiresDp: true, ownerRole: "DP", sortOrder: 91 } });
    await expect(saveSettingsRow(admin, "transactionType", custom.id, { code: "ZSPA", name: "Z SPA", ownerRole: "DP", sortOrder: "91", requiresDp: "", needsLto: "on" })).rejects.toThrow(/needs a processor/);
    await saveSettingsRow(admin, "transactionType", custom.id, { code: "ZSPA", name: "Z SPA", ownerRole: "DP", sortOrder: "91", requiresDp: "on", needsLto: "on" });
    expect((await prisma.transactionType.findUniqueOrThrow({ where: { id: custom.id } })).needsLto).toBe(true);
    expect(await prisma.auditLog.count({ where: { entityType: "transactionType", entityId: custom.id } })).toBe(1);
    const csv = await currentDataCsv("transaction-types");
    expect(csv.split("\n")[0]).toContain("needs_lto");
    expect(csv).toMatch(/ZSPA,Z SPA,DP,Yes,Yes,/);
    const file = toCsv(["code", "name", "done_by", "needs_processor", "needs_lto", "order", "status"], [{ code: "ZSPA", name: "Z SPA", done_by: "DP", needs_processor: "Yes", needs_lto: "No", order: "91", status: "Active" }]);
    const run = await runImport(admin, "transaction-types", "t.csv", file);
    if (!run.ok) throw new Error(run.error);
    expect((await prisma.transactionType.findUniqueOrThrow({ where: { id: custom.id } })).needsLto).toBe(false);
  });
});

describe("Changing the office", () => {
  it("the LA before accept (DP told); the DP after accept with a note (LA and Finance told, audit)", async () => {
    const { loan, txn } = await ready("NOTARY");
    await send(loan, txn.id, mandaue.id);
    await laChangeLtoOffice(la, txn.id, { ltoOfficeId: cebu.id });
    expect(await prisma.notification.count({ where: { userId: dp.id, title: { contains: "LTO office changed" } } })).toBe(1);
    const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } });
    expect(job.ltoOfficeId).toBe(cebu.id);
    await acceptJob(dp, job.id, true);
    await expect(laChangeLtoOffice(la, txn.id, { ltoOfficeId: mandaue.id })).rejects.toThrow(/already accepted/);
    await expect(dpChangeLtoOffice(dp, job.id, { ltoOfficeId: mandaue.id, note: "" })).rejects.toThrow(/Say why the office is different/);
    await dpChangeLtoOffice(dp, job.id, { ltoOfficeId: mandaue.id, note: "Cebu City office is closed today" });
    const fin = await prisma.user.findUniqueOrThrow({ where: { email: "test.finance@gdfi.ph" } });
    expect(await prisma.notification.count({ where: { userId: fin.id, title: { contains: "LTO office changed" } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: la.id, title: { contains: "LTO office changed" } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "lto_office_changed", entityId: job.id } })).toBe(1);
  });
});

describe("Funds and custody", () => {
  it("the request lists the office and estimate, Transport pre-fills from it, the line keeps the office it had", async () => {
    const { loan, txn } = await ready("NOTARY");
    await send(loan, txn.id, mandaue.id, { fundsNeeded: "YES", fundsKinds: ["TRANSPORT"] });
    const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } });
    await acceptJob(dp, job.id, true);
    const [j] = await requestableJobs(dp);
    expect(j.lto).toEqual({ id: mandaue.id, name: "Z LTO Mandaue", estimate: "about 25 km · usually 1 hour · suggested transport ₱600" });
    expect(j.kinds.find((k) => k.kind === "TRANSPORT")).toMatchObject({ suggestedCents: 60000, suggestedFrom: "office" });
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "TRANSPORT", cents: 70000 }] });
    const line = await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } });
    expect(line.ltoOfficeId).toBe(mandaue.id);
    // The office changes later: the line still knows the office it was asked for (shown as "Office changed").
    await dpChangeLtoOffice(dp, job.id, { ltoOfficeId: cebu.id, note: "Moved to Cebu City" });
    expect((await prisma.cashAdvanceLine.findUniqueOrThrow({ where: { id: line.id } })).ltoOfficeId).toBe(mandaue.id);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).ltoOfficeId).toBe(cebu.id);
  });

  it("At the LTO for Notary, then the existing hand-back to the LA of the branch", async () => {
    const { loan, txn } = await ready("NOTARY");
    await send(loan, txn.id, mandaue.id);
    const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } });
    await acceptJob(dp, job.id, true);
    await logAttempt(dp, job.id, { date: businessDate(new Date()), result: "DONE" });
    await workStages(dp, job.id, { name: "Atty. Uy", docNo: "1", pageNo: "2", bookNo: "III", series: "2026" });
    await completeJob(dp, job.id, {});
    await forwardToLoanBranch(dp, job.id, la.id);
    await receivePackage(la, job.id, true, "");
    const doc = await prisma.documentItem.findFirstOrThrow({ where: { transactionId: txn.id, documentId: { not: null } } });
    const moves = await prisma.documentMovement.findMany({ where: { documentItemId: doc.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    // The LTO stages write the drop and pickup; Check and verify writes Returned to DP and Verified by DP.
    expect(moves.map((m) => m.action)).toEqual(["RECEIVED_AT_BRANCH", "DISPATCHED_TO_DP", "ACKNOWLEDGED_BY_DP", "AT_LTO", "RETURNED_FROM_LTO", "RETURNED_TO_DP", "VERIFIED_BY_DP", "FORWARDED_TO_BRANCH", "ACCEPTED_AT_BRANCH"]);
    expect(moves.find((m) => m.action === "AT_LTO")).toMatchObject({ location: "Z LTO Mandaue" });
    expect(moves.find((m) => m.action === "AT_LTO")?.remarks).toMatch(/^Dropped at Z LTO Mandaue on \d{4}-\d{2}-\d{2}$/);
    expect(doc.stage).toBe("AT_BRANCH");
  });
});

describe("LTO office list and the branch's usual office", () => {
  it("estimate fields, Inactive, Import/Export with the new columns; usual office on a branch", async () => {
    await saveSettingsRow(admin, "ltoOffice", null, { code: "ZLTO-TAL", name: "Z LTO Talisay", city: "Talisay", distanceKm: "18", travelHours: "0.5", suggestedTransport: "350" });
    const t = await prisma.ltoOffice.findUniqueOrThrow({ where: { code: "ZLTO-TAL" } });
    expect(t).toMatchObject({ city: "Talisay", distanceKm: 18, travelHours: 0.5, suggestedTransportCents: 35000 });
    await setRowActive(admin, "ltoOffice", t.id, false);
    const csv = await currentDataCsv("lto");
    expect(csv.split("\n")[0]).toContain("distance_km,travel_hours,suggested_transport");
    expect(csv).toContain("ZLTO-TAL,Z LTO Talisay,Talisay,18,0.5,350.00,Inactive");
    const file = toCsv(["code", "name", "city", "distance_km", "travel_hours", "suggested_transport", "status"], [{ code: "ZLTO-TAL", name: "Z LTO Talisay", city: "Talisay", distance_km: "20", travel_hours: "", suggested_transport: "400", status: "Active" }]);
    const plan = await checkImport(admin, "lto", "l.csv", file);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.counts).toMatchObject({ changed: 1, problem: 0 });
    await runImport(admin, "lto", "l.csv", file);
    expect(await prisma.ltoOffice.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ distanceKm: 20, travelHours: null, suggestedTransportCents: 40000, active: true });
    const branch = await prisma.branch.findUniqueOrThrow({ where: { code: "CEB" } });
    try {
      await saveSettingsRow(admin, "branch", branch.id, { code: "CEB", name: branch.name, usualLtoOfficeId: t.id });
      expect((await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } })).usualLtoOfficeId).toBe(t.id);
    } finally {
      await prisma.branch.update({ where: { id: branch.id }, data: { usualLtoOfficeId: null } });
    }
  });
});
