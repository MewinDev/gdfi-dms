/**
 * Replacement vs additional unit: related loans (same CIN or CIF), possible replacements, the
 * no-payment rule, manual links, branch scope, amounts, and Copy reusable papers for each case.
 * LOCAL database, mock MyLoans.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { lookupPn, openLoanFile } from "@/lib/services/loan-file";
import { saveChecklist } from "@/lib/services/workflow";
import { copyReusablePapers, linkFromRelated, linkReplacement, refreshLoan, reusablePapers, ORIGINAL_NOTE } from "@/lib/services/source-sync";
import { relatedLoans, RELATED_SELECT } from "@/lib/services/related-loans";
import { relatedPanel, reviewFor } from "@/lib/services/source-review";
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
  return prisma.sourceChange.findFirstOrThrow({ where: { loan: { pn: OLD }, state: "OPEN" } });
}

describe("Replacement or additional unit", () => {
  it("additional unit: the other loan is active, or ended with other details; never by name alone", async () => {
    await open(OLD);
    await extra({ pn: "GD1012026909201", totalReleasedAmount: 900_000, vehicle: { plateNo: "NEW 9201", engineNo: "E9201", chassisNo: "C9201", make: "Toyota Wigo" } });
    await extra({ pn: "GD1012026909202", cin: "CIN-OTHER", cif: "CIF-OTHER" }); // same name and details, another borrower number
    await open("GD1012026909201");
    await open("GD1012026909202");
    const rel = await relatedLoans(prisma, await loanOf(OLD));
    expect(rel.map((r) => [r.loan.pn, r.tag])).toEqual([["GD1012026909201", "ADDITIONAL"]]);
    expect(rel[0].relation?.reason).toMatch(/still active in MyLoans/);
    // The old one ends, but the details differ: still additional; no possible replacement in the review.
    const item = await cancelOld();
    expect(item.candidates).toEqual([]);
    const after = await relatedLoans(prisma, await loanOf(OLD));
    expect(after[0]).toMatchObject({ tag: "ADDITIONAL", relation: { mismatched: ["Amount", "Plate number", "Chassis number", "Engine number"] } });
    expect((await reviewFor(admin, item.loanId))!.candidates).toEqual([]);
    // Find loan: the preview names any loan of the same borrower, open or not.
    await extra({ pn: "GD1012026909203", totalReleasedAmount: 800_000 });
    expect(await lookupPn(la, "GD1012026909203")).toMatchObject({ kind: "preview", otherLoans: expect.arrayContaining([OLD, "GD1012026909201"]), otherHidden: 0 });
  });

  it("replacement candidate (same details, ended, in time) by CIF too; the Admin confirms no payment; saved and audited", async () => {
    await open(OLD);
    await extra({ pn: "GD1012026909210", cin: "CIN-CHANGED", cif: base.cif }); // same CIF, same unit and amount
    await open("GD1012026909210");
    const item = await cancelOld();
    expect(item.candidates).toEqual(["GD1012026909210"]);
    const review = (await reviewFor(admin, item.loanId))!;
    expect(review.candidates[0]).toMatchObject({ pn: "GD1012026909210", matched: "Product name, Loan type, Amount, Plate number, Chassis number, Engine number" });
    expect(review.payment).toEqual({ known: false, recorded: false, text: null });
    await expect(linkReplacement(admin, item.id, { newPn: "GD1012026909210", note: "Unit issue after release" })).rejects.toThrow(/I confirmed no payment was made on the old PN/);
    await expect(linkReplacement(la, item.id, { newPn: "GD1012026909210", note: "x note", confirmNoPayment: true })).rejects.toThrow(/Only Admin/);
    await linkReplacement(admin, item.id, { newPn: "GD1012026909210", note: "Unit issue after release", confirmNoPayment: true });
    const nw = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026909210" } });
    expect(nw).toMatchObject({ replacesPn: OLD, replacementEvidence: "Test Admin confirmed no payment was made on GD1652026901003. Note: Unit issue after release" });
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: OLD } })).replacedByPn).toBe("GD1012026909210");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "replacement_linked", loanId: nw.id } });
    expect(audit.details).toMatchObject({ confirmedNoPayment: true, payment: "no payments field", manual: false });
    expect((await relatedPanel(admin, await loanOf(OLD))).rows[0]).toMatchObject({ tag: "REPLACES", tagText: "Replaces this loan" });
    expect((await relatedPanel(admin, await loanOf("GD1012026909210"))).rows[0]).toMatchObject({ tag: "REPLACED_BY", tagText: "Replaced by this loan" });
  });

  it("a payment recorded in MyLoans refuses the link unless the Admin gives an override note", async () => {
    await open(OLD);
    await change(OLD, { paymentRecorded: true });
    await extra({ pn: "GD1012026909220" });
    await open("GD1012026909220");
    const item = await cancelOld();
    expect((await reviewFor(admin, item.loanId))!.payment).toEqual({ known: true, recorded: true, text: "Payment recorded in MyLoans" });
    await expect(linkReplacement(admin, item.id, { newPn: "GD1012026909220", note: "Unit issue", confirmNoPayment: true })).rejects.toThrow(/Payment recorded in MyLoans on GD1652026901003/);
    await linkReplacement(admin, item.id, { newPn: "GD1012026909220", note: "Unit issue", overrideNote: "Payment was reversed by Finance" });
    expect((await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026909220" } })).replacementEvidence).toMatch(/^Payment recorded in MyLoans; linked by Test Admin with an override: Payment was reversed by Finance/);
  });

  it("manual link from Related loans (unusual case): Admin only, the same confirmation plus a note", async () => {
    await open(OLD);
    await extra({ pn: "GD1012026909230", totalReleasedAmount: 950_000 });
    await open("GD1012026909230");
    const me = await loanOf("GD1012026909230");
    await expect(linkFromRelated(la, me.id, OLD, { note: "x note", confirmNoPayment: true })).rejects.toThrow(/Only Admin/);
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
    expect(forLa.rows[0]).toMatchObject({ amount: null, tag: "ADDITIONAL", canLink: false });
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
