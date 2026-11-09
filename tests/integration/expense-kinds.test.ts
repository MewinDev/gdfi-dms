/**
 * Expense kinds (Settings > Expense kinds), the Other description and the amount per kind, through the
 * same functions the screens use. TEST database only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { openLoanFile } from "@/lib/services/loan-file";
import { assignToDp, saveChecklist } from "@/lib/services/workflow";
import { acceptJob } from "@/lib/services/jobs";
import { requestAdvance, requestableJobs, saveAdvanceLine } from "@/lib/services/funds";
import { saveSettingsRow } from "@/lib/services/admin";
import { setRowActive } from "@/lib/services/settings-status";
import { addSuggestionAsKind, otherSuggestionList, quickAddKind, moveExpenseKind, allKinds, lineKindText, kindNames } from "@/lib/services/expense-kinds";
import { checkImport, runImport } from "@/lib/import/importer";
import { toCsv } from "@/lib/import/csv";
import { FUNDS_CSV_HEADER, fundsCsv } from "@/lib/funds/export";
import { setSetting } from "@/lib/settings";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser, dp: CurrentUser, fin: CurrentUser, admin: CurrentUser;
const BASE = ["NOTARY_FEE", "PPSR_FEE", "LTO_FEE", "TRANSPORT", "OTHER"];
const kind = (code: string) => prisma.expenseKind.findUniqueOrThrow({ where: { code } });

async function resetKinds() {
  await cleanLoans();
  await prisma.cashAdvanceRule.deleteMany({ where: { kind: { notIn: BASE } } });
  await prisma.cashAdvanceRule.deleteMany({ where: { kind: "OTHER" } });
  await prisma.expenseKind.deleteMany({ where: { code: { notIn: BASE } } });
  await prisma.expenseKind.updateMany({ data: { amountMode: "TYPED", amountCents: null, active: true, deactivatedAt: null } });
  const names: Record<string, string> = { NOTARY_FEE: "Notary fee", PPSR_FEE: "PPSR fee", LTO_FEE: "LTO fee", TRANSPORT: "Transport", OTHER: "Other" };
  for (const [i, c] of BASE.entries()) await prisma.expenseKind.update({ where: { code: c }, data: { name: names[c], nameKey: names[c].toLowerCase().replace(/\s+/g, ""), sortOrder: c === "OTHER" ? 999 : i + 1 } });
}

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  dp = await asUser("test.dp@gdfi.ph");
  fin = await asUser("test.finance@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await resetKinds();
  await setSetting("funds.blockLtoUntilFunded", true);
});
afterAll(async () => {
  await resetKinds();
  await prisma.$disconnect();
});

/** GD1652026901003 Mortgage, flagged with the given kinds, accepted by the test DP. */
async function acceptedMortgage(kinds: string[]) {
  await openLoanFile(la, { pn: "GD1652026901003", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" }).catch(() => null);
  const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1652026901003" } });
  const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, type: { code: "MORTGAGE" } }, include: { checks: true, type: true } });
  await saveChecklist(la, { transactionId: txn.id, checkedIds: txn.checks.map((c) => c.id), newOthers: [] });
  const lto = await prisma.ltoOffice.findFirstOrThrow({ where: { active: true }, orderBy: { code: "asc" } });
  await assignToDp(la, { transactionId: txn.id, dpBranchId: loan.branchId, dpUserId: dp.id, ltoOfficeId: lto.id, fundsNeeded: "YES", fundsKinds: kinds, beyondTatReason: "Integration test", pasuyo: false, secondaryDpUserId: null, pasuyoReason: null });
  const job = await prisma.dpAssignment.findFirstOrThrow({ where: { transactionId: txn.id }, orderBy: { createdAt: "desc" } });
  await acceptJob(dp, job.id, true);
  return { loan, txn };
}

