/**
 * MyLoans sync, checked end to end (the "sync check" brief): each scenario on a loan with ticked papers,
 * one sent transaction and one unsent one. Borrower details (its own review, decided by the branch
 * supervisors and approvers), the pause switch, the busy message, refresh paths and notifications.
 * Test database (gdfi_dms_test), sample MyLoans (mock).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { loanScope } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { getMyLoansAdapter } from "@/lib/myloans";
import { lookupPn, openLoanFile, refreshFromMyLoans, MYLOANS_BUSY } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { requestAdvance } from "@/lib/services/funds";
import {
  applySourceChange, keepCurrent, linkReplacement, refreshLoan, refreshOnOpen, runMyLoansSync, runSyncNow, setMyLoansPaused, simulateSourceChange, PAUSED_BY_ADMIN,
} from "@/lib/services/source-sync";
import { cashBlockReason, sendBlockReason, CANCELLED_REASON, CHANGED_REASON } from "@/lib/services/source-blocks";
import { reviewFor } from "@/lib/services/source-review";
import { acceptBorrowerCorrection, borrowerReviewFor, borrowerToDo, keepBorrowerCurrent } from "@/lib/services/borrower-review";
import { refreshFoundLoan, savedLoanCard } from "@/lib/services/find-local";
import { listLoans } from "@/lib/services/queries";
import { setUserBranches } from "@/lib/services/access";
import { callsThisHour, countCall, resetClient } from "@/lib/myloans/client";
import { SYSTEM_ACTOR } from "@/lib/audit";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { POST as cronPost } from "@/app/api/cron/myloans-sync/route";
import { asUser, cleanLoans } from "./helpers";

const PN = "GD1652026901003"; // Angono, Renewal ₱1,000,000, Auto Financing: Mortgage, 4 transactions
const ANTIPOLO_PN = "GD1012026901001"; // Antipolo
const sys = { actor: SYSTEM_ACTOR, mode: "MANUAL" as const, trigger: "button" as const };
const SUP_A = "zz.sync.sup.angono@gdfi.ph", SUP_B = "zz.sync.sup.antipolo@gdfi.ph", APPR_A = "zz.sync.appr.angono@gdfi.ph";

let la: CurrentUser, dp: CurrentUser, admin: CurrentUser, supAngono: CurrentUser, supAntipolo: CurrentUser, apprAngono: CurrentUser;
let angono: string, antipolo: string;

async function makeUser(email: string, roleKey: string, branchIds: string[]) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const u = (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.create({ data: { email, name: email.split("@")[0], roleId: role.id, isTestUser: true } }));
  await prisma.user.update({ where: { id: u.id }, data: { roleId: role.id, active: true } });
  await setUserBranches(u.id, branchIds);
  return asUser(email);
}

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  angono = (await prisma.branch.findUniqueOrThrow({ where: { code: "165" } })).id;
  antipolo = (await prisma.branch.findUniqueOrThrow({ where: { code: "101" } })).id;
  supAngono = await makeUser(SUP_A, "SUP", [angono]);
  supAntipolo = await makeUser(SUP_B, "SUP", [antipolo]);
  // A branch-level approver: the Finance role (it approves funds) with Angono only.
  apprAngono = await makeUser(APPR_A, "FIN", [angono]);
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  vi.restoreAllMocks();
  await cleanLoans();
  for (const [k, v] of [["myloans.refreshOnOpenMinutes", 15], ["myloans.refreshOnFindHours", 4], ["myloans.maxPerRun", 50], ["myloans.pauseMs", 0], ["myloans.hourlyCeiling", 600]] as const) await setSetting(k, v);
  await setSetting("myloans.paused", false);
  await setSetting("myloans.businessHoursOnly", false);
  await setSetting("myloans.lastRun", null);
  await setSetting("myloans.state", { cursor: null, cap: null, runs: [] });
  await setSetting("myloans.mockOverrides", {});
  await setSetting("myloans.mockExtra", []);
  await setSetting("email.active", false);
  await prisma.user.updateMany({ where: { email: { in: [SUP_A, APPR_A] } }, data: { active: true } });
  resetClient();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await cleanLoans();
  await setSetting("myloans.paused", false);
  await setSetting("myloans.businessHoursOnly", true);
  await setSetting("myloans.mockOverrides", {});
  await setSetting("myloans.mockExtra", []);
  for (const email of [SUP_A, SUP_B, APPR_A]) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) continue;
    await prisma.userAccessGrant.deleteMany({ where: { userId: u.id } });
    await prisma.userBranch.deleteMany({ where: { userId: u.id } });
    await prisma.notification.deleteMany({ where: { userId: u.id } });
    await prisma.auditLog.updateMany({ where: { actorId: u.id }, data: { actorId: null } }).catch(() => null);
    await prisma.user.delete({ where: { id: u.id } }).catch(() => null);
  }
  await prisma.$disconnect();
});

const change = async (pn: string, over: Partial<MyLoansRecord>) => {
  const all = { ...(await getSetting("myloans.mockOverrides")) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: new Date().toISOString() };
  await setSetting("myloans.mockOverrides", all);
};
/** A loan with ticked papers, one sent transaction (PPSR) and one unsent one (Notary, papers ticked). */
async function setup(pn = PN) {
  await openLoanFile(la, { pn, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn } });
  const txn = (code: string) => prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  const notary = await txn("NOTARY");
  await saveChecklist(la, { transactionId: notary.id, checkedIds: notary.checks.map((c) => c.id), newOthers: [] });
  const ppsr = await txn("PPSR");
  await saveChecklist(la, { transactionId: ppsr.id, checkedIds: ppsr.checks.map((c) => c.id), newOthers: [] });
  const office = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, { transactionId: ppsr.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: office.id, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: ppsr.id } });
  return { loan, notary, ppsr, job, txn };
}
const openItems = (loanId: string) => prisma.sourceChange.findMany({ where: { loanId, state: "OPEN" } });

