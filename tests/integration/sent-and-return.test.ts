/**
 * Sent, not accepted yet: the LA changes it or pulls it back. After accepting: the processor returns it
 * to the LA for papers. Through the same functions the screens use. LOCAL database only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, confirmPapersBack, laSetFundsFlag, saveChecklist } from "@/lib/services/workflow";
import { acceptJob } from "@/lib/services/jobs";
import { addProcessorNote, changeProcessor, pullBack, updatesBeforeAccept } from "@/lib/services/sent-changes";
import { returnToLa } from "@/lib/services/return-to-la";
import { addReceipt, cashToSettleIds, decideAdvance, recordReturn, releaseAdvance, requestAdvance } from "@/lib/services/funds";
import { myJobs } from "@/lib/services/job-queries";
import { reasonReport } from "@/lib/services/tat-report";
import { getLoanForUser } from "@/lib/services/queries";
import { loadJourney } from "@/lib/services/journey";
import { saveSettingsRow } from "@/lib/services/admin";
import { setRowActive } from "@/lib/services/settings-status";
import { checkImport, currentDataCsv, runImport } from "@/lib/import/importer";
import { toCsv } from "@/lib/import/csv";
import { setSetting } from "@/lib/settings";
import { allPapers, asUser, cleanLoans } from "./helpers";
import { businessDate } from "@/lib/time";
const today = () => businessDate(new Date());

let la: CurrentUser, dp: CurrentUser, fin: CurrentUser, admin: CurrentUser;
const ACCEPTED = "Test Document Processor already accepted this. Ask them to return it if something is missing.";

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
  await prisma.userBranch.deleteMany({ where: { user: { email: { startsWith: "zz." } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  await prisma.returnReason.deleteMany({ where: { code: { startsWith: "Z" } } });
  await prisma.returnReason.updateMany({ data: { active: true, deactivatedAt: null, deactivatedById: null } });
});
afterAll(async () => {
  await prisma.userBranch.deleteMany({ where: { user: { email: { startsWith: "zz." } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  await prisma.returnReason.deleteMany({ where: { code: { startsWith: "Z" } } });
  await prisma.$disconnect();
});

/** Opens PN-0001003, ticks the required papers (optional ones left unticked) and sends to the test DP. */
async function send(code = "NOTARY", needed: "YES" | "NO" = "NO", kinds: string[] = []) {
  await openLoanFile(la, { pn: "PN-0001003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.filter((c) => c.required).map((c) => c.id), newOthers: [] });
  // Every type that needs LTO processing (Notary, Entry of PPSR, Mortgage) is sent with an office.
  const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, {
    transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: needed, fundsKinds: kinds,
    beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
  return { loan, txn, job };
}
const checksOf = (transactionId: string) => prisma.checklistCheck.findMany({ where: { transactionId }, include: { rule: true }, orderBy: { createdAt: "asc" } });
const reasonId = async (code: string) => (await prisma.returnReason.findUniqueOrThrow({ where: { code } })).id;

describe("A. Sent, not accepted yet: the LA can still change it", () => {
  it("papers, funds, processor, note: each with who and when, the DP sees the list, the clock is not reset", async () => {
    const { txn, job } = await send();
    const since = (await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).statusSince;
    const checks = await checksOf(txn.id);
    const optional = checks.find((c) => !c.required)!;
    const required = checks.find((c) => c.required)!;
    // Update papers: add one (it goes to the processor too); a required one cannot be unticked while sent.
    await saveChecklist(la, { transactionId: txn.id, checkedIds: checks.filter((c) => c.required).map((c) => c.id).concat(optional.id), newOthers: [] });
    const doc = await prisma.documentItem.findFirstOrThrow({ where: { checkId: optional.id } });
    expect(doc.stage).toBe("IN_TRANSIT");
    await expect(saveChecklist(la, { transactionId: txn.id, checkedIds: checks.filter((c) => c.id !== required.id).map((c) => c.id), newOthers: [] })).rejects.toThrow(/Pull it back instead/);
    // Funds and kinds.
    await laSetFundsFlag(la, { transactionId: txn.id, needed: true, kinds: ["NOTARY_FEE", "TRANSPORT"] });
    // Note; change processor (reason required; the first processor is told).
    await expect(addProcessorNote(la, txn.id, { note: "" })).rejects.toThrow(/Write the note/);
    await addProcessorNote(la, txn.id, { note: "The ID copy is in the brown envelope" });
    const joy = await prisma.user.findUniqueOrThrow({ where: { email: "dp.joy@gdfi.ph" } });
    await expect(changeProcessor(la, txn.id, { dpUserId: joy.id, reason: "" })).rejects.toThrow(/Say why you change the processor/);
    await changeProcessor(la, txn.id, { dpUserId: joy.id, reason: "Joy is at the LTO today" });
    const moved = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } });
    expect(moved).toMatchObject({ dpUserId: joy.id, endorsedAt: job.endorsedAt, status: "PENDING_ACCEPTANCE" });
    expect(await prisma.notification.count({ where: { userId: dp.id, title: { contains: "given to another processor" } } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: joy.id, title: { startsWith: "New assignment" } } })).toBe(1);
    // The clock is not reset by any change.
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).statusSince).toEqual(since);
    // The processor's "Updated by" list.
    const u = await updatesBeforeAccept({ ...moved, dpUserId: joy.id });
    expect(u).toMatchObject({ by: "Test Loan Associate" });
    expect(u!.changes).toEqual(expect.arrayContaining([
      `Added ${optional.rule!.label}`, "Funds: Needs funds (notary fee, transport)", "Note: The ID copy is in the brown envelope", "Processor: Test Document Processor to Joy Navarro",
    ]));
    // One audit row per action, and Journey events in plain words.
    expect(await prisma.auditLog.count({ where: { action: "sent_job_updated", entityId: job.id } })).toBe(3);
    const j = (await loadJourney(la, (await getLoanForUser(la, "PN-0001003"))!)).journey;
    const texts = j.phases.flatMap((p) => p.steps).filter((s) => s.txnCode === "NOTARY").flatMap((s) => s.events.map((e) => e.text));
    expect(texts).toContain(`Test Loan Associate added ${optional.rule!.label} before the processor accepted.`);
  });

  it("Pull back: reason required; back to Ready to send; papers not handed over; gone from the DP's list", async () => {
    const { txn, job } = await send();
    await expect(pullBack(la, txn.id, { reason: "" })).rejects.toThrow(/Say why you pull it back/);
    await pullBack(la, txn.id, { reason: "Wrong borrower name on the deed" });
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PULLED_BACK");
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("READY");
    const docs = await prisma.documentItem.findMany({ where: { transactionId: txn.id, documentId: { not: null } } });
    expect(docs.every((d) => d.stage === "AT_BRANCH")).toBe(true);
    expect(await prisma.documentMovement.count({ where: { documentItemId: docs[0].id, action: "NOT_HANDED_OVER" } })).toBe(1);
    expect((await myJobs(dp)).map((r) => r.id)).not.toContain(job.id);
    expect(await prisma.notification.count({ where: { userId: dp.id, title: { contains: "pulled back" } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "sent_job_pulled_back", entityId: job.id } })).toBe(1);
  });

  it("after the processor accepted every change is refused, including one at the same moment", async () => {
    const { txn, job } = await send();
    await acceptJob(dp, job.id, true);
    const checks = await checksOf(txn.id);
    await expect(saveChecklist(la, { transactionId: txn.id, checkedIds: checks.map((c) => c.id), newOthers: [] })).rejects.toThrow(ACCEPTED);
    await expect(laSetFundsFlag(la, { transactionId: txn.id, needed: false, kinds: [] })).rejects.toThrow(ACCEPTED);
    await expect(addProcessorNote(la, txn.id, { note: "Too late?" })).rejects.toThrow(ACCEPTED);
    await expect(pullBack(la, txn.id, { reason: "Too late?" })).rejects.toThrow(ACCEPTED);
    const joy = await prisma.user.findUniqueOrThrow({ where: { email: "dp.joy@gdfi.ph" } });
    await expect(changeProcessor(la, txn.id, { dpUserId: joy.id, reason: "Too late?" })).rejects.toThrow(ACCEPTED);
  });

  it("accept and pull back at the same moment: exactly one wins, the other is refused", async () => {
    const { txn, job } = await send();
    const results = await Promise.allSettled([acceptJob(dp, job.id, true), pullBack(la, txn.id, { reason: "At the same time" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } });
    expect(["ACCEPTED", "PULLED_BACK"]).toContain(a.status);
    const t = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(t.status).toBe(a.status === "ACCEPTED" ? "IN_PROCESS" : "READY");
  });

  it("only the LA of the branch who may send: Admin and another branch's LA are refused", async () => {
    const { txn } = await send();
    await expect(pullBack(admin, txn.id, { reason: "Admin tries" })).rejects.toThrow("Only the Loan Associate who sends work can change it.");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
    const dvo = await prisma.branch.findUniqueOrThrow({ where: { code: "DVO" } });
    await prisma.user.create({ data: { email: "zz.la.dvo@gdfi.ph", name: "Zz Davao LA", roleId: role.id, isTestUser: true, branches: { create: { branchId: dvo.id } } } });
    const other = await asUser("zz.la.dvo@gdfi.ph");
    await expect(pullBack(other, txn.id, { reason: "Not my branch" })).rejects.toThrow();
    await expect(addProcessorNote(other, txn.id, { note: "Not my branch" })).rejects.toThrow();
  });
});