describe("the kinds list", () => {
  it("starts with the old kinds, all Person enters, Other built in and last", async () => {
    const kinds = await allKinds();
    expect(kinds.map((k) => k.code)).toEqual(BASE);
    expect(kinds.every((k) => k.amountMode === "TYPED" && k.amountCents === null)).toBe(true);
    expect(kinds.at(-1)).toMatchObject({ code: "OTHER", builtIn: true });
  });

  it("checks names: required, 2 to 40 characters, unique ignoring case and spaces; audited", async () => {
    await expect(saveSettingsRow(admin, "expenseKind", null, { name: "" })).rejects.toThrow(/Type the name/);
    await expect(saveSettingsRow(admin, "expenseKind", null, { name: "x" })).rejects.toThrow(/at least 2/);
    await expect(saveSettingsRow(admin, "expenseKind", null, { name: "x".repeat(41) })).rejects.toThrow(/at most 40/);
    await expect(saveSettingsRow(admin, "expenseKind", null, { name: "notary FEE" })).rejects.toThrow(/Notary fee already exists/);
    await saveSettingsRow(admin, "expenseKind", null, { name: "Photo copy", amountMode: "TYPED" });
    await expect(saveSettingsRow(admin, "expenseKind", null, { name: "photocopy" })).rejects.toThrow(/Photo copy already exists/);
    const k = await prisma.expenseKind.findFirstOrThrow({ where: { name: "Photo copy" } });
    expect(k).toMatchObject({ code: "PHOTO_COPY", active: true, builtIn: false });
    expect(await prisma.auditLog.count({ where: { action: "expense_kind_added", entityId: k.id } })).toBe(1);
    // Placed before Other, and reordered with Up / Down.
    expect((await allKinds()).map((x) => x.code).slice(-2)).toEqual(["PHOTO_COPY", "OTHER"]);
    await moveExpenseKind(admin, k.id, -1);
    expect((await allKinds()).map((x) => x.code).slice(-3)).toEqual(["PHOTO_COPY", "TRANSPORT", "OTHER"]);
  });

  it("Other cannot be renamed, made inactive or given an amount", async () => {
    const o = await kind("OTHER");
    await expect(saveSettingsRow(admin, "expenseKind", o.id, { name: "Misc" })).rejects.toThrow(/cannot be renamed/);
    await expect(setRowActive(admin, "expenseKind", o.id, false)).rejects.toThrow(/always active/);
    await expect(saveSettingsRow(admin, "expenseKind", o.id, { name: "Other", amountMode: "SUGGESTED", amount: "100" })).rejects.toThrow(/Other is always entered by the person/);
  });

  it("needs the tick: a processor cannot add or change kinds (server refuses)", async () => {
    expect(dp.permissions.has(PERMISSIONS.FUNDS_KINDS_MANAGE)).toBe(false);
    expect(fin.permissions.has(PERMISSIONS.FUNDS_KINDS_MANAGE)).toBe(true);
    await expect(quickAddKind(dp, { name: "Courier" })).rejects.toThrow(/does not allow/);
    await expect(saveSettingsRow(dp, "expenseKind", null, { name: "Courier" })).rejects.toThrow(/does not allow/);
    const k = await quickAddKind(fin, { name: "Courier" }, "Funds, To approve");
    expect(k).toMatchObject({ name: "Courier", active: true });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "expense_kind_added", entityId: k.id } })).summary).toMatch(/Test Finance added the expense kind Courier/);
  });
});

describe("Other must say what it is", () => {
  it("refuses an Other line without 3 to 60 characters of words, on the server", async () => {
    const { txn } = await acceptedMortgage(["LTO_FEE", "OTHER"]);
    const line = (otherDescription: string) => requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "OTHER", cents: 30_000, otherDescription }] });
    await expect(line("")).rejects.toThrow(/Say what this expense is/);
    await expect(line("ab")).rejects.toThrow(/at least 3/);
    await expect(line("x".repeat(61))).rejects.toThrow(/60 characters/);
    await expect(line("12345")).rejects.toThrow(/in words/);
    await expect(requestAdvance(dp, { others: [{ kind: "OTHER", cents: 10_000, otherDescription: "!!" }] })).rejects.toThrow(/Say what this expense is/);
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "OTHER", cents: 30_000, otherDescription: "  Courier  " }] });
    const l = await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } });
    expect(l).toMatchObject({ kind: "OTHER", otherDescription: "Courier", amountSource: "TYPED" });
    expect(lineKindText(await kindNames(), l)).toBe("Other: Courier");
  });

  it("an old Other line without text shows Other (not described), never blocked", async () => {
    expect(lineKindText(await kindNames(), { kind: "OTHER", otherDescription: "" })).toBe("Other (not described)");
  });

  it("the CSV has its own Other description column", () => {
    expect(FUNDS_CSV_HEADER).toEqual(expect.arrayContaining(["Other description", "Preset amount", "Locked", "Amount source"]));
    const csv = fundsCsv([{ number: "CA-1", typeCode: "CA", typeName: "Cash advance", status: "REQUESTED", processor: "P", branch: "B", branchCode: "101", area: "", requestedCents: 100, approvedCents: null, releasedCents: 0, receiptCents: 0, returnedCents: 0, releasedOn: "", releaseRef: "", transferDate: "", accountProvider: "", accountName: "", accountLast4: "", liquidateBy: "", cashToSettle: false, lines: "Other: Courier", otherDescriptions: "Courier", presetAmounts: "", locked: "No", amountSources: "Typed" }]);
    expect(csv.split("\r\n")[1]).toMatch(/Other: Courier,Courier,,No,Typed$/);
  });
});