describe("1. Minor: area name corrected", () => {
  it("the copy updates, one Journey line, no review, no alert, no email", async () => {
    const { loan } = await setup();
    const notesBefore = await prisma.notification.count({ where: { loanId: loan.id } });
    await simulateSourceChange(admin, loan.id, "area");
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).sourceAreaName).toMatch(/\(corrected\)$/);
    expect(await prisma.auditLog.count({ where: { loanId: loan.id, action: "source_minor_updated" } })).toBe(1);
    expect(await openItems(loan.id)).toEqual([]);
    expect(await prisma.notification.count({ where: { loanId: loan.id } })).toBe(notesBefore);
    expect(await prisma.emailOutbox.count({ where: { loanId: loan.id, event: { in: ["source_changed", "borrower_changed"] } } })).toBe(0);
  });
});

describe("2. Material: amount raised across the mortgage threshold", () => {
  it("one item; Send held only where it reaches; the loan keeps the old amount; the review shows the rules' answer unsaved; read-only for LA and DP; amounts hidden", async () => {
    const { loan } = await setup();
    await simulateSourceChange(admin, loan.id, "amount");
    const items = await openItems(loan.id);
    expect(items).toHaveLength(1);
    expect(items[0].category).toBe("MATERIAL");
    expect(await sendBlockReason(prisma, loan.id, "MORTGAGE")).toBe(CHANGED_REASON);
    expect(await sendBlockReason(prisma, loan.id, "NOTARY")).toBeNull();
    const l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(Number(l.totalReleasedAmount)).toBe(1_000_000);
    expect(l.mortgageResult).toBe("MORTGAGE");
    const forAdmin = (await reviewFor(admin, loan.id))!;
    expect(forAdmin.canReview).toBe(true);
    expect(forAdmin.sentences.join(" ")).toMatch(/Mortgage is not needed: this is a Renewal loan above ₱1,000,000./);
    for (const u of [la, dp]) {
      const r = (await reviewFor(u, loan.id))!;
      expect(r.canReview).toBe(false);
      expect(r.rows.find((x) => x.label === "Amount")).toMatchObject({ hidden: true, was: "", now: "" });
    }
  });
});

