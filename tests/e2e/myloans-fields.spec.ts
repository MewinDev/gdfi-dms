import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, watchConsole, docShot } from "./helpers";

/**
 * The MyLoans account details (docs/myloans/field-map.md): Find a loan shows the short list, names only;
 * the loan file's Loan at a glance shows what people need (D-062: no open / close; the codes and IDs for Admin only).
 * Screenshots at 1440, 820 and 390: docs/screenshots/myloans-fields/.
 */
const DIR = "docs/screenshots/myloans-fields";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
const PN = "GD1652026901003"; // Ana Villanueva, Angono (165), Auto Financing (AF-001), area 1, division 1, company 1

async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.beforeEach(async () => {
  await resetLoans();
});

test("Find a loan: the short list, names only; Loan at a glance: what people need; the codes and IDs for Admin", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto(`/search?q=${PN}`);
  const card = main(page).locator("[data-find-preview]");

  // Header: name and PN; on the right the status by name and the source (no "all good" chips).
  await expect(card.getByRole("heading", { name: "Ana Villanueva" })).toBeVisible();
  await expect(card.locator("[data-find-pn]")).toHaveText(PN);
  await expect(card.getByRole("list", { name: "Loan status" }).getByRole("listitem")).toHaveText(["Loan Released", "myloans · Not yet in DMS"]);
  await expect(card.locator("[data-find-amber]")).toHaveCount(0);
  await expect(card.getByText("Loan found")).toHaveCount(0);

  // The facts by name (D-060 adds CIN and Classification; the status in myloans is the chip, not a fact).
  await expect(card.locator("dt")).toHaveText(["Amount released", "Released on", "Loan type", "Product", "Branch", "Area", "Division", "Company", "CIN", "Classification"]);
  const values = await card.locator("dd").allTextContents();
  expect(values[0]).toBe("₱1,000,000");
  expect(values.slice(2)).toEqual(["Renewal", "Auto Financing", "Angono", "LUZON 1 (NGMA + RIZAL)", "Branch Division", "Global Dominion Financing Inc.", "CIN-771003", "Financing"]); // D-060: CIN, Classification
  // No codes or IDs (the CIN is shown since D-060); the other identity details live on the loan file.
  const text = (await card.textContent()) ?? "";
  for (const hidden of ["AF-001", "CIF", "Vehicle", "Toyota", "Source loan ID", "ML-2026", "Status ID", "Area ID", "(165)", "· 165"]) expect(text).not.toContain(hidden);
  if (width(page) >= 1024) {
    // Chips on the right of the name block, vertically centred with it.
    const head = (await card.locator("[data-find-head] > div").first().boundingBox())!;
    const chip = (await card.locator("[data-find-source]").boundingBox())!;
    expect(chip.x).toBeGreaterThan(head.x + head.width);
    expect(Math.abs(chip.y + chip.height / 2 - (head.y + head.height / 2))).toBeLessThan(4);
  }
  await noSideways(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.evaluate(() => window.scrollTo(0, 0));
  await docShot(page, { path: `${DIR}/find-loan-found-${width(page)}.png`, fullPage: true });

  // Open the loan file. D-062 review: Loan at a glance shows what people need, with no open / close; the codes
  // and IDs only for people who manage the myloans link.
  await main(page).getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main(page).getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
  const glance = page.locator("[data-glance]");
  await expect(page.getByText("More loan details")).toHaveCount(0);
  await expect(glance.locator("details, summary")).toHaveCount(0);
  const fact = (k: string) => glance.locator(`[data-glance-fact="${k}"] dd`);
  await expect(fact("cin")).toHaveText("CIN-771003");
  await expect(fact("cif")).toHaveText("CIF-551003");
  await expect(fact("area")).toHaveText("LUZON 1 (NGMA + RIZAL)");
  // The status in myloans is a chip beside the due badge in the summary card (not in Loan at a glance).
  await expect(glance.locator('[data-glance-fact="status"]')).toHaveCount(0);
  await expect(page.locator("[data-card-identity] [data-myloans-status]").first()).toHaveText(/Loan Released/);
  await expect(fact("opened")).toContainText("Test Loan Associate");
  // Why this was set up: the rule's title and reason, never a rule number.
  await expect(glance.locator('[data-rule-why="MORTGAGE_THRESHOLD"]')).toHaveText("Mortgage needed · This is a Renewal loan of ₱1,000,000 or below.");
  await expect(glance).not.toContainText(/Rule \d/);
  // Not repeated (the header has them) and no codes for an LA.
  for (const t of ["Source loan ID", "Product code", "Status ID", "Borrower name", "Product name"]) await expect(glance).not.toContainText(t);
  await expect(glance.locator("[data-myloans-codes]")).toHaveCount(0);
  for (const dd of await glance.locator("dd").all()) expect((await dd.boundingBox())!.width).toBeGreaterThanOrEqual(60);
  await noSideways(page);

  // Admin (myloans:manage): the myloans codes and IDs as well.
  await signIn(page, "admin");
  await page.goto(`/loans/${PN}`);
  const codes = page.locator("[data-myloans-codes]");
  const code = async () => Object.fromEntries(await codes.locator("dl > div").evaluateAll((ds) => ds.map((d) => [d.querySelector("dt")!.textContent!.trim(), d.querySelector("dd")!.textContent!.trim()])));
  expect(await code()).toMatchObject({
    "Source loan ID": "ML-202600003", "Product code": "AF-001", Branch: "165 · Angono", Area: "1 · LUZON 1 (NGMA + RIZAL)",
    Division: "1 · Branch Division", Company: "1 · Global Dominion Financing Inc.", "Status ID": "12", Active: "Yes",
  });
  for (const k of ["Retrieved", "Updated in myloans"]) expect((await code())[k]).toMatch(/\d/); // a time, not "-"
  await noSideways(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await docShot(page, { path: `${DIR}/more-loan-details-${width(page)}.png`, fullPage: true });
  expect(await db.loan.count()).toBe(1);
  clean();
});