describe("inactive kinds", () => {
  it("are not offered for new requests or flags, and old records keep them", async () => {
    const k = await quickAddKind(fin, { name: "Parking" });
    const r = await requestAdvance(dp, { others: [{ kind: k.code, cents: 5_000, note: "Mall parking" }] });
    await setRowActive(admin, "expenseKind", k.id, false);
    await expect(requestAdvance(dp, { others: [{ kind: k.code, cents: 5_000, note: "Mall parking" }] })).rejects.toThrow(/Parking is inactive/);
    const old = await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } });
    expect(lineKindText(await kindNames(), old)).toBe("Parking");
    // Not kept on a new funds flag.
    const { txn } = await acceptedMortgage(["LTO_FEE", k.code]);
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).fundsKinds).toEqual(["LTO_FEE"]);
  });
});

describe("amount per kind", () => {
  it("a preset prefills; unlocked can be changed and records Preset was; locked is refused on the server", async () => {
    await saveSettingsRow(admin, "expenseKind", (await kind("PPSR_FEE")).id, { name: "PPSR fee", amountMode: "SUGGESTED", amount: "500" });
    await saveSettingsRow(admin, "expenseKind", (await kind("NOTARY_FEE")).id, { name: "Notary fee", amountMode: "FIXED", amount: "1,200" });
    const { txn } = await acceptedMortgage(["PPSR_FEE", "NOTARY_FEE"]);
    const job = (await requestableJobs(dp)).find((j) => j.transactionId === txn.id)!;
    expect(job.kinds.find((k) => k.kind === "PPSR_FEE")).toMatchObject({ suggestedCents: 50_000, suggestedFrom: "preset", locked: false });
    expect(job.kinds.find((k) => k.kind === "NOTARY_FEE")).toMatchObject({ suggestedCents: 120_000, suggestedFrom: "preset", locked: true });
    await expect(requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "NOTARY_FEE", cents: 100_000 }] })).rejects.toThrow(/fixed amount of ₱1,200.00. It cannot be changed/);
    const r = await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "PPSR_FEE", cents: 60_000 }, { transactionId: txn.id, kind: "NOTARY_FEE", cents: 120_000 }] });
    const lines = await prisma.cashAdvanceLine.findMany({ where: { advanceId: r.id }, orderBy: { kind: "asc" } });
    expect(lines.map((l) => [l.kind, l.amountSource, l.presetCents, l.locked])).toEqual([["NOTARY_FEE", "PRESET", 120_000, true], ["PPSR_FEE", "TYPED", 50_000, false]]);
    // Finance with the tick may change the fixed amount for this one request; the history says so.
    const t = lines.find((l) => l.kind === "NOTARY_FEE")!;
    await saveAdvanceLine(fin, { lineId: t.id }, { kind: "NOTARY_FEE", cents: 90_000 });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "advance_line_changed", entityId: r.id } })).summary).toMatch(/changed the fixed amount of ₱1,200.00 for this request only/);
    expect((await prisma.cashAdvance.findUniqueOrThrow({ where: { id: r.id } })).requestedCents).toBe(150_000);
  });

  it("the rule's Suggested amount wins over the kind's own amount; the maximum still needs a reason", async () => {
    await saveSettingsRow(admin, "expenseKind", (await kind("LTO_FEE")).id, { name: "LTO fee", amountMode: "SUGGESTED", amount: "9000" });
    const { txn } = await acceptedMortgage(["LTO_FEE"]);
    const rule = await prisma.cashAdvanceRule.findFirstOrThrow({ where: { transactionTypeId: txn.typeId, kind: "LTO_FEE", active: true } });
    const job = (await requestableJobs(dp)).find((j) => j.transactionId === txn.id)!;
    expect(job.kinds[0]).toMatchObject({ suggestedCents: Number(rule.suggestedAmount) * 100, suggestedFrom: "rule", locked: false });
    // The preset above the maximum (8,000): it is a suggestion, so it may be asked with the typed reason.
    await expect(requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 900_000 }] })).rejects.toThrow(/above the maximum/);
    await requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: "LTO_FEE", cents: 900_000, overMaxReason: "Two annotations" }] });
  });

  it("a fixed amount above a rule's maximum cannot be saved; Other with no rule uses the OTHER rule as a fallback", async () => {
    const lto = await kind("LTO_FEE");
    await expect(saveSettingsRow(admin, "expenseKind", lto.id, { name: "LTO fee", amountMode: "FIXED", amount: "9000" })).rejects.toThrow(/above the maximum of ₱8,000.00 in the Mortgage rule/);
    await saveSettingsRow(admin, "expenseKind", lto.id, { name: "LTO fee", amountMode: "FIXED", amount: "2500" });
    expect(await kind("LTO_FEE")).toMatchObject({ amountMode: "FIXED", amountCents: 250_000 });
    // An OTHER rule covers a kind without its own rule (here a new kind, Courier).
    const mortgage = await prisma.transactionType.findUniqueOrThrow({ where: { code: "MORTGAGE" } });
    await saveSettingsRow(admin, "caRule", null, { transactionTypeId: mortgage.id, kind: "OTHER", purpose: "Anything else", suggestedAmount: "", maxAmount: "1000" });
    const courier = await quickAddKind(fin, { name: "Courier" });
    const { txn } = await acceptedMortgage(["LTO_FEE", courier.code]);
    const job = (await requestableJobs(dp)).find((j) => j.transactionId === txn.id)!;
    expect(job.kinds.find((k) => k.kind === courier.code)).toMatchObject({ maxCents: 100_000 });
    await expect(requestAdvance(dp, { lines: [{ transactionId: txn.id, kind: courier.code, cents: 150_000 }] })).rejects.toThrow(/Courier is above the maximum of ₱1,000.00/);
  });

  it("changing a kind's amount never changes old records", async () => {
    const ppsr = await kind("PPSR_FEE");
    await saveSettingsRow(admin, "expenseKind", ppsr.id, { name: "PPSR fee", amountMode: "SUGGESTED", amount: "500" });
    const r = await requestAdvance(dp, { others: [{ kind: "PPSR_FEE", cents: 50_000, note: "Rush PPSR" }] });
    await saveSettingsRow(admin, "expenseKind", ppsr.id, { name: "PPSR fee", amountMode: "FIXED", amount: "700" });
    expect(await prisma.cashAdvanceLine.findFirstOrThrow({ where: { advanceId: r.id } })).toMatchObject({ requestedCents: 50_000, presetCents: 50_000, amountSource: "PRESET", locked: false });
  });
});