describe("3. Borrower details", () => {
  it("name, address and contact in one change: one item, old and new; the loan keeps the old details; nothing blocked; read-only for LA and DP; the deciders are told without values", async () => {
    const { loan, job } = await setup();
    await setSetting("email.active", true);
    await change(PN, { borrowerName: "Ana Villanueva-Reyes", address: "12 Rizal Ave, Angono", contactNo: "09171234567" });
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ ok: true, outcome: "review", category: "BORROWER", borrower: true });
    const items = await openItems(loan.id);
    expect(items.map((i) => i.category)).toEqual(["BORROWER"]);
    const rows = (await borrowerReviewFor(supAngono, loan.id))!.rows;
    expect(rows.map((r) => [r.label, r.dms, r.myloans])).toEqual([["Name", "Ana Villanueva", "Ana Villanueva-Reyes"], ["Address", "blank", "12 Rizal Ave, Angono"], ["Contact number", "blank", "09171234567"]]);
    // The DMS keeps the old details everywhere until it is decided.
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).borrowerName).toBe("Ana Villanueva");
    // Nothing blocked: Send, Accept, funds.
    expect(await sendBlockReason(prisma, loan.id, "NOTARY")).toBeNull();
    expect(await cashBlockReason(prisma, loan.id)).toBeNull();
    const { acceptJob } = await import("@/lib/services/jobs");
    await acceptJob(dp, job.id);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("ACCEPTED");
    // What it means: sent work, and what accepting changes.
    const sup = (await borrowerReviewFor(supAngono, loan.id))!;
    expect(sup.sentences[0]).toMatch(/^Already sent or done: .*PPSR \(sent to a processor\)\. Their papers may carry the old details\.$/);
    expect(sup.sentences[1]).toBe("Accepting changes the details shown in the DMS. It does not change papers already prepared.");
    expect(sup).toMatchObject({ canDecide: true, toAdmin: false });
    // LA and DP see it read-only.
    for (const u of [la, dp]) expect((await borrowerReviewFor(u, loan.id))!).toMatchObject({ canDecide: false, waiting: "Waiting for review by your supervisor." });
    // A supervisor of another branch: cannot see or decide it.
    expect(await borrowerReviewFor(supAntipolo, loan.id)).toBeNull();
    await expect(acceptBorrowerCorrection(supAntipolo, sup.id, "Checked the ID card")).rejects.toThrow();
    // Told: the branch supervisor and approver (in-app); email field names only.
    const notes = await prisma.notification.findMany({ where: { loanId: loan.id, title: { contains: "borrower's details" } } });
    expect(new Set(notes.map((n) => n.userId))).toEqual(new Set([supAngono.id, apprAngono.id]));
    const mails = await prisma.emailOutbox.findMany({ where: { loanId: loan.id, event: "borrower_changed" } });
    expect(mails.length).toBeGreaterThan(0);
    for (const m of [...notes.map((n) => n.body), ...mails.map((x) => `${x.subject} ${x.text} ${x.html} ${x.headline}`)]) expect(m).not.toMatch(/Reyes|Rizal|0917/);
    // Chips: My loans, Home (the list), the "Already in the DMS" card; Home to-do of the deciders.
    expect((await listLoans(la, { tab: "all" })).find((r) => r.pn === PN)).toMatchObject({ borrowerChanged: true, sourceChanged: false });
    expect((await savedLoanCard(la, PN))!.borrowerChanged).toBe(true);
    expect((await borrowerToDo(supAngono)).items.map((i) => i.pn)).toEqual([PN]);
    expect((await borrowerToDo(supAntipolo)).count).toBe(0);
  });

  it("Accept the correction (supervisor): details update, one Journey line with old → new, audit with old and new, note 5 to 500", async () => {
    const { loan } = await setup();
    await change(PN, { borrowerName: "Ana Villanueva-Reyes", address: "12 Rizal Ave, Angono" });
    await refreshLoan(loan.id, sys);
    const id = (await borrowerReviewFor(supAngono, loan.id))!.id;
    await expect(acceptBorrowerCorrection(supAngono, id, "ok")).rejects.toThrow(/at least 5/);
    await expect(acceptBorrowerCorrection(la, id, "Checked the ID")).rejects.toThrow(/does not review/);
    await expect(keepCurrent(admin, id, "Admin path")).rejects.toThrow(/borrower details correction/);
    await acceptBorrowerCorrection(supAngono, id, "Checked the valid ID");
    const l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(l).toMatchObject({ borrowerName: "Ana Villanueva-Reyes", borrowerAddress: "12 Rizal Ave, Angono" });
    const a = await prisma.auditLog.findFirstOrThrow({ where: { loanId: loan.id, action: "borrower_details_corrected" } });
    expect(a.summary).toBe("Borrower details corrected: Name: Ana Villanueva → Ana Villanueva-Reyes; Address: blank → 12 Rizal Ave, Angono. Note: Checked the valid ID");
    expect(a).toMatchObject({ actorId: supAngono.id, before: { Name: "Ana Villanueva", Address: null }, after: { Name: "Ana Villanueva-Reyes", Address: "12 Rizal Ave, Angono" } });
    expect(await openItems(loan.id)).toEqual([]);
    // The same MyLoans value does not alert again.
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ outcome: "none" });
  });

  it("CIF alone, decided by an approver of the branch; Keep current remembers it; a different later change alerts again; a newer change updates the same item", async () => {
    const { loan } = await setup();
    await change(PN, { cif: "CIF-NEW-1" });
    await refreshLoan(loan.id, sys);
    let r = (await borrowerReviewFor(apprAngono, loan.id))!;
    expect(r.rows.map((x) => x.label)).toEqual(["CIF"]);
    // Two changes before anyone looks: one item, the earlier one in its history.
    await change(PN, { cif: "CIF-NEW-2" });
    await refreshLoan(loan.id, sys);
    expect(await openItems(loan.id)).toHaveLength(1);
    r = (await borrowerReviewFor(apprAngono, loan.id))!;
    expect(r).toMatchObject({ history: 1, rows: [{ label: "CIF", myloans: "CIF-NEW-2" }] });
    await keepBorrowerCurrent(apprAngono, r.id, "Branch file says the old CIF");
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).cif).toBe("CIF-551003");
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ outcome: "none" });
    expect(await openItems(loan.id)).toEqual([]);
    await change(PN, { cif: "CIF-NEW-3" });
    await refreshLoan(loan.id, sys);
    expect((await borrowerReviewFor(apprAngono, loan.id))!.rows[0]).toMatchObject({ dms: "CIF-551003", myloans: "CIF-NEW-3" });
  });

  it("no supervisor or approver in the branch: it goes to Admin (and the Admin Home count)", async () => {
    const { loan } = await setup();
    await prisma.user.updateMany({ where: { email: { in: [SUP_A, APPR_A] } }, data: { active: false } });
    await change(PN, { address: "1 New St" });
    await refreshLoan(loan.id, sys);
    const r = (await borrowerReviewFor(admin, loan.id))!;
    expect(r).toMatchObject({ toAdmin: true, canDecide: true });
    expect((await borrowerReviewFor(la, loan.id))!.waiting).toBe("No supervisor or approver in this branch. Admin reviews it.");
    const told = await prisma.notification.findMany({ where: { loanId: loan.id, title: { contains: "borrower's details" } } });
    expect(told.map((n) => n.userId)).toContain(admin.id);
    const { borrowerItemsForAdmin } = await import("@/lib/services/borrower-review");
    expect(await borrowerItemsForAdmin()).toBe(1);
  });

  it("a borrower change together with an amount change: two items (Admin's and the supervisor's)", async () => {
    const { loan } = await setup();
    await change(PN, { borrowerName: "Ana V. Cruz", totalReleasedAmount: 1_020_000 });
    await refreshLoan(loan.id, sys);
    expect((await openItems(loan.id)).map((i) => i.category).sort()).toEqual(["BORROWER", "MATERIAL"]);
    expect((await reviewFor(admin, loan.id))!.category).toBe("MATERIAL");
  });

  it("a copy saved before this change does not count as changed", async () => {
    const { loan } = await setup();
    // An older snapshot without tracked fields (payload only): the first refresh is not a change.
    await prisma.loanSourceSnapshot.updateMany({ where: { loanId: loan.id }, data: { tracked: Prisma.DbNull, hash: null } });
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ outcome: "none" });
    expect(await openItems(loan.id)).toEqual([]);
  });
});

