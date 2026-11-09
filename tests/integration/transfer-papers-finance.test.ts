/**
 * Transfer hold, the inactive sending LA, papers handed over on a Return to LA, Finance actions on a
 * held transaction, and the simulator guard. Through the same functions the screens use. LOCAL only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, confirmPapersBack, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, declineJob } from "@/lib/services/jobs";
import { returnToLa } from "@/lib/services/return-to-la";
import { mayTransferHold, raiseHold, resumeHold, transferCandidates, transferHold } from "@/lib/services/holds";
import {
  addReceipt, cashToSettleIds, closeAdvance, confirmReturn, decideAdvance, decideCarryOver, decideTopUp, grantException, recordReturn, releaseAdvance, releaseTopUp, requestAdvance, requestTopUp,
} from "@/lib/services/funds";
import { getLoanForUser } from "@/lib/services/queries";
import { loadJourney } from "@/lib/services/journey";
import { assertSimulatorAllowed } from "@/lib/services/simulator";
import { sentBackFor } from "@/components/loan/sent-back-to-you";
import { roundEntries } from "@/lib/ui/rounds";
import { businessDate, fmtDateTime } from "@/lib/time";
import { setSetting } from "@/lib/settings";
import { allPapers, asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser, admin: CurrentUser, fin: CurrentUser, la2: CurrentUser, sup: CurrentUser, laGone: CurrentUser;
const PN = "GD1652026901003";
const today = () => businessDate(new Date());
const REMARKS = "Waiting for the client to sign page 2";

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  await prisma.userBranch.deleteMany({ where: { user: { email: { startsWith: "zz." } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  await prisma.role.deleteMany({ where: { key: "ZSUP" } });
  const laRole = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
  const loanBranch = (await prisma.branch.findFirstOrThrow({ where: { name: "Angono" } })).id;
  const otherBranch = (await prisma.branch.findFirstOrThrow({ where: { name: "Antipolo" } })).id;
  // A second LA of the loan's branch, an LA who will be inactive, and a supervisor of another branch.
  await prisma.user.create({ data: { email: "zz.la2@gdfi.ph", name: "Second Loan Associate", roleId: laRole.id, isTestUser: true, branches: { create: [{ branchId: loanBranch }] } } });
  await prisma.user.create({ data: { email: "zz.lagone@gdfi.ph", name: "Leaving Loan Associate", roleId: laRole.id, isTestUser: true, branches: { create: [{ branchId: loanBranch }] } } });
  const supRole = await prisma.role.create({ data: { key: "ZSUP", name: "Z Branch supervisor", builtIn: false, branchAccess: "ASSIGNED", permissions: [PERMISSIONS.LOANS_VIEW, PERMISSIONS.HOLDS_TRANSFER] } });
  await prisma.user.create({ data: { email: "zz.sup@gdfi.ph", name: "Z Supervisor", roleId: supRole.id, isTestUser: true, branches: { create: [{ branchId: otherBranch }] } } });
  la2 = await asUser("zz.la2@gdfi.ph");
  laGone = await asUser("zz.lagone@gdfi.ph");
  sup = await asUser("zz.sup@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", false);
  await prisma.user.updateMany({ where: { email: { startsWith: "zz." } }, data: { active: true } });
});
afterAll(async () => {
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
  await prisma.userBranch.deleteMany({ where: { user: { email: { startsWith: "zz." } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  await prisma.role.deleteMany({ where: { key: "ZSUP" } });
  await prisma.$disconnect();
});

async function open() {
  await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  return prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
}
const txnOf = (code: string) => prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } }, include: { checks: true } });
async function ready(code: string, by: CurrentUser = la) {
  await open();
  const t = await txnOf(code);
  await saveChecklist(by, { transactionId: t.id, checkedIds: t.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
  return txnOf(code);
}
async function send(code = "NOTARY", by: CurrentUser = la, funds: "YES" | "NO" = "NO", kinds: string[] = []) {
  const loan = await open();
  const t = await txnOf(code);
  if (t.status === "FOR_CHECKLIST") await saveChecklist(by, { transactionId: t.id, checkedIds: t.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
  const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(by, {
    transactionId: t.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: funds, fundsKinds: kinds,
    beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: t.id }, orderBy: { createdAt: "desc" } });
  return { loan, txn: t, job };
}
const reasonId = async (code = "CLIENT-PAPERS") => (await prisma.holdReason.findUniqueOrThrow({ where: { code } })).id;

describe("1. Transfer hold: Admin anywhere, a supervisor in their branch; never resume", () => {
  it("rules for who may transfer, who may receive, remarks; the new owner alone resumes; Journey and notices", async () => {
    const notary = await ready("NOTARY");
    const id = await raiseHold(la, { transactionId: notary.id, reasonId: await reasonId(), note: REMARKS });
    const loan = await open();
    // Who may transfer: Admin anywhere; Finance (all branches); a supervisor only in their own branch.
    expect(mayTransferHold(admin, loan.branchId)).toBe(true);
    expect(mayTransferHold(fin, loan.branchId)).toBe(true);
    expect(mayTransferHold(sup, loan.branchId)).toBe(false);
    expect(mayTransferHold(la, loan.branchId)).toBe(false);
    await expect(transferHold(sup, id, la2.id, "Ana is on leave")).rejects.toThrow();
    await expect(transferHold(la, id, la2.id, "Ana is on leave")).rejects.toThrow("Your role does not allow transferring holds.");
    // Who may receive: an active LA of the loan's branch; not the holder, not the transferer, not a DP.
    const names = (await transferCandidates(admin, id)).map((c) => c.name);
    expect(names).toContain("Second Loan Associate");
    expect(names).not.toContain("Test Loan Associate");
    expect(names).not.toContain("Test Document Processor");
    await expect(transferHold(admin, id, la.id, "Ana is on leave")).rejects.toThrow("That person already owns this hold.");
    await expect(transferHold(admin, id, admin.id, "Ana is on leave")).rejects.toThrow("You cannot transfer a hold to yourself.");
    await expect(transferHold(admin, id, dp.id, "Ana is on leave")).rejects.toThrow(/same work role/);
    await prisma.user.update({ where: { id: laGone.id }, data: { active: false } });
    await expect(transferHold(admin, id, laGone.id, "Ana is on leave")).rejects.toThrow(/same work role/);
    await expect(transferHold(admin, id, la2.id, "")).rejects.toThrow("Write 5 to 500 characters.");
    await expect(transferHold(admin, id, la2.id, "x".repeat(501))).rejects.toThrow("Write 5 to 500 characters.");

    await transferHold(admin, id, la2.id, "Ana is on leave this week");
    const h = await prisma.hold.findUniqueOrThrow({ where: { id } });
    // The hold itself is unchanged except the owner; still locked.
    expect(h).toMatchObject({ ownerId: la2.id, ownerLabel: "Second Loan Associate", raisedById: la.id, raisedByLabel: "Test Loan Associate", note: REMARKS, resumedAt: null });
    await expect(saveChecklist(la2, { transactionId: notary.id, checkedIds: [], newOthers: [] })).rejects.toThrow(`Locked: on hold by Test Loan Associate since ${fmtDateTime(h.raisedAt)}. Only Second Loan Associate can resume.`);
    // The old holder cannot resume; neither Admin nor the supervisor ever can.
    await expect(resumeHold(la, id, "Client signed today")).rejects.toThrow("Only Second Loan Associate can resume this.");
    await expect(resumeHold(admin, id, "Client signed today")).rejects.toThrow("Only Second Loan Associate can resume this.");
    await expect(resumeHold(fin, id, "Client signed today")).rejects.toThrow("Only Second Loan Associate can resume this.");
    // Notices: the new owner, and the old holder (still active).
    expect(await prisma.notification.count({ where: { userId: la2.id, title: { contains: "hold transferred to Second Loan Associate" } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: la.id, title: { contains: "hold transferred to Second Loan Associate" } } })).toBe(1);
    // Journey and audit.
    const j = (await loadJourney(admin, (await getLoanForUser(admin, PN))!)).journey;
    const holdRec = j.phases.flatMap((p) => p.steps).flatMap((s) => s.holds).find((x) => x.id === id);
    expect(holdRec?.transfers?.[0]).toMatchObject({ fromLabel: "Test Loan Associate", toLabel: "Second Loan Associate", byLabel: "Test Admin", note: "Ana is on leave this week" });
    expect(await prisma.auditLog.count({ where: { entityId: id, action: "hold_transferred" } })).toBe(1);
    await resumeHold(la2, id, "Client signed today");
    expect((await prisma.hold.findUniqueOrThrow({ where: { id } })).resumedByLabel).toBe("Second Loan Associate");
  });

  it("a hold without an owner (older data) can be transferred, then resumed by the new owner", async () => {
    const notary = await ready("NOTARY");
    const h = await prisma.hold.create({ data: { loanId: notary.loanId, transactionId: notary.id, reasonId: await reasonId(), reasonName: "Waiting for the client's papers", note: "Old hold", raisedByLabel: "Someone" } });
    await expect(resumeHold(la, h.id, "Signed")).rejects.toThrow("Nobody can resume it until a supervisor or Admin transfers the hold.");
    await transferHold(fin, h.id, la.id, "No owner was recorded");
    await resumeHold(la, h.id, "Signed now");
  });
});

describe("2. Inactive sending LA: every active LA of the branch sees it (in-app, no email)", () => {
  it("decline after the sender left: Home and Open items for the branch LAs, with the note; anyone re-sends it", async () => {
    await setSetting("email.active", true);
    try {
      const { txn, job } = await send("NOTARY", laGone);
      await prisma.user.update({ where: { id: laGone.id }, data: { active: false } });
      const emailsBefore = await prisma.emailOutbox.count({ where: { event: "job_declined" } });
      await declineJob(dp, job.id, { reasons: ["No capacity"], remarks: "Full this week" });
      expect(await prisma.emailOutbox.count({ where: { event: "job_declined" } })).toBe(emailsBefore); // no email
      for (const u of [la, la2]) {
        expect(await prisma.notification.count({ where: { userId: u.id, title: { endsWith: "Notary declined" }, body: { contains: "Sender Leaving Loan Associate is inactive." } } })).toBe(1);
        const rows = await sentBackFor(u);
        expect(rows.map((r) => r.t.id)).toEqual([txn.id]);
        expect(rows[0].sb).toMatchObject({ senderActive: false, senderName: "Leaving Loan Associate" });
      }
      // Re-sent by another LA: the Journey records who actually sent it again.
      await send("NOTARY", la2);
      const loan = (await getLoanForUser(la, PN))!;
      const rows = roundEntries(loan.transactions.find((x) => x.id === txn.id)!.dpAssignments);
      expect(rows.map((r) => [r.round, r.sentText, r.sentBy])).toEqual([[1, "Sent", "Leaving Loan Associate"], [2, "Sent again", "Second Loan Associate"]]);
    } finally {
      await setSetting("email.active", false);
    }
  });
});

describe("3. Return to LA: papers handed over and confirmed back", () => {
  it("send again waits for the LA to confirm; Not received raises a Problem naming the paper", async () => {
    const { txn, job } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    const withDp = await prisma.documentItem.findMany({ where: { transactionId: txn.id, stage: "WITH_DP" } });
    expect(withDp.length).toBeGreaterThan(1);
    const reason = (await prisma.returnReason.findUniqueOrThrow({ where: { code: "OTHER" } })).id;
    await expect(returnToLa(dp, job.id, { reasonId: reason, note: "Needs the PPSR first", handedOver: withDp.slice(1).map((d) => d.id) })).rejects.toThrow("Tick every paper you hand over to the Loan Associate.");
    await returnToLa(dp, job.id, { reasonId: reason, note: "Needs the PPSR first", handedOver: await allPapers(txn.id) });
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).papersHandedAt).not.toBeNull();
    const loan = await open();
    const input = { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } })).id, fundsNeeded: "NO" as const, fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null };
    await expect(assignToDp(la, input)).rejects.toThrow("Confirm you received the papers the processor handed over first.");
    await confirmPapersBack(la, { transactionId: txn.id, notReceived: [withDp[0].id] });
    const p = await prisma.problem.findFirstOrThrow({ where: { transactionId: txn.id, resolvedAt: null } });
    expect(p.note).toBe(`Not received from Test Document Processor: ${withDp[0].label}`);
    expect((await prisma.documentItem.findUniqueOrThrow({ where: { id: withDp[0].id } })).stage).toBe("WITH_DP");
    expect((await prisma.documentItem.findUniqueOrThrow({ where: { id: withDp[1].id } })).stage).toBe("AT_BRANCH");
    const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } });
    expect(a.papersReceivedBy).toBe("Test Loan Associate");
    const rows = roundEntries([{ ...a, dpUser: { name: "Test Document Processor" }, assignedBy: { name: "Test Loan Associate" } }]);
    expect(rows[0].papers[0]).toMatch(/^Papers handed over by Test Document Processor · .+ PHT$/);
    expect(rows[0].papers[1]).toMatch(/^Papers received by Test Loan Associate · .+ PHT$/);
    // Confirmed: sending again is no longer blocked by the papers.
    await assignToDp(la, input);
  });
});

describe("4. Finance actions on a held transaction", () => {
  it("blocks request, approve, release, top-up and carry-over; allows receipts, returns, confirm, close and exceptions", async () => {
    const { txn, job } = await send("MORTGAGE", la, "YES", ["LTO_FEE"]);
    await acceptJob(dp, job.id, true);
    const hold = async () => raiseHold(dp, { transactionId: txn.id, reasonId: await reasonId("FUNDS"), note: "Waiting for the LTO fee schedule" });
    const locked = async (holdId: string) => `Locked: on hold by Test Document Processor since ${fmtDateTime((await prisma.hold.findUniqueOrThrow({ where: { id: holdId } })).raisedAt)}.`;
    const line = [{ transactionId: txn.id, kind: "LTO_FEE", cents: 150000, overMaxReason: "Integration test" }];

    let h = await hold();
    await expect(requestAdvance(dp, { lines: line })).rejects.toThrow(await locked(h));
    await resumeHold(dp, h, "The fee schedule is out");
    const adv = await requestAdvance(dp, { lines: line });
    h = await hold();
    await expect(decideAdvance(fin, adv.id, { approve: true })).rejects.toThrow(await locked(h));
    await resumeHold(dp, h, "Approve it now");
    await decideAdvance(fin, adv.id, { approve: true });
    h = await hold();
    await expect(releaseAdvance(fin, adv.id, { ref: "V-9" })).rejects.toThrow(await locked(h));
    await resumeHold(dp, h, "Release it now");
    await releaseAdvance(fin, adv.id, { ref: "V-9" });
    const lineId = (await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: adv.id } })).id;
    // A top-up approved before the hold, and a pending carry-over, to try while held.
    const topUp = await requestTopUp(dp, lineId, 20000, "Extra copies");
    await decideTopUp(fin, topUp, true, 20000, "");
    const carry = await prisma.carryOver.create({ data: { lineId, cents: 10000, status: "PENDING" } });
    h = await hold();
    const msg = await locked(h);
    await expect(requestTopUp(dp, lineId, 5000, "More copies")).rejects.toThrow(msg);
    await expect(releaseTopUp(fin, topUp)).rejects.toThrow(msg);
    await expect(decideCarryOver(fin, carry.id, true)).rejects.toThrow(msg);
    // Allowed while held: settle the money already out.
    await addReceipt(dp, { lineId, date: today(), cents: 100000, number: "OR-77" }, null);
    await recordReturn(dp, adv.id, 50000, today());
    const ret = await prisma.cashReturn.findFirstOrThrow({ where: { advanceId: adv.id } });
    await confirmReturn(fin, ret.id);
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: adv.id } })).status).toBe("LIQUIDATED");
    await closeAdvance(fin, adv.id);
    await grantException(fin, dp.id, "One more request this week");
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: adv.id } })).status).toBe("CLOSED");
    expect(await cashToSettleIds([{ ...(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: adv.id }, include: { lines: true } })) }])).toEqual(new Set());
  });
});

describe("5. The simulator bypasses the hold lock, so it runs only in test mode, never on staging or production", () => {
  it("is refused without TEST_MODE and on staging and production", () => {
    const env = { mode: process.env.TEST_MODE, app: process.env.APP_ENV };
    try {
      process.env.APP_ENV = "local";
      process.env.TEST_MODE = "true";
      expect(() => assertSimulatorAllowed()).not.toThrow();
      process.env.TEST_MODE = "false";
      expect(() => assertSimulatorAllowed()).toThrow("The test simulator runs only in test mode (TEST_MODE=true).");
      process.env.TEST_MODE = "true";
      process.env.APP_ENV = "staging";
      expect(() => assertSimulatorAllowed()).toThrow("The test simulator is not available on staging.");
      process.env.APP_ENV = "production";
      expect(() => assertSimulatorAllowed()).toThrow("The test simulator is not available on production.");
    } finally {
      process.env.TEST_MODE = env.mode;
      process.env.APP_ENV = env.app;
    }
  });
});
