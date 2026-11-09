/**
 * Required vs optional papers (LOCAL database only; removes all loan files first).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { simulate } from "@/lib/services/simulator";
import { saveSettingsRow } from "@/lib/services/admin";
import { MissingPapersError } from "@/lib/services/errors";
import { getSetting, setSetting } from "@/lib/settings";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser;
let admin: CurrentUser;

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Opens GD1012026901001 (Refinancing, 4 transactions) and returns its Notary transaction with lines. */
async function openNotary() {
  await openLoanFile(la, { pn: "GD1012026901001" });
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026901001" } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({
    where: { loanId: loan.id, type: { code: "NOTARY" } },
    include: { checks: { include: { rule: true } } },
  });
  const id = (label: string) => txn.checks.find((c) => c.rule?.label === label)!.id;
  return { loan, txn, id };
}

async function assignInput(loanBranchId: string, transactionId: string) {
  const dp = await prisma.user.findFirstOrThrow({ where: { role: { key: "DP" }, branches: { some: { branchId: loanBranchId } } } });
  return {
    transactionId, dpBranchId: loanBranchId, dpUserId: dp.id, ltoOfficeId: (await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } })).id, fundsNeeded: "NO" as const, fundsKinds: [] as string[],
    beyondTatReason: null, pasuyo: false, secondaryDpUserId: null, pasuyoReason: null,
  };
}

const ALL_REQUIRED = ["Promissory Note", "Disclosure Statement", "Chattel Mortgage (for notarization)", "Valid IDs of borrower (2)", "Sales Invoice"];

describe("Required papers before sending to a DP", () => {
  it("refuses to send with one required line unticked, names it, changes nothing and writes one audit row", async () => {
    const { loan, txn, id } = await openNotary();
    await saveChecklist(la, { transactionId: txn.id, checkedIds: ALL_REQUIRED.filter((l) => l !== "Valid IDs of borrower (2)").map(id), newOthers: [] });
    const auditBefore = await prisma.auditLog.count({ where: { action: "send_refused_missing_papers" } });

    const err = await assignToDp(la, await assignInput(loan.branchId, txn.id)).catch((e) => e);

    expect(err).toBeInstanceOf(MissingPapersError);
    expect((err as MissingPapersError).missing).toEqual(["Valid IDs of borrower (2)"]);
    expect((err as MissingPapersError).message).toBe("Still needed: Valid IDs of borrower (2).");
    expect(await prisma.dpAssignment.count()).toBe(0);
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("FOR_CHECKLIST");
    expect(await prisma.auditLog.count({ where: { action: "send_refused_missing_papers" } })).toBe(auditBefore + 1);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "send_refused_missing_papers" }, orderBy: { at: "desc" } });
    expect(row.summary).toMatch(/^Send refused, missing required papers/);
    expect(row.entityId).toBe(txn.id);
    expect((row.details as { missing: string[] }).missing).toEqual(["Valid IDs of borrower (2)"]);
  });

  it("an unsatisfied pick-one group is named as one paper", async () => {
    const { loan, txn, id } = await openNotary();
    await saveChecklist(la, { transactionId: txn.id, checkedIds: ALL_REQUIRED.filter((l) => l !== "Sales Invoice").map(id), newOthers: [] });
    const err = await assignToDp(la, await assignInput(loan.branchId, txn.id)).catch((e) => e);
    expect((err as MissingPapersError).missing).toEqual(["Proof of sale (Deed of Sale or Sales Invoice)"]);
  });

  it("allows sending with every required paper ticked and the optional one blank", async () => {
    const { loan, txn, id } = await openNotary();
    await saveChecklist(la, { transactionId: txn.id, checkedIds: ALL_REQUIRED.map(id), newOthers: [] });
    const coMaker = txn.checks.find((c) => c.rule?.label === "Valid ID of co-maker")!;
    expect(coMaker.required).toBe(false);
    await assignToDp(la, await assignInput(loan.branchId, txn.id));
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("ASSIGNED");
    expect(await prisma.dpAssignment.count({ where: { transactionId: txn.id } })).toBe(1);
  });

  it("the Admin test simulator follows the same rule", async () => {
    const { loan, txn, id } = await openNotary();
    await saveChecklist(la, { transactionId: txn.id, checkedIds: ALL_REQUIRED.map(id), newOthers: [] });
    await assignToDp(la, await assignInput(loan.branchId, txn.id));
    const assignment = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id } });
    // Data drift: a required line is no longer ticked (e.g. corrected directly in the database).
    await prisma.checklistCheck.update({ where: { id: id("Promissory Note") }, data: { checked: false } });
    const simBefore = await getSetting("simulator.enabled");
    await setSetting("simulator.enabled", true);
    const auditBefore = await prisma.auditLog.count({ where: { action: "send_refused_missing_papers", mode: "SIMULATED" } });
    try {
      const err = await simulate(admin, { loanId: loan.id, action: "DP_ACCEPT", targetId: assignment.id }).catch((e) => e);
      expect(err).toBeInstanceOf(MissingPapersError);
      expect((err as MissingPapersError).missing).toEqual(["Promissory Note"]);
      expect((await prisma.dpAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).status).toBe("PENDING_ACCEPTANCE");
      expect(await prisma.auditLog.count({ where: { action: "send_refused_missing_papers", mode: "SIMULATED" } })).toBe(auditBefore + 1);
    } finally {
      await setSetting("simulator.enabled", simBefore);
    }
  });
});

describe("The Required flag is copied onto each loan file", () => {
  it("new loan files copy it; changing it later does not change open loan files", async () => {
    const { txn } = await openNotary();
    for (const c of txn.checks) expect(c.required).toBe(c.rule!.required);
    const coMakerRule = txn.checks.find((c) => c.rule?.label === "Valid ID of co-maker")!.rule!;
    expect(coMakerRule.required).toBe(false);

    const form = (required: boolean) => ({
      transactionTypeId: coMakerRule.transactionTypeId, documentTypeId: coMakerRule.documentTypeId, label: coMakerRule.label,
      required, oneOfGroup: coMakerRule.oneOfGroup ?? "", originality: coMakerRule.originality, sortOrder: String(coMakerRule.sortOrder), active: true,
    });
    await saveSettingsRow(admin, "checklistRule", coMakerRule.id, form(true));
    try {
      // The open loan file keeps "optional".
      const kept = await prisma.checklistCheck.findFirstOrThrow({ where: { transactionId: txn.id, ruleId: coMakerRule.id } });
      expect(kept.required).toBe(false);
      // A new loan file gets "required".
      await openLoanFile(la, { pn: "GD1012026901006" });
      const fresh = await prisma.checklistCheck.findFirstOrThrow({
        where: { ruleId: coMakerRule.id, transaction: { loan: { pn: "GD1012026901006" } } },
      });
      expect(fresh.required).toBe(true);
      expect((await prisma.checklistRule.findUniqueOrThrow({ where: { id: coMakerRule.id } })).kind).toBe("REQUIRED");
    } finally {
      await saveSettingsRow(admin, "checklistRule", coMakerRule.id, form(false));
    }
    expect((await prisma.checklistRule.findUniqueOrThrow({ where: { id: coMakerRule.id } })).kind).toBe("OPTIONAL");
  });
});