describe("Part A.2: no name at all", () => {
  it("Open loan file is refused only when MyLoans has neither a name nor a company; the Admin data check lists it", async () => {
    await setSetting("myloans.noNameLoans", []);
    await change("GD1652026901004", { borrowerName: "  " });
    expect(await lookupPn(la, "GD1652026901004")).toMatchObject({ kind: "refused", field: "borrowerName", message: "MyLoans has no borrower name for this loan. Ask the MyLoans team to complete it." });
    await expect(openLoanFile(la, { pn: "GD1652026901004" })).rejects.toThrow(/no borrower name/);
    expect((await getSetting("myloans.noNameLoans")).map((x) => x.pn)).toEqual(["GD1652026901004"]);
    // A company-only borrower is fine (the composed name is the company). (A new answer: past the short cache.)
    await change("GD1652026901004", { borrowerName: "Rizal Trucking Corp." });
    resetClient();
    expect(await lookupPn(la, "GD1652026901004")).toMatchObject({ kind: "preview" });
  });
});

describe("4. Material: branch changed (Antipolo to Angono)", () => {
  it("access follows the old branch until Admin applies; then the Antipolo-only user loses it and the Angono-only user gains it", async () => {
    await openLoanFile(la, { pn: ANTIPOLO_PN });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: ANTIPOLO_PN } });
    const sees = async (u: CurrentUser) => !!(await prisma.loan.findFirst({ where: { pn: ANTIPOLO_PN, ...loanScope(u) } }));
    await change(ANTIPOLO_PN, { branchCode: "165", branchName: "Angono" });
    await refreshLoan(loan.id, sys);
    const item = (await openItems(loan.id))[0];
    expect(item.category).toBe("MATERIAL");
    expect([await sees(supAntipolo), await sees(supAngono)]).toEqual([true, false]);
    expect((await reviewFor(admin, loan.id))!.branchMove).toMatchObject({ from: "Antipolo", to: "Angono", known: true });
    await applySourceChange(admin, item.id, { note: "Moved in MyLoans" });
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).branchId).toBe(angono);
    expect([await sees(supAntipolo), await sees(supAngono)]).toEqual([false, true]);
  });
});

