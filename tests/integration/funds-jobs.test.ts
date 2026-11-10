/**
 * DP jobs, funds (cash advances) and problems, through the same functions the screens use.
 * LOCAL database only; removes all loan files first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, laSetFundsFlag, saveChecklist } from "@/lib/services/workflow";
import {
  acceptJob, completeJob, logAttempt, LTO_BLOCK_MESSAGE, markOutsideControl, raiseProblem, receivePackage, resolveProblem, returnJob,
} from "@/lib/services/jobs";
import { addReceipt, closeAdvance, decideAdvance, grantException, releaseAdvance, requestAdvance, requestTopUp, decideTopUp } from "@/lib/services/funds";
import { txnFunds } from "@/lib/jobs/view";
import { businessDate } from "@/lib/time";
import { setSetting } from "@/lib/settings";
import { asUser, cleanLoans, workStages, forwardToLoanBranch } from "./helpers";

let la: CurrentUser, dp: CurrentUser, fin: CurrentUser, admin: CurrentUser;
const today = () => businessDate(new Date());

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
  await setSetting("funds.carryOverLimitDays", 3);
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Opens GD1652026901003 (Undertaking, OR/CR transferred) and sends one transaction to the test DP. */
async function send(code: string, funds: { needed: "YES" | "NO"; kinds?: string[] }) {
  await openLoanFile(la, { pn: "GD1652026901003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  // Every type that needs LTO processing (Notary, Entry of PPSR, Mortgage) is sent with an office.
  const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, {
    transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: funds.needed, fundsKinds: funds.kinds ?? [],
    beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
  return { loan, txn, job };
}
const funds = async (transactionId: string) =>
  txnFunds(await prisma.loanTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { advanceLines: { include: { advance: true } } } }));

/** Request → approve → release for one job line. Returns the advance and its line. */
async function fund(transactionId: string, kind: string, cents: number) {
  const r = await requestAdvance(dp, { lines: [{ transactionId, kind, cents, overMaxReason: "Integration test above max" }] });
  await decideAdvance(fin, r.id, { approve: true });
  await releaseAdvance(fin, r.id, { ref: "VOUCHER-1" });
  const line = await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } });
  return { advanceId: r.id, lineId: line.id };
}

describe("Funds flag (LA)", () => {
  it("is required on Send, needs kinds when Yes, and can change only until the DP accepts", async () => {
    const { txn, job } = await send("MORTGAGE", { needed: "YES", kinds: ["LTO_FEE"] });
    let t = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(t.fundsNeeded).toBe("YES");
    expect(t.fundsKinds).toEqual(["LTO_FEE"]);
    await expect(laSetFundsFlag(la, { transactionId: txn.id, needed: true, kinds: [] })).rejects.toThrow("Tick what the funds are for.");
    await laSetFundsFlag(la, { transactionId: txn.id, needed: true, kinds: ["LTO_FEE", "TRANSPORT"] });
    t = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(t.fundsKinds).toEqual(["LTO_FEE", "TRANSPORT"]);
    expect(await prisma.auditLog.count({ where: { action: "funds_flag_changed", entityId: txn.id } })).toBe(1);

    await expect(acceptJob(dp, job.id, false)).rejects.toThrow(/Labels are on all papers/);
    await acceptJob(dp, job.id, true);
    await expect(laSetFundsFlag(la, { transactionId: txn.id, needed: false, kinds: [] })).rejects.toThrow(/already accepted/);
  });
});

