// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getSetting, setSetting } from "@/lib/settings";
import { setUserBranches } from "@/lib/services/access";
import { previewClassification, reclassifyLoan, saveClassificationRules, classificationChangedText } from "@/lib/services/classification";
import { listLoans } from "@/lib/services/queries";
import { proposeEffect } from "@/lib/myloans/changes";
import { DEFAULT_CLASSIFICATION_RULES, asRules } from "@/lib/rules/classify";
import { asUser } from "./helpers";

/**
 * D-031 product classification: Settings save (audited, re-checks open loans), the preview, "Classified by
 * default", "Classification changed since accepted", Reclassify (permission, scope, remarks, audit), and a
 * myloans rename that flips the result. Test database only; fake borrowers and product names.
 */
const P = "GD9992099880";
let admin: CurrentUser, la: CurrentUser, supOther: CurrentUser, head: CurrentUser;
let angono: string;

async function loan(n: string, productName: string, classification: "FINANCING" | "REFINANCING", extra: Record<string, unknown> = {}) {
  const opener = await prisma.user.findUniqueOrThrow({ where: { email: "test.admin@gdfi.ph" } });
  return prisma.loan.create({
    data: {
      pn: `${P}${n}`, borrowerName: `Zz Class ${n}`, branchId: angono, loanType: "New", productName, totalReleasedAmount: 400000, releasedAt: new Date(), sourceStatus: "RELEASED", retrievedAt: new Date(), openedById: opener.id,
      classification, mortgageResult: "MORTGAGE", ruleFired: "test", stage: "For checklist", ...extra,
    },
  });
}
async function clean() {
  await prisma.loan.deleteMany({ where: { pn: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: "zz.class." } } });
}

beforeAll(async () => {
  await clean();
  angono = (await prisma.branch.findUniqueOrThrow({ where: { code: "165" } })).id;
  const antipolo = (await prisma.branch.findUniqueOrThrow({ where: { code: "101" } })).id;
  admin = await asUser("test.admin@gdfi.ph");
  la = await asUser("test.la@gdfi.ph");
  head = await asUser("test.lahead@gdfi.ph");
  const sup = await prisma.role.findUniqueOrThrow({ where: { key: "SUP" } });
  const u = await prisma.user.create({ data: { email: "zz.class.sup@gdfi.ph", name: "Zz Antipolo Head", roleId: sup.id, isTestUser: true } });
  await setUserBranches(u.id, [antipolo]);
  supOther = await asUser(u.email);
  await setSetting("classification.rules", DEFAULT_CLASSIFICATION_RULES);
});
afterAll(async () => {
  await setSetting("classification.rules", DEFAULT_CLASSIFICATION_RULES);
  await clean();
});

describe("product classification (D-031)", () => {
  it("save: permission, plain-language checks, audit with before and after; re-check flags a changed result only", async () => {
    const refi = await loan("01", "Auto Refinancing", "REFINANCING");
    const byDefault = await loan("02", "Car Loan", "REFINANCING", { classifiedByDefault: true });
    const fin = await loan("03", "Auto Finance", "FINANCING", { financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED" });

    await expect(saveClassificationRules(la, { refinancing: "refinanc", financing: "financ" })).rejects.toThrow(/Ask a Superadmin/);
    // D-052: "Manage product classification" is the LA Supervisor/Head's by default, not Admin's.
    await expect(saveClassificationRules(admin, { refinancing: "refinanc", financing: "financ" })).rejects.toThrow(/Ask a Superadmin/);
    await expect(saveClassificationRules(head, { refinancing: "", financing: "financ" })).rejects.toThrow(/at least one Refinancing keyword/);
    await expect(saveClassificationRules(head, { refinancing: "re", financing: "financ" })).rejects.toThrow(/too short/);

    // Test keyword rules: "financing" only, so "Auto Finance" has no keyword any more.
    const tried = asRules({ refinancing: ["refinanc", "refi"], financing: ["financing"], fallback: "REFINANCING" });
    const preview = await previewClassification(tried);
    expect(preview.rows.find((r) => r.productName === "Auto Finance")).toMatchObject({ next: "REFINANCING", byDefault: true, changes: 1, saved: "FINANCING" });
    expect(await getSetting("classification.rules")).toEqual(DEFAULT_CLASSIFICATION_RULES); // the preview saves nothing

    const r = await saveClassificationRules(head, { refinancing: "refinanc\nrefi", financing: "financing", fallback: "REFINANCING" });
    expect(r.flagged).toBeGreaterThanOrEqual(1);
    const after = await prisma.loan.findMany({ where: { id: { in: [refi.id, byDefault.id, fin.id] } }, orderBy: { pn: "asc" } });
    expect(after.map((l) => l.classificationNow)).toEqual([null, null, "REFINANCING"]);
    expect(after[2].classification).toBe("FINANCING"); // flagged, never applied by itself
    expect(classificationChangedText(after[2])).toBe("Classification changed since accepted: was Financing, now Refinancing.");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "classification_rules_saved" }, orderBy: { at: "desc" } });
    expect(audit.summary).toMatch(/Financing: financing/);

    // Admin's filters: classified by default, and changed since accepted.
    expect((await listLoans(admin, { tab: "all", classification: "BY_DEFAULT", q: P })).map((x) => x.pn)).toContain(byDefault.pn);
    expect((await listLoans(admin, { tab: "all", classification: "CHANGED", q: P })).map((x) => x.pn)).toEqual([fin.pn]);
  });

  it("Reclassify: needs the tick and the branch, a note of 5+ characters; applies the new result, audited", async () => {
    const fin = await prisma.loan.findUniqueOrThrow({ where: { pn: `${P}03` } });
    await expect(reclassifyLoan(la, fin.id, { note: "Product renamed" })).rejects.toThrow(/Reclassify a loan/);
    await expect(reclassifyLoan(supOther, fin.id, { note: "Product renamed" })).rejects.toThrow();
    await expect(reclassifyLoan(admin, fin.id, { note: "ok" })).rejects.toThrow(/at least 5/);
    const p = await reclassifyLoan(admin, fin.id, { note: "Keywords tightened" });
    expect(p.classificationNext).toBe("REFINANCING");
    const l = await prisma.loan.findUniqueOrThrow({ where: { id: fin.id } });
    expect(l).toMatchObject({ classification: "REFINANCING", classificationNow: null, classifiedByDefault: true, financingType: null, orcrStatus: null });
    const a = await prisma.auditLog.findFirstOrThrow({ where: { loanId: fin.id, action: "loan_reclassified" } });
    expect(a.summary).toMatch(/Financing → Refinancing .*Note: Keywords tightened/);
    await expect(reclassifyLoan(admin, fin.id, { note: "Again please" })).rejects.toThrow(/Nothing to reclassify/);
  });

  it("a myloans rename that flips the result is said on the review, and Apply uses the saved keywords", () => {
    const p = proposeEffect({
      category: "MATERIAL", loan: { classification: "FINANCING", financingType: "UNDERTAKING", orcrStatus: "TRANSFERRED", mortgageResult: "MORTGAGE", ruleFired: "x" }, txns: [],
      next: { productName: "Auto Refinancing", loanType: "New", amount: 40_000_000 } as never, rules: DEFAULT_CLASSIFICATION_RULES,
    });
    expect(p.classificationNext).toBe("REFINANCING");
    expect(p.sentences.join(" ")).toMatch(/The product name now means Refinancing \(was Financing\)/);
  });
});