describe("5. Status: cancelled or not released", () => {
  it("Send and new cash requests blocked for the whole loan; open processor jobs unaffected until Admin decides", async () => {
    const { loan, job } = await setup();
    await simulateSourceChange(admin, loan.id, "cancel");
    expect((await openItems(loan.id))[0].category).toBe("STATUS");
    for (const code of ["NOTARY", "PPSR", "MORTGAGE", "EDST"]) expect(await sendBlockReason(prisma, loan.id, code)).toBe(CANCELLED_REASON);
    expect(await cashBlockReason(prisma, loan.id)).toBe(CANCELLED_REASON);
    const notary = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "NOTARY" } } });
    await expect(requestAdvance(dp, { lines: [{ transactionId: notary.id, kind: "TRANSPORT", cents: 10_000 }] })).rejects.toThrow();
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING_ACCEPTANCE");
  });
});

describe("6. Replacement PN: only suggested, a person links", () => {
  const base = (pn: string, over: Partial<MyLoansRecord>): MyLoansRecord => ({
    pn, cin: null, cif: null, sourceLoanId: `ML-${pn}`, borrowerName: "Ana Villanueva", branchName: "Angono", branchCode: "165", status: "RELEASED", statusId: "12", statusName: "Loan Released",
    loanType: "Renewal", productName: "Auto Financing", totalReleasedAmount: 1_000_000, releaseDate: new Date().toISOString().slice(0, 10), ...over,
  });

  it("MyLoans names the old PN: the old loan gets the review with the suggestion; nothing is linked until Link as replacement with a note", async () => {
    const t0 = new Date();
    const { loan: old } = await setup();
    await setSetting("myloans.mockExtra", [base("GD1652026909101", { cin: "CIN-NEW-9101", cif: "CIF-551003", previousPn: PN })]);
    await change(PN, { ...{ status: "STATUS_14", statusId: "14", statusName: "Cancelled" } });
    await refreshLoan(old.id, sys);
    await openLoanFile(la, { pn: "GD1652026909101", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const [o, n] = await Promise.all([prisma.loan.findUniqueOrThrow({ where: { pn: PN } }), prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026909101" } })]);
    expect([o.replacedByPn, n.replacesPn]).toEqual([null, null]);
    const item = (await openItems(old.id)).find((i) => i.category !== "BORROWER")!;
    expect(item.candidates).toContain("GD1652026909101");
    expect(await prisma.auditLog.count({ where: { action: "replacement_linked", pn: { in: [PN, "GD1652026909101"] }, at: { gte: t0 } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "replacement_suggested", pn: "GD1652026909101" } })).toBeGreaterThan(0);
    await expect(linkReplacement(admin, item.id, { newPn: "GD1652026909101", note: "", confirmNoPayment: true })).rejects.toThrow(/short note/);
    await linkReplacement(admin, item.id, { newPn: "GD1652026909101", note: "Same unit, new PN", confirmNoPayment: true });
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: PN } })).replacedByPn).toBe("GD1652026909101");
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026909101" } })).replacesPn).toBe(PN);
  });

  it("two new PNs with the same CIF as one cancelled loan: both suggested, none linked", async () => {
    const { loan: old } = await setup();
    await setSetting("myloans.mockExtra", [
      base("GD1652026909201", { cin: "CIN-NEW-9201", cif: "CIF-551003" }),
      base("GD1652026909202", { cin: "CIN-NEW-9202", cif: "CIF-551003" }),
    ]);
    await change(PN, { status: "STATUS_14", statusId: "14", statusName: "Cancelled" });
    await refreshLoan(old.id, sys);
    for (const pn of ["GD1652026909201", "GD1652026909202"]) await openLoanFile(la, { pn, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const item = (await openItems(old.id)).find((i) => i.category === "STATUS")!;
    expect([...item.candidates].sort()).toEqual(["GD1652026909201", "GD1652026909202"]);
    expect(await prisma.loan.count({ where: { OR: [{ replacesPn: { not: null } }, { replacedByPn: { not: null } }] } })).toBe(0);
  });

  it("two borrowers with the same name but different CIFs and CINs: never suggested", async () => {
    const { loan: old } = await setup();
    await setSetting("myloans.mockExtra", [base("GD1652026909301", { cin: "CIN-OTHER", cif: "CIF-OTHER" })]);
    await change(PN, { status: "STATUS_14", statusId: "14", statusName: "Cancelled" });
    await refreshLoan(old.id, sys);
    await openLoanFile(la, { pn: "GD1652026909301", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    const item = (await openItems(old.id)).find((i) => i.category === "STATUS")!;
    expect(item.candidates).toEqual([]);
    expect((await reviewFor(admin, old.id))!.candidates).toEqual([]);
  });
});

describe("7. Two changes in a row before Admin looks", () => {
  it("one open item, updated, with the earlier change in its history", async () => {
    const { loan } = await setup();
    await change(PN, { totalReleasedAmount: 1_020_000 });
    await refreshLoan(loan.id, sys);
    await change(PN, { totalReleasedAmount: 1_040_000 });
    await refreshLoan(loan.id, sys);
    const items = await openItems(loan.id);
    expect(items).toHaveLength(1);
    expect((items[0].history as unknown[]).length).toBe(1);
  });
});

describe("8. Admin decisions need a note (Apply, Keep current)", () => {
  it("Apply: unsent removed, ticked papers stay ticked, sent job untouched", async () => {
    const { loan, notary, job } = await setup();
    await change(PN, { productName: "Auto Refinancing" });
    await refreshLoan(loan.id, sys);
    const item = (await openItems(loan.id))[0];
    await expect(applySourceChange(admin, item.id, { note: "" })).rejects.toThrow(/short note/);
    await expect(keepCurrent(admin, item.id, "")).rejects.toThrow(/short note/);
    await applySourceChange(admin, item.id, { note: "Product corrected" });
    expect((await prisma.sourceChange.findUniqueOrThrow({ where: { id: item.id } })).state).toBe("APPLIED");
    expect((await prisma.checklistCheck.findMany({ where: { transactionId: notary.id } })).every((c) => c.checked)).toBe(true);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING_ACCEPTANCE");
  });
});

describe("9. MyLoans does not answer", () => {
  it("Not current, nothing blocked, no review opened", async () => {
    const { loan } = await setup();
    await setSetting("myloans.simulateUnavailable", true);
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ ok: false });
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).sourceCurrent).toBe(false);
    expect(await openItems(loan.id)).toEqual([]);
    expect(await sendBlockReason(prisma, loan.id, "NOTARY")).toBeNull();
    await setSetting("myloans.simulateUnavailable", false);
  });
});