describe("At the LTO, attempts and problems", () => {
  it("blocks attempts until Funded; then Not processed opens a problem, Done resolves it; attempts are append-only", async () => {
    const { txn, job } = await send("MORTGAGE", { needed: "YES", kinds: ["LTO_FEE"] });
    await acceptJob(dp, job.id, true);
    expect(await funds(txn.id)).toBe("NEEDED");
    await expect(logAttempt(dp, job.id, { date: today(), result: "DONE" })).rejects.toThrow(LTO_BLOCK_MESSAGE);

    const { lineId } = await fund(txn.id, "LTO_FEE", 150000);
    expect(await funds(txn.id)).toBe("FUNDED");

    const reason = await prisma.problemReason.findUniqueOrThrow({ where: { code: "LTO_DOWN" } });
    await expect(logAttempt(dp, job.id, { date: today(), result: "NOT_PROCESSED", spends: [{ lineId, cents: 200000 }], reasonId: reason.id })).rejects.toThrow(/more than is left/);
    await logAttempt(dp, job.id, { date: today(), result: "NOT_PROCESSED", reasonId: reason.id, spends: [{ lineId, cents: 50000 }], rest: "CARRY_OVER" });
    const open = await prisma.problem.findFirstOrThrow({ where: { transactionId: txn.id, resolvedAt: null } });
    expect(open.reasonId).toBe(reason.id);
    expect(await prisma.carryOver.findFirstOrThrow({ where: { lineId } })).toMatchObject({ status: "AUTO", cents: 100000 });

    const first = await prisma.transactionAttempt.findFirstOrThrow({ where: { transactionId: txn.id } });
    await logAttempt(dp, job.id, { date: today(), result: "DONE", spends: [{ lineId, cents: 100000 }] });
    expect(await prisma.transactionAttempt.count({ where: { transactionId: txn.id } })).toBe(2);
    expect(await prisma.transactionAttempt.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first); // unchanged
    expect((await prisma.problem.findUniqueOrThrow({ where: { id: open.id } })).resolvedAt).not.toBeNull();
    // Return to the LA is only possible before the first attempt.
    await expect(returnJob(dp, job.id, { reasons: ["Other"], remarks: "Too late" })).rejects.toThrow(/already logged an attempt/);
  });

  it("the LA raises and resolves problems only on transactions it owns; only Admin marks outside our control", async () => {
    const { txn, job } = await send("NOTARY", { needed: "NO" });
    const reason = await prisma.problemReason.findUniqueOrThrow({ where: { code: "WAITING" } });
    // Sent to the DP and not yet back: not the LA's to raise.
    await expect(raiseProblem(la, { transactionId: txn.id, reasonId: reason.id, note: "" })).rejects.toThrow(/only on transactions you work on/);
    const pid = await raiseProblem(dp, { transactionId: txn.id, reasonId: reason.id, note: "Notary out" });
    await expect(markOutsideControl(dp, pid, true)).rejects.toThrow(/Only an Admin/);
    await markOutsideControl(admin, pid, true);
    expect((await prisma.problem.findUniqueOrThrow({ where: { id: pid } })).outsideControl).toBe(true);
    await expect(resolveProblem(dp, pid, "")).rejects.toThrow(/how it was resolved/);
    await resolveProblem(dp, pid, "Notary back");
    expect(await prisma.auditLog.count({ where: { entityId: pid } })).toBe(3); // raised, outside, resolved
    expect(job.id).toBeTruthy();
  });

  it("Complete, forward to a named LA, and the real Phase 5 receive", async () => {
    const { txn, job } = await send("NOTARY", { needed: "NO" });
    await acceptJob(dp, job.id, true);
    await logAttempt(dp, job.id, { date: today(), result: "DONE" });
    await expect(completeJob(dp, job.id, {})).rejects.toThrow(/Finish every stage first\. Next: Notarization/);
    await workStages(dp, job.id, { name: "Atty. Uy", docNo: "12", pageNo: "3", bookNo: "IV", series: "2026" });
    await completeJob(dp, job.id, {});
    await forwardToLoanBranch(dp, job.id, la.id);
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("FORWARDED");
    await expect(receivePackage(dp, job.id, true, "")).rejects.toThrow(/does not allow accepting returned papers/);
    await receivePackage(la, job.id, true, "");
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("COMPLETED");
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("CLOSED");
  });
});

