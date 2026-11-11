import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, watchConsole } from "./helpers";

/**
 * Find a loan on a PN MyLoans has not released: a status card (PN, borrower, branch, the MyLoans status
 * by name), never a loan file, no Open button, nothing saved. Status 8 (Check Prepared) and status 14
 * (Cancelled). Screenshots at 1440, 820 and 390: docs/screenshots/status-card/.
 */
const DIR = "docs/screenshots/status-card";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.beforeEach(async () => {
  await resetLoans();
});

const CASES = [
  {
    name: "not-released", pn: "GD1652026901008", kind: "before_release",
    text: "This loan is not released yet. MyLoans status: Check Prepared.", borrower: "Roberto Cruz", branch: "Angono", status: "Check Prepared",
  },
  {
    name: "cancelled", pn: "GD1012026901013", kind: "cancelled",
    text: "This loan was cancelled in MyLoans.", borrower: "Andres Lim", branch: "Antipolo", status: "Cancelled",
  },
] as const;

for (const c of CASES) {
  test(`status card: ${c.name} (${c.status})`, async ({ page }) => {
    const clean = watchConsole(page);
    await signIn(page, "la");
    await page.goto(`/search?q=${c.pn}`);
    const card = main(page).locator(`[data-find-status="${c.kind}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator("[data-status-text]")).toHaveText(c.text);
    for (const v of [c.pn, c.borrower, c.branch, c.status]) await expect(card.getByText(v, { exact: true }).first()).toBeVisible();
    // Never a loan file: no Open button, no preview, no questions, nothing saved.
    await expect(main(page).getByRole("button", { name: "Open loan file" })).toHaveCount(0);
    await expect(main(page).locator("[data-find-preview]")).toHaveCount(0);
    await expect(main(page).locator("[data-find-problem]")).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Try again" })).toBeVisible();
    await noSideways(page);
    await shot(page, c.name);
    expect(await db.loan.count({ where: { pn: c.pn } })).toBe(0);
    clean();
  });
}

test("status 15 (not a loan) shows only 'No loan with this PN was found in MyLoans.', never the status", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/search?q=GD1652026901015");
  const n = main(page).locator('[data-find-problem="not_found"]');
  await expect(n).toBeVisible();
  await expect(n.getByText("No loan with this PN was found in MyLoans.")).toHaveCount(1);
  await expect(main(page).locator("[data-find-status]")).toHaveCount(0);
  await expect(main(page).getByText(/Disbursement check|Check Record Only/)).toHaveCount(0);
  await noSideways(page);
  clean();
});