describe("B. Return to LA: papers needed", () => {
  it("rules: permission, reason, note, papers for Missing or Wrong; keeping papers; a status change, not a Problem", async () => {
    const { txn, job } = await send();
    await expect(returnToLa(la, job.id, { reasonId: await reasonId("MISSING"), note: "x", checkIds: [] })).rejects.toThrow(/does not allow returning/);
    await expect(returnToLa(admin, job.id, { reasonId: await reasonId("MISSING"), note: "x", checkIds: [] })).rejects.toThrow(/does not allow returning/);
    await expect(returnToLa(dp, job.id, { reasonId: await reasonId("OTHER"), note: "Before accepting" })).rejects.toThrow(/Only an accepted job/);
    await acceptJob(dp, job.id, true);
    const since = (await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).statusSince;
    const checks = await checksOf(txn.id);
    const valid = checks.find((c) => c.required)!;
    await expect(returnToLa(dp, job.id, { reasonId: "", note: "x" })).rejects.toThrow("Pick a reason.");
    await expect(returnToLa(dp, job.id, { reasonId: await reasonId("MISSING"), note: "" })).rejects.toThrow("Write 5 to 500 characters.");
    await expect(returnToLa(dp, job.id, { reasonId: await reasonId("MISSING"), note: "Missing ID" })).rejects.toThrow("Pick the papers that are missing or wrong.");
    await expect(returnToLa(dp, job.id, { reasonId: await reasonId("WRONG"), note: "Unclear copy" })).rejects.toThrow("Pick the papers that are missing or wrong.");
    // The removed choices are refused on the server.
    await expect(returnToLa(dp, job.id, { reasonId: await reasonId("MISSING"), checkIds: [valid.id], note: "Bring the original ID", papers: "KEEP" } as never)).rejects.toThrow('The return no longer offers "keep the papers" or "keep the cash".');
    await expect(returnToLa(dp, job.id, { reasonId: await reasonId("MISSING"), checkIds: [valid.id], note: "Bring the original ID", cash: "KEEP" } as never)).rejects.toThrow('The return no longer offers "keep the papers" or "keep the cash".');
    // Every paper with the processor must be handed over.
    await expect(returnToLa(dp, job.id, { reasonId: await reasonId("MISSING"), checkIds: [valid.id], note: "Bring the original ID" })).rejects.toThrow("Tick every paper you hand over to the Loan Associate.");
    await returnToLa(dp, job.id, { reasonId: await reasonId("MISSING"), checkIds: [valid.id], otherPaper: "Barangay clearance", note: "Bring the original ID", handedOver: await allPapers(txn.id) });

    const a = await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } });
    expect(a).toMatchObject({ status: "WITHDRAWN", returnReasonId: await reasonId("MISSING") });
    const t = await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(t.status).toBe("RETURNED");
    expect(t.statusSince).toEqual(since); // the clock is not reset
    expect(await prisma.loanException.count({ where: { transactionId: txn.id, type: "DP_DECLINED" } })).toBe(0); // not a Problem
    expect(await prisma.problem.count({ where: { transactionId: txn.id } })).toBe(0);
    // The papers asked for: unticked, plus the "Other paper" as its own required row; a request asked by DP.
    const after = await checksOf(txn.id);
    expect(after.find((c) => c.id === valid.id)!.checked).toBe(false);
    const extra = after.find((c) => c.otherLabel === "Barangay clearance")!;
    expect(extra).toMatchObject({ required: true, checked: false });
    const ex = await prisma.loanException.findFirstOrThrow({ where: { transactionId: txn.id, type: "LEGAL_DOCS_COMPLETION", status: "OPEN" } });
    expect(ex.details).toMatchObject({ askedBy: "DP", checkIds: [valid.id, extra.id] });
    // Handed over: in transit to the LA until confirmed back; sending again waits for that.
    const doc = await prisma.documentItem.findFirstOrThrow({ where: { transactionId: txn.id, documentId: { not: null }, NOT: { checkId: valid.id } } });
    expect(doc.stage).toBe("IN_TRANSIT");
    expect(await prisma.documentMovement.count({ where: { documentItemId: doc.id, action: "HANDED_TO_LA" } })).toBe(1);
    // The branch LA is told.
    expect(await prisma.notification.count({ where: { userId: la.id, title: { contains: "returned by the processor" } } })).toBe(1);

    // The LA ticks the papers: the request closes; Send again (the processor is told) and they accept as usual.
    await saveChecklist(la, { transactionId: txn.id, checkedIds: after.filter((c) => c.required).map((c) => c.id), newOthers: [] });
    expect((await prisma.loanException.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe("RESOLVED");
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
    const sendInput = { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } })).id, fundsNeeded: "NO" as const, fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null };
    await expect(assignToDp(la, sendInput)).rejects.toThrow("Confirm you received the papers the processor handed over first.");
    await confirmPapersBack(la, { transactionId: txn.id, notReceived: [] });
    expect((await prisma.documentItem.findUniqueOrThrow({ where: { id: doc.id } })).stage).toBe("AT_BRANCH");
    await assignToDp(la, { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } })).id, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
    // Round 2: the first "New assignment" alert was removed with the return (the job left the DP); this is the new one.
    expect(await prisma.notification.count({ where: { userId: dp.id, title: { startsWith: "New assignment" } } })).toBe(1);
    const again = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id, status: "PENDING_ACCEPTANCE" } });
    await acceptJob(dp, again.id, true);

    // Returned twice: the Journey shows both; the report counts Returned separately.
    await returnToLa(dp, again.id, { reasonId: await reasonId("OTHER"), note: "Needs the PPSR first", handedOver: await allPapers(txn.id) });
    expect(await prisma.documentMovement.count({ where: { documentItemId: doc.id, action: "HANDED_TO_LA" } })).toBe(2);
    const report = await reasonReport(admin);
    expect(report.filter((r) => r.type === "Returned").reduce((s, r) => s + r.count, 0)).toBe(2);
    const j = (await loadJourney(la, (await getLoanForUser(la, "PN-0001003"))!)).journey;
    const texts = j.phases.flatMap((p) => p.steps).flatMap((s) => s.events.map((e) => e.text));
    expect(texts.filter((x) => x.startsWith("Test Document Processor returned Notary to Test Loan Associate"))).toHaveLength(2);
    expect(texts).toContain("Test Document Processor returned Notary to Test Loan Associate: Missing paper (Valid IDs of borrower (2), Barangay clearance).".replace("Valid IDs of borrower (2)", valid.rule!.label));
  });

  it("cash released for the job: the return goes ahead; the advance stays the processor's to liquidate (Cash to settle)", async () => {
    const { txn, job } = await send("MORTGAGE", "YES", ["LTO_FEE"]);
    await acceptJob(dp, job.id, true);
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 150000, overMaxReason: "Integration test" }] });
    await decideAdvance(fin, r.id, { approve: true });
    await releaseAdvance(fin, r.id, { ref: "V-1" });
    await returnToLa(dp, job.id, { reasonId: await reasonId("OTHER"), note: "Needs the PPSR first", handedOver: await allPapers(txn.id) });
    // Nothing is returned automatically; the job left the processor but the cash did not.
    expect(await prisma.cashReturn.count({ where: { advanceId: r.id } })).toBe(0);
    expect((await myJobs(dp)).map((x) => x.id)).not.toContain(job.id);
    const adv = await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id }, include: { lines: true } });
    expect([...(await cashToSettleIds([adv]))]).toEqual([r.id]);
    // Liquidation continues beside it: receipts for what was spent, the rest returned, Finance closes.
    await addReceipt(dp, { lineId: adv.lines[0].id, date: today(), cents: 50000, number: "OR-55" }, null);
    await recordReturn(dp, r.id, 100000, today());
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("LIQUIDATED");
  });
});

