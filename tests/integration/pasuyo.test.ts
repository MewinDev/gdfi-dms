/**
 * Second processor (Pasuyo): at Send (LA) and passing a job on (DP), with held cash returned or handed over.
 * LOCAL database only; removes all loan files first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, canSeeJob, declineJob, logAttempt } from "@/lib/services/jobs";
import { decideAdvance, releaseAdvance, requestAdvance } from "@/lib/services/funds";
import { passJob } from "@/lib/services/pasuyo";
import { myJobs } from "@/lib/services/job-queries";
import { businessDate } from "@/lib/time";
import { setSetting } from "@/lib/settings";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser, dp2: CurrentUser, dp3: CurrentUser, fin: CurrentUser, admin: CurrentUser;
const today = () => businessDate(new Date());

let ltoId: string;
beforeAll(async () => {
  ltoId = (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } })).id;
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  dp2 = await asUser("dp.paolo@gdfi.ph");
  dp3 = await asUser("dp.grace@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function ready(code: string) {
  await openLoanFile(la, { pn: "PN-0001003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  return { loan, txn };
}
const input = (loan: { branchId: string }, transactionId: string, extra: Partial<Parameters<typeof assignToDp>[1]> = {}) => ({
  transactionId, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: ltoId as string | null, fundsNeeded: "NO" as "YES" | "NO" | null, fundsKinds: [] as string[],
  beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null as string | null, pasuyoReason: null as string | null, ...extra,
});
const jobOf = (transactionId: string) => prisma.dpAssignment.findFirstOrThrow({ where: { transactionId }, orderBy: { createdAt: "desc" }, include: { loan: true } });

describe("LA: a second processor (Pasuyo) at Send", () => {
  it("needs a different processor and a reason; both see the job; works again after a decline", async () => {
    const { loan, txn } = await ready("NOTARY");
    await expect(assignToDp(la, input(loan, txn.id, { pasuyo: true, secondaryDpUserId: dp.id, pasuyoReason: "Busy" }))).rejects.toThrow(/different person/);
    await expect(assignToDp(la, input(loan, txn.id, { pasuyo: true, secondaryDpUserId: dp2.id, pasuyoReason: "" }))).rejects.toThrow(/enter the reason/);
    await assignToDp(la, input(loan, txn.id, { pasuyo: true, secondaryDpUserId: dp2.id, pasuyoReason: "Cebu notary is closer" }));
    const job = await jobOf(txn.id);
    expect(job.secondaryDpUserId).toBe(dp2.id);
    expect(await prisma.pasuyoEvent.count({ where: { assignmentId: job.id, fromUserId: null, toUserId: dp2.id } })).toBe(1);
    expect(canSeeJob(dp2, job)).toBe(true);
    expect((await myJobs(dp2)).map((r) => r.id)).toContain(job.id);
    expect((await myJobs(dp2)).find((r) => r.id === job.id)?.pasuyo).toBe(`to ${dp2.name}`);

    // Declined, then sent again with a second processor.
    await declineJob(dp, job.id, { reasons: ["Papers not complete"], remarks: "Page 2 unsigned" });
    await assignToDp(la, input(loan, txn.id, { pasuyo: true, secondaryDpUserId: dp3.id, pasuyoReason: "Paolo on leave" }));
    expect((await jobOf(txn.id)).secondaryDpUserId).toBe(dp3.id);
  });
});

describe("DP: Pasuyo, pass a job to a second processor", () => {
  it("is refused for the LA and Admin (jobs:pasuyo) and before the job is accepted", async () => {
    const { loan, txn } = await ready("NOTARY");
    await assignToDp(la, input(loan, txn.id));
    const job = await jobOf(txn.id);
    const body = { toUserId: dp2.id, reason: "Out of town" };
    await expect(passJob(la, job.id, body)).rejects.toThrow(/does not allow passing/);
    await expect(passJob(admin, job.id, body)).rejects.toThrow(/does not allow passing/);
    await expect(passJob(dp, job.id, body)).rejects.toThrow(/only while it is accepted/);
  });

  it("with no funds: passes on, keeps the TAT clock, records history, audit and notices; the second processor works it", async () => {
    const { loan, txn } = await ready("NOTARY");
    await assignToDp(la, input(loan, txn.id));
    const job = await jobOf(txn.id);
    await acceptJob(dp, job.id, true);
    const before = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    await expect(passJob(dp, job.id, { toUserId: dp.id, reason: "x x x" })).rejects.toThrow(/other than the current one/);
    await expect(passJob(dp, job.id, { toUserId: dp2.id, reason: "" })).rejects.toThrow(/why a second processor/);
    await passJob(dp, job.id, { toUserId: dp2.id, reason: "I am out of town", note: "Papers at the Cebu office" });

    const after = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(after.statusSince).toEqual(before.statusSince); // the clock does not reset
    expect(await prisma.problem.count({ where: { transactionId: txn.id } })).toBe(0); // not a problem
    const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } });
    expect(a).toMatchObject({ dpUserId: dp.id, secondaryDpUserId: dp2.id, pasuyoReason: "I am out of town" });
    expect(await prisma.pasuyoEvent.findFirstOrThrow({ where: { assignmentId: job.id } })).toMatchObject({ fromUserId: dp.id, toUserId: dp2.id, funds: "NONE" });
    expect(await prisma.auditLog.count({ where: { action: "job_passed_pasuyo", entityId: job.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: dp2.id, title: { contains: "passed to" } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: la.id, title: { contains: "passed to" } } })).toBe(1);
    expect((await myJobs(dp2)).find((r) => r.id === job.id)?.pasuyo).toBe(`from ${dp.name} to ${dp2.name}`);
    expect((await myJobs(dp)).map((r) => r.id)).toContain(job.id); // both see it
    await logAttempt(dp2, job.id, { date: today(), result: "DONE" }); // the second processor works it
    expect(await prisma.transactionAttempt.count({ where: { transactionId: txn.id, dpUserId: dp2.id } })).toBe(1); // recorded under who did it
  });

  async function fundedMortgage() {
    const { loan, txn } = await ready("MORTGAGE");
    const lto = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true } });
    await assignToDp(la, input(loan, txn.id, { fundsNeeded: "YES", fundsKinds: ["LTO_FEE"], ltoOfficeId: lto.id }));
    const job = await jobOf(txn.id);
    await acceptJob(dp, job.id, true);
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 200000 }] });
    await decideAdvance(fin, r.id, { approve: true });
    await releaseAdvance(fin, r.id, { ref: "V-1" });
    const line = await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } });
    await logAttempt(dp, job.id, { date: today(), result: "DONE", spends: [{ lineId: line.id, cents: 50000 }] });
    return { txn, job, advanceId: r.id, lineId: line.id };
  }

  it("with held cash: blocks until a choice; Return the cash records a cash return for Finance to confirm", async () => {
    const { job, advanceId } = await fundedMortgage();
    await expect(passJob(dp, job.id, { toUserId: dp2.id, reason: "Out sick" })).rejects.toThrow(/You hold ₱1,500\.00 for this job/);
    await passJob(dp, job.id, { toUserId: dp2.id, reason: "Out sick", funds: "RETURN" });
    const ret = await prisma.cashReturn.findFirstOrThrow({ where: { advanceId } });
    expect(ret).toMatchObject({ kind: "CASH", cents: 150000, confirmedAt: null });
    expect((await prisma.pasuyoEvent.findFirstOrThrow({ where: { assignmentId: job.id } })).funds).toBe("RETURNED");
  });

  it("with held cash: Hand the balance moves it to the second processor on a new released advance (Outstanding), Finance told", async () => {
    const { txn, job, advanceId } = await fundedMortgage();
    await passJob(dp, job.id, { toUserId: dp2.id, reason: "Out sick", funds: "HAND" });
    const handed = await prisma.cashReturn.findFirstOrThrow({ where: { advanceId } });
    expect(handed).toMatchObject({ kind: "HANDOVER", cents: 150000 });
    expect(handed.confirmedAt).not.toBeNull();
    const old = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: advanceId } });
    expect(old.note).toMatch(/₱1,500\.00 handed to Paolo Lim/);
    const fresh = await prisma.cashAdvance.findFirstOrThrow({ where: { requestedById: dp2.id }, include: { lines: true } });
    expect(fresh).toMatchObject({ status: "RELEASED", releasedCents: 150000, liquidationDueAt: old.liquidationDueAt });
    expect(fresh.note).toMatch(/Handed over from/);
    expect(fresh.lines[0]).toMatchObject({ transactionId: txn.id, kind: "LTO_FEE", releasedCents: 150000 });
    expect(await prisma.auditLog.count({ where: { action: "advance_handed_over", entityId: advanceId } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: fin.id, title: { contains: "handed over" } } })).toBe(1);
    // The second processor can spend it on the job.
    await logAttempt(dp2, job.id, { date: today(), result: "DONE", spends: [{ lineId: fresh.lines[0].id, cents: 100000 }] });
  });
});
