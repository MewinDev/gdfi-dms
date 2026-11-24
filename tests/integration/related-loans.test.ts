/**
 * Related loans (same CIN or CIF; D-051: no guessed additional-unit / replacement tag, payment recorded unknown), a redo
 * myloans names, manual links, branch scope, amounts, and Copy reusable papers.
 * LOCAL database, mock MyLoans.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { lookupPn, openLoanFile } from "@/lib/services/loan-file";
import { saveChecklist } from "@/lib/services/workflow";
import { copyReusablePapers, linkFromRelated, refreshLoan, reusablePapers, ORIGINAL_NOTE } from "@/lib/services/source-sync";
import { relatedLoans, RELATED_SELECT } from "@/lib/services/related-loans";
import { relatedPanel } from "@/lib/services/source-review";
import { MockMyLoansAdapter } from "@/lib/myloans/mock-adapter";
import { SYSTEM_ACTOR } from "@/lib/audit";
import type { MyLoansRecord } from "@/lib/myloans/types";
import { businessDate } from "@/lib/time";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, admin: CurrentUser;
const OLD = "GD1652026901003"; // Angono, Renewal, ₱1,000,000
const sys = { actor: SYSTEM_ACTOR, mode: "MANUAL" as const, trigger: "button" as const };
let base: MyLoansRecord;

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  const r = await new MockMyLoansAdapter().getByPn(OLD);
  if (!r.ok) throw new Error("mock");
  base = r.record;
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  process.env.MYLOANS_MODE = "mock";
  await cleanLoans();
  await setSetting("myloans.refreshOnOpenMinutes", 15);
});
afterAll(async () => {
  await cleanLoans();
  await prisma.loan.deleteMany({ where: { pn: "GD1012026908801" } });
  await prisma.$disconnect();
});

const today = () => businessDate(new Date());
async function extra(r: Partial<MyLoansRecord> & { pn: string }) {
  const list = [...(await getSetting("myloans.mockExtra"))];
  list.push({ ...base, sourceLoanId: `ML-${r.pn}`, releaseDate: today(), status: "RELEASED", ...r });
  await setSetting("myloans.mockExtra", list);
}
async function change(pn: string, over: Partial<MyLoansRecord>) {
  const all = { ...(await getSetting("myloans.mockOverrides")) };
  all[pn] = { ...(all[pn] ?? {}), ...over, changedAt: new Date().toISOString() };
  await setSetting("myloans.mockOverrides", all);
}
const open = (pn: string) => openLoanFile(la, { pn, financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });
const loanOf = (pn: string) => prisma.loan.findUniqueOrThrow({ where: { pn }, select: RELATED_SELECT });
async function cancelOld() {
  await change(OLD, { status: "CANCELLED" });
  await refreshLoan((await loanOf(OLD)).id, sys);
  return prisma.openItem.findFirstOrThrow({ where: { loan: { pn: OLD }, status: "PENDING", field: "status" } });
}

describe("Replacement or additional unit", () => {
  it("D-051: other loans of the same borrower show as Same borrower, with no additional-unit or replacement guess", async () => {
    await open(OLD);
    await extra({ pn: "GD1012026909201", cin: "CIN-UNIT-9201", totalReleasedAmount: 900_000 }); // same CIF, another loan
    await extra({ pn: "GD1012026909202", cin: "CIN-OTHER", cif: "CIF-OTHER" }); // same name, another borrower
    await open("GD1012026909201");
    await open("GD1012026909202");
    const rel = await relatedLoans(prisma, await loanOf(OLD));
    expect(rel.map((r) => [r.loan.pn, r.tag, r.relation])).toEqual([["GD1012026909201", "SAME_BORROWER", null]]);
    // The old one is cancelled: still no guessed candidate (a redo is named by myloans, D-051).
    const item = await cancelOld();
    expect(item.newValue).toBe("Cancelled in myloans"); // no guessed replacement on it
    expect((await relatedPanel(admin, await loanOf(OLD))).rows[0]).toMatchObject({ tag: "SAME_BORROWER", tagText: "Same borrower", canLink: true });
    // Find loan: no "this borrower has another loan" warning now (D-051).
    await extra({ pn: "GD1012026909203", cin: "CIN-UNIT-9203", totalReleasedAmount: 800_000 });
    const preview = await lookupPn(la, "GD1012026909203");
    expect(preview).toMatchObject({ kind: "preview", replacesPn: null });
    expect(preview).not.toHaveProperty("otherLoans");
  });

  it("a redo myloans names (same CIN, the old copy cancelled): linked from Related loans; the approver confirms no payment (unknown, D-051); linked and audited", async () => {
    await open(OLD);
    await cancelOld();
    await extra({ pn: "GD1012026909210" }); // the same CIN as the old copy: myloans' redo
    expect(await lookupPn(la, "GD1012026909210")).toMatchObject({ kind: "preview", replacesPn: OLD });
    await open("GD1012026909210");
    const oldId = (await loanOf(OLD)).id;
    expect((await relatedPanel(admin, await loanOf(OLD))).rows[0]).toMatchObject({ pn: "GD1012026909210", payment: { known: false, recorded: false, text: null } });
    await expect(linkFromRelated(admin, oldId, "GD1012026909210", { note: "Redone in myloans" })).rejects.toThrow(/I confirmed no payment was made on the old PN/);
    await expect(linkFromRelated(la, oldId, "GD1012026909210", { note: "x note", confirmNoPayment: true })).rejects.toThrow(/Only approvers/);
    await linkFromRelated(admin, oldId, "GD1012026909210", { note: "Redone in myloans", confirmNoPayment: true });
    const nw = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026909210" } });
    expect(nw).toMatchObject({ replacesPn: OLD, replacementEvidence: "Test Admin confirmed no payment was made on GD1652026901003. Note: Redone in myloans" });
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: OLD } })).replacedByPn).toBe("GD1012026909210");
    expect(await prisma.auditLog.count({ where: { action: "replacement_linked", loanId: nw.id } })).toBe(1);
    expect((await relatedPanel(admin, await loanOf(OLD))).rows[0]).toMatchObject({ tag: "REPLACES", tagText: "Replaces this loan" });
    expect((await relatedPanel(admin, await loanOf("GD1012026909210"))).rows[0]).toMatchObject({ tag: "REPLACED_BY", tagText: "Replaced by this loan" });
  });

  it("manual link from Related loans (unusual case): Admin only, the same confirmation plus a note", async () => {
    await open(OLD);
    await extra({ pn: "GD1012026909230", totalReleasedAmount: 950_000 });
    await open("GD1012026909230");
    const me = await loanOf("GD1012026909230");
    await expect(linkFromRelated(la, me.id, OLD, { note: "x note", confirmNoPayment: true })).rejects.toThrow(/Only approvers/);
    await expect(linkFromRelated(admin, me.id, OLD, { confirmNoPayment: true })).rejects.toThrow(/short note/);
    await expect(linkFromRelated(admin, me.id, OLD, { note: "Amount was corrected" })).rejects.toThrow(/I confirmed no payment/);
    await linkFromRelated(admin, me.id, OLD, { note: "Amount was corrected", confirmNoPayment: true });
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026909230" } })).replacesPn).toBe(OLD);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "replacement_linked", pn: "GD1012026909230" } })).summary).toMatch(/\(from Related loans\)/);
  });

  it("Related loans: branch scope hides details, amounts only with journey:view_amounts", async () => {
    await open(OLD);
    await extra({ pn: "GD1012026909240", totalReleasedAmount: 700_000 });
    await open("GD1012026909240");
    const dvo = await prisma.branch.findUniqueOrThrow({ where: { code: "390" } });
    const old = await prisma.loan.findUniqueOrThrow({ where: { pn: OLD } });
    await prisma.loan.create({ data: { pn: "GD1012026908801", cin: old.cin, cif: null, borrowerName: "Ana Villanueva", branchId: dvo.id, loanType: "New", productName: "Auto Financing", totalReleasedAmount: 300_000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: admin.id, classification: "FINANCING", mortgageResult: "MORTGAGE", ruleFired: "test", stage: "For checklist" } });
    const forLa = await relatedPanel(la, await loanOf(OLD));
    expect(forLa.hidden).toBe(1);
    expect(forLa.rows.map((r) => r.pn)).toEqual(["GD1012026909240"]);
    expect(forLa.rows[0]).toMatchObject({ amount: null, tag: "SAME_BORROWER", canLink: false });
    const forAdmin = await relatedPanel(admin, await loanOf(OLD));
    expect(forAdmin.hidden).toBe(0);
    expect(forAdmin.rows.find((r) => r.pn === "GD1012026909240")).toMatchObject({ amount: "₱700,000.00", canLink: true });
  });
});

describe("Copy reusable papers", () => {
  it("additional unit: copies only papers needed as a Copy; Originals are not copied (with the note); custody Referenced; unit papers never", async () => {
    await open(OLD);
    for (const code of ["NOTARY", "MORTGAGE"]) {
      const t = await prisma.loanTransaction.findFirstOrThrow({ where: { loan: { pn: OLD }, type: { code } }, include: { checks: true } });
      await saveChecklist(la, { transactionId: t.id, checkedIds: t.checks.map((c) => c.id), newOthers: [] });
    }
    await extra({ pn: "GD1012026909250", totalReleasedAmount: 900_000 });
    await open("GD1012026909250");
    const nw = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026909250" } });
    const options = await reusablePapers(prisma, nw.id);
    expect(options.length).toBeGreaterThan(1);
    expect(options.every((o) => o.mode === "additional" && o.fromPn === OLD)).toBe(true);
    expect(options.every((o) => /Valid ID|Special Power/.test(o.label))).toBe(true); // reusable only: no unit papers
    const original = options.find((o) => o.blocked);
    const copyForm = options.find((o) => !o.blocked);
    expect(original?.blocked).toBe(ORIGINAL_NOTE(OLD));
    expect(original?.blocked).toBe("Original is filed under GD1652026901003. Tick it here only if you hold another original or a certified copy.");
    expect(copyForm).toBeTruthy();
    await expect(copyReusablePapers(admin, nw.id, [original!.fromCheckId])).rejects.toThrow(/Original is filed under GD1652026901003/);
    await copyReusablePapers(admin, nw.id, [copyForm!.fromCheckId]);
    expect((await prisma.checklistCheck.findUniqueOrThrow({ where: { id: copyForm!.toCheckId } })).checked).toBe(true);
    expect(await prisma.documentMovement.count({ where: { action: "REFERENCED", remarks: { startsWith: `Referenced from ${OLD}` } } })).toBe(1);
    expect(await prisma.documentMovement.count({ where: { action: "REASSIGNED" } })).toBe(0); // the old file keeps its paper
  });
});
