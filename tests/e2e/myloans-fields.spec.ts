import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, watchConsole } from "./helpers";

/**
 * The MyLoans account details (docs/myloans/field-map.md): Find a loan shows the short list, names only;
 * the loan file's More loan details (collapsed) shows the full set with codes and IDs.
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

test("Find a loan: the short list, names only; More loan details: the full set with codes and IDs", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto(`/search?q=${PN}`);
  const card = main(page).locator("[data-find-preview]");

  // Header: name and PN; on the right the status by name and the source (no "all good" chips).
  await expect(card.getByRole("heading", { name: "Ana Villanueva" })).toBeVisible();
  await expect(card.locator("[data-find-pn]")).toHaveText(PN);
  await expect(card.getByRole("list", { name: "Loan status" }).getByRole("listitem")).toHaveText(["Loan Released", "MyLoans"]);
  await expect(card.locator("[data-find-amber]")).toHaveCount(0);
  await expect(card.getByText("Loan found")).toHaveCount(0);

  // Exactly eight facts, two rows of four, names only.
  await expect(card.locator("dt")).toHaveText(["Amount released", "Released on", "Loan type", "Product", "Branch", "Area", "Division", "Company"]);
  const values = await card.locator("dd").allTextContents();
  expect(values[0]).toBe("₱1,000,000");
  expect(values.slice(2)).toEqual(["Renewal", "Auto Financing", "Angono", "LUZON 1 (NGMA + RIZAL)", "Branch Division", "Global Dominion Financing Inc."]);
  // No codes or IDs, and the identity details live on the loan file now.
  const text = (await card.textContent()) ?? "";
  for (const hidden of ["AF-001", "CIN", "CIF", "Vehicle", "Toyota", "Source loan ID", "ML-2026", "Status ID", "Area ID", "(165)", "· 165"]) expect(text).not.toContain(hidden);
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
  await page.screenshot({ path: `${DIR}/find-loan-found-${width(page)}.png`, fullPage: true });

  // Open the loan file; More loan details is collapsed, then shows everything.
  await main(page).getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main(page).getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${PN}`));
  const more = page.locator("[data-more-loan-details]");
  await expect(more).not.toHaveAttribute("open", "");
  await expect(more.getByText("Global Dominion Financing Inc.")).toBeHidden();
  await more.getByText("More loan details").click();
  await expect(more).toHaveAttribute("open", "");

  const group = (title: string) => more.locator(`[data-more-group="${title}"]`);
  const row = async (title: string) =>
    Object.fromEntries(await group(title).locator("dl > div").evaluateAll((ds) => ds.map((d) => [d.querySelector("dt")!.textContent!.trim(), d.querySelector("dd")!.textContent!.trim()])));
  expect(await row("Identity")).toEqual({ PN, "Source loan ID": "ML-202600003", CIN: "CIN-771003", CIF: "CIF-551003" });
  expect(await row("Loan")).toEqual({ "Borrower name": "Ana Villanueva", "Amount released": "₱1,000,000", "Released on": expect.stringMatching(/2026/), "Loan type": "Renewal", "Product name": "Auto Financing", "Product code": "AF-001" });
  expect(await row("Organization")).toEqual({ Company: "1 · Global Dominion Financing Inc.", Division: "1 · Branch Division", Area: "1 · LUZON 1 (NGMA + RIZAL)", Branch: "165 · Angono" });
  expect(await row("Status")).toEqual({ "Status ID": "12", "Status name": "Loan Released", Active: "Yes" });
  const src = await row("Source");
  expect(src).toMatchObject({ Source: "MyLoans", "Opened at": expect.stringContaining("Test Loan Associate") });
  for (const k of ["Retrieved at", "Last checked", "Last updated in MyLoans"]) expect(src[k]).toMatch(/\d/); // a time, not "-"
  // Why this was set up: the rule's title and reason, never a rule number.
  await expect(more.getByText("Why this was set up")).toBeVisible();
  await expect(more.locator('[data-rule-why="MORTGAGE_THRESHOLD"]')).toHaveText("Mortgage needed · This is a Renewal loan of ₱1,000,000 or below.");
  await expect(more).not.toContainText(/Rule \d/);
  // Two compact columns when the panel is wide enough (34rem); one in the narrow side column. Either way no
  // value is squeezed: each value is at least 6rem wide and a time stays on a few lines.
  const [a, b] = [(await group("Identity").boundingBox())!, (await group("Loan").boundingBox())!];
  const panel = (await more.boundingBox())!;
  if (panel.width >= 34 * 16) expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  else expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  for (const dd of await more.locator("dd").all()) expect((await dd.boundingBox())!.width).toBeGreaterThanOrEqual(90);
  const updated = (await group("Source").locator("dd").nth(3).boundingBox())!;
  expect(updated.height).toBeLessThan(80);
  await noSideways(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${DIR}/more-loan-details-${width(page)}.png`, fullPage: true });
  expect(await db.loan.count()).toBe(1);
  clean();
});