describe("Cash advances", () => {
  it("above the maximum needs a typed reason; approving less needs a note; Admin and the DP cannot approve or release", async () => {
    const { txn, job } = await send("MORTGAGE", { needed: "YES", kinds: ["LTO_FEE"] });
    await acceptJob(dp, job.id, true);
    const rule = await prisma.cashAdvanceRule.findFirst({ where: { transactionType: { code: "MORTGAGE" }, kind: "LTO_FEE", active: true } });
    if (rule) {
      const max = Math.round(Number(rule.maxAmount) * 100);
      await expect(requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: max + 100 }] })).rejects.toThrow(/Type a reason/);
    }
    await expect(requestAdvance(admin, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 1000 }] })).rejects.toThrow(/does not allow requesting/);
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 200000 }] });
    expect(r.number).toMatch(/^CA-\d{4}-\d{4}$/);
    expect(await funds(txn.id)).toBe("REQUESTED");
    await expect(decideAdvance(dp, r.id, { approve: true })).rejects.toThrow("Request not found."); // the DP cannot see the Funds list: the normal refusal
    await expect(decideAdvance(admin, r.id, { approve: true })).rejects.toThrow(/does not allow approving/);
    const line = await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } });
    await expect(decideAdvance(fin, r.id, { approve: true, lines: [{ lineId: line.id, cents: 150000 }] })).rejects.toThrow(/needs a short note/);
    await decideAdvance(fin, r.id, { approve: true, lines: [{ lineId: line.id, cents: 150000 }], note: "Typical LTO fee" });
    await expect(releaseAdvance(admin, r.id, { ref: "X1" })).rejects.toThrow(/does not allow releasing/);
    await releaseAdvance(fin, r.id, { ref: "VOUCHER-9" });
    const adv = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } });
    expect(adv).toMatchObject({ status: "RELEASED", releasedCents: 150000, releaseRef: "VOUCHER-9" });
    expect(adv.liquidationDueAt).not.toBeNull();
    expect(await funds(txn.id)).toBe("FUNDED");
  });

  it("a denied advance makes the job Denied (No funds) with an exception", async () => {
    const { txn, job } = await send("MORTGAGE", { needed: "YES", kinds: ["LTO_FEE"] });
    await acceptJob(dp, job.id, true);
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 100000 }] });
    await expect(decideAdvance(fin, r.id, { approve: false })).rejects.toThrow(/why it is denied/);
    await decideAdvance(fin, r.id, { approve: false, note: "No budget" });
    expect(await funds(txn.id)).toBe("DENIED");
    expect(await prisma.loanException.count({ where: { transactionId: txn.id, type: "NO_FUNDS", status: "OPEN" } })).toBe(1);
  });

  it("an overdue advance blocks new requests until Finance grants a one-time exception", async () => {
    const a = await send("MORTGAGE", { needed: "YES", kinds: ["LTO_FEE"] });
    await acceptJob(dp, a.job.id, true);
    const { advanceId } = await fund(a.txn.id, "LTO_FEE", 100000);
    await prisma.cashAdvance.update({ where: { id: advanceId }, data: { liquidationDueAt: new Date(Date.now() - 86_400_000) } });
    const b = await send("PPSR", { needed: "YES", kinds: ["PPSR_FEE"] });
    await acceptJob(dp, b.job.id, true);
    await expect(requestAdvance(dp, { lines: [{ transactionId: b.txn.id, kind: "PPSR_FEE", cents: 50000 }] })).rejects.toThrow(/overdue/);
    await expect(grantException(dp, dp.id, "")).rejects.toThrow(/does not allow granting/);
    await grantException(fin, dp.id, "Weekend LTO trip");
    const r = await requestAdvance(dp, { lines: [{ transactionId: b.txn.id, kind: "PPSR_FEE", cents: 50000 }] });
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).exceptionId).not.toBeNull();
  });

  it("top-up approves only the extra; receipts liquidate; the stage gate opens when settled", async () => {
    const { txn, job } = await send("MORTGAGE", { needed: "YES", kinds: ["LTO_FEE"] });
    await acceptJob(dp, job.id, true);
    const { advanceId, lineId } = await fund(txn.id, "LTO_FEE", 100000);
    const topId = await requestTopUp(dp, lineId, 20000, "Extra annotation fee");
    await decideTopUp(fin, topId, true, null, "");
    expect((await prisma.cashAdvanceTopUp.findUniqueOrThrow({ where: { id: topId } })).approvedCents).toBe(20000);
    await addReceipt(dp, { lineId, date: today(), cents: 60000, number: "OR-1" }, null);
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: advanceId } })).status).toBe("PARTIALLY_LIQUIDATED");
    await addReceipt(dp, { lineId, date: today(), cents: 40000, number: "OR-2" }, null);
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: advanceId } })).status).toBe("LIQUIDATED");
    expect(await funds(txn.id)).toBe("SETTLED");
    await closeAdvance(fin, advanceId);
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: advanceId } })).status).toBe("CLOSED");
    // Every money action wrote an audit row.
    for (const action of ["advance_requested", "advance_approved", "advance_released", "topup_requested", "topup_approved", "receipt_added", "advance_closed"]) {
      expect(await prisma.auditLog.count({ where: { action, entityId: advanceId } })).toBeGreaterThan(0);
    }
  });
});
