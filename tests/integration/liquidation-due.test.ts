// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { recordLiquidated, refreshLiquidationDue, refreshLiquidationForTransaction, restartLiquidationWait } from "@/lib/services/liquidation";
import { raiseHold, resumeHold } from "@/lib/services/holds";
import { businessDate } from "@/lib/time";
import { asUser } from "./helpers";

/**
 * Piece 5 (D-017, D-044) through the service: due N working days after the last LTO pickup (per type), waiting
 * until then, cancellations, carry-over, note-only lines, the fallback (alert once; it follows the TAT due date;
 * it stays after a late LTO), the saved date kept after a redo, and the late record. Fake PNs; Nov 2026.
 */
const P = "GD9992099979";
let admin: CurrentUser, dp: CurrentUser, angono: string;
const at = (d: string, hh = "10:00") => new Date(`${d}T${hh}:00+08:00`);
let seq = 0;

async function loanWith(n: number, jobDue: string | null = null) {
  // Different types: a loan file has at most one active transaction of each type (D-050).
  const types = await prisma.transactionType.findMany({ where: { requiresDp: true }, orderBy: { code: "asc" }, take: n });
  const pn = `${P}${String(++seq).padStart(2, "0")}`;
  const loan = await prisma.loan.create({
    data: {
      pn, borrowerName: `Zz Liq ${pn.slice(-2)}`, branchId: angono, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id,
      classification: "REFINANCING", mortgageResult: "MORTGAGE", ruleFired: "test", stage: "In process",
      transactions: { create: types.map((t) => ({ typeId: t.id, status: "IN_PROCESS" as const })) },
    },
    include: { transactions: true },
  });
  const jobs = [];
  for (const t of loan.transactions) {
    jobs.push(await prisma.dpAssignment.create({ data: { loanId: loan.id, transactionId: t.id, dpBranchId: angono, dueBranchId: angono, dpUserId: dp.id, assignedById: admin.id, status: "ACCEPTED", decidedAt: at("2026-11-23"), dueDate: jobDue, targetDays: jobDue ? 3 : null } }));
  }
  return { loan, txns: loan.transactions, jobs };
}
async function advance(txnIds: (string | null)[], type = "fundstype_ca", released = "2026-11-23") {
  return prisma.cashAdvance.create({
    data: {
      number: `CA-2099-79${String(++seq).padStart(2, "0")}`, requestedById: dp.id, branchId: angono, requestedCents: 100_000, status: "RELEASED", approvedCents: 100_000, approvedAt: at(released), releasedCents: 100_000, releasedAt: at(released), fundsTypeId: type,
      lines: { create: txnIds.map((t) => ({ transactionId: t, kind: "TRANSPORT", requestedCents: 100_000 / txnIds.length, approvedCents: 100_000 / txnIds.length, releasedCents: 100_000 / txnIds.length, note: t ? "" : "Courier" })) },
    },
  });
}
/** The job's LTO pickup finished on a day (a redo finishes the same stage again, later). */
const pickup = (jobId: string, day: string) => prisma.jobStage.upsert({
  where: { assignmentId_code: { assignmentId: jobId, code: "LTO_PICKUP" } },
  create: { assignmentId: jobId, code: "LTO_PICKUP", name: "LTO pickup", kind: "LTO_PICKUP", sortOrder: 9, status: "DONE", finishedAt: at(day, "15:00") },
  update: { finishedAt: at(day, "15:00") },
});
const refresh = (id: string, day: string) => prisma.$transaction((tx) => refreshLiquidationDue(tx, id, at(day, "12:00")));
const state = async (id: string) => {
  const a = await prisma.cashAdvance.findUniqueOrThrow({ where: { id } });
  return { due: a.liquidationDueAt ? businessDate(a.liquidationDueAt) : null, basis: a.liquidationBasis, note: a.liquidationNote };
};