describe("10. No change", () => {
  it("no snapshot saved, only the last-checked time moves, the button says No changes", async () => {
    const { loan } = await setup();
    const before = await prisma.loanSourceSnapshot.count({ where: { loanId: loan.id } });
    const t0 = (await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).lastCheckedAt!;
    await new Promise((r) => setTimeout(r, 5));
    expect(await refreshFromMyLoans(la, loan.id)).toEqual({ ok: true, changed: false, minor: false });
    expect(await prisma.loanSourceSnapshot.count({ where: { loanId: loan.id } })).toBe(before);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).lastCheckedAt!.getTime()).toBeGreaterThan(t0.getTime());
  });
});

describe("11. Refresh paths, the pause switch, limits", () => {
  let calls: MockInstance[] = [];
  const count = () => calls.reduce((n, s) => n + s.mock.calls.length, 0);
  const spy = () => { const a = getMyLoansAdapter(); calls = [vi.spyOn(a, "getByPn"), vi.spyOn(a, "getChangedSince"), vi.spyOn(a, "search")]; };

  it("paused: the background run, the stale refresh and refresh on open make zero calls; the button and a new-PN Find still call; audited; noted; Admin only", async () => {
    const t0 = new Date();
    const { loan } = await setup();
    await prisma.loan.update({ where: { id: loan.id }, data: { lastCheckedAt: new Date(Date.now() - 6 * 3_600_000), nextCheckAt: new Date(Date.now() - 60_000) } });
    await expect(setMyLoansPaused(la, true)).rejects.toThrow(/Ask an Admin/);
    await expect(setMyLoansPaused(supAngono, true)).rejects.toThrow(/Ask an Admin/);
    await setMyLoansPaused(admin, true);
    expect(await prisma.auditLog.count({ where: { action: "myloans_paused", actorId: admin.id, at: { gte: t0 } } })).toBe(1);
    resetClient();
    spy();
    expect(await runMyLoansSync({ trigger: "cron" })).toEqual({ ran: false, reason: PAUSED_BY_ADMIN });
    expect(await runMyLoansSync({ trigger: "script", force: true })).toEqual({ ran: false, reason: PAUSED_BY_ADMIN });
    expect(await refreshFoundLoan(la, PN)).toMatchObject({ called: false });
    expect(await refreshOnOpen(await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } }))).toBeNull();
    expect(count()).toBe(0);
    const state = await getSetting("myloans.state");
    expect(state.runs[0]).toMatchObject({ status: "paused", byAdmin: true, error: PAUSED_BY_ADMIN });
    expect((await (await import("@/lib/services/source-sync")).syncStatus()).health).toBe("Paused by Admin: MyLoans calls are paused");
    // A person asked: the button and a new-PN lookup still call MyLoans.
    await refreshFromMyLoans(la, loan.id);
    expect(count()).toBe(1);
    await lookupPn(la, "GD1652026901004");
    expect(count()).toBe(2);
    await setMyLoansPaused(admin, false);
    expect(await prisma.auditLog.count({ where: { action: "myloans_paused", at: { gte: t0 } } })).toBe(2);
  });

  it("refresh on open and the stale refresh skip closed and cancelled loans; every run is audited; a wrong secret is refused", async () => {
    const { loan } = await setup();
    await prisma.loan.update({ where: { id: loan.id }, data: { cancelledAt: new Date(), lastCheckedAt: new Date(Date.now() - 6 * 3_600_000) } });
    spy();
    expect(await refreshOnOpen(await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } }))).toBeNull();
    expect(await refreshFoundLoan(la, PN)).toMatchObject({ called: false });
    expect(count()).toBe(0);
    await runMyLoansSync({ trigger: "script", force: true });
    await runSyncNow(admin);
    expect(await prisma.auditLog.count({ where: { action: "myloans_sync_run", summary: { startsWith: "The console script ran" } } })).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: "myloans_sync_run", actorId: admin.id } })).toBeGreaterThan(0);
    process.env.CRON_SECRET = "a-long-test-secret-123456";
    const wrong = await cronPost(new NextRequest("http://localhost/api/cron/myloans-sync", { method: "POST", headers: { "x-cron-secret": "wrong-secret-0000000000" } }));
    expect(wrong.status).toBe(401);
    const right = await cronPost(new NextRequest("http://localhost/api/cron/myloans-sync", { method: "POST", headers: { "x-cron-secret": "a-long-test-secret-123456" } }));
    expect(right.status).toBe(200);
  });

  it("two runs at once do not overlap (advisory lock)", async () => {
    await setup();
    const [a, b] = await Promise.all([runMyLoansSync({ trigger: "script", force: true, sleep: () => new Promise((r) => setTimeout(r, 50)) }), runMyLoansSync({ trigger: "script", force: true })]);
    const reasons = [a, b].filter((r) => !r.ran).map((r) => (r as { reason: string }).reason);
    expect(reasons.length).toBeLessThanOrEqual(1);
    if (reasons.length) expect(reasons[0]).toBe("Another MyLoans sync is running.");
  });

  it("Find a loan for an unsaved PN: the hourly limit or the circuit breaker gives 'MyLoans is busy', never 'not found'", async () => {
    await setSetting("myloans.hourlyCeiling", 10);
    for (let i = await callsThisHour(); i < 10; i++) await countCall();
    spy();
    expect(await lookupPn(la, "GD1652026901004")).toEqual({ kind: "unavailable", pn: "GD1652026901004", message: MYLOANS_BUSY, busy: true });
    expect(count()).toBe(0);
    resetClient();
    await setSetting("myloans.hourlyCeiling", 600);
    const a = getMyLoansAdapter() as unknown as { breakerState: () => Promise<{ open: boolean }> };
    vi.spyOn(a, "breakerState").mockResolvedValue({ open: true } as never);
    expect(await lookupPn(la, "GD1012026999999")).toMatchObject({ kind: "unavailable", busy: true, message: MYLOANS_BUSY });
  });

  it("the default for refresh on open is 60 minutes", async () => {
    const { SETTING_DEFAULTS } = await import("@/lib/settings");
    expect(SETTING_DEFAULTS["myloans.refreshOnOpenMinutes"]).toBe(60);
  });
});