describe("Often typed as Other", () => {
  it("lists descriptions typed 3 times in 90 days, and Add as a kind relabels only when asked", async () => {
    for (const d of ["Courier", "courier", "Parking"]) await requestAdvance(dp, { others: [{ kind: "OTHER", cents: 10_000, otherDescription: d }] });
    expect(await otherSuggestionList()).toEqual([]);
    await requestAdvance(dp, { others: [{ kind: "OTHER", cents: 10_000, otherDescription: "COURIER " }] });
    expect(await otherSuggestionList()).toEqual([expect.objectContaining({ count: 3 })]);
    const r = await addSuggestionAsKind(fin, { name: "Courier", amountMode: "SUGGESTED", amount: "150", relabel: true });
    expect(r.relabelled).toBe(3);
    expect(await prisma.cashAdvanceLine.count({ where: { kind: r.kind.code } })).toBe(3);
    expect(await prisma.cashAdvanceLine.count({ where: { kind: "OTHER", otherDescription: "Parking" } })).toBe(1);
    expect(await otherSuggestionList()).toEqual([]);
  });
});

describe("import and template", () => {
  it("adds and updates kinds by name, with the amount mode", async () => {
    const csv = toCsv(["name", "amount_mode", "amount", "status", "notes"], [
      { name: "Courier", amount_mode: "Suggested", amount: "150", status: "Active", notes: "" },
      { name: "transport", amount_mode: "Fixed", amount: "300", status: "", notes: "" },
      { name: "Other", amount_mode: "Fixed", amount: "10", status: "", notes: "" },
    ]);
    const plan = await checkImport(admin, "expense-kinds", "kinds.csv", csv);
    expect(plan.ok && plan.counts).toEqual({ new: 1, changed: 1, unchanged: 0, problem: 1 });
    await runImport(admin, "expense-kinds", "kinds.csv", csv);
    expect(await prisma.expenseKind.findFirstOrThrow({ where: { nameKey: "courier" } })).toMatchObject({ amountMode: "SUGGESTED", amountCents: 15_000 });
    expect(await kind("TRANSPORT")).toMatchObject({ amountMode: "FIXED", amountCents: 30_000, name: "Transport" });
    expect(await kind("OTHER")).toMatchObject({ amountMode: "TYPED", amountCents: null });
  });
});
