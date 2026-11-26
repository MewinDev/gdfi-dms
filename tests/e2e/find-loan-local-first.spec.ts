import { expect, test, type Page } from "@playwright/test";
import { db, resetLoans } from "./db";
import { signIn, watchConsole } from "./helpers";

/**
 * Find a loan, local first, on the one Loans page (D-059): part of a PN or a name searches the DMS only (the table is
 * the result; never myloans); a full PN with or without GD that is not saved yet is looked up in myloans once (the two
 * questions, Open loan file); a saved one is its row in the table, with no myloans call.
 */
const SAVED = "GD1012026901001"; // Maria Santos, Antipolo: no questions
const UNSAVED = "GD1652026901003"; // Ana Villanueva, Angono: the two questions
const main = (page: Page) => page.getByRole("main");
const row = (page: Page, pn: string) => main(page).locator(`[data-loan-row="${pn}"]:visible`);
async function openSaved(page: Page) {
  await page.goto(`/loans?q=${SAVED}`);
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${SAVED}`));
}

test.beforeEach(async () => {
  await resetLoans();
  await db.pnSearchLog.deleteMany({});
});

test("an unsaved PN: one lookup, the two questions, Open loan file", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto("/loans?find=1");
  await expect(main(page).locator("#find-loan")).toBeFocused();
  await main(page).locator("#find-loan").fill(UNSAVED);
  await main(page).locator("#find-loan").press("Enter");
  await expect(page).toHaveURL(new RegExp(`/loans\\?q=${UNSAVED}`));
  const preview = main(page).locator("[data-find-preview]");
  await expect(preview.locator("[data-find-source]")).toBeVisible();
  await main(page).getByRole("radio", { name: "Undertaking", exact: true }).check({ force: true });
  await main(page).getByRole("radio", { name: "Transferred", exact: true }).check({ force: true });
  await main(page).getByRole("button", { name: "Open loan file" }).click();
  await expect(page).toHaveURL(new RegExp(`/loans/${UNSAVED}`));
  clean();
});

test("the PN without GD: the myloans preview; a saved one is its row, with no myloans call", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await page.goto(`/loans?q=${UNSAVED.slice(2)}`);
  await expect(main(page).locator("[data-find-preview]").getByText(UNSAVED)).toBeVisible();
  await expect(main(page).locator("[data-pn-error]")).toHaveCount(0);
  await openSaved(page);
  const calls = await db.myLoansCallHour.aggregate({ _sum: { calls: true } });
  await page.goto(`/loans?q=${SAVED.slice(2)}`);
  await expect(row(page, SAVED)).toBeVisible();
  await expect(main(page).locator("[data-myloans-result]")).toHaveCount(0);
  expect((await db.myLoansCallHour.aggregate({ _sum: { calls: true } }))._sum.calls).toBe(calls._sum.calls);
  clean();
});

test("part of a PN or a name: the DMS only; the rows, or No loans match", async ({ page }) => {
  const clean = watchConsole(page);
  await signIn(page, "la");
  await openSaved(page);
  await db.pnSearchLog.deleteMany({});
  await page.goto("/loans?q=GD10120269");
  await expect(row(page, SAVED)).toContainText("Maria Santos");
  await expect(main(page).locator("[data-find-preview]")).toHaveCount(0);
  await page.goto(`/loans?q=${encodeURIComponent("Zzz Nobody")}`);
  await expect(main(page).locator("[data-empty-line]")).toContainText('No loans match "Zzz Nobody"');
  await expect(main(page).locator("[data-empty-line]")).toContainText("Type the full PN to look it up in myloans");
  expect(await db.pnSearchLog.count()).toBe(0);
  clean();
});