describe("12. Notifications", () => {
  it("Material, Status, Replacement: in-app to Admin, the branch LA and the DP, never amounts; email only when the master switch is on", async () => {
    const { loan } = await setup();
    await setSetting("email.active", false);
    await change(PN, { totalReleasedAmount: 1_020_000 });
    await refreshLoan(loan.id, sys);
    const notes = await prisma.notification.findMany({ where: { loanId: loan.id, title: { contains: "MyLoans changed this loan" } } });
    expect(new Set(notes.map((n) => n.userId))).toEqual(new Set([admin.id, la.id, dp.id]));
    expect(notes.every((n) => !/₱|1,020,000/.test(n.body))).toBe(true);
    const out = await prisma.emailOutbox.findMany({ where: { loanId: loan.id, event: "source_changed" } });
    // The outbox records it; with the master switch off nothing is sent.
    expect(out.every((m) => m.status !== "SENT")).toBe(true);
    // Minor changes tell no one.
    const n0 = await prisma.notification.count();
    await change(PN, { areaName: "Somewhere else" });
    await refreshLoan(loan.id, sys);
    expect(await prisma.notification.count()).toBe(n0);
  });
});

describe("13. Chips and lists", () => {
  it("'MyLoans changed' on My loans and the Already in the DMS card; the Admin Home count", async () => {
    const { loan } = await setup();
    await change(PN, { totalReleasedAmount: 1_020_000 });
    await refreshLoan(loan.id, sys);
    expect((await listLoans(la, { tab: "all" })).find((r) => r.pn === PN)!.sourceChanged).toBe(true);
    expect((await savedLoanCard(la, PN))!.changed).toBe(true);
    expect(await prisma.sourceChange.count({ where: { state: "OPEN", category: { not: "BORROWER" } } })).toBe(1);
  });
});

describe("Permissions: the new tick", () => {
  it("myloans:review_borrower is on for the Branch Supervisor, Admin and the funds approvers; never by role name", async () => {
    const roles = await prisma.role.findMany({ where: { key: { in: ["SUP", "ADMIN", "FIN", "LA", "DP"] } } });
    const has = (k: string) => roles.find((r) => r.key === k)!.permissions.includes(PERMISSIONS.SOURCE_REVIEW_BORROWER);
    expect(["SUP", "ADMIN", "FIN"].map(has)).toEqual([true, true, true]);
    expect(["LA", "DP"].map(has)).toEqual([false, false]);
  });
});

import { Prisma } from "@prisma/client";