async function clean() {
  await prisma.cashAdvance.deleteMany({ where: { number: { startsWith: "CA-2099-79" } } });
  await prisma.loan.deleteMany({ where: { pn: { startsWith: P } } });
}
beforeAll(async () => {
  admin = await asUser("test.admin@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  angono = (await prisma.branch.findUniqueOrThrow({ where: { code: "165" } })).id;
  await clean();
});
afterAll(async () => {
  await prisma.fundsType.update({ where: { id: "fundstype_ft" }, data: { liquidationDueDays: 2 } });
  await clean();
});

describe("due N working days after the last LTO pickup (D-044)", () => {
  it("1. one transaction: waiting with no date; pickup Wed 25 -> due Fri 27, logged", async () => {
    const { txns, jobs } = await loanWith(1);
    const a = await advance([txns[0].id]);
    await refresh(a.id, "2026-11-23");
    expect(await state(a.id)).toEqual({ due: null, basis: null, note: "" });
    await pickup(jobs[0].id, "2026-11-25");
    await prisma.$transaction((tx) => refreshLiquidationForTransaction(tx, txns[0].id, at("2026-11-25", "16:00")));
    expect(await state(a.id)).toMatchObject({ due: "2026-11-27", basis: "LTO" });
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: "liquidation_due_set" } })).toBe(1);
  });

  it("2. three transactions: '1 of 3 left' until the last pickup Mon 30 -> due Wed 2 Dec", async () => {
    const { txns, jobs } = await loanWith(3);
    const a = await advance(txns.map((t) => t.id));
    await pickup(jobs[0].id, "2026-11-24");
    await pickup(jobs[1].id, "2026-11-26");
    await refresh(a.id, "2026-11-26");
    expect(await state(a.id)).toEqual({ due: null, basis: null, note: "1 of 3 left" });
    await pickup(jobs[2].id, "2026-11-30");
    await refresh(a.id, "2026-11-30");
    expect(await state(a.id)).toMatchObject({ due: "2026-12-02", basis: "LTO" });
  });

  it("3. an LTO redone after the date was saved: the saved date stays", async () => {
    const { txns, jobs } = await loanWith(1);
    const a = await advance([txns[0].id]);
    await pickup(jobs[0].id, "2026-11-25");
    await refresh(a.id, "2026-11-25");
    await pickup(jobs[0].id, "2026-12-01"); // redone
    await refresh(a.id, "2026-12-01");
    expect(await state(a.id)).toMatchObject({ due: "2026-11-27", basis: "LTO" });
  });

  it("4. cancelled before its LTO: N after the later of the last pickup and the cancellation (Sat 28)", async () => {
    const { txns, jobs } = await loanWith(2);
    const a = await advance(txns.map((t) => t.id));
    await pickup(jobs[0].id, "2026-11-24");
    await prisma.loanTransaction.update({ where: { id: txns[1].id }, data: { status: "CANCELLED", cancelledAt: at("2026-11-26") } });
    await prisma.$transaction((tx) => refreshLiquidationForTransaction(tx, txns[1].id, at("2026-11-26", "11:00")));
    expect(await state(a.id)).toMatchObject({ due: "2026-11-28", basis: "CANCELLED" });
  });

  it("6. CA vs FT: the same pickup Wed 25; FT set to 3 -> Sat 28 (CA stays 2 -> Fri 27)", async () => {
    await prisma.fundsType.update({ where: { id: "fundstype_ft" }, data: { liquidationDueDays: 3 } });
    const { txns, jobs } = await loanWith(1);
    const ft = await advance([txns[0].id], "fundstype_ft");
    await pickup(jobs[0].id, "2026-11-25");
    await refresh(ft.id, "2026-11-25");
    expect(await state(ft.id)).toMatchObject({ due: "2026-11-28" });
  });

  it("a note-only line: N after the release (Mon 23 -> Wed 25)", async () => {
    const a = await advance([null]);
    await refresh(a.id, "2026-11-23");
    expect(await state(a.id)).toMatchObject({ due: "2026-11-25", basis: "RELEASE" });
  });

  it("carry-over: the wait restarts; due N after that attempt's pickup (Fri 27 -> Mon 30)", async () => {
    const { txns, jobs } = await loanWith(1);
    const a = await advance([txns[0].id]);
    await pickup(jobs[0].id, "2026-11-24");
    await refresh(a.id, "2026-11-24");
    expect(await state(a.id)).toMatchObject({ due: "2026-11-26" });
    await prisma.$transaction((tx) => restartLiquidationWait(tx, a.id, at("2026-11-25")));
    expect(await state(a.id)).toMatchObject({ due: null }); // the old pickup no longer counts
    await pickup(jobs[0].id, "2026-11-27");
    await refresh(a.id, "2026-11-27");
    expect(await state(a.id)).toMatchObject({ due: "2026-11-30", basis: "LTO" });
  });
});

