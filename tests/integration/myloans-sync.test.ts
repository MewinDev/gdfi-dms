/**
 * MyLoans sync: refresh rules, change detection and review items, Apply / Keep / Close as cancelled,
 * replacement PNs, reusable papers, moving cash, Find loan at scale. LOCAL database, mock MyLoans.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { lookupPn, openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob } from "@/lib/services/jobs";
import { decideAdvance, requestAdvance } from "@/lib/services/funds";
import {
  applySourceChange, closeAsCancelled, copyReusablePapers, keepCurrent, linkReplacement, moveCashToNewPn, outstandingCash, refreshLoan, refreshOnOpen,
  reusablePapers, sameBorrowerLoans, simulateSourceChange,
} from "@/lib/services/source-sync";
import { cashBlockReason, sendBlockReason, CANCELLED_REASON, CHANGED_REASON } from "@/lib/services/source-blocks";
import { reviewFor } from "@/lib/services/source-review";
import { sampleLoans } from "@/lib/myloans/samples";
import { samplesForUser } from "@/lib/ui/samples";
import { resetClient } from "@/lib/myloans/client";
import { SYSTEM_ACTOR } from "@/lib/audit";
import { resetLoanData } from "@/lib/test-data/reset-core";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser, admin: CurrentUser, fin: CurrentUser;
const PN = "GD1652026901003"; // Angono, Renewal, ₱1,000,000, Auto Financing: Mortgage (4 transactions)
const sys = { actor: SYSTEM_ACTOR, mode: "MANUAL" as const, trigger: "button" as const };

beforeAll(async () => {
  // This file counts exactly who is told: the seeded LA Supervisor/Head is parked (afterAll restores).
  await prisma.user.updateMany({ where: { email: "test.lahead@gdfi.ph" }, data: { active: false } });
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  await cleanLoans();
  await setSetting("myloans.refreshOnOpenMinutes", 15);
  resetClient();
});
afterAll(async () => {
  await cleanLoans();
  await prisma.user.updateMany({ where: { email: "test.lahead@gdfi.ph" }, data: { active: true } });
  await prisma.$disconnect();
});

const change = async (pn: string, over: Partial<MyLoansRecord>) => {
  const all = { ...(await getSetting("myloans.mockOverrides")) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: new Date().toISOString() };
  await setSetting("myloans.mockOverrides", all);
};
async function open(pn = PN) {
  await openLoanFile(la, { pn, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn } });
  const txn = (code: string) => prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code } }, include: { checks: true } });
  return { loan, txn };
}
async function send(loan: { branchId: string }, t: { id: string; checks: { id: string }[] }, funds: "YES" | "NO" = "NO") {
  await saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.map((c) => c.id), newOthers: [] });
  const office = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, { transactionId: t.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: office.id, fundsNeeded: funds, fundsKinds: funds === "YES" ? ["TRANSPORT"] : [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
  return prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: t.id } });
}
const item = (loanId: string) => prisma.sourceChange.findFirstOrThrow({ where: { loanId }, orderBy: { firstSeenAt: "desc" } });

describe("Refresh rules", () => {
  it("on open only when older than N minutes (0 = always); an outage keeps the last copy and blocks nothing", async () => {
    const { loan } = await open();
    expect(await refreshOnOpen(loan)).toBeNull(); // just checked
    await setSetting("myloans.refreshOnOpenMinutes", 0);
    expect(await refreshOnOpen(loan)).toMatchObject({ ok: true, outcome: "none" });
    await setSetting("myloans.simulateUnavailable", true);
    try {
      const r = await refreshLoan(loan.id, sys);
      expect(r).toMatchObject({ ok: false, message: "MyLoans did not answer. Try again in a moment." });
      const l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
      expect(l).toMatchObject({ sourceCurrent: false, lastRefreshError: "MyLoans did not answer. Try again in a moment." });
      expect(l.lastCheckedAt!.getTime()).toBeGreaterThan(l.retrievedAt.getTime() - 1);
      expect(await sendBlockReason(prisma, loan.id, "NOTARY")).toBeNull();
      expect(await cashBlockReason(prisma, loan.id)).toBeNull();
    } finally {
      await setSetting("myloans.simulateUnavailable", false);
    }
  });
  // The sync itself (API 2, the catch-up, the lock, the run log, its settings): myloans-sync-run.test.ts (piece 7).
});

describe("Changes and the review item", () => {
  it("minor: the copy is updated, no alert (the borrower's own details are a review: sync-check.test.ts)", async () => {
    const { loan } = await open();
    await change(PN, { areaName: "LUZON 1 (corrected)", divisionName: "Branch Division 2" });
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ ok: true, outcome: "minor" });
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).sourceAreaName).toBe("LUZON 1 (corrected)");
    expect(await prisma.sourceChange.count({ where: { loanId: loan.id } })).toBe(0);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "source_minor_updated", loanId: loan.id } })).summary).toBe("MyLoans updated the loan's area and division");
  });

  it("material: one item, Send held only where the change reaches, Apply refused for sent work, Keep current does not re-alert; newer change updates the same item", async () => {
    const { loan, txn } = await open();
    await send(loan, await txn("PPSR"));
    await change(PN, { totalReleasedAmount: 1_020_000 });
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ ok: true, outcome: "review", category: "MATERIAL" });
    const it1 = await item(loan.id);
    expect(it1).toMatchObject({ state: "OPEN", category: "MATERIAL" });
    expect((it1.proposed as { removed: string[] }).removed).toEqual(["PPSR", "MORTGAGE"]);
    expect(await sendBlockReason(prisma, loan.id, "MORTGAGE")).toBe(CHANGED_REASON);
    expect(await sendBlockReason(prisma, loan.id, "NOTARY")).toBeNull();
    // Notified: Admin, the branch LA, the processor on it (no amounts in the words).
    const notes = await prisma.notification.findMany({ where: { loanId: loan.id, title: { contains: "MyLoans changed" } } });
    expect(new Set(notes.map((n) => n.userId))).toEqual(new Set([admin.id, la.id, dp.id]));
    expect(notes.every((n) => !/₱|1,020,000/.test(n.body))).toBe(true);
    expect(await prisma.emailOutbox.count({ where: { event: "source_changed", loanId: loan.id } })).toBeGreaterThan(0);
    // Amounts only for people who may see them.
    expect((await reviewFor(la, loan.id))!.rows.find((r) => r.label === "Amount")).toMatchObject({ hidden: true, was: "", now: "" });
    expect((await reviewFor(admin, loan.id))!.rows.find((r) => r.label === "Amount")).toMatchObject({ hidden: false, was: "₱1,000,000", now: "₱1,020,000" });
    expect((await reviewFor(la, loan.id))!.canReview).toBe(false);
    // A newer change while open: the same item, earlier one in its history.
    await change(PN, { totalReleasedAmount: 1_050_000, loanType: "Renewal" });
    await refreshLoan(loan.id, sys);
    expect(await prisma.sourceChange.count({ where: { loanId: loan.id } })).toBe(1);
    const it2 = await item(loan.id);
    expect((it2.history as unknown[]).length).toBe(1);
    expect((it2.changes as { field: string; was: number; now: number }[]).find((c) => c.field === "amount")).toMatchObject({ was: 100_000_000, now: 105_000_000 });
    // Apply never changes sent work; LA and DP cannot decide.
    await expect(applySourceChange(admin, it2.id, { note: "Checked with MyLoans" })).rejects.toThrow(/PPSR: sent to Test Document Processor, waiting to accept\. Apply never changes work that was sent/);
    await expect(keepCurrent(la, it2.id, "x note")).rejects.toThrow(/Only approvers review/);
    await expect(keepCurrent(dp, it2.id, "x note")).rejects.toThrow(/Only approvers review/);
    await expect(keepCurrent(admin, it2.id, "")).rejects.toThrow(/short note/);
    await keepCurrent(admin, it2.id, "client confirmed by phone");
    expect((await item(loan.id)).state).toBe("KEPT");
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "source_change_kept", loanId: loan.id }, orderBy: [{ at: "desc" }, { id: "desc" }] })).summary).toBe("MyLoans changed Amount. Admin Test Admin kept the current setup: client confirmed by phone");
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ outcome: "none" });
    expect(await prisma.sourceChange.count({ where: { loanId: loan.id } })).toBe(1);
    expect(await sendBlockReason(prisma, loan.id, "MORTGAGE")).toBeNull();
  });

  it("Apply: unsent transactions removed and added back; ticked papers stay ticked", async () => {
    const { loan, txn } = await open();
    const mortgage = await txn("MORTGAGE");
    await saveChecklist(la, { transactionId: mortgage.id, checkedIds: [mortgage.checks[0].id], newOthers: [] });
    await change(PN, { totalReleasedAmount: 1_020_000 });
    await refreshLoan(loan.id, sys);
    await applySourceChange(admin, (await item(loan.id)).id, { note: "MyLoans corrected the amount" });
    let l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id }, include: { transactions: { include: { type: true } } } });
    expect(l).toMatchObject({ mortgageResult: "NOT_MORTGAGE" });
    expect(Number(l.totalReleasedAmount)).toBe(1_020_000);
    expect(l.transactions.filter((t) => t.status === "CANCELLED").map((t) => t.type.code).sort()).toEqual(["MORTGAGE", "PPSR"]);
    expect(await prisma.loanTransaction.count({ where: { loanId: loan.id } })).toBe(4); // nothing deleted
    await change(PN, { totalReleasedAmount: 900_000 });
    await refreshLoan(loan.id, sys);
    expect(((await item(loan.id)).proposed as { added: string[] }).added).toEqual(["PPSR", "MORTGAGE"]);
    await applySourceChange(admin, (await item(loan.id)).id, { note: "Back to the first amount" });
    l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id }, include: { transactions: { include: { type: true } } } });
    expect(l.transactions.every((t) => t.status !== "CANCELLED")).toBe(true);
    expect((await prisma.checklistCheck.findUniqueOrThrow({ where: { id: mortgage.checks[0].id } })).checked).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "source_change_applied", loanId: loan.id } })).toBe(2);
  });

  it("Close as cancelled: blocks Send and cash, needs a note, refused while cash is out, stops processor jobs, deletes nothing", async () => {
    const { loan, txn } = await open();
    const job = await send(loan, await txn("NOTARY"), "YES");
    await acceptJob(dp, job.id);
    const notary = await txn("NOTARY");
    const adv = await requestAdvance(dp, { lines: [{ transactionId: notary.id, kind: "TRANSPORT", cents: 50_000 }] });
    await change(PN, { status: "CANCELLED" });
    await refreshLoan(loan.id, sys);
    const it1 = await item(loan.id);
    expect(it1.category).toBe("STATUS");
    expect(await sendBlockReason(prisma, loan.id, "PPSR")).toBe(CANCELLED_REASON);
    expect(await cashBlockReason(prisma, loan.id)).toBe(CANCELLED_REASON);
    await expect(applySourceChange(admin, it1.id, { note: "Not for this one" })).rejects.toThrow(/Apply is for changes/);
    await expect(closeAsCancelled(admin, it1.id, "")).rejects.toThrow(/short note/);
    expect((await outstandingCash(prisma, loan.id)).map((c) => c.notReleased)).toEqual([true]);
    await expect(closeAsCancelled(admin, it1.id, "MyLoans cancelled it")).rejects.toThrow(/Cash is still out/);
    await prisma.cashAdvance.update({ where: { id: adv.id }, data: { status: "DENIED" } });
    await closeAsCancelled(admin, it1.id, "MyLoans cancelled it");
    const l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(l).toMatchObject({ cancelReason: "Cancelled in MyLoans", stage: "Cancelled in MyLoans" });
    expect(await prisma.loanTransaction.count({ where: { loanId: loan.id, status: "CANCELLED" } })).toBe(4);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PULLED_BACK");
    expect(await prisma.notification.count({ where: { userId: dp.id, title: { contains: "Notary stopped" } } })).toBe(1);
    expect(await prisma.documentItem.count({ where: { loanId: loan.id } })).toBeGreaterThan(0);
  });
});

describe("Replacement PN", () => {
  it("simulated replacement; opening the new PN links both; duplicate warning; reusable papers copied with custody; cash moved through the approval band; old closed as replaced", async () => {
    const { loan: old, txn } = await open();
    const notary = await txn("NOTARY");
    await saveChecklist(la, { transactionId: notary.id, checkedIds: notary.checks.map((c) => c.id), newOthers: [] });
    // Cash still out on the old PN (released).
    const adv = await prisma.cashAdvance.create({
      data: {
        number: "CA-2026-9001", requestedById: dp.id, branchId: old.branchId, status: "RELEASED", requestedCents: 50_000, approvedCents: 50_000, releasedCents: 50_000, releasedAt: new Date(), liquidationDueAt: new Date(Date.now() + 5 * 86_400_000),
        lines: { create: { transactionId: notary.id, kind: "TRANSPORT", requestedCents: 50_000, approvedCents: 50_000, releasedCents: 50_000 } },
      },
      include: { lines: true },
    });
    const msg = await simulateSourceChange(admin, old.id, "replace");
    const newPn = /now has (GD\d{13})/.exec(msg)![1];
    expect((await item(old.id)).category).toBe("STATUS");
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "source_change_detected", loanId: old.id } })).mode).toBe("SIMULATED");
    // Find loan: the new PN warns about the other open loan of the same borrower.
    const preview = await lookupPn(la, newPn);
    expect(preview).toMatchObject({ kind: "preview", replacesPn: PN }); // a redo: the same CIN, the old copy replaced (D-051)
    await openLoanFile(la, { pn: newPn, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
    // Only a suggestion: nothing is linked until Admin presses Link as replacement (with a note).
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: newPn } })).replacesPn).toBeNull();
    const it1 = await item(old.id);
    expect(it1).toMatchObject({ state: "OPEN", category: "REPLACEMENT", candidates: expect.arrayContaining([newPn]) });
    await linkReplacement(admin, it1.id, { newPn, note: "MyLoans gave the unit a new PN", confirmNoPayment: true });
    const nw = await prisma.loan.findUniqueOrThrow({ where: { pn: newPn } });
    expect(nw.replacesPn).toBe(PN);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: old.id } })).replacedByPn).toBe(newPn);
    expect((await sameBorrowerLoans(prisma, old)).map((l) => l.pn)).toContain(newPn);
    // Reusable papers: valid IDs only (unit papers never), each confirmed; custody on both.
    const options = await reusablePapers(prisma, nw.id);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => /Valid ID|Special Power/.test(o.label))).toBe(true);
    await expect(copyReusablePapers(la, nw.id, [options[0].fromCheckId])).rejects.toThrow(/Only approvers/);
    const unit = notary.checks.find((c) => !options.some((o) => o.fromCheckId === c.id))!;
    await expect(copyReusablePapers(admin, nw.id, [unit.id])).rejects.toThrow(/belong to the borrower/);
    await copyReusablePapers(admin, nw.id, [options[0].fromCheckId]);
    expect((await prisma.checklistCheck.findUniqueOrThrow({ where: { id: options[0].toCheckId } })).checked).toBe(true);
    expect(await prisma.documentMovement.count({ where: { action: "REASSIGNED", remarks: `Reassigned to ${newPn}` } })).toBe(1);
    expect(await prisma.documentMovement.count({ where: { action: "REASSIGNED", remarks: { startsWith: `Reassigned from ${PN}` } } })).toBe(1);
    // Cash: Move to the new PN waits for the approval band; approved, the old line is handed over.
    await expect(closeAsCancelled(admin, it1.id, "Replaced")).rejects.toThrow(/Cash is still out/);
    const r = await moveCashToNewPn(admin, it1.id, adv.lines[0].id);
    const moved = await prisma.cashAdvance.findUniqueOrThrow({ where: { number: r.number } });
    expect(moved).toMatchObject({ status: "REQUESTED", movedFromLineId: adv.lines[0].id, requestedCents: 50_000 });
    await decideAdvance(fin, moved.id, { approve: true, lines: [], note: "" });
    expect(await prisma.cashAdvance.findUniqueOrThrow({ where: { id: moved.id } })).toMatchObject({ status: "RELEASED", releasedCents: 50_000 });
    expect(await outstandingCash(prisma, old.id)).toEqual([]);
    await closeAsCancelled(admin, it1.id, "Unit changed: new PN given");
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: old.id } })).cancelReason).toBe(`Replaced by ${newPn}`);
  });
});

describe("Find loan and the simulator", () => {
  it("the sample loans: only those in the person's branches (all for All branches)", async () => {
    // Find loan itself (typing, the button) is tested in find-local.test.ts.
    const samples = sampleLoans(true);
    expect(samplesForUser(samples, { scopeBranchIds: ["x"], branchNames: ["Angono"], branchCodes: ["165"] }).map((x) => x.pn)).toEqual(["GD1652026901003", "GD1652026901004"]);
    expect(samplesForUser(samples, { scopeBranchIds: null, branchNames: [], branchCodes: [] })).toHaveLength(3);
  });

  it("every simulated change works and is labelled; Reset test data clears the copies, changes and simulated source", async () => {
    const { loan } = await open();
    expect(await simulateSourceChange(admin, loan.id, "name")).toMatch(/spells the borrower's name/);
    expect(await simulateSourceChange(admin, loan.id, "amount")).toMatch(/amount is ₱/);
    expect((await item(loan.id)).category).toBe("MATERIAL");
    expect(await simulateSourceChange(admin, loan.id, "product")).toMatch(/product is Auto Refinancing/);
    expect(await simulateSourceChange(admin, loan.id, "cancel")).toMatch(/cancelled/);
    expect((await item(loan.id)).category).toBe("STATUS");
    await expect(simulateSourceChange(la, loan.id, "cancel")).rejects.toThrow(/does not allow the simulator/);
    expect(await prisma.auditLog.count({ where: { loanId: loan.id, mode: "SIMULATED", action: { in: ["source_change_detected", "source_minor_updated"] } } })).toBeGreaterThan(1);
    await prisma.$transaction((tx) => resetLoanData(tx), { timeout: 60_000 });
    expect(await prisma.sourceChange.count()).toBe(0);
    expect(await prisma.loanSourceSnapshot.count()).toBe(0);
    expect(await getSetting("myloans.mockOverrides")).toEqual({});
    expect(await getSetting("myloans.mockExtra")).toEqual([]);
  });
});

describe("MyLoans account details (docs/myloans/field-map.md)", () => {
  it("a loan opened from the sample MyLoans stores all 15 items, and the snapshot keeps them", async () => {
    const { loan } = await open();
    expect(loan).toMatchObject({
      pn: PN, sourceLoanId: "ML-202600003", cin: "CIN-771003", cif: "CIF-551003", borrowerName: "Ana Villanueva", loanType: "Renewal",
      productName: "Auto Financing", productCode: "AF-001", sourceBranchCode: "165", sourceBranchName: "Angono",
      sourceAreaId: "1", sourceAreaName: "LUZON 1 (NGMA + RIZAL)", sourceDivisionId: "1", sourceDivisionName: "Branch Division",
      sourceCompanyId: "1", sourceCompanyName: "Global Dominion Financing Inc.", sourceStatusId: "12", sourceStatusName: "Loan Released",
      sourceIsActive: true, source: "MyLoans",
    });
    expect(Number(loan.totalReleasedAmount)).toBe(1_000_000);
    expect(loan.releasedAt).toBeInstanceOf(Date);
    expect(loan.sourceUpdatedAt).toBeInstanceOf(Date);
    const snap = await prisma.loanSourceSnapshot.findFirstOrThrow({ where: { loanId: loan.id } });
    expect(snap.source).toBe("MyLoans");
    expect(snap.tracked).toMatchObject({ sourceLoanId: "ML-202600003", productCode: "AF-001", areaId: "1", areaName: "LUZON 1 (NGMA + RIZAL)", divisionId: "1", companyId: "1", companyName: "Global Dominion Financing Inc.", statusId: "12", statusName: "Loan Released", isActive: "Yes" });
    expect((snap.payload as { loan: Record<string, unknown> }).loan).toMatchObject({ divisionName: "Branch Division", sourceUpdatedAt: expect.any(String) });
  });

  it("a changed area name is Minor: the copy is updated, no review, plain words", async () => {
    const { loan } = await open();
    await change(PN, { areaName: "LUZON 1 - RIZAL" });
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ ok: true, outcome: "minor", category: "MINOR" });
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).sourceAreaName).toBe("LUZON 1 - RIZAL");
    expect(await prisma.sourceChange.count({ where: { loanId: loan.id } })).toBe(0);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "source_minor_updated", loanId: loan.id } })).summary).toBe("MyLoans updated the loan's area");
  });

  it("a changed product code is Material; Apply stores it", async () => {
    const { loan } = await open();
    await change(PN, { productCode: "AF-002" });
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ ok: true, outcome: "review", category: "MATERIAL" });
    const it1 = await prisma.sourceChange.findFirstOrThrow({ where: { loanId: loan.id } });
    expect((it1.changes as { field: string }[]).map((c) => c.field)).toEqual(["productCode"]);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).productCode).toBe("AF-001"); // unchanged until Admin applies
    await applySourceChange(admin, it1.id, { note: "MyLoans corrected the product code." });
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).productCode).toBe("AF-002");
  });

  it("a status ID change is Status", async () => {
    const { loan } = await open();
    await change(PN, { statusId: "13", statusName: "Status 13" });
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ ok: true, outcome: "review", category: "STATUS" });
  });
});
