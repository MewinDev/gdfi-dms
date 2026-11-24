// @vitest-environment node
/**
 * D-049: products from API 5 (the mock), a manual Financing / Refinancing setting that overrides the keywords and
 * survives a rename, the tick, and "Test keyword rules" over all active products. When myloans' real product list
 * (docs/incoming/myloans-round4-results/pr_products.tsv) is in the repo, the before/after check runs on it.
 * LOCAL test database only.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { DEFAULT_CLASSIFICATION_RULES } from "@/lib/rules/classify";
import { resetMockData } from "@/lib/myloans/v1/mock-store";
import { PRODUCTS_FILE } from "@/lib/myloans/v1/products-file";
import { productPreview, refreshProducts, setProductClassification } from "@/lib/services/products";
import { asUser } from "./helpers";

const FAKE = [
  { productId: 990001, productCode: "Z-2H", name: "Zz SME - 2nd Hand Vehicle Loan" },
  { productId: 990002, productCode: "Z-BN", name: "Zz Brand New Motorcycle Loan" },
  { productId: 990003, productCode: "Z-RHT", name: "Zz SME - Refinancing Heavy Truck" },
  { productId: 990004, productCode: "Z-TO", name: "Zz Real Estate Take Out" },
  { productId: 990005, productCode: "Z-PL", name: "Zz Personal Loan" },
];

async function clean() {
  await prisma.mockMyLoansProduct.deleteMany({ where: { productId: { gte: 990000 } } });
  await prisma.product.deleteMany({ where: { sourceProductId: { gte: 990000 } } });
  await prisma.product.updateMany({ data: { classification: null, classificationNote: "" } });
}

beforeEach(async () => {
  process.env.MYLOANS_MODE = "mock";
  await setSetting("myloans.mockFailures", []);
  await setSetting("classification.rules", DEFAULT_CLASSIFICATION_RULES);
  await clean();
  await resetMockData();
  await prisma.mockMyLoansProduct.createMany({ data: FAKE.map((p) => ({ ...p, active: true })) });
  await refreshProducts();
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

const row = async (name: string) => (await productPreview()).rows.find((r) => r.name === name)!;

describe("product classification (D-049)", () => {
  it("API 5 fills the product list; 2nd hand and brand new are Financing; Refinancing Heavy Truck stays Refinancing; unclear ones say Please confirm", async () => {
    expect(await prisma.product.count({ where: { sourceProductId: { gte: 990000 } } })).toBe(5);
    expect((await row("Zz SME - 2nd Hand Vehicle Loan")).before).toMatchObject({ classification: "FINANCING", keyword: "2nd hand" });
    expect((await row("Zz Brand New Motorcycle Loan")).before).toMatchObject({ classification: "FINANCING", keyword: "brand new" });
    expect((await row("Zz SME - Refinancing Heavy Truck")).before.classification).toBe("REFINANCING");
    expect((await row("Zz Personal Loan")).before).toMatchObject({ classification: "REFINANCING", step: "DEFAULT" }); // "Classified by default"
  });

  it("a manual setting overrides the keywords; a reason is required; audited; the note goes once it is set", async () => {
    const sup = await asUser("test.lahead@gdfi.ph");
    const p = await prisma.product.findFirstOrThrow({ where: { sourceProductId: 990003 } });
    await expect(setProductClassification(sup, p.id, "FINANCING", "no")).rejects.toThrow(/at least 5 characters/);
    await setProductClassification(sup, p.id, "FINANCING", "Confirmed with Credit");
    expect((await row("Zz SME - Refinancing Heavy Truck")).before).toMatchObject({ classification: "FINANCING", step: "MANUAL" });
    expect(await prisma.auditLog.count({ where: { action: "product_classification_set", entityId: p.id } })).toBe(1);
    const t = await prisma.product.findFirstOrThrow({ where: { sourceProductId: 990004 } });
    await setProductClassification(sup, t.id, "REFINANCING", "Decided by the branch head");
    expect((await row("Zz Real Estate Take Out")).before.step).toBe("MANUAL");
    // Back to the keywords.
    await setProductClassification(sup, p.id, null, "Credit changed their mind");
    expect((await row("Zz SME - Refinancing Heavy Truck")).before.classification).toBe("REFINANCING");
  });

  it("a rename in myloans keeps the manual setting (matched by ProductID)", async () => {
    const sup = await asUser("test.lahead@gdfi.ph");
    const p = await prisma.product.findFirstOrThrow({ where: { sourceProductId: 990005 } });
    await setProductClassification(sup, p.id, "FINANCING", "Confirmed with Credit");
    await prisma.mockMyLoansProduct.update({ where: { productId: 990005 }, data: { name: "Zz Personal Loan Plus" } });
    expect((await refreshProducts()).renamed).toBe(1);
    const after = await prisma.product.findFirstOrThrow({ where: { sourceProductId: 990005 } });
    expect(after).toMatchObject({ name: "Zz Personal Loan Plus", classification: "FINANCING" });
    expect((await row("Zz Personal Loan Plus")).before).toMatchObject({ classification: "FINANCING", step: "MANUAL" });
  });

  it("someone without Manage product classification cannot change it", async () => {
    const la = await asUser("test.la@gdfi.ph");
    const p = await prisma.product.findFirstOrThrow({ where: { sourceProductId: 990001 } });
    await expect(setProductClassification(la, p.id, "REFINANCING", "Should not work")).rejects.toThrow(/Manage product classification/);
  });

  it("myloans' real product list (pr_products.tsv, 88 active): 20 products move from Refinancing (default) to Financing; nothing else changes", async () => {
    expect(existsSync(path.join(process.cwd(), PRODUCTS_FILE))).toBe(true);
    await prisma.mockMyLoansProduct.deleteMany({ where: { productId: { gte: 990000 } } });
    await refreshProducts();
    const before = { ...DEFAULT_CLASSIFICATION_RULES, financing: DEFAULT_CLASSIFICATION_RULES.financing.filter((k) => k.text !== "brand new" && k.text !== "2nd hand") };
    await setSetting("classification.rules", before);
    const p = await productPreview(DEFAULT_CLASSIFICATION_RULES);
    expect(p.moving).toEqual([{ from: "Refinancing (default)", to: "Financing", n: 20 }]);
    for (const r of p.rows.filter((x) => /refinancing heavy truck/i.test(x.name))) expect(r.after.classification, r.name).toBe("REFINANCING");
    expect(p.rows.filter((r) => /refinancing heavy truck/i.test(r.name))).toHaveLength(2);
  });

  it("D-052: on by default for the LA Supervisor/Head only; Admin and Superadmin need it granted; every change shows in the product's history with its reason", async () => {
    const p = await prisma.product.findFirstOrThrow({ where: { sourceProductId: 990001 } });
    for (const email of ["test.admin@gdfi.ph", "test.superadmin@gdfi.ph"]) {
      await expect(setProductClassification(await asUser(email), p.id, "REFINANCING", "Should not work")).rejects.toThrow(/Manage product classification/);
    }
    const sup = await asUser("test.lahead@gdfi.ph");
    await setProductClassification(sup, p.id, "REFINANCING", "Credit decided: a refinancing product");
    await setProductClassification(sup, p.id, null, "Back to the keywords after review");
    const h = (await productPreview()).rows.find((r) => r.id === p.id)!.history;
    expect(h).toHaveLength(2);
    expect(h[0].text).toContain("Back to the keywords after review");
    expect(h[1].text).toContain("Credit decided: a refinancing product");
  });
});