describe("Return reasons in Settings", () => {
  it("add, rename, inactive, import and export", async () => {
    await saveSettingsRow(admin, "returnReason", null, { code: "ZUNSIGNED", name: "Paper not signed", sortOrder: "9" });
    const r = await prisma.returnReason.findUniqueOrThrow({ where: { code: "ZUNSIGNED" } });
    await saveSettingsRow(admin, "returnReason", r.id, { code: "ZUNSIGNED", name: "Paper not signed yet", sortOrder: "9" });
    await setRowActive(admin, "returnReason", r.id, false);
    expect(await prisma.returnReason.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ name: "Paper not signed yet", active: false });
    expect(await prisma.auditLog.count({ where: { entityType: "returnReason", entityId: r.id } })).toBe(3);
    await expect(saveSettingsRow(la, "returnReason", null, { code: "ZNO", name: "No", sortOrder: "1" })).rejects.toThrow(/does not allow/);
    const file = toCsv(["code", "name", "order", "status"], [{ code: "ZEXPIRED", name: "Expired ID", order: "7", status: "Active" }]);
    const plan = await checkImport(admin, "return-reasons", "r.csv", file);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.counts).toMatchObject({ new: 1, problem: 0 });
    const run = await runImport(admin, "return-reasons", "r.csv", file);
    if (!run.ok) throw new Error(run.error);
    expect(await currentDataCsv("return-reasons")).toContain("MISSING,Missing paper,1,Active");
  });
});