describe("the fallback when the LTO is not done (D-044 item 5)", () => {
  it("a stuck job: TAT due Thu 26, Fri 27 -> due Sat 28 by fallback; Finance and the supervisors told once", async () => {
    const { txns } = await loanWith(1, "2026-11-26");
    const a = await advance([txns[0].id]);
    await refresh(a.id, "2026-11-26");
    expect(await state(a.id)).toMatchObject({ due: null });
    await refresh(a.id, "2026-11-27");
    expect(await state(a.id)).toMatchObject({ due: "2026-11-28", basis: "FALLBACK" });
    const number = (await prisma.cashAdvance.findUniqueOrThrow({ where: { id: a.id } })).number;
    const told = () => prisma.notification.count({ where: { title: `${number}: LTO not done. Liquidation due by fallback` } });
    const n = await told();
    expect(n).toBeGreaterThan(0); // the CA handlers of Angono (or Admin) and its supervisors
    await refresh(a.id, "2026-11-28");
    expect(await told()).toBe(n); // once
  });

  it("an LTO done after the fallback date: the fallback date stays", async () => {
    const { txns, jobs } = await loanWith(1, "2026-11-26");
    const a = await advance([txns[0].id]);
    await refresh(a.id, "2026-11-27");
    await pickup(jobs[0].id, "2026-11-30");
    await refresh(a.id, "2026-11-30");
    expect(await state(a.id)).toMatchObject({ due: "2026-11-28", basis: "FALLBACK" });
  });

  it("a job on a pausing hold: the TAT due date moves and the fallback follows it", async () => {
    const { txns } = await loanWith(1, "2026-11-26");
    const a = await advance([txns[0].id]);
    await refresh(a.id, "2026-11-27");
    expect(await state(a.id)).toMatchObject({ due: "2026-11-28", basis: "FALLBACK" });
    const reason = await prisma.holdReason.findUniqueOrThrow({ where: { code: "CLIENT-PAPERS" } });
    const h = await raiseHold(dp, { transactionId: txns[0].id, reasonId: reason.id, note: "Waiting for the borrower's papers" }, at("2026-11-27"));
    // Sat 28, Mon 30 and Tue 1 paused (3 working days): the TAT due date Thu 26 moves to Mon 30.
    await resumeHold(dp, h, "Papers arrived", at("2026-12-01", "15:00"));
    expect((await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txns[0].id } })).dueDate).toBe("2026-11-30");
    // The fallback follows: Mon 30 + 2 = Wed 2 Dec (it was Sat 28).
    expect(await state(a.id)).toMatchObject({ due: "2026-12-02", basis: "FALLBACK" });
  });
});

describe("the late record (D-044 item 6)", () => {
  it("due Fri 27, liquidated Mon 30: 2 working days late; on time is 0", async () => {
    const late = await advance([null]);
    await prisma.cashAdvance.update({ where: { id: late.id }, data: { liquidationDueAt: at("2026-11-27", "23:59") } });
    await prisma.$transaction((tx) => recordLiquidated(tx, late.id, at("2026-11-30")));
    expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({ daysLate: 2 });
    const ok = await advance([null]);
    await prisma.cashAdvance.update({ where: { id: ok.id }, data: { liquidationDueAt: at("2026-11-27", "23:59") } });
    await prisma.$transaction((tx) => recordLiquidated(tx, ok.id, at("2026-11-27", "16:00")));
    expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: ok.id } })).toMatchObject({ daysLate: 0 });
  });
});
