/**
 * Piece 8 (D-004, D-010 to D-013, D-053): Open Items. Test database, the myloans mock in-process.
 * The plan's list (IMPLEMENTATION_PLAN.md 9.8) and the four additions of D-053: reverted in myloans; Forward blocked
 * for every move away from Released; renames never an Open Item; the waiting time, oldest first, Home "too long".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings";
import { openLoanFile } from "@/lib/services/loan-file";
import { refreshLoan, simulateSourceChange } from "@/lib/services/source-sync";
import { cashBlockReason, forwardBlockReason, loanBlockedReason, sendBlockReason } from "@/lib/services/source-blocks";
import { decideOpenItem, openItemCounts, openItemsFor } from "@/lib/services/open-items";
import { statusOutcome } from "@/lib/open-items/fields";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { saveMonitoredFields } from "@/lib/services/open-items-settings";
import { referenceChanges } from "@/lib/services/reference-changes";
import { resetClient } from "@/lib/myloans/client";
import { SYSTEM_ACTOR } from "@/lib/audit";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, head: CurrentUser, admin: CurrentUser, superadmin: CurrentUser;
const PN = "GD1652026901003"; // Angono, Renewal, ₱1,000,000, Auto Financing: Mortgage
const OTHER = "GD3902026901007"; // Alaminos: no approver of its own (Unassigned)
const sys = { actor: SYSTEM_ACTOR, mode: "MANUAL" as const, trigger: "button" as const };
const DEFAULT_FIELDS = ["loanType", "amount", "productCode", "releaseDate", "branchCode", "sourceLoanId", "borrowerName", "cif", "cin"];

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  head = await asUser("test.lahead@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  superadmin = await asUser("test.superadmin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  await cleanLoans();
  await setSetting("openItems.monitoredFields", DEFAULT_FIELDS);
  await prisma.userPermissionOverride.deleteMany({ where: { note: "open-items test" } });
  resetClient();
});
afterAll(async () => {
  await prisma.userPermissionOverride.deleteMany({ where: { note: "open-items test" } });
  await setSetting("openItems.monitoredFields", DEFAULT_FIELDS);
  await cleanLoans();
  await prisma.$disconnect();
});

const change = async (pn: string, over: Partial<MyLoansRecord>) => {
  const all = { ...(await getSetting("myloans.mockOverrides")) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: new Date().toISOString() };
  await setSetting("myloans.mockOverrides", all);
};
async function open(pn = PN, who: CurrentUser = la) {
  await openLoanFile(who, { pn, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
  return prisma.loan.findUniqueOrThrow({ where: { pn } });
}
const pending = (loanId: string) => prisma.openItem.findMany({ where: { loanId, status: "PENDING" }, orderBy: { field: "asc" } });

describe("raising Open Items", () => {
  it("every monitored field its own item; nothing applied; numbered OI-YYYY-######; a field switched off raises none", async () => {
    const loan = await open();
    await change(PN, { borrowerName: "Ana V. Villanueva-Cruz", cif: "CIF-NEW-1", totalReleasedAmount: 1_020_000, releaseDate: "2026-11-03" });
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ ok: true, outcome: "review", raised: 4 });
    const items = await pending(loan.id);
    expect(items.map((i) => i.field)).toEqual(["amount", "borrowerName", "cif", "releaseDate"]);
    expect(items.every((i) => /^OI-\d{4}-\d{6}$/.test(i.number))).toBe(true);
    expect(items.find((i) => i.field === "amount")).toMatchObject({ groupKey: "rules", audience: "LOAN", oldValue: "₱1,000,000.00", newValue: "₱1,020,000.00" });
    expect(items.find((i) => i.field === "cif")).toMatchObject({ audience: "BORROWER", groupKey: null });
    const after = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(after.borrowerName).toBe(loan.borrowerName);
    expect(after.totalReleasedAmount.toString()).toBe(loan.totalReleasedAmount.toString());
    // A field switched off in Settings, Open Items raises nothing.
    await expect(saveMonitoredFields(la, ["amount"])).rejects.toThrow(/Ask a Superadmin/);
    await saveMonitoredFields(admin, DEFAULT_FIELDS.filter((f) => f !== "sourceLoanId"));
    await change(PN, { sourceLoanId: "ML-NEW-9" });
    await refreshLoan(loan.id, sys);
    expect((await pending(loan.id)).map((i) => i.field)).not.toContain("sourceLoanId");
  });

  it("D-053 (3): renames never raise an Open Item: applied by themselves and logged in Reference data changes, with a notice", async () => {
    const loan = await open();
    await change(PN, { areaName: "LUZON 1 - RIZAL (renamed)", divisionName: "Division Two" });
    expect(await refreshLoan(loan.id, sys)).toMatchObject({ ok: true, outcome: "minor", raised: 0 });
    expect(await pending(loan.id)).toHaveLength(0);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).sourceAreaName).toBe("LUZON 1 - RIZAL (renamed)");
    const rows = await referenceChanges(admin);
    expect(rows.map((r) => r.entity).sort()).toEqual(["AREA", "DIVISION"]);
    expect(rows.find((r) => r.entity === "AREA")).toMatchObject({ newValue: "LUZON 1 - RIZAL (renamed)", source: "myloans API 1", loanCount: 1 });
    expect(await prisma.notification.count({ where: { userId: head.id, title: "Area renamed in myloans" } })).toBe(1);
    await expect(referenceChanges(la)).rejects.toThrow(/See reference data changes/);
  });

  it("supersede on a newer value (linked); the one-pending rule; D-053 (1): reverted in myloans closes it and tells the approvers", async () => {
    const loan = await open();
    await change(PN, { cif: "CIF-A" });
    await refreshLoan(loan.id, sys);
    const first = (await pending(loan.id))[0];
    await change(PN, { cif: "CIF-B" });
    await refreshLoan(loan.id, sys);
    const second = (await pending(loan.id))[0];
    expect(second.newValue).toBe("CIF-B");
    expect(await prisma.openItem.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: "SUPERSEDED", supersededById: second.id });
    // The database refuses a second pending item for the same field.
    await expect(prisma.openItem.create({ data: { number: "OI-2099-000001", loanId: loan.id, branchId: loan.branchId, field: "cif", fieldLabel: "CIF" } })).rejects.toThrow();
    // myloans puts the DMS value back: closed by itself, no new item.
    const before = await prisma.notification.count({ where: { title: `${PN}: ${second.number} closed` } });
    await change(PN, { cif: loan.cif ?? undefined });
    await refreshLoan(loan.id, sys);
    expect(await pending(loan.id)).toHaveLength(0);
    expect(await prisma.openItem.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: "REVERTED", remarks: "Reverted in myloans" });
    expect(await prisma.notification.count({ where: { title: `${PN}: ${second.number} closed` } })).toBeGreaterThan(before);
    expect(await prisma.auditLog.count({ where: { action: "open_item_reverted", loanId: loan.id } })).toBe(1);
  });
});

describe("deciding", () => {
  it("approve applies, reject keeps; remarks 5 to 500 for both; only the tick and the branch decide", async () => {
    const loan = await open();
    await change(PN, { borrowerName: "Ana Villanueva Reyes", cif: "CIF-X" });
    await refreshLoan(loan.id, sys);
    const [name, cif] = [(await pending(loan.id)).find((i) => i.field === "borrowerName")!, (await pending(loan.id)).find((i) => i.field === "cif")!];
    await expect(decideOpenItem(la, name.id, { decision: "APPROVE", remarks: "Checked it" })).rejects.toThrow(/Review borrower detail corrections/);
    await expect(decideOpenItem(head, name.id, { decision: "APPROVE", remarks: "ok" })).rejects.toThrow(/at least 5/);
    await expect(decideOpenItem(head, name.id, { decision: "REJECT", remarks: "x".repeat(501) })).rejects.toThrow(/under 500/);
    expect(await decideOpenItem(head, name.id, { decision: "APPROVE", remarks: "Matches the ID" })).toMatch(/^Approved OI-/);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).borrowerName).toBe("Ana Villanueva Reyes");
    await decideOpenItem(head, cif.id, { decision: "REJECT", remarks: "myloans typo, asked them to fix it" });
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).cif).toBe(loan.cif);
    expect(await prisma.openItem.findUniqueOrThrow({ where: { id: cif.id } })).toMatchObject({ status: "REJECTED", decidedByLabel: head.name, remarks: "myloans typo, asked them to fix it" });
    await expect(decideOpenItem(head, cif.id, { decision: "APPROVE", remarks: "Again please" })).rejects.toThrow(/already decided/);
    expect(await prisma.auditLog.count({ where: { action: { in: ["open_item_approved", "open_item_rejected"] }, loanId: loan.id } })).toBe(2);
  });

  it("the rule group: loan type, amount, product and release date decided together, with the rule effect", async () => {
    const loan = await open();
    await change(PN, { totalReleasedAmount: 1_020_000, releaseDate: "2026-11-03" });
    await refreshLoan(loan.id, sys);
    const items = await pending(loan.id);
    expect(items.map((i) => i.groupKey)).toEqual(["rules", "rules"]);
    // Renewal above ₱1,000,000: Mortgage is not needed any more (the effect, shown before approving).
    expect(await sendBlockReason(prisma, loan.id, "MORTGAGE")).toMatch(/An approver decides the Open Item/);
    expect(await sendBlockReason(prisma, loan.id, "NOTARY")).toBeNull();
    const msg = await decideOpenItem(head, items[0].id, { decision: "APPROVE", remarks: "Amount corrected in myloans" });
    expect(msg).toMatch(/Mortgage would be removed/);
    expect(await pending(loan.id)).toHaveLength(0);
    expect((await prisma.openItem.findMany({ where: { loanId: loan.id } })).every((i) => i.status === "APPROVED")).toBe(true);
    const l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id }, include: { transactions: { include: { type: true } } } });
    expect(l.totalReleasedAmount.toString()).toBe("1020000");
    expect(l.transactions.find((t) => t.type.code === "MORTGAGE")?.status).toBe("CANCELLED");
  });

  it("an override deny or grant of the approver tick decides who may approve", async () => {
    const loan = await open();
    await change(PN, { totalReleasedAmount: 990_000 });
    await refreshLoan(loan.id, sys);
    const item = (await pending(loan.id))[0];
    await prisma.userPermissionOverride.create({ data: { userId: head.id, key: PERMISSIONS.SOURCE_REVIEW, effect: "DENY", note: "open-items test" } });
    await expect(decideOpenItem(await asUser("test.lahead@gdfi.ph"), item.id, { decision: "REJECT", remarks: "Not mine now" })).rejects.toThrow(/Only approvers decide Open Items/);
    await prisma.userPermissionOverride.create({ data: { userId: la.id, key: PERMISSIONS.SOURCE_REVIEW, effect: "GRANT", note: "open-items test" } });
    expect(await decideOpenItem(await asUser("test.la@gdfi.ph"), item.id, { decision: "REJECT", remarks: "Granted for the test" })).toMatch(/^Rejected/);
  });
});

describe("D-053 (2): a loan that left Released does not move on", () => {
  for (const [what, over, state] of [
    ["Cancelled", { status: "CANCELLED" }, "cancelled in myloans"],
    ["NotReleased", { status: "NOT_RELEASED" }, "not released in myloans"],
    ["Inactive", { isActive: false }, "inactive in myloans"],
  ] as const) {
    it(`${what}: one status item; Send, Forward and new cash blocked with the reason; Reject unblocks`, async () => {
      const loan = await open();
      await change(PN, over as Partial<MyLoansRecord>);
      await refreshLoan(loan.id, sys);
      const item = (await pending(loan.id)).find((i) => i.field === "status")!;
      expect(item).toMatchObject({ fieldLabel: "Status in myloans" });
      for (const why of [await sendBlockReason(prisma, loan.id, "NOTARY"), await forwardBlockReason(prisma, loan.id), await cashBlockReason(prisma, loan.id), await loanBlockedReason(prisma, loan.id)]) {
        expect(why).toContain(state);
        expect(why).toContain("Send, Forward and new cash wait");
      }
      await decideOpenItem(head, item.id, { decision: "REJECT", remarks: "Confirmed released with the branch" });
      expect(await sendBlockReason(prisma, loan.id, "NOTARY")).toBeNull();
      expect(await forwardBlockReason(prisma, loan.id)).toBeNull();
    });
  }

  it("Cancelled: Approve closes the loan file (the outcome is said first)", async () => {
    const loan = await open();
    await change(PN, { status: "CANCELLED" });
    await refreshLoan(loan.id, sys);
    const item = (await pending(loan.id)).find((i) => i.field === "status")!;
    expect(statusOutcome("Cancelled", null)).toEqual({ kind: "close", text: "This will close the loan file." });
    expect(await decideOpenItem(head, item.id, { decision: "APPROVE", remarks: "Cancelled in myloans" })).toMatch(/The loan is closed: Cancelled in MyLoans/);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).cancelledAt).not.toBeNull();
  });

  it("Not released: Approve keeps the loan ON HOLD (blocked, not closed); released again in myloans: the hold ends by itself, logged, approvers told", async () => {
    const loan = await open();
    await change(PN, { status: "NOT_RELEASED" });
    await refreshLoan(loan.id, sys);
    const item = (await pending(loan.id)).find((i) => i.field === "status")!;
    expect(statusOutcome("NotReleased", null).text).toMatch(/^The loan stays on hold until released again/);
    expect(await decideOpenItem(head, item.id, { decision: "APPROVE", remarks: "Confirmed with the branch" })).toMatch(/on hold: not released in myloans/);
    let l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(l).toMatchObject({ cancelledAt: null, sourceHold: "NotReleased" });
    for (const why of [await sendBlockReason(prisma, loan.id, "NOTARY"), await forwardBlockReason(prisma, loan.id), await cashBlockReason(prisma, loan.id), await loanBlockedReason(prisma, loan.id)]) {
      expect(why).toBe("On hold: not released in myloans. Send, Forward and new cash wait until myloans shows it released again.");
    }
    // The same state again: no new item.
    await change(PN, { status: "NOT_RELEASED", statusName: "Not released (again)" });
    await refreshLoan(loan.id, sys);
    expect((await pending(loan.id)).filter((i) => i.field === "status")).toHaveLength(0);
    // myloans shows it Released again: the hold ends by itself.
    const before = await prisma.notification.count({ where: { userId: head.id, title: `${PN}: released again in myloans` } });
    await change(PN, { status: "RELEASED", statusName: "Loan Released" });
    await refreshLoan(loan.id, sys);
    l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(l).toMatchObject({ sourceHold: null, cancelledAt: null });
    expect(await sendBlockReason(prisma, loan.id, "NOTARY")).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "loan_hold_reverted", loanId: loan.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: head.id, title: `${PN}: released again in myloans` } })).toBe(before + 1);
    expect(await pending(loan.id)).toHaveLength(0);
  });

  it("Inactive: Approve keeps the loan on hold too", async () => {
    const loan = await open();
    await change(PN, { isActive: false });
    await refreshLoan(loan.id, sys);
    const item = (await pending(loan.id)).find((i) => i.field === "status")!;
    await decideOpenItem(head, item.id, { decision: "APPROVE", remarks: "Inactive in myloans" });
    expect(await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).toMatchObject({ sourceHold: "Inactive", cancelledAt: null });
    expect(await loanBlockedReason(prisma, loan.id)).toBe("On hold: inactive in myloans. Send, Forward and new cash wait until myloans shows it released again.");
  });

  it("Redone (same CIN, ReplacedBy): Approve RE-LINKS the same loan file to the new PN and ExternalLoanId; papers, jobs and work items stay; the old PN stays in its history; nothing closed", async () => {
    const loan = await open();
    // Papers ticked and one job sent on the old PN.
    const notary = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "NOTARY" } }, include: { checks: true } });
    await saveChecklist(la, { transactionId: notary.id, checkedIds: notary.checks.map((c) => c.id), newOthers: [] });
    const dp = await asUser("test.dp@gdfi.ph");
    const office = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
    await assignToDp(la, { transactionId: notary.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: office.id, fundsNeeded: "NO", fundsKinds: [], beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
    const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: notary.id } });
    const msg = await simulateSourceChange(admin, loan.id, "replace");
    const newPn = /now has (GD\d{13})/.exec(msg)![1];
    const item = (await pending(loan.id)).find((i) => i.field === "status")!;
    expect(item.newValue).toBe(`Redone in myloans (replaced): replaced by ${newPn}`);
    expect(statusOutcome("Superseded", newPn).text).toMatch(new RegExp(`^This will move the loan file to PN ${newPn}\\.`));
    const before = { checks: notary.checks.length, ticked: await prisma.checklistCheck.count({ where: { transactionId: notary.id, checked: true } }), docs: await prisma.documentItem.count({ where: { loanId: loan.id } }) };
    expect(await decideOpenItem(head, item.id, { decision: "APPROVE", remarks: "Redone as a new PN in myloans" })).toMatch(new RegExp(`The loan file is now PN ${newPn} \\(was ${PN}\\)`));
    const l = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id }, include: { sourceIdentities: { orderBy: { firstSeenAt: "asc" } } } });
    expect(l).toMatchObject({ pn: newPn, cancelledAt: null, sourceHold: null });
    expect(l.externalLoanId).not.toBe(loan.externalLoanId);
    expect(l.sourceIdentities.map((i) => i.pnNo)).toEqual([PN, newPn]); // the old PN stays in its history
    expect(await prisma.loan.findUnique({ where: { pn: PN } })).toBeNull(); // no second loan file
    // Papers, jobs and work stay with the loan file.
    expect(await prisma.checklistCheck.count({ where: { transactionId: notary.id, checked: true } })).toBe(before.ticked);
    expect(await prisma.documentItem.count({ where: { loanId: loan.id } })).toBe(before.docs);
    expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING_ACCEPTANCE");
    expect(await prisma.workItem.count({ where: { loanId: loan.id, pn: PN } })).toBe(0);
    expect(await prisma.workItem.count({ where: { loanId: loan.id, pn: newPn } })).toBeGreaterThan(0);
    expect(await sendBlockReason(prisma, loan.id, "PPSR")).toBeNull();
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "loan_relinked", loanId: loan.id } })).summary).toContain(`from PN ${PN} to PN ${newPn}`);
  });

  it("Redone, but the new PN is already a loan file here: refused, link them from Related loans", async () => {
    const loan = await open();
    const msg = await simulateSourceChange(admin, loan.id, "replace");
    const newPn = /now has (GD\d{13})/.exec(msg)![1];
    await open(newPn);
    const item = (await pending(loan.id)).find((i) => i.field === "status")!;
    await expect(decideOpenItem(head, item.id, { decision: "APPROVE", remarks: "Redone as a new PN" })).rejects.toThrow(`${newPn} is already a loan file here. Link the two from Related loans instead.`);
  });
});

describe("queues and waiting time", () => {
  it("branch-scoped; Unassigned for a branch with no approver; giving one an approver moves its items; oldest first, green / amber / red; Home too long", async () => {
    const angono = await open();
    // The LA opens the Alaminos loan with Alaminos added to their access for a moment.
    const alaminosId = (await prisma.branch.findUniqueOrThrow({ where: { code: "390" } })).id;
    await prisma.userBranch.create({ data: { userId: la.id, branchId: alaminosId } });
    const alaminos = await open(OTHER, await asUser("test.la@gdfi.ph")).finally(() => prisma.userBranch.delete({ where: { userId_branchId: { userId: la.id, branchId: alaminosId } } }));
    for (const pn of [PN, OTHER]) await change(pn, { cif: `CIF-Q-${pn}` });
    await refreshLoan(angono.id, sys);
    await refreshLoan(alaminos.id, sys);
    // Waited: Angono's raised 6 working days ago (red at the default 3), Alaminos' today.
    await prisma.openItem.updateMany({ where: { loanId: angono.id }, data: { raisedAt: new Date(Date.now() - 9 * 86_400_000) } });
    const mine = await openItemsFor(head, "mine");
    expect(mine.map((r) => r.loan.pn)).toEqual([PN]); // the head works at Antipolo and Angono only
    expect(mine[0].tone).toBe("bad");
    expect(mine[0].waitingDays).toBeGreaterThanOrEqual(5);
    expect(await openItemCounts(head)).toMatchObject({ waiting: 1, tooLong: 1 });
    // Alaminos has no approver of its own: Unassigned, seen by the Superadmin and All-branches approvers.
    expect((await openItemsFor(superadmin, "unassigned")).map((r) => r.loan.pn)).toEqual([OTHER]);
    expect(await openItemsFor(head, "unassigned")).toHaveLength(0);
    // Admin (All branches) sees both under Mine, oldest first.
    expect((await openItemsFor(admin, "mine")).map((r) => r.loan.pn)).toEqual([PN, OTHER]);
    // An approver for Alaminos: its items leave Unassigned at once.
    await prisma.userBranch.create({ data: { userId: head.id, branchId: alaminosId } });
    try {
      expect(await openItemsFor(superadmin, "unassigned")).toHaveLength(0);
    } finally {
      await prisma.userBranch.delete({ where: { userId_branchId: { userId: head.id, branchId: alaminosId } } });
    }
  });
});
