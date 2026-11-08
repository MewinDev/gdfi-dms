/**
 * Processing stages per transaction type, Check and verify, manual Forward to branch, the receiving
 * LA's outcomes, the vault gate from real DP output, and the DP list filters. Through the same
 * functions the screens use. LOCAL database only; removes all loan files first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import {
  acceptJob, completeJob, finishStage, forwardJob, loadAssignment, logAttempt, raiseProblem, receivePackage, resolveProblem, somethingMissing, startStage, verifyPaper,
} from "@/lib/services/jobs";
import { stageRows, verifiablePapers } from "@/lib/services/job-stages";
import { raiseHold } from "@/lib/services/holds";
import { passJob } from "@/lib/services/pasuyo";
import { returnToLa, acceptWithMissing } from "@/lib/services/return-to-la";
import { addReceipt, closeAdvance, decideAdvance, releaseAdvance, requestAdvance } from "@/lib/services/funds";
import { saveSettingsRow } from "@/lib/services/admin";
import { setRowActive, inactiveEffect } from "@/lib/services/settings-status";
import { jobRows, myJobs } from "@/lib/services/job-queries";
import { packagesFor } from "@/components/jobs/packages-to-receive";
import { checkImport, currentDataRows, runImport } from "@/lib/import/importer";
import { simulate } from "@/lib/services/simulator";
import { loadJourney } from "@/lib/services/journey";
import { getLoanForUser } from "@/lib/services/queries";
import { getHolidaySet, getTatMap, setSetting } from "@/lib/settings";
import { txnTat } from "@/lib/jobs/view";
import { businessDate } from "@/lib/time";
import { asUser, cleanLoans, workStages, allPapers } from "./helpers";

let la: CurrentUser, dp: CurrentUser, dp2: CurrentUser, fin: CurrentUser, admin: CurrentUser, laDvo: CurrentUser;
const PN = "PN-0001003"; // Cebu
const today = () => businessDate(new Date());

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  dp2 = await asUser("dp.paolo@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  // A Loan Associate who works only at Davao (another branch than the loan's).
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
  const dvo = await prisma.branch.findUniqueOrThrow({ where: { code: "DVO" } });
  const u = await prisma.user.upsert({ where: { email: "it.la.davao@gdfi.ph" }, create: { email: "it.la.davao@gdfi.ph", name: "IT Davao LA", roleId: role.id, isTestUser: true }, update: { active: true, roleId: role.id } });
  await prisma.userBranch.deleteMany({ where: { userId: u.id } });
  await prisma.userBranch.create({ data: { userId: u.id, branchId: dvo.id } });
  laDvo = await asUser("it.la.davao@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
  await setSetting("simulator.enabled", false);
  // Settings back to the defaults (tests below change them).
  await prisma.processingStage.updateMany({ data: { active: true, deactivatedAt: null, deactivatedById: null } });
  await prisma.processingStage.deleteMany({ where: { code: { in: ["SIGNING", "IT-EXTRA"] } } });
  await prisma.transactionType.updateMany({ where: { code: { in: ["NOTARY", "PPSR", "MORTGAGE"] } }, data: { needsLto: true } });
});
afterAll(async () => {
  await cleanLoans();
  await prisma.processingStage.deleteMany({ where: { code: { in: ["SIGNING", "IT-EXTRA"] } } });
  await prisma.transactionType.updateMany({ where: { code: { in: ["NOTARY", "PPSR", "MORTGAGE"] } }, data: { needsLto: true } });
  await prisma.$disconnect();
});

async function send(code: string, fundsNeeded: "YES" | "NO" = "NO", kinds: string[] = []) {
  await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true, type: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  const lto = txn.type.needsLto ? await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } }) : null;
  await assignToDp(la, {
    transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded, fundsKinds: kinds,
    beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
  return { loan, txn, job };
}
const rows = async (jobId: string) => stageRows(prisma, await loadAssignment(prisma, jobId));
const current = async (jobId: string) => (await rows(jobId)).find((r) => r.status !== "DONE")!;
async function upTo(jobId: string, kind: string, values: Record<string, unknown> = {}) {
  // Works the stages in order until the given kind is current (not started).
  for (;;) {
    const r = await current(jobId);
    if (r.kind === kind) return r;
    const id = r.id ?? r.code;
    if (r.status === "LATER") await startStage(dp, jobId, id);
    const raw: Record<string, unknown> = {};
    for (const f of r.fields) raw[f.key] = values[f.key] ?? (f.type === "date" ? today() : f.type === "tick" ? "on" : f.type === "file" ? "On file" : `Test ${f.label}`);
    await finishStage(dp, jobId, (await current(jobId)).id!, raw);
  }
}
const lastAudit = (action: string) => prisma.auditLog.findFirst({ where: { action }, orderBy: { at: "desc" } });

describe("Settings > Processing stages", () => {
  it("defaults: Notary Notarization, Entry of PPSR PPSR registration, Mortgage only the LTO stages, Check and verify last", async () => {
    const plan = async (code: string) => {
      const t = await prisma.transactionType.findUniqueOrThrow({ where: { code } });
      const { settingsPlan } = await import("@/lib/services/job-stages");
      return (await settingsPlan(prisma, t)).map((s) => s.name);
    };
    expect(await plan("NOTARY")).toEqual(["Notarization", "LTO drop off", "LTO pickup", "Check and verify"]);
    expect(await plan("PPSR")).toEqual(["PPSR registration", "LTO drop off", "LTO pickup", "Check and verify"]);
    expect(await plan("MORTGAGE")).toEqual(["LTO drop off", "LTO pickup", "Check and verify"]);
    // Without Needs LTO processing the LTO stages are gone; Check and verify stays.
    await prisma.transactionType.update({ where: { code: "NOTARY" }, data: { needsLto: false } });
    expect(await plan("NOTARY")).toEqual(["Notarization", "Check and verify"]);
  });

  it("add, rename, reorder, Inactive (never deleted), audit; stages:manage is Admin only", async () => {
    const t = await prisma.transactionType.findUniqueOrThrow({ where: { code: "NOTARY" } });
    const fields = JSON.stringify([{ label: "Signed on", type: "date", required: true }, { label: "Witness", type: "text", required: false }]);
    await expect(saveSettingsRow(la, "processingStage", null, { typeId: t.id, name: "Borrower signing", code: "SIGNING", sortOrder: "0", targetDays: "1", fields })).rejects.toThrow(/does not allow/);
    await expect(saveSettingsRow(dp, "processingStage", null, { typeId: t.id, name: "Borrower signing", code: "SIGNING", sortOrder: "0", targetDays: "1", fields })).rejects.toThrow(/does not allow/);
    await saveSettingsRow(admin, "processingStage", null, { typeId: t.id, name: "Borrower signing", code: "SIGNING", sortOrder: "0", targetDays: "1", fields });
    const s = await prisma.processingStage.findFirstOrThrow({ where: { typeId: t.id, code: "SIGNING" } });
    expect(s.fields).toEqual([{ key: "signedOn", label: "Signed on", type: "date", required: true }, { key: "witness", label: "Witness", type: "text", required: false }]);
    expect(await lastAudit("setting_created")).toMatchObject({ entityType: "processingStage", entityId: s.id });
    const { settingsPlan } = await import("@/lib/services/job-stages");
    expect((await settingsPlan(prisma, t)).map((x) => x.code)).toEqual(["SIGNING", "NOTARIZATION", "LTO-DROP", "LTO-PICKUP", "VERIFY"]);
    // Rename and move after Notarization.
    await saveSettingsRow(admin, "processingStage", s.id, { typeId: t.id, name: "Signing", code: "SIGNING", sortOrder: "5", targetDays: "", fields });
    expect((await settingsPlan(prisma, t)).map((x) => x.name)).toEqual(["Notarization", "Signing", "LTO drop off", "LTO pickup", "Check and verify"]);
    // System stages keep their place and code; Check and verify keeps its paper checklist.
    const verify = await prisma.processingStage.findFirstOrThrow({ where: { typeId: t.id, kind: "VERIFY" } });
    await saveSettingsRow(admin, "processingStage", verify.id, { typeId: t.id, name: "Check and verify", code: "OTHER", sortOrder: "0", targetDays: "1", fields: JSON.stringify([{ label: "x", type: "text", required: true }]) });
    expect(await prisma.processingStage.findUniqueOrThrow({ where: { id: verify.id } })).toMatchObject({ code: "VERIFY", sortOrder: 1002, fields: [], targetDays: 1 });
    // Inactive (with its own confirmation wording for Check and verify), never deleted.
    expect(await inactiveEffect("processingStage", verify.id)).toMatch(/could forward without ticking every paper/);
    await setRowActive(admin, "processingStage", s.id, false);
    expect((await settingsPlan(prisma, t)).map((x) => x.code)).not.toContain("SIGNING");
    expect(await prisma.processingStage.count({ where: { id: s.id } })).toBe(1);
    await expect(setRowActive(dp, "processingStage", s.id, true)).rejects.toThrow(/does not allow/);
    // Evidence types are checked.
    await expect(saveSettingsRow(admin, "processingStage", null, { typeId: t.id, name: "X", code: "IT-EXTRA", sortOrder: "1", targetDays: "", fields: JSON.stringify([{ label: "Paid", type: "money", required: true }]) })).rejects.toThrow(/text, date, number, file or tick/);
    // A type without a processor has no stages.
    const edst = await prisma.transactionType.findUniqueOrThrow({ where: { code: "EDST" } });
    await expect(saveSettingsRow(admin, "processingStage", null, { typeId: edst.id, name: "X", code: "IT-EXTRA", sortOrder: "1", targetDays: "", fields: "[]" })).rejects.toThrow(/has no processor/);
  });

  it("Import / Export with the shared columns", async () => {
    const exported = await currentDataRows("processing-stages");
    expect(exported.find((r) => r.transaction_code === "NOTARY" && r.code === "NOTARIZATION")).toMatchObject({ name: "Notarization", evidence_fields: "Notary name:text:required; Document:text:required; Page number:text:required; Book number:text:required; Series:text:required" });
    const csv = ["transaction_code,code,name,order,evidence_fields,target_days,status,notes", "NOTARY,IT-EXTRA,Extra check,9,Checked on:date:required,2,Active,", "NOTARY,NOTARIZATION,Notarization,1,Notary name:text:required; Document:text:required; Page number:text:required; Book number:text:required; Series:text:required,3,Active,"].join("\n");
    const check = await checkImport(admin, "processing-stages", "s.csv", csv);
    if (!check.ok) throw new Error(check.error);
    expect(check.rows.flatMap((r) => r.problems)).toEqual([]);
    expect(check.counts).toMatchObject({ new: 1, changed: 1, problem: 0 });
    const run = await runImport(admin, "processing-stages", "s.csv", csv);
    if (!run.ok) throw new Error(run.error);
    expect(await prisma.processingStage.findFirstOrThrow({ where: { code: "IT-EXTRA" } })).toMatchObject({ name: "Extra check", targetDays: 2 });
    const notar = await prisma.processingStage.findFirstOrThrow({ where: { code: "NOTARIZATION" } });
    expect(notar.targetDays).toBe(3);
    expect((notar.fields as { key: string }[]).map((f) => f.key)).toEqual(["name", "docNo", "pageNo", "bookNo", "series"]); // keys kept
    await prisma.processingStage.update({ where: { id: notar.id }, data: { targetDays: null } });
    const bad = await checkImport(admin, "processing-stages", "s.csv", ["transaction_code,code,name,order,evidence_fields,target_days,status,notes", "NOTARY,IT-EXTRA,Extra,1,Paid:money:required,,Active,"].join("\n"));
    if (!bad.ok) throw new Error(bad.error);
    expect(bad.rows.flatMap((r) => r.problems).join(" ")).toMatch(/Evidence fields: "Paid": the type must be text, date, number, file or tick/);
  });
});

describe("Stage rules on a job", () => {
  it("order, required evidence on the server, system times; Complete only when every stage is done", async () => {
    const { job } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    expect((await rows(job.id)).map((r) => r.name)).toEqual(["Notarization", "LTO drop off", "LTO pickup", "Check and verify"]);
    await expect(startStage(dp, job.id, "LTO-DROP")).rejects.toThrow("Stages run in order. Finish Notarization first.");
    await expect(startStage(la, job.id, "NOTARIZATION")).rejects.toThrow(/does not allow working on jobs/);
    await expect(startStage(admin, job.id, "NOTARIZATION")).rejects.toThrow(/does not allow working on jobs/);
    await expect(finishStage(dp, job.id, "NOTARIZATION", {})).rejects.toThrow("Press Start on Notarization first.");
    const before = Date.now();
    await startStage(dp, job.id, "NOTARIZATION");
    const started = (await rows(job.id))[0];
    expect(started.status).toBe("STARTED");
    expect(started.startedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    await expect(finishStage(dp, job.id, started.id!, { name: "Atty. Uy" })).rejects.toThrow("Document is required.");
    // A typed time is ignored: the server sets the finish time.
    await finishStage(dp, job.id, started.id!, { name: "Atty. Uy", docNo: "12", pageNo: "3", bookNo: "IV", series: "2026", finishedAt: "2020-01-01T00:00:00Z" });
    const done = (await rows(job.id))[0];
    expect(done.finishedAt!.getFullYear()).toBe(new Date().getFullYear());
    expect(done.evidence).toEqual({ name: "Atty. Uy", docNo: "12", pageNo: "3", bookNo: "IV", series: "2026" });
    await expect(completeJob(dp, job.id, {})).rejects.toThrow("Finish every stage first. Next: LTO drop off.");
    expect(await prisma.auditLog.count({ where: { action: { in: ["stage_started", "stage_finished"] }, entityId: job.id } })).toBe(2);
  });

  it("At the LTO stays blocked until funded; attempts, holds and problems attach to the current stage", async () => {
    const { job, txn } = await send("MORTGAGE", "YES", ["LTO_FEE"]);
    await acceptJob(dp, job.id, true);
    const drop = await current(job.id);
    expect(drop.kind).toBe("LTO_DROP");
    await expect(startStage(dp, job.id, drop.code)).rejects.toThrow("This job needs funds. Request a cash advance first.");
    await expect(logAttempt(dp, job.id, { date: today(), result: "DONE" })).rejects.toThrow("This job needs funds.");
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 150000, overMaxReason: "Integration test" }] });
    await decideAdvance(fin, r.id, { approve: true });
    await releaseAdvance(fin, r.id, { ref: "VOUCHER-1" });
    await startStage(dp, job.id, drop.code);
    const dropId = (await current(job.id)).id!;
    const reason = await prisma.problemReason.findFirstOrThrow({ where: { code: "LTO_DOWN" } });
    await logAttempt(dp, job.id, { date: today(), result: "NOT_PROCESSED", reasonId: reason.id, rest: "CARRY_OVER" });
    const hr = await prisma.holdReason.findFirstOrThrow({ where: { active: true } });
    const p = await prisma.problem.findFirstOrThrow({ where: { transactionId: txn.id, resolvedAt: null } });
    expect(p.jobStageId).toBe(dropId); // Not processed opened the problem on LTO drop off
    await resolveProblem(dp, p.id, "LTO back online");
    await raiseHold(dp, { transactionId: txn.id, reasonId: hr.id, note: "Appointment tomorrow" });
    expect((await prisma.transactionAttempt.findFirstOrThrow({ where: { transactionId: txn.id } })).jobStageId).toBe(dropId);
    expect((await prisma.hold.findFirstOrThrow({ where: { transactionId: txn.id } })).jobStageId).toBe(dropId);
  });

  it("the transaction clock is the same with and without stages and holds (it never pauses)", async () => {
    const { job, txn } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    const [tats, holidays] = await Promise.all([getTatMap(), getHolidaySet()]);
    const load = () => prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id }, include: { type: true, problems: { include: { reason: true } }, holds: { include: { reason: true } }, advanceLines: { include: { advance: true } } } });
    const at = new Date(Date.now() + 3 * 86_400_000);
    const before = txnTat(await load(), tats, holidays, at);
    await startStage(dp, job.id, "NOTARIZATION");
    const after = txnTat(await load(), tats, holidays, at);
    expect(after?.text).toBe(before?.text);
    const t = await load();
    expect(t.statusSince.getTime()).toBe((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).decidedAt!.getTime());
  });

  it("Needs LTO processing switched off: jobs not yet started lose the LTO stages; started jobs keep theirs", async () => {
    const a = await send("NOTARY");
    await acceptJob(dp, a.job.id, true);
    await startStage(dp, a.job.id, "NOTARIZATION"); // started: its stages are copied
    const b = await send("PPSR");
    await acceptJob(dp, b.job.id, true);
    await prisma.transactionType.updateMany({ where: { code: { in: ["NOTARY", "PPSR"] } }, data: { needsLto: false } });
    expect((await rows(a.job.id)).map((r) => r.kind)).toEqual(["OWN", "LTO_DROP", "LTO_PICKUP", "VERIFY"]);
    expect((await rows(b.job.id)).map((r) => r.kind)).toEqual(["OWN", "VERIFY"]);
  });

  it("Return to LA and Pasuyo work at any stage; Pasuyo continues from the current stage", async () => {
    const { job } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    await upTo(job.id, "LTO_DROP");
    await startStage(dp, job.id, "LTO-DROP");
    await passJob(dp, job.id, { toUserId: dp2.id, reason: "Out of town" });
    const r = await current(job.id);
    expect(r).toMatchObject({ code: "LTO-DROP", status: "STARTED" });
    // The second processor finishes the stage the first one started.
    await finishStage(dp2, job.id, r.id!, { droppedAt: today(), office: "LTO Cebu", orNumber: "OR-9" });
    expect((await current(job.id)).code).toBe("LTO-PICKUP");
    const reason = await prisma.returnReason.findFirstOrThrow({ where: { code: "MISSING" } });
    const check = await prisma.checklistCheck.findFirstOrThrow({ where: { transaction: { dpAssignments: { some: { id: job.id } } } } });
    await returnToLa(dp2, job.id, { reasonId: reason.id, checkIds: [check.id], note: "Page 2 unsigned", handedOver: await allPapers(check.transactionId) });
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("WITHDRAWN");
  });
});

describe("Check and verify", () => {
  it("every paper ticked (Returned to DP), Something is missing opens a Problem on the stage, then Verified by DP", async () => {
    const { job, txn } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    const v = await upTo(job.id, "VERIFY");
    await startStage(dp, job.id, v.code);
    const vid = (await current(job.id)).id!;
    const papers = verifiablePapers((await loadAssignment(prisma, job.id)).transaction.documents);
    expect(papers.length).toBeGreaterThan(1);
    await expect(finishStage(dp, job.id, vid, {})).rejects.toThrow(`Tick every paper as received back and complete first (${papers.length} left).`);
    await verifyPaper(dp, job.id, vid, papers[0].id);
    const ret = await prisma.documentMovement.findFirstOrThrow({ where: { documentItemId: papers[0].id, action: "RETURNED_TO_DP" } });
    expect(ret).toMatchObject({ actorLabel: "Test Document Processor", remarks: "Received back and complete" });
    // A paper is not back: a Problem (Missing paper) on this stage, naming it.
    await somethingMissing(dp, job.id, vid, [papers[1].id], "Not in the folder");
    const p = await prisma.problem.findFirstOrThrow({ where: { transactionId: txn.id, resolvedAt: null }, include: { reason: true } });
    expect(p).toMatchObject({ jobStageId: vid, note: `Missing: ${papers[1].label}. Not in the folder` });
    expect(p.reason.code).toBe("MISSING_PAPER");
    for (const d of papers.slice(1)) await verifyPaper(dp, job.id, vid, d.id);
    await expect(finishStage(dp, job.id, vid, {})).rejects.toThrow(/A problem is open on this job/);
    await resolveProblem(dp, p.id, "Found in the car");
    await finishStage(dp, job.id, vid, { note: "All back" });
    expect(await prisma.documentMovement.count({ where: { documentItemId: { in: papers.map((x) => x.id) }, action: "VERIFIED_BY_DP" } })).toBe(papers.length);
    expect((await rows(job.id)).at(-1)).toMatchObject({ status: "DONE", evidence: expect.objectContaining({ note: "All back", verifiedBy: "Test Document Processor" }) });
  });

  it("is the last stage with and without LTO; Making it inactive needs a confirmation (the effect text)", async () => {
    await prisma.transactionType.update({ where: { code: "NOTARY" }, data: { needsLto: false } });
    const { job } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    expect((await rows(job.id)).map((r) => r.kind)).toEqual(["OWN", "VERIFY"]);
    const m = await send("MORTGAGE");
    await acceptJob(dp, m.job.id, true);
    expect((await rows(m.job.id)).map((r) => r.kind)).toEqual(["LTO_DROP", "LTO_PICKUP", "VERIFY"]);
  });
});

describe("Forward to branch (manual, never automatic) and the receiving LA", () => {
  async function verified(code = "NOTARY") {
    const s = await send(code);
    await acceptJob(dp, s.job.id, true);
    return s;
  }

  it("refused without Check and verify, a branch, or an LA active in that branch; nothing forwards by itself", async () => {
    const { job, txn, loan } = await verified();
    await expect(forwardJob(dp, job.id, { branchId: loan.branchId, receivingLaId: la.id })).rejects.toThrow(/Finish Check and verify before forwarding|Complete the job first/);
    await workStages(dp, job.id);
    // Every stage done: still not forwarded.
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("IN_PROCESS");
    await completeJob(dp, job.id, {});
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("IN_PROCESS"); // never automatic
    await expect(forwardJob(dp, job.id, { branchId: "", receivingLaId: la.id })).rejects.toThrow("Choose the branch.");
    await expect(forwardJob(dp, job.id, { branchId: loan.branchId, receivingLaId: "" })).rejects.toThrow("Choose the Loan Associate.");
    const dvo = await prisma.branch.findUniqueOrThrow({ where: { code: "DVO" } });
    await expect(forwardJob(dp, job.id, { branchId: dvo.id, receivingLaId: la.id })).rejects.toThrow("Choose a Loan Associate who is active at Davao.");
    await expect(forwardJob(dp, job.id, { branchId: loan.branchId, receivingLaId: dp2.id })).rejects.toThrow(/Choose a Loan Associate who is active/);
  });

  it("to another branch: custody, notification and Home to-do; that LA receives it (Complete) and the DP is told", async () => {
    const since = new Date();
    const { job, txn } = await verified();
    await workStages(dp, job.id);
    await completeJob(dp, job.id, {});
    const dvo = await prisma.branch.findUniqueOrThrow({ where: { code: "DVO" } });
    await forwardJob(dp, job.id, { branchId: dvo.id, receivingLaId: laDvo.id, note: "Original OR inside" });
    const moved = await prisma.documentMovement.findFirstOrThrow({ where: { action: "FORWARDED_TO_BRANCH", documentItem: { transactionId: txn.id } } });
    expect(moved.location).toBe("Forwarded to IT Davao LA, Davao");
    expect(await prisma.notification.count({ where: { userId: laDvo.id, title: { contains: "package forwarded to you" } } })).toBe(1);
    expect(await prisma.emailOutbox.count({ where: { event: "package_moved", userId: laDvo.id, createdAt: { gte: since } } })).toBe(1);
    const todo = await packagesFor(laDvo);
    expect(todo).toHaveLength(1);
    expect(todo[0]).toMatchObject({ pn: PN, branch: "Davao", href: `/receive/${job.id}` });
    expect(todo[0].tat?.text).toMatch(/of 2|Due today|Processing/); // the 2 business day receiving target
    // The loan's own LA (Cebu) is not the one asked; the Davao LA receives it.
    await expect(receivePackage(la, job.id, { result: "complete", note: "" })).rejects.toThrow();
    await receivePackage(laDvo, job.id, { result: "complete", note: "" });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("COMPLETED");
    expect((await prisma.documentItem.findFirstOrThrow({ where: { transactionId: txn.id, documentId: { not: null } } })).location).toBe("Davao branch");
    expect(await prisma.notification.count({ where: { userId: dp.id, title: { contains: "papers received" } } })).toBe(1);
    expect(await packagesFor(laDvo)).toHaveLength(0);
  });

  it("Incomplete (and a blocking Other): the DP is told, sees Package incomplete, corrects and forwards again", async () => {
    const { job, txn, loan } = await verified();
    await workStages(dp, job.id);
    await completeJob(dp, job.id, {});
    await forwardJob(dp, job.id, { branchId: loan.branchId, receivingLaId: la.id });
    await expect(receivePackage(la, job.id, { result: "incomplete", note: "" })).rejects.toThrow("Say what is missing or wrong.");
    await receivePackage(la, job.id, { result: "incomplete", note: "OR missing" });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("IN_PROCESS");
    expect(await prisma.loanException.count({ where: { transactionId: txn.id, type: "INCOMPLETE_PACKAGE", status: "OPEN" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: dp.id, title: { contains: "package incomplete" } } })).toBe(1);
    const row = (await myJobs(dp)).find((r) => r.id === job.id)!;
    expect(row).toMatchObject({ tab: "process", incomplete: "OR missing" });
    // Corrected and forwarded again; this time a non-blocking Other is received with the remark.
    await forwardJob(dp, job.id, { branchId: loan.branchId, receivingLaId: la.id });
    expect(await prisma.loanException.count({ where: { transactionId: txn.id, type: "INCOMPLETE_PACKAGE", status: "OPEN" } })).toBe(0);
    await receivePackage(la, job.id, { result: "other", note: "Receipt copy faded", blocking: true });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("IN_PROCESS");
    await forwardJob(dp, job.id, { branchId: loan.branchId, receivingLaId: la.id });
    await receivePackage(la, job.id, { result: "other", note: "Receipt copy faded but readable" });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("COMPLETED");
    expect((await lastAudit("package_accepted"))?.summary).toMatch(/Other: Receipt copy faded but readable/);
  });

  it("forwarding does not wait for liquidation; the vault gate opens from real DP output once funds are settled", async () => {
    // Every transaction of PN-0001003 done for real: EDST by the LA, the others by the DP.
    await openLoanFile(la, { pn: PN, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: PN }, include: { transactions: { include: { type: true } } } });
    const { completeLaTransaction, recordEdst } = await import("@/lib/services/workflow");
    const edst = loan.transactions.find((t) => t.type.code === "EDST")!;
    const edstChecks = await prisma.checklistCheck.findMany({ where: { transactionId: edst.id } });
    await saveChecklist(la, { transactionId: edst.id, checkedIds: edstChecks.map((c) => c.id), newOthers: [] });
    await recordEdst(la, { transactionId: edst.id, reference: "EDST-123" }).catch(() => completeLaTransaction(la, { transactionId: edst.id }));
    let advanceId = "";
    for (const code of ["NOTARY", "PPSR", "MORTGAGE"]) {
      const s = await send(code, code === "MORTGAGE" ? "YES" : "NO", code === "MORTGAGE" ? ["LTO_FEE"] : []);
      await acceptJob(dp, s.job.id, true);
      if (code === "MORTGAGE") {
        const r = await requestAdvance(dp, { lines: [{ transactionId: s.txn.id, kind: "LTO_FEE", cents: 100000, overMaxReason: "Integration test" }] });
        await decideAdvance(fin, r.id, { approve: true });
        await releaseAdvance(fin, r.id, { ref: "VOUCHER-1" });
        advanceId = r.id;
      }
      await workStages(dp, s.job.id);
      await completeJob(dp, s.job.id, {});
      await forwardJob(dp, s.job.id, { branchId: s.loan.branchId, receivingLaId: la.id }); // before liquidation
      await receivePackage(la, s.job.id, { result: "complete", note: "" });
    }
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: PN } })).stage).toBe("In process"); // funds still out
    const line = await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId } });
    await addReceipt(dp, { lineId: line.id, date: today(), cents: 100000, number: "OR-1" }, null);
    await closeAdvance(fin, advanceId);
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: PN } })).stage).toBe("For Vault Transmittal");
  });
});

describe("Gaps closed", () => {
  it("custody at Accept: one Received by the processor per paper; Some papers are missing returns them to the LA", async () => {
    const { job, txn } = await send("NOTARY");
    const docs = await prisma.documentItem.findMany({ where: { transactionId: txn.id, documentId: { not: null } } });
    const missing = docs[0];
    const reason = await prisma.returnReason.findFirstOrThrow({ where: { code: "MISSING" } });
    await expect(acceptWithMissing(dp, job.id, false, { reasonId: reason.id, checkIds: [missing.checkId!], note: "Not in the envelope" })).rejects.toThrow(/Labels are on the papers I received/);
    await expect(acceptWithMissing(dp, job.id, true, { reasonId: reason.id, checkIds: [missing.checkId!], note: "Not in the envelope" })).rejects.toThrow("Tick every paper you hand over to the Loan Associate.");
    await acceptWithMissing(dp, job.id, true, { reasonId: reason.id, checkIds: [missing.checkId!], note: "Not in the envelope", handedOver: await allPapers(txn.id) });
    const acks = await prisma.documentMovement.findMany({ where: { documentItem: { transactionId: txn.id }, action: "ACKNOWLEDGED_BY_DP" } });
    expect(acks).toHaveLength(docs.length - 1);
    expect(acks.every((m) => m.actorLabel === "Test Document Processor" && m.acknowledgedAt)).toBe(true);
    expect(await prisma.documentMovement.count({ where: { documentItemId: missing.id, action: "NOT_RECEIVED_BY_DP" } })).toBe(1);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("WITHDRAWN");
    expect((await prisma.checklistCheck.findUniqueOrThrow({ where: { id: missing.checkId! } })).checked).toBe(false);
  });

  it("DP lists: On hold shows with its chip; a returned job leaves the DP's list; the TAT report filters by stage", async () => {
    const a = await send("NOTARY");
    await acceptJob(dp, a.job.id, true);
    await startStage(dp, a.job.id, "NOTARIZATION");
    const hr = await prisma.holdReason.findFirstOrThrow({ where: { active: true } });
    await raiseHold(dp, { transactionId: a.txn.id, reasonId: hr.id, note: "Waiting on the LTO" });
    const mine = await myJobs(dp);
    expect(mine.find((r) => r.id === a.job.id)).toMatchObject({ hold: expect.objectContaining({ reason: hr.name }), stage: "Notarization" });
    const b = await send("PPSR");
    const reason = await prisma.returnReason.findFirstOrThrow({ where: { code: "OTHER" } });
    await acceptJob(dp, b.job.id, true);
    await returnToLa(dp, b.job.id, { reasonId: reason.id, note: "Wrong branch", handedOver: await allPapers(b.txn.id) });
    // Returned to the LA who sent it: no longer in any DP list, tile or count.
    expect((await myJobs(dp)).find((r) => r.id === b.job.id)).toBeUndefined();
    const { tatReport } = await import("@/lib/services/tat-report");
    expect((await tatReport(admin, { show: "all", stage: "Notarization" })).rows.map((r) => r.id)).toEqual([a.job.id]);
    expect((await jobRows({ id: a.job.id }))[0].stage).toBe("Notarization");
  });

  it("the Journey shows the stage rows with what was recorded in each; the simulator uses the same stage functions", async () => {
    const { job, txn } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    await startStage(dp, job.id, "NOTARIZATION");
    const reason = await prisma.problemReason.findFirstOrThrow({ where: { code: "OTHER" } });
    await raiseProblem(dp, { transactionId: txn.id, reasonId: reason.id, note: "Notary out" });
    const loan = (await getLoanForUser(admin, PN))!;
    const { journey } = await loadJourney(admin, loan);
    const step = journey.phases.flatMap((p) => p.steps).find((s) => s.txnId === txn.id && s.stages?.length)!;
    expect(step.stages!.map((s) => `${s.name}:${s.state}`)).toEqual(["Notarization:now", "LTO drop off:later", "LTO pickup:later", "Check and verify:later"]);
    expect(step.stages![0].problems.map((p) => p.reason)).toEqual([reason.name]);
    // Simulator: the same stage functions, labelled Simulated.
    const p = await prisma.problem.findFirstOrThrow({ where: { transactionId: txn.id, resolvedAt: null } });
    await resolveProblem(dp, p.id, "Back");
    await setSetting("simulator.enabled", true);
    await simulate(admin, { loanId: loan.id, action: "DP_PROCESS", targetId: job.id });
    const all = await rows(job.id);
    expect(all.every((r) => r.status === "DONE")).toBe(true);
    // Notarization (started by the DP) and the 3 after it, all finished by the simulator.
    expect(await prisma.auditLog.count({ where: { entityId: job.id, action: "stage_finished", mode: "SIMULATED" } })).toBe(4);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).processing).toBeTruthy();
  });

  it("migration: a job completed before stages has every stage Done from its stored references", async () => {
    const { job } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    // As a job completed with the old Complete step looks (no stage rows, references stored).
    await prisma.dpAssignment.update({ where: { id: job.id }, data: { processing: { notary: { name: "Atty. Old", docNo: "1", pageNo: "2", bookNo: "3", series: "2025" }, processedAt: new Date().toISOString() } } });
    const sql = (await import("node:fs")).readFileSync("prisma/migrations/20261117090000_job_stages/migration.sql", "utf8");
    const mapping = sql.slice(sql.indexOf('INSERT INTO "JobStage"'));
    await prisma.$executeRawUnsafe(mapping.replace(/;\s*$/, ""));
    const r = await rows(job.id);
    expect(r.map((x) => `${x.name}:${x.status}`)).toEqual(["Notarization:DONE", "LTO drop off:DONE", "LTO pickup:DONE", "Check and verify:DONE"]);
    expect(r[0]).toMatchObject({ migrated: true, evidence: { name: "Atty. Old", docNo: "1", pageNo: "2", bookNo: "3", series: "2025" } });
  });
});
