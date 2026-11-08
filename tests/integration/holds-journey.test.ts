/**
 * Holds, hold reasons, the Journey (amounts and custody) through the same functions the screens use.
 * LOCAL database only; removes all loan files first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, markLabelsPrinted, saveChecklist } from "@/lib/services/workflow";
import { acceptJob, completeJob, logAttempt, receivePackage } from "@/lib/services/jobs";
import { raiseHold, resumeHold } from "@/lib/services/holds";
import { decideAdvance, releaseAdvance, requestAdvance } from "@/lib/services/funds";
import { saveSettingsRow } from "@/lib/services/admin";
import { setRowActive } from "@/lib/services/settings-status";
import { checkImport, currentDataCsv, runImport } from "@/lib/import/importer";
import { toCsv } from "@/lib/import/csv";
import { getLoanForUser } from "@/lib/services/queries";
import { loadJourney, stripAmounts } from "@/lib/services/journey";
import { simulate } from "@/lib/services/simulator";
import { setSetting } from "@/lib/settings";
import { businessDate } from "@/lib/time";
import { asUser, cleanLoans, workStages, forwardToLoanBranch } from "./helpers";

let la: CurrentUser, dp: CurrentUser, fin: CurrentUser, admin: CurrentUser;
const today = () => businessDate(new Date());
let borrower: string;

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  borrower = (await prisma.holdReason.findUniqueOrThrow({ where: { code: "BORROWER" } })).id;
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
  await setSetting("funds.blockLtoUntilFunded", true);
  await prisma.holdReason.deleteMany({ where: { code: { startsWith: "Z" } } });
  await prisma.holdReason.updateMany({ data: { active: true, deactivatedAt: null, deactivatedById: null } });
});
afterAll(async () => {
  await prisma.holdReason.deleteMany({ where: { code: { startsWith: "Z" } } });
  await prisma.$disconnect();
});

async function open() {
  await openLoanFile(la, { pn: "PN-0001003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  return prisma.loan.findUniqueOrThrow({ where: { pn: "PN-0001003" } });
}
async function tick(code: string) {
  const loan = await open();
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  return { loan, txn };
}
async function send(code: string, needed: "YES" | "NO" = "NO", kinds: string[] = []) {
  const { loan, txn } = await tick(code);
  // Every type that needs LTO processing (Notary, Entry of PPSR, Mortgage) is sent with an office.
  const lto = await prisma.ltoOffice.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, {
    transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto?.id ?? null, fundsNeeded: needed, fundsKinds: kinds,
    beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
  return { loan, txn, job };
}

describe("Holds: who may raise and resume", () => {
  it("the LA on work in the LA's hands; one open hold per transaction; Admin cannot raise but resumes any", async () => {
    const { txn } = await tick("NOTARY"); // Ready to send: in the LA's hands
    await expect(raiseHold(admin, { transactionId: txn.id, reasonId: borrower })).rejects.toThrow("Your role does not allow putting work on hold.");
    await expect(raiseHold(dp, { transactionId: txn.id, reasonId: borrower })).rejects.toThrow("You can put on hold only work you do.");
    // The reason is required; the start time and the person are the server's, not the form's.
    await expect(raiseHold(la, { transactionId: txn.id, reasonId: "" })).rejects.toThrow("Pick a reason.");
    const before = Date.now();
    const id = await raiseHold(la, { transactionId: txn.id, reasonId: borrower, note: "Signed page", raisedAt: new Date("2020-01-01"), expectedResumeOn: "2020-01-02" } as never);
    const started = await prisma.hold.findUniqueOrThrow({ where: { id } });
    expect(started.raisedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(started).toMatchObject({ raisedById: la.id, raisedByLabel: "Test Loan Associate", expectedResumeOn: null });
    await expect(raiseHold(la, { transactionId: txn.id, reasonId: borrower })).rejects.toThrow("This transaction is already on hold.");
    // The database refuses a second open hold too.
    await expect(prisma.hold.create({ data: { loanId: txn.loanId, transactionId: txn.id, reasonId: borrower, raisedByLabel: "x" } })).rejects.toThrow();
    await expect(resumeHold(dp, id, "Done now")).rejects.toThrow("You can resume only holds on work you do.");
    // Resume remarks are required (at least 3 characters).
    await expect(resumeHold(admin, id, "")).rejects.toThrow("Write the resume remarks (at least 3 characters).");
    await expect(resumeHold(admin, id, " ok ")).rejects.toThrow("Write the resume remarks (at least 3 characters).");
    expect((await prisma.hold.findUniqueOrThrow({ where: { id } })).resumedAt).toBeNull();
    await resumeHold(admin, id, "Borrower came in");
    const h = await prisma.hold.findUniqueOrThrow({ where: { id } });
    expect(h).toMatchObject({ resumedByLabel: "Test Admin", resumeNote: "Borrower came in" });
    expect(await prisma.hold.count({ where: { transactionId: txn.id } })).toBe(1); // closed on the same record
    await expect(resumeHold(admin, id, "Again please")).rejects.toThrow("This hold has already ended.");
    // Several holds over time are fine.
    await raiseHold(la, { transactionId: txn.id, reasonId: borrower });
    expect(await prisma.hold.count({ where: { transactionId: txn.id } })).toBe(2);
  });

  it("the DP on their own job; one audit row per action; the branch LA and Admin are told", async () => {
    const { txn, job } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    // Once sent and accepted it is the DP's work, not the LA's.
    await expect(raiseHold(la, { transactionId: txn.id, reasonId: borrower })).rejects.toThrow("You can put on hold only work you do.");
    const auditBefore = await prisma.auditLog.count({ where: { action: { startsWith: "hold_" } } });
    const id = await raiseHold(dp, { transactionId: txn.id, reasonId: borrower });
    await resumeHold(dp, id, "Borrower signed");
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "hold_" } } })).toBe(auditBefore + 2);
    const notes = await prisma.notification.findMany({ where: { loanId: txn.loanId, title: { contains: "Notary" } } });
    expect(notes.filter((n) => n.title.endsWith("put on hold")).map((n) => n.userId)).toEqual(expect.arrayContaining([la.id, admin.id]));
    expect(notes.some((n) => n.title.endsWith("resumed") && n.userId === admin.id)).toBe(true);
  });

  it("a finished transaction does not stay on hold (System ends it, same record)", async () => {
    const { txn, job } = await send("NOTARY");
    await acceptJob(dp, job.id, true);
    await raiseHold(dp, { transactionId: txn.id, reasonId: borrower });
    await logAttempt(dp, job.id, { date: today(), result: "DONE" });
    await workStages(dp, job.id, { name: "Atty. Uy", docNo: "1", pageNo: "2", bookNo: "III", series: "2026" });
    await completeJob(dp, job.id, {});
    await forwardToLoanBranch(dp, job.id, la.id);
    await receivePackage(la, job.id, true, "");
    const h = await prisma.hold.findFirstOrThrow({ where: { transactionId: txn.id } });
    expect(h.resumedByLabel).toBe("System");
    expect(h.resumedAt).not.toBeNull();
  });
});

describe("Hold reasons in Settings", () => {
  it("add, rename, inactive instead of delete, import and export; audited", async () => {
    await saveSettingsRow(admin, "holdReason", null, { code: "ZBANK", name: "Waiting on the bank", sortOrder: "9" });
    const r = await prisma.holdReason.findUniqueOrThrow({ where: { code: "ZBANK" } });
    await saveSettingsRow(admin, "holdReason", r.id, { code: "ZBANK", name: "Waiting on the bank (loan)", sortOrder: "9" });
    await setRowActive(admin, "holdReason", r.id, false);
    expect(await prisma.holdReason.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ name: "Waiting on the bank (loan)", active: false });
    expect(await prisma.auditLog.count({ where: { entityType: "holdReason", entityId: r.id } })).toBe(3);
    // An inactive reason is not offered for new holds.
    const { txn } = await tick("NOTARY");
    await expect(raiseHold(la, { transactionId: txn.id, reasonId: r.id })).rejects.toThrow("Pick a reason.");
    // The LA may not change the list.
    await expect(saveSettingsRow(la, "holdReason", null, { code: "ZNO", name: "No", sortOrder: "1" })).rejects.toThrow(/does not allow/);

    const file = toCsv(["code", "name", "order", "status"], [{ code: "ZCOURIER", name: "Waiting on the courier", order: "7", status: "Active" }, { code: "ZBANK", name: "Waiting on the bank (loan)", order: "9", status: "Active" }]);
    const plan = await checkImport(admin, "hold-reasons", "h.csv", file);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.counts).toMatchObject({ new: 1, changed: 1, problem: 0 });
    const run = await runImport(admin, "hold-reasons", "h.csv", file);
    if (!run.ok) throw new Error(run.error);
    expect((await prisma.holdReason.findUniqueOrThrow({ where: { code: "ZBANK" } })).active).toBe(true);
    const csv = await currentDataCsv("hold-reasons");
    expect(csv).toContain("ZCOURIER,Waiting on the courier,7,Active");
    expect(csv).toContain("BORROWER,Waiting on borrower,1,Active");
  });
});

describe("Journey: cash amounts stay on the server unless allowed", () => {
  it("Finance receives amounts; the LA and the DP never do; a role switch takes effect on the next request", async () => {
    const { txn, job } = await send("MORTGAGE", "YES", ["LTO_FEE"]);
    await acceptJob(dp, job.id, true);
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 150000, overMaxReason: "Integration test" }] });
    await decideAdvance(fin, r.id, { approve: true });
    await releaseAdvance(fin, r.id, { ref: "VOUCHER-1" });

    const view = async (u: CurrentUser) => {
      const loan = (await getLoanForUser(u, "PN-0001003"))!;
      return JSON.stringify((await loadJourney(u, loan)).journey);
    };
    expect(await view(fin)).toContain("₱1,500.00");
    for (const u of [la, dp]) {
      const s = await view(u);
      expect(s).not.toMatch(/₱|PHP \d|1,500|150000/);
      expect(s).toContain("Funded");
    }
    // Roles and access: turn it on for the Loan Associate role; the next request sees amounts.
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "LA" } });
    try {
      await prisma.role.update({ where: { key: "LA" }, data: { permissions: [...role.permissions, "journey:view_amounts"] } });
      expect(await view(await asUser("test.la@gdfi.ph"))).toContain("₱1,500.00");
    } finally {
      await prisma.role.update({ where: { key: "LA" }, data: { permissions: role.permissions } });
    }
    expect(await view(await asUser("test.la@gdfi.ph"))).not.toContain("₱");
  });

  it("strips amounts from sentences", () => {
    expect(stripAmounts("CA-2026-0001 requested by Joy: ₱1,500.00 for Mortgage")).toBe("CA-2026-0001 requested by Joy for Mortgage");
    expect(stripAmounts("Finance released PHP 2,000.00.")).toBe("Finance released.");
  });
});

describe("Custody trail: who and where at each hand-over", () => {
  it("label printed, sent, DP accepted, at the LTO and back, forwarded, LA received; time held per holder", async () => {
    const t0 = await tick("MORTGAGE");
    const docs = await prisma.documentItem.findMany({ where: { transactionId: t0.txn.id, documentId: { not: null } } });
    await markLabelsPrinted(la, docs.map((d) => d.id));
    const { loan, job } = await send("MORTGAGE", "NO");
    await acceptJob(dp, job.id, true);
    await logAttempt(dp, job.id, { date: today(), result: "DONE" });
    await workStages(dp, job.id, { droppedAt: today(), pickedUpAt: today(), annotatedOrCr: "on" });
    await completeJob(dp, job.id, {});
    await forwardToLoanBranch(dp, job.id, la.id);
    await receivePackage(la, job.id, true, "");
    const moves = await prisma.documentMovement.findMany({ where: { documentItemId: docs[0].id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(moves.map((m) => m.action)).toEqual([
      "RECEIVED_AT_BRANCH", "LABEL_PRINTED", "DISPATCHED_TO_DP", "ACKNOWLEDGED_BY_DP", "AT_LTO", "RETURNED_FROM_LTO", "RETURNED_TO_DP", "VERIFIED_BY_DP", "FORWARDED_TO_BRANCH", "ACCEPTED_AT_BRANCH",
    ]);
    expect(moves.every((m) => m.actorLabel)).toBe(true);
    expect(moves.every((m) => m.location || m.action === "LABEL_PRINTED")).toBe(true);
    expect(moves.find((m) => m.action === "ACKNOWLEDGED_BY_DP")).toMatchObject({ actorLabel: "Test Document Processor", acknowledgedById: dp.id });
    expect(moves.find((m) => m.action === "ACCEPTED_AT_BRANCH")).toMatchObject({ actorLabel: "Test Loan Associate", acknowledgedById: la.id });

    const j = (await loadJourney(la, (await getLoanForUser(la, loan.pn))!)).journey;
    const d = j.docs.find((x) => x.id === docs[0].id)!;
    expect(d.periods.map((p) => p.holder)).toEqual(["Test Loan Associate (LA, Cebu)", "Test Document Processor (DP)", "Test Loan Associate (LA, Cebu)"]);
    expect(d.trail[0]).toMatchObject({ label: "Received by the LA", acknowledgedBy: "Test Loan Associate" });
  });
});

describe("Admin simulator: events in the Journey are tagged Simulated", () => {
  it("DP accept, process, forward and receive by the simulator", async () => {
    await setSetting("simulator.enabled", true);
    try {
      const { loan, job } = await send("NOTARY");
      for (const action of ["DP_ACCEPT", "DP_PROCESS", "DP_FORWARD", "LA_ACCEPT_COMPLETE"] as const) await simulate(admin, { loanId: loan.id, action, targetId: job.id });
      const j = (await loadJourney(admin, (await getLoanForUser(admin, loan.pn))!)).journey;
      const steps = j.phases.flatMap((p) => p.steps).filter((s) => s.txnCode === "NOTARY");
      expect(steps.find((s) => s.stepId === "4.1")!.simulated).toBe(true);
      expect(steps.find((s) => s.stepId === "4.6")!.simulated).toBe(true);
      expect(steps.every((s) => s.state === "done")).toBe(true);
      expect(j.docs.find((d) => d.txnCode === "NOTARY")!.trail.some((m) => m.simulated && m.by === "Test Document Processor (Simulated)")).toBe(true);
    } finally {
      await setSetting("simulator.enabled", false);
    }
  });
});

describe("Missing paper: specific papers, closes when they are ticked", () => {
  it("needs at least one unticked paper of this transaction; one audit row; ticking closes it; unticking does not reopen", async () => {
    const { requestMissingDocuments } = await import("@/lib/services/workflow");
    const loan = await open();
    const notary = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "NOTARY" } }, include: { checks: { include: { rule: true } } } });
    const ppsr = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "PPSR" } }, include: { checks: true } });
    const [a, b] = notary.checks;
    await saveChecklist(la, { transactionId: notary.id, checkedIds: [b.id], newOthers: [] });
    await expect(requestMissingDocuments(la, { transactionId: notary.id, checkIds: [] })).rejects.toThrow("Pick at least one paper.");
    await expect(requestMissingDocuments(la, { transactionId: notary.id, checkIds: [ppsr.checks[0].id] })).rejects.toThrow("Pick papers of this transaction only.");
    await expect(requestMissingDocuments(la, { transactionId: notary.id, checkIds: [b.id] })).rejects.toThrow(/already ticked/);
    await expect(requestMissingDocuments(dp, { transactionId: notary.id, checkIds: [a.id] })).rejects.toThrow();
    const before = await prisma.auditLog.count({ where: { action: "exception_raised" } });
    const papers = await requestMissingDocuments(la, { transactionId: notary.id, checkIds: [a.id], askedFrom: "BORROWER", note: "Bring it Monday" });
    expect(papers).toEqual([a.rule!.label]);
    expect(await prisma.auditLog.count({ where: { action: "exception_raised" } })).toBe(before + 1);
    const ex = await prisma.loanException.findFirstOrThrow({ where: { transactionId: notary.id, type: "LEGAL_DOCS_COMPLETION" } });
    expect(ex.details).toMatchObject({ checkIds: [a.id], askedFrom: "BORROWER" });
    // Ticking another paper does not close it; ticking the requested one does.
    await saveChecklist(la, { transactionId: notary.id, checkedIds: [b.id, notary.checks[2].id], newOthers: [] });
    expect((await prisma.loanException.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe("OPEN");
    await saveChecklist(la, { transactionId: notary.id, checkedIds: [a.id, b.id], newOthers: [] });
    expect((await prisma.loanException.findUniqueOrThrow({ where: { id: ex.id } })).status).toBe("RESOLVED");
    await saveChecklist(la, { transactionId: notary.id, checkedIds: [b.id], newOthers: [] });
    expect(await prisma.loanException.count({ where: { transactionId: notary.id, type: "LEGAL_DOCS_COMPLETION", status: "OPEN" } })).toBe(0);
  });
});
