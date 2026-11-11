/**
 * Transaction types, document types, Inactive instead of delete, and Import.
 * LOCAL database only. Removes all loan files first; rows the tests add (codes starting with Z)
 * are removed again at the end (test clean-up only: the app itself never deletes them).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { openLoanFile } from "@/lib/services/loan-file";
import { addCustomTransaction, completeLaTransaction, overrideAutomaticResult } from "@/lib/services/workflow";
import { saveSettingsRow, saveUser } from "@/lib/services/admin";
import { inactiveRefusal, setRowActive } from "@/lib/services/settings-status";
import { checkImport, currentDataCsv, runImport } from "@/lib/import/importer";
import { parseCsv, toCsv } from "@/lib/import/csv";
import { getHolidaySet } from "@/lib/settings";
import { UserError } from "@/lib/services/errors";
import { asUser, cleanLoans } from "./helpers";

let la: CurrentUser;
let admin: CurrentUser;

async function cleanup() {
  const tt = await prisma.transactionType.findMany({ where: { code: { startsWith: "Z" } }, select: { id: true } });
  const dt = await prisma.documentType.findMany({ where: { code: { startsWith: "Z" } }, select: { id: true } });
  await prisma.checklistRule.deleteMany({ where: { OR: [{ transactionTypeId: { in: tt.map((t) => t.id) } }, { documentTypeId: { in: dt.map((d) => d.id) } }] } });
  await prisma.cashAdvanceRule.deleteMany({ where: { transactionTypeId: { in: tt.map((t) => t.id) } } });
  await prisma.transactionType.deleteMany({ where: { code: { startsWith: "Z" } } });
  await prisma.retentionRule.deleteMany({ where: { documentTypeId: { in: dt.map((d) => d.id) } } });
  await prisma.documentType.deleteMany({ where: { code: { startsWith: "Z" } } });
  // Branches the tests make by hand ("Zeta ..."; branch codes are 3 digits now).
  await prisma.branch.deleteMany({ where: { name: { startsWith: "Zeta" } } });
  await prisma.ltoOffice.deleteMany({ where: { code: { startsWith: "Z" } } });
  await prisma.holidayCalendar.deleteMany({ where: { date: { startsWith: "2099-" } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz." } } });
  // Put the seeded rows the tests touch back as they were.
  for (const m of [prisma.branch, prisma.documentType, prisma.ltoOffice, prisma.loanType] as unknown as { updateMany(a: unknown): Promise<unknown> }[]) {
    await m.updateMany({ where: { active: false }, data: { active: true, deactivatedAt: null, deactivatedById: null } });
  }
  await prisma.branch.update({ where: { code: "168" }, data: { name: "A. Mabini" } });
  // Alicia-Inactive (718) is inactive in the seeded list: keep it so.
  await prisma.branch.updateMany({ where: { code: "718" }, data: { active: false } });
  await prisma.user.updateMany({ where: { email: { in: ["test.admin@gdfi.ph", "test.la@gdfi.ph", "dp.rico@gdfi.ph"] } }, data: { active: true, deactivatedAt: null, deactivatedById: null } });
}

beforeAll(async () => {
  la = await asUser("test.la@gdfi.ph");
  admin = await asUser("test.admin@gdfi.ph");
  await cleanup();
});
beforeEach(async () => {
  process.env.TEST_MODE = "true";
  await cleanLoans();
});
afterAll(async () => {
  await cleanLoans();
  await cleanup();
  await prisma.$disconnect();
});

const refused = async (p: Promise<unknown>, msg: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(UserError);
  await expect(p).rejects.toThrow(msg);
};

describe("Migration", () => {
  it("leaves current data active and marks the four built-in transaction types (Alicia-Inactive 718 is inactive in MyLoans)", async () => {
    const counts = await Promise.all([
      prisma.branch.count({ where: { active: false, code: { not: "718" } } }), prisma.loanType.count({ where: { active: false } }),
      prisma.ltoOffice.count({ where: { active: false } }), prisma.holidayCalendar.count({ where: { active: false } }),
      prisma.documentType.count({ where: { active: false } }), prisma.transactionType.count({ where: { active: false } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0]);
    const builtIn = await prisma.transactionType.findMany({ where: { builtIn: true }, orderBy: { sortOrder: "asc" } });
    expect(builtIn.map((t) => t.code)).toEqual(["NOTARY", "EDST", "PPSR", "MORTGAGE"]);
    const cols = await prisma.$queryRaw<{ column_default: string }[]>`SELECT column_default FROM information_schema.columns WHERE table_name = 'HolidayCalendar' AND column_name = 'active'`;
    expect(cols[0].column_default).toBe("true");
  });
});

describe("Transaction types", () => {
  it("adds a custom type with a unique short code; built-ins keep their code and stay active", async () => {
    await saveSettingsRow(admin, "transactionType", null, { name: "Special Power of Attorney", code: "zspa", ownerRole: "DP", requiresDp: true, sortOrder: "5" });
    const t = await prisma.transactionType.findUniqueOrThrow({ where: { code: "ZSPA" } });
    expect(t.builtIn).toBe(false);
    await refused(saveSettingsRow(admin, "transactionType", null, { name: "Again", code: "ZSPA", ownerRole: "DP", requiresDp: true, sortOrder: "6" }), /code is already used/);
    await refused(saveSettingsRow(admin, "transactionType", null, { name: "Bad", code: "Z1", ownerRole: "DP", requiresDp: true, sortOrder: "6" }), /2 to 12 capital letters/);

    const notary = await prisma.transactionType.findUniqueOrThrow({ where: { code: "NOTARY" } });
    await refused(setRowActive(admin, "transactionType", notary.id, false), /built-in/);
    await refused(saveSettingsRow(admin, "transactionType", notary.id, { name: "Notary", code: "NOTARIAL", ownerRole: "DP", requiresDp: true, sortOrder: "1" }), /cannot be changed after it is used/);
    // Rename and re-order are allowed.
    await saveSettingsRow(admin, "transactionType", notary.id, { name: "Notarial work", code: "NOTARY", ownerRole: "DP", requiresDp: true, needsLto: true, sortOrder: "1", description: notary.description });
    expect((await prisma.transactionType.findUniqueOrThrow({ where: { id: notary.id } })).name).toBe("Notarial work");
    await prisma.transactionType.update({ where: { id: notary.id }, data: { name: notary.name } });
  });

  it("the Loan Associate adds a custom type on a loan file; its checklist is copied; the override leaves it", async () => {
    const pn = await prisma.documentType.findUniqueOrThrow({ where: { code: "PN" } });
    await saveSettingsRow(admin, "transactionType", null, { name: "Collection letter", code: "ZCOLL", ownerRole: "LA", requiresDp: false, sortOrder: "7" });
    const tt = await prisma.transactionType.findUniqueOrThrow({ where: { code: "ZCOLL" } });
    await saveSettingsRow(admin, "checklistRule", null, { transactionTypeId: tt.id, documentTypeId: pn.id, label: "Signed letter", required: true, originality: "ORIGINAL", sortOrder: "1" });

    await openLoanFile(la, { pn: "GD1012026901001" });
    const loan = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026901001" } });
    await addCustomTransaction(la, { loanId: loan.id, typeId: tt.id });
    const txn = await prisma.loanTransaction.findFirstOrThrow({ where: { loanId: loan.id, typeId: tt.id }, include: { checks: { include: { rule: true } } } });
    expect(txn.origin).toBe("ADDED");
    expect(txn.checks.map((c) => [c.rule?.label, c.required])).toEqual([["Signed letter", true]]);
    await refused(addCustomTransaction(la, { loanId: loan.id, typeId: tt.id }), /already on this loan file/);
    const notary = await prisma.transactionType.findUniqueOrThrow({ where: { code: "NOTARY" } });
    await refused(addCustomTransaction(la, { loanId: loan.id, typeId: notary.id }), /Pick a transaction/);
    await expect(addCustomTransaction(admin, { loanId: loan.id, typeId: tt.id })).rejects.toThrow(/Your role does not allow this step/);

    // Mark as done needs the required paper.
    await expect(completeLaTransaction(la, { transactionId: txn.id })).rejects.toThrow(/Still needed: Signed letter/);
    await prisma.checklistCheck.update({ where: { id: txn.checks[0].id }, data: { checked: true } });
    await completeLaTransaction(la, { transactionId: txn.id });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("COMPLETED");

    // Supervisor override re-decides only the built-in transactions.
    await overrideAutomaticResult(admin, { loanId: loan.id, classification: "REFINANCING", financingType: null, orcrStatus: null, mortgage: "NOT_MORTGAGE", reason: "Test override, keep the added one" });
    expect((await prisma.loanTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("COMPLETED");

    // Inactive custom types can no longer be added.
    await setRowActive(admin, "transactionType", tt.id, false);
    await cleanLoans();
    await openLoanFile(la, { pn: "GD1012026901001" });
    const loan2 = await prisma.loan.findUniqueOrThrow({ where: { pn: "GD1012026901001" } });
    await refused(addCustomTransaction(la, { loanId: loan2.id, typeId: tt.id }), /inactive/);
  });
});

describe("Document types", () => {
  it("add, edit, code locks once used; inactive hides it from new items but existing items keep it", async () => {
    await saveSettingsRow(admin, "documentType", null, { name: "Title", code: "ztct", defaultOriginality: "ORIGINAL", notes: "" });
    const d = await prisma.documentType.findUniqueOrThrow({ where: { code: "ZTCT" } });
    expect(d.defaultOriginality).toBe("ORIGINAL");
    // Not used yet: the code may change.
    await saveSettingsRow(admin, "documentType", d.id, { name: "Transfer Certificate of Title", code: "ZTCT2", defaultOriginality: "EITHER", notes: "Land only" });
    const notary = await prisma.transactionType.findUniqueOrThrow({ where: { code: "NOTARY" } });
    await saveSettingsRow(admin, "checklistRule", null, { transactionTypeId: notary.id, documentTypeId: d.id, label: "Title", required: false, originality: "ORIGINAL", sortOrder: "50" });
    const rule = await prisma.checklistRule.findFirstOrThrow({ where: { documentTypeId: d.id } });
    // Used now: locked.
    await refused(saveSettingsRow(admin, "documentType", d.id, { name: "TCT", code: "ZTCT3", defaultOriginality: "EITHER", notes: "" }), /cannot be changed after it is used/);

    await setRowActive(admin, "documentType", d.id, false);
    // Not offered for new items…
    await refused(saveSettingsRow(admin, "checklistRule", null, { transactionTypeId: notary.id, documentTypeId: d.id, label: "Title again", required: false, originality: "ORIGINAL", sortOrder: "51" }), /inactive/);
    // …but the item that uses it keeps it and can still be edited.
    await saveSettingsRow(admin, "checklistRule", rule.id, { transactionTypeId: notary.id, documentTypeId: d.id, label: "Title (copy kept)", required: false, originality: "COPY", sortOrder: "50" });
    expect((await prisma.checklistRule.findUniqueOrThrow({ where: { id: rule.id } })).documentTypeId).toBe(d.id);
    await prisma.checklistRule.delete({ where: { id: rule.id } }); // test clean-up
  });
});

describe("Inactive instead of delete", () => {
  it("writes one audit row each time, with who", async () => {
    const lto = await prisma.ltoOffice.findFirstOrThrow({ where: { code: "LTO-MKT" } });
    const before = await prisma.auditLog.count({ where: { entityId: lto.id } });
    await setRowActive(admin, "ltoOffice", lto.id, false);
    await setRowActive(admin, "ltoOffice", lto.id, true);
    const rows = await prisma.auditLog.findMany({ where: { entityId: lto.id }, orderBy: { at: "asc" } });
    expect(rows.length - before).toBe(2);
    expect(rows.slice(-2).map((r) => r.summary)).toEqual([`LTO office ${lto.name} made inactive`, `LTO office ${lto.name} made active`]);
    expect(rows.at(-1)!.actorId).toBe(admin.id);
  });

  it("an inactive branch: no new loan files, but existing loan files are untouched and still open", async () => {
    await openLoanFile(la, { pn: "GD1012026901001" }); // Antipolo
    const qc = await prisma.branch.findUniqueOrThrow({ where: { code: "101" } });
    // Antipolo comes from MyLoans: the DMS cannot switch it off; MyLoans closing it (an accepted review) does.
    await expect(setRowActive(admin, "branch", qc.id, false)).rejects.toThrow(/comes from MyLoans/);
    await prisma.branch.update({ where: { id: qc.id }, data: { active: false, deactivatedAt: new Date() } });
    const la2 = await asUser("test.la@gdfi.ph");
    expect(la2.branchIds).toContain(qc.id); // existing loan files stay reachable
    expect(await prisma.loan.findUnique({ where: { pn: "GD1012026901001" } })).not.toBeNull();
    const n = await prisma.loan.count();
    await cleanLoans();
    await expect(openLoanFile(la2, { pn: "GD1012026901001" })).rejects.toThrow(/Antipolo is inactive/);
    expect(await prisma.loan.count()).toBe(0);
    expect(n).toBe(1);
    await prisma.branch.update({ where: { id: qc.id }, data: { active: true, deactivatedAt: null } });
  });

  it("an inactive holiday is no longer skipped", async () => {
    await saveSettingsRow(admin, "holiday", null, { date: "2099-01-02", name: "Test day" });
    const h = await prisma.holidayCalendar.findUniqueOrThrow({ where: { date: "2099-01-02" } });
    expect((await getHolidaySet()).has("2099-01-02")).toBe(true);
    await setRowActive(admin, "holiday", h.id, false);
    expect((await getHolidaySet()).has("2099-01-02")).toBe(false);
  });

  it("hard limits on the server: yourself, the last active person who can manage roles, the last active branch", async () => {
    await refused(setRowActive(admin, "user", admin.id, false), /cannot make yourself inactive/);
    await refused(saveUser(admin, admin.id, { name: admin.name, email: admin.email, roleId: (await prisma.role.findUniqueOrThrow({ where: { key: "LA" } })).id, active: true }), /cannot take "Manage roles" away from yourself/);
    const admins = await prisma.user.count({ where: { active: true, role: { key: "ADMIN" } } });
    expect(admins).toBe(1);
    expect(await inactiveRefusal("user", { id: admin.id }, { id: "someone-else" })).toMatch(/^This is the last active person who can (manage roles|change branch access)\./);

    // The last active branch (a branch made in the DMS; the others switched off as MyLoans would).
    await saveSettingsRow(admin, "branch", null, { code: "869", name: "Zeta Last" });
    const last = await prisma.branch.findUniqueOrThrow({ where: { code: "869" } });
    const others = await prisma.branch.findMany({ where: { active: true, id: { not: last.id } }, select: { id: true } });
    await prisma.branch.updateMany({ where: { id: { in: others.map((b) => b.id) } }, data: { active: false } });
    try {
      await refused(setRowActive(admin, "branch", last.id, false), /last active branch/);
    } finally {
      await prisma.branch.updateMany({ where: { id: { in: others.map((b) => b.id) } }, data: { active: true } });
    }
  });
});

describe("Import", () => {
  const branchesCsv = (rows: Record<string, string>[]) => toCsv(["code", "name", "status", "notes"], rows);

  it("Check file counts new, changed, unchanged and problem rows; nothing is saved", async () => {
    await saveSettingsRow(admin, "branch", null, { code: "861", name: "Zeta Hand" }); // made in the DMS: editable here
    const file = branchesCsv([
      { code: "101", name: "Antipolo", status: "Active" }, // unchanged
      { code: "861", name: "Zeta Hand Renamed", status: "" }, // changed
      { code: "862", name: "Zeta One", status: "Active" }, // new
      { code: "863", name: "Angono", status: "Active" }, // problem: name used by another branch
      { code: "864", name: "Zeta Three", status: "Maybe" }, // problem: status
      { code: "865", name: "Example", status: "Active", notes: "EXAMPLE, delete this row" }, // problem: example
      { code: "168", name: "Makati City", status: "" }, // problem: a MyLoans branch's name changes only in MyLoans
    ]);
    const plan = await checkImport(admin, "branches", "b.csv", file);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.counts).toEqual({ new: 1, changed: 1, unchanged: 1, problem: 4 });
    const problems = plan.rows.filter((r) => r.action === "problem").flatMap((r) => r.problems);
    expect(problems).toContain("Row 5, Branch name: already used by another branch.");
    expect(problems).toContain("Row 6, Status: type Active or Inactive.");
    expect(problems.some((p) => p.startsWith("Row 7: this is an example row"))).toBe(true);
    expect(problems.some((p) => p.startsWith("Row 8, Branch name: this branch comes from MyLoans"))).toBe(true);
    expect(await prisma.branch.count({ where: { code: { in: ["862", "863", "864"] } } })).toBe(0);
    expect((await prisma.branch.findUniqueOrThrow({ where: { code: "168" } })).name).toBe("A. Mabini");
  });

  it("Import re-checks, applies valid rows in one go, never deletes, writes one audit row", async () => {
    const totalBefore = await prisma.branch.count();
    const auditBefore = await prisma.auditLog.count({ where: { action: "settings_imported" } });
    const file = branchesCsv([
      { code: "866", name: "Zeta B1", status: "Active" },
      { code: "867", name: "Zeta B2", status: "Inactive" },
      { code: "861", name: "Zeta Hand Again", status: "" },
      { code: "868", name: "", status: "" }, // problem: name required
    ]); // Antipolo, Angono and the rest are not in the file: they stay.
    const r = await runImport(admin, "branches", "branches.csv", file);
    if (!r.ok) throw new Error(r.error);
    expect(r.counts).toEqual({ new: 2, changed: 1, unchanged: 0, problem: 1 });
    expect(await prisma.branch.count()).toBe(totalBefore + 2);
    expect((await prisma.branch.findUniqueOrThrow({ where: { code: "867" } })).active).toBe(false);
    expect((await prisma.branch.findUniqueOrThrow({ where: { code: "866" } })).source).toBe("DMS");
    expect(await prisma.branch.findUnique({ where: { code: "868" } })).toBeNull();
    expect(await prisma.branch.findUnique({ where: { code: "165" } })).not.toBeNull();
    const audits = await prisma.auditLog.findMany({ where: { action: "settings_imported" }, orderBy: { at: "desc" } });
    expect(audits.length).toBe(auditBefore + 1);
    expect(audits[0].summary).toBe("Imported Branches from branches.csv: 2 new, 1 updated, 0 unchanged, 1 skipped");
    expect(audits[0].details).toMatchObject({ file: "branches.csv", counts: { new: 2, changed: 1, unchanged: 0, problem: 1 } });

    // Round trip: current data imports back with nothing to change.
    const again = await checkImport(admin, "branches", "current.csv", await currentDataCsv("branches"));
    if (!again.ok) throw new Error(again.error);
    expect(again.counts).toMatchObject({ new: 0, changed: 0, problem: 0 });
  });

  it("refuses formula-looking text; unknown codes in Checklist items are row problems, not crashes", async () => {
    const bad = await checkImport(admin, "branches", "x.csv", branchesCsv([{ code: "870", name: "@SUM(1)", status: "" }]));
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/formula/);

    const cols = ["transaction_code", "document_code", "paper", "original_or_copy", "required", "pick_one_group", "order", "status", "notes"];
    const plan = await checkImport(admin, "checklist", "c.csv", toCsv(cols, [
      { transaction_code: "NOPE", document_code: "PN", original_or_copy: "Original", required: "Yes", order: "1" },
      { transaction_code: "NOTARY", document_code: "NOPE", original_or_copy: "Original", required: "Yes", order: "1" },
      { transaction_code: "NOTARY", document_code: "PN", paper: "Promissory Note copy", original_or_copy: "Original", required: "Maybe", order: "1" },
      { transaction_code: "NOTARY", document_code: "PN", paper: "Promissory Note", original_or_copy: "Original", required: "Yes", order: "1" },
    ]));
    if (!plan.ok) throw new Error(plan.error);
    const p = plan.rows.flatMap((r) => r.problems);
    expect(p).toContain("Row 2, Transaction code: no transaction type has the code NOPE.");
    expect(p).toContain("Row 3, Document code: no document type has the code NOPE.");
    expect(p).toContain("Row 4, Required: type Yes or No.");
    expect(plan.rows.find((r) => r.line === 5)?.action).toBe("unchanged");
  });

  it("enforces the hard limits in a file too (built-in types, yourself)", async () => {
    const tt = await checkImport(admin, "transaction-types", "t.csv", toCsv(["code", "name", "done_by", "needs_processor", "order", "status"], [
      { code: "NOTARY", name: "Notary", done_by: "DP", needs_processor: "Yes", order: "1", status: "Inactive" },
    ]));
    expect(tt.ok && tt.rows[0].problems[0]).toMatch(/built-in/);
    const u = await checkImport(admin, "users", "u.csv", toCsv(["name", "email", "role", "branches", "status"], [
      { name: admin.name, email: admin.email, role: "ADMIN", branches: "101", status: "Inactive" },
      { name: "Zed Person", email: "zz.person@gdfi.ph", role: "DP", branches: "101;165", status: "Active" },
    ]));
    if (!u.ok) throw new Error(u.error);
    expect(u.rows[0].problems.join(" ")).toMatch(/cannot make yourself inactive/);
    expect(u.rows[1].action).toBe("new");
  });

  it("downloads use the same columns", async () => {
    for (const list of ["branches", "users", "checklist"] as const) {
      const rows = parseCsv(await currentDataCsv(list));
      expect(rows[0].length).toBeGreaterThan(1);
      expect(rows.length).toBeGreaterThan(1);
    }
  });
});
