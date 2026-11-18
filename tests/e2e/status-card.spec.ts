import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, watchConsole, docShot } from "./helpers";

/**
 * Find a loan on a PN myloans has not released (API 1 answers 422, D-050 / D-051): a card that gives the reason only
 * (myloans' status name and why), never the borrower's name, the branch or other details, never a loan file, no Open
 * button, nothing saved. Status 8 (Check Prepared), status 14 (Cancelled), status 15 (a disbursement-check record:
 * "not a released loan", without its internal status name). Screenshots: docs/screenshots/status-card/.
 */
const DIR = "docs/screenshots/status-card";
const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.getByRole("main");
async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await docShot(page, { path: `${DIR}/${name}-${width(page)}.png`, fullPage: true });
}
async function noSideways(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.beforeEach(async () => {
  await resetLoans();
});

const CASES = [
  { name: "not-released", pn: "GD1652026901008", feed: "NotReleased", text: /^Not released in myloans/, chip: "Check Prepared", borrower: "Roberto Cruz" },
  { name: "cancelled", pn: "GD1012026901013", feed: "Cancelled", text: /^Cancelled in myloans\./, chip: "Cancelled", borrower: "Andres Lim" },
  { name: "status-15", pn: "GD1652026901015", feed: "NotReleased", text: /^Not released in myloans/, chip: "Not released", borrower: null },
] as const;

for (const c of CASES) {
  test(`not a released loan: ${c.name} (${c.chip})`, async ({ page }) => {
    const clean = watchConsole(page);
    await signIn(page, "la");
    await page.goto(`/search?q=${c.pn}`);
    const card = main(page).locator('[data-find-status="not_selectable"]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-feed-state", c.feed);
    await expect(card.locator("[data-status-text]")).toHaveText(c.text);
    await expect(card.locator("[data-find-pn]")).toHaveText(c.pn);
    await expect(card.getByRole("list", { name: "Loan status" }).getByRole("listitem")).toHaveText([c.chip, "MyLoans"]);
    // The reason only: no borrower name, no branch, no loan details (API 1 sends none for it).
    if (c.borrower) await expect(card).not.toContainText(c.borrower);
    await expect(card.locator("dt")).toHaveCount(0);
    await expect(main(page).getByText(/Disbursement check|Check Record Only/)).toHaveCount(0);
    // Never a loan file: no Open button, no preview, nothing saved.
    await expect(main(page).getByRole("button", { name: "Open loan file" })).toHaveCount(0);
    await expect(main(page).locator("[data-find-preview]")).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Try again" })).toBeVisible();
    await noSideways(page);
    await shot(page, c.name);
    expect(await db.loan.count({ where: { pn: c.pn } })).toBe(0);
    clean();
  });
}
