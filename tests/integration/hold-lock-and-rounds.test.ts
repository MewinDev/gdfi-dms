/**
 * The hold lock and owner, the hold reasons list, the remark limits, and decline / return going back
 * to the specific Loan Associate who sent it (rounds). Through the same functions the screens use.
 * LOCAL database only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { ADMIN_PERMISSIONS, PERMISSIONS, ROLE_DEFAULTS } from "@/lib/auth/permissions";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, confirmPapersBack, laSetFundsFlag, recordEdst, saveChecklist } from "@/lib/services/workflow";
import { markPaperMissing } from "@/lib/services/papers";
import { acceptJob, declineJob } from "@/lib/services/jobs";
import { addProcessorNote, changeProcessor, pullBack } from "@/lib/services/sent-changes";
import { laChangeLtoOffice } from "@/lib/services/lto";
import { returnToLa } from "@/lib/services/return-to-la";
import { addHoldDetails, raiseHold, resumeHold } from "@/lib/services/holds";
import { jobCounts, myJobs } from "@/lib/services/job-queries";
import { getLoanForUser, listLoans } from "@/lib/services/queries";
import { saveSettingsRow } from "@/lib/services/admin";
import { sentBackFor } from "@/components/loan/sent-back-to-you";
import { holdReasonName } from "@/lib/ui/holds";
import { roundChip, roundEntries, sentBack } from "@/lib/ui/rounds";
import { fmtDateTime } from "@/lib/time";
import { setSetting } from "@/lib/settings";
import { allPapers, asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser, admin: CurrentUser, la2: CurrentUser;
const PN = "GD1652026901003";
const REMARKS = "Waiting for the client to sign page 2";

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  // A second Loan Associate of the same branches: a returned job must NOT land on them.
  await prisma.userBranch.deleteMany({ where: { user: { email: { startsWith: "zz." } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
  const branches = await prisma.userBranch.findMany({ where: { userId: la.id } });
  await prisma.user.create({ data: { email: "zz.la2@gdfi.ph", name: "Second Loan Associate", roleId: role.id, isTestUser: true, branches: { create: branches.map((b) => ({ branchId: b.branchId })) } } });
  la2 = await asUser("zz.la2@gdfi.ph");
  // Same state as the migration: the testing reasons are switched off (other test files may have switched them on).
  await prisma.holdReason.updateMany({ where: { code: { in: ["BORROWER", "OTHER-TEAM", "LTO-SCHEDULE"] } }, data: { active: false } });
  await prisma.holdReason.deleteMany({ where: { code: { startsWith: "Z" } } });
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
});
afterAll(async () => {
  await cleanLoans();
  await prisma.userBranch.deleteMany({ where: { user: { email: { startsWith: "zz." } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  await prisma.holdReason.deleteMany({ where: { code: { startsWith: "Z" } } });
  await prisma.$disconnect();
});

async function open() {
  await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  return prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
}
const txnOf = async (code: string) => prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn: PN }, type: { code } }, include: { checks: true } });
async function ready(code: string) {
  await open();
  const t = await txnOf(code);
  await saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
  return txnOf(code);
}
async function send(code = "NOTARY", by: CurrentUser = la) {
  const loan = await open();
  const t = await txnOf(code);
  if (t.status === "FOR_CHECKLIST") await saveChecklist(by, { transactionId: t.id, checkedIds: t.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
  const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(by, {
    transactionId: t.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: "NO", fundsKinds: [],
    beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: t.id }, orderBy: { createdAt: "desc" } });
  return { loan, txn: t, job };
}
const reasonOf = async (code: string) => prisma.holdReason.findUniqueOrThrow({ where: { code } });
const lockOf = async (holdId: string, who: string) => `Locked: on hold by ${who} since ${fmtDateTime((await prisma.hold.findUniqueOrThrow({ where: { id: holdId } })).raisedAt)}. Only ${who} can resume.`;

describe("Part 1. Hold owner and full lock (per transaction)", () => {
  it("the LA's held transaction: papers, missing paper, funds, send are refused; the other transactions keep working; only the holder resumes", async () => {
    const notary = await ready("NOTARY");
    const id = await raiseHold(la, { transactionId: notary.id, reasonId: (await reasonOf("CLIENT-PAPERS")).id, note: REMARKS });
    const locked = await lockOf(id, "Test Loan Associate");
    const loan = await open();
    await expect(saveChecklist(la, { transactionId: notary.id, checkedIds: [], newOthers: [] })).rejects.toThrow(locked); // untick
    await expect(saveChecklist(la, { transactionId: notary.id, checkedIds: notary.checks.filter((c) => c.checked).map((c) => c.id), newOthers: ["Barangay clearance"] })).rejects.toThrow(locked); // add a paper
    await expect(markPaperMissing(la, { checkId: notary.checks[0].id })).rejects.toThrow(locked);
    await expect(laSetFundsFlag(la, { transactionId: notary.id, needed: true, kinds: ["NOTARY_FEE"] })).rejects.toThrow(locked);
    await expect(assignToDp(la, {
      transactionId: notary.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true } })).id,
      fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
    })).rejects.toThrow(locked);
    // Nothing changed on it.
    expect((await txnOf("NOTARY")).checks.filter((c) => c.checked).length).toBe(notary.checks.filter((c) => c.checked).length);
    // Another transaction of the same loan keeps working (the lock is per transaction).
    const edst = await txnOf("EDST");
    await saveChecklist(la, { transactionId: edst.id, checkedIds: edst.checks.map((c) => c.id), newOthers: [] });
    await recordEdst(la, { transactionId: edst.id, reference: "E-777" });
    expect((await txnOf("EDST")).status).toBe("COMPLETED");
    // Only the holder resumes (Admin and another LA are refused with the same words).
    await expect(resumeHold(admin, id, "Client signed today")).rejects.toThrow("Only Test Loan Associate can resume this.");
    await expect(resumeHold(la2, id, "Client signed today")).rejects.toThrow("Only Test Loan Associate can resume this.");
    await resumeHold(la, id, "Client signed today");
    await saveChecklist(la, { transactionId: notary.id, checkedIds: [], newOthers: [] });
    expect((await txnOf("NOTARY")).checks.every((c) => !c.checked)).toBe(true);
  });

  it("a sent job on hold (by the DP, before accepting): the LA's update, change processor, notes, LTO, pull back and the DP's accept and decline are refused", async () => {
    const { txn, job } = await send();
    const id = await raiseHold(dp, { transactionId: txn.id, reasonId: (await reasonOf("NO-DP")).id, note: "No processor free until Monday" });
    const locked = await lockOf(id, "Test Document Processor");
    const office = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "desc" } });
    for (const step of [
      () => pullBack(la, txn.id, { reason: "Wrong processor" }),
      () => changeProcessor(la, txn.id, { dpUserId: dp.id, reason: "Change it" }),
      () => addProcessorNote(la, txn.id, { note: "Please call me first" }),
      () => laChangeLtoOffice(la, txn.id, { ltoOfficeId: office.id, note: "Closer office" }),
      () => acceptJob(dp, job.id),
      () => declineJob(dp, job.id, { reasons: ["No capacity"], remarks: "Full this week" }),
    ]) await expect(step()).rejects.toThrow(locked);
    // "Add details" and Resume stay for the holder only.
    await expect(addHoldDetails(la, id, "Adding something")).rejects.toThrow();
    await resumeHold(dp, id, "A processor is free now");
    await acceptJob(dp, job.id);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ACCEPTED");
  });
});

describe("Part 3. Hold reasons: a managed list", () => {
  it("seeds the proposed list; a hold keeps the id and a copy of the name; a rename does not change old holds; holds:manage is Admin only", async () => {
    const active = await prisma.holdReason.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    expect(active.map((r) => r.name)).toEqual([
      "No available DP", "Waiting for the client's papers", "Waiting for the client's decision", "Waiting for the branch head's approval",
      "Waiting for funds or payment", "Waiting for corrections from the client", "Waiting for a MyLoans update", "Other",
    ]);
    // Testing reasons are switched off but stay on old holds.
    expect((await reasonOf("BORROWER")).active).toBe(false);
    expect(ADMIN_PERMISSIONS).toContain(PERMISSIONS.HOLDS_MANAGE);
    expect(PERMISSIONS.HOLDS_MANAGE).toBe("holds:manage");
    expect(ROLE_DEFAULTS.LA.permissions).not.toContain(PERMISSIONS.HOLDS_MANAGE);
    await expect(saveSettingsRow(la, "holdReason", null, { code: "ZNOPE", name: "Nope", sortOrder: "9" })).rejects.toThrow(/does not allow/);

    await saveSettingsRow(admin, "holdReason", null, { code: "ZBANK", name: "Waiting on the bank", sortOrder: "9" });
    const r = await reasonOf("ZBANK");
    expect(r.proposed).toBe(false);
    const notary = await ready("NOTARY");
    const id = await raiseHold(la, { transactionId: notary.id, reasonId: r.id, note: "Bank to confirm the payoff" });
    expect(await prisma.hold.findUniqueOrThrow({ where: { id } })).toMatchObject({ reasonId: r.id, reasonName: "Waiting on the bank" });
    await saveSettingsRow(admin, "holdReason", r.id, { code: "ZBANK", name: "Waiting for the bank (renamed)", sortOrder: "3" });
    const h = await prisma.hold.findUniqueOrThrow({ where: { id }, include: { reason: true } });
    expect(holdReasonName(h)).toBe("Waiting on the bank"); // the old hold keeps its text
    // Saving a proposed reason confirms it.
    const other = await reasonOf("OTHER");
    expect(other.proposed).toBe(true);
    await saveSettingsRow(admin, "holdReason", other.id, { code: "OTHER", name: "Other", sortOrder: String(other.sortOrder) });
    expect((await reasonOf("OTHER")).proposed).toBe(false);
    await prisma.holdReason.update({ where: { id: other.id }, data: { proposed: true } });
    // Remarks stay required for every reason, Other included.
    await expect(raiseHold(la, { transactionId: (await ready("PPSR")).id, reasonId: other.id, note: "abc" })).rejects.toThrow("Write 5 to 500 characters.");
    // The loans list filters by the reason.
    expect((await listLoans(admin, { tab: "all", holdReason: r.id })).map((l) => l.pn)).toEqual([PN]);
    expect(await listLoans(admin, { tab: "all", holdReason: other.id })).toEqual([]);
    expect((await listLoans(admin, { tab: "all", holdReason: "ANY" })).map((l) => l.pn)).toEqual([PN]);
  });
});

describe("Part 4. Decline and Return to LA go back to the specific Loan Associate who sent it", () => {
  it("decline: findings required; back to the sender only; the DP no longer sees it; send again is round 2 with the TAT start kept", async () => {
    const { txn, job } = await send();
    const before = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    // Findings are required: one reason from the list and remarks of 5 to 500 characters.
    await expect(declineJob(dp, job.id, { reasons: [], remarks: "Full this week" })).rejects.toThrow("Pick a reason.");
    await expect(declineJob(dp, job.id, { reasons: ["Unsigned pages"], remarks: "Full this week" })).rejects.toThrow("Pick a reason.");
    await expect(declineJob(dp, job.id, { reasons: ["No capacity"], remarks: "Full" })).rejects.toThrow("Write 5 to 500 characters.");
    await expect(declineJob(dp, job.id, { reasons: ["No capacity"], remarks: "x".repeat(501) })).rejects.toThrow("Write 5 to 500 characters.");
    expect((await myJobs(dp)).map((r) => r.id)).toContain(job.id);
    expect(await prisma.notification.count({ where: { userId: dp.id, link: { startsWith: `/jobs/${job.id}` } } })).toBeGreaterThan(0);
    const notesBefore = await prisma.notification.count({ where: { userId: { in: [la2.id, admin.id] } } });

    await declineJob(dp, job.id, { reasons: ["No capacity"], remarks: "Full this week, try Grace" });
    const t = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(t.status).toBe("RETURNED");
    expect(t.statusSince).toEqual(before.statusSince); // the clock is not reset
    expect(await prisma.loanException.count({ where: { transactionId: txn.id, type: "DP_DECLINED" } })).toBe(0); // not a Problem
    // The DP: gone from every list and count, and their notifications about it are removed; nothing new for them.
    expect((await myJobs(dp)).map((r) => r.id)).not.toContain(job.id);
    expect(jobCounts(await myJobs(dp))).toMatchObject({ review: 0, process: 0 });
    expect(await prisma.notification.count({ where: { userId: dp.id, link: { startsWith: `/jobs/${job.id}` } } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: dp.id, loanId: txn.loanId, title: { contains: "declined" } } })).toBe(0);
    // The sender: told (in-app), and it is on their Home; not on the other LA's, and nobody else is told.
    expect(await prisma.notification.count({ where: { userId: la.id, title: { endsWith: "Notary declined" } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: { in: [la2.id, admin.id] } } })).toBe(notesBefore);
    expect((await sentBackFor(la)).map((x) => x.t.id)).toEqual([txn.id]);
    expect(await sentBackFor(la2)).toEqual([]);
    const loan1 = (await getLoanForUser(la, PN))!;
    const sb = sentBack("RETURNED", loan1.transactions.find((x) => x.id === txn.id)!.dpAssignments)!;
    expect(sb).toMatchObject({ kind: "declined", label: "Declined by the DP", dpName: "Test Document Processor", findings: "No capacity: Full this week, try Grace", senderId: la.id, round: 1 });

    // Send again: a new round (round 2), a new assignment; the earlier round stays.
    const { job: job2 } = await send();
    expect(job2.id).not.toBe(job.id);
    const loan2 = (await getLoanForUser(la, PN))!;
    const assignments = loan2.transactions.find((x) => x.id === txn.id)!.dpAssignments;
    expect(roundChip(assignments)).toBe("Round 2");
    expect(roundEntries(assignments).map((r) => [r.round, r.sentText, r.outcome])).toEqual([[1, "Sent", "Declined by DP"], [2, "Sent again", "Waiting to accept"]]);
    // The loan's deadline (TAT from release) is unchanged.
    expect(loan2.releasedAt).toEqual(loan1.releasedAt);
  });

  it("return to LA: findings required (5 to 500); back to the sender only; send again; the Journey has both rounds", async () => {
    const { txn, job } = await send("NOTARY");
    await acceptJob(dp, job.id);
    const reason = (await prisma.returnReason.findUniqueOrThrow({ where: { code: "MISSING" } })).id;
    const check = (await txnOf("NOTARY")).checks.find((c) => c.required)!;
    await expect(returnToLa(dp, job.id, { reasonId: reason, checkIds: [check.id], note: "abcd" })).rejects.toThrow("Write 5 to 500 characters.");
    await expect(returnToLa(dp, job.id, { reasonId: reason, checkIds: [], note: "The ID is not in the folder" })).rejects.toThrow("Pick the papers that are missing or wrong.");
    await returnToLa(dp, job.id, { reasonId: reason, checkIds: [check.id], note: "The ID is not in the folder", handedOver: await allPapers(txn.id) });
    await confirmPapersBack(la, { transactionId: txn.id, notReceived: [] });
    expect((await myJobs(dp)).map((r) => r.id)).not.toContain(job.id);
    expect(await prisma.notification.count({ where: { userId: dp.id, link: { startsWith: `/jobs/${job.id}` } } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: la.id, title: { contains: "returned by the processor" } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: la2.id, title: { contains: "returned by the processor" } } })).toBe(0);
    expect((await sentBackFor(la)).map((x) => x.sb.label)).toEqual(["Returned by the DP: fix and send again"]);
    expect(await sentBackFor(la2)).toEqual([]);
    // Fix (tick the paper) and send again: round 2.
    const t = await txnOf("NOTARY");
    await saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
    await send("NOTARY");
    const loan = (await getLoanForUser(la, PN))!;
    const rows = roundEntries(loan.transactions.find((x) => x.id === txn.id)!.dpAssignments);
    expect(rows.map((r) => [r.round, r.outcome, r.dpName])).toEqual([[1, "Returned by DP", "Test Document Processor"], [2, "Waiting to accept", "Test Document Processor"]]);
    expect(rows[0].findings).toMatch(/^Missing paper \(.+\): The ID is not in the folder$/);
    // The Journey events keep both rounds.
    const audit = await prisma.auditLog.findMany({ where: { loanId: txn.loanId, action: { in: ["assigned_to_dp", "job_returned_to_la"] } }, orderBy: { at: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["assigned_to_dp", "job_returned_to_la", "assigned_to_dp"]);
  });

  it("a held transaction cannot be declined or returned: the lock comes first", async () => {
    const { txn, job } = await send("NOTARY");
    await acceptJob(dp, job.id);
    const id = await raiseHold(dp, { transactionId: txn.id, reasonId: (await reasonOf("FUNDS")).id, note: "Waiting for the LTO fee" });
    const reason = (await prisma.returnReason.findUniqueOrThrow({ where: { code: "OTHER" } })).id;
    await expect(returnToLa(dp, job.id, { reasonId: reason, note: "Needs the PPSR first" })).rejects.toThrow(await lockOf(id, "Test Document Processor"));
  });
});
